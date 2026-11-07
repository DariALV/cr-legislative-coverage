"""Local read-only explorer for private_corpus.db.

Serves the static page in this folder plus a small JSON API on top of SQLite.
Standard library only. Run from the repo root or anywhere:

    python private_visuals/db_explorer/server.py [--port 8765] [--db path/to/db]

and open http://localhost:8765
"""
import argparse
import json
import sqlite3
import unicodedata
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DEFAULT_DB = ROOT / "databases" / "private_corpus.db"

DB_PATH = DEFAULT_DB


def connect():
    # mode=ro: the explorer never writes to the database.
    conn = sqlite3.connect(f"file:{DB_PATH.as_posix()}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def rows(conn, sql, args=()):
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def norm(s):
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


@lru_cache(maxsize=1)
def bills_index():
    """Compact list of every bill for client-side search and filters (built once)."""
    conn = connect()
    proponents = {}
    for r in conn.execute("SELECT number, name FROM bill_proponents ORDER BY number, signing_order"):
        proponents.setdefault(r["number"], []).append(r["name"])
    subjects = {}
    for r in conn.execute("SELECT number, subject FROM bill_subjects"):
        subjects.setdefault(r["number"], []).append(r["subject"])
    news = dict(conn.execute("SELECT bill_number, COUNT(DISTINCT news_id) FROM news_bill_links GROUP BY 1").fetchall())
    votes = dict(conn.execute("SELECT number, COUNT(*) FROM votes GROUP BY 1").fetchall())
    steps = dict(conn.execute("SELECT number, COUNT(*) FROM bill_steps GROUP BY 1").fetchall())

    out = []
    sql = """SELECT b.number, b.name, b.file_type, b.date_proposed, b.status, b.flag, b.law_number,
                    t.status AS text_status
             FROM bills b LEFT JOIN bill_texts t ON t.number = b.number ORDER BY b.number DESC"""
    for r in conn.execute(sql):
        n = r["number"]
        props = proponents.get(n, [])
        out.append({
            "n": n,
            "name": r["name"],
            "type": r["file_type"],
            "date": r["date_proposed"],
            "status": r["status"],
            "flag": r["flag"],
            "law": r["law_number"],
            "text": r["text_status"],
            "news": news.get(n, 0),
            "votes": votes.get(n, 0),
            "steps": steps.get(n, 0),
            "props": props[:3],
            "nprops": len(props),
            # Accent-free haystack: number, name, proponents and subjects.
            "hay": norm(" ".join([str(n), r["name"], *props, *subjects.get(n, [])])),
        })
    totals = {
        "bills": len(out),
        "news_links": conn.execute("SELECT COUNT(*) FROM news_bill_links").fetchone()[0],
        "votes": conn.execute("SELECT COUNT(*) FROM votes").fetchone()[0],
        "steps": conn.execute("SELECT COUNT(*) FROM bill_steps").fetchone()[0],
    }
    conn.close()
    return json.dumps({"bills": out, "totals": totals}, ensure_ascii=False).encode("utf-8")


def bill_detail(number):
    conn = connect()
    bill = conn.execute("SELECT * FROM bills WHERE number = ?", (number,)).fetchone()
    if not bill:
        conn.close()
        return None
    bill = dict(bill)
    d = {"bill": bill}
    d["text"] = (rows(conn, "SELECT * FROM bill_texts WHERE number = ?", (number,)) or [None])[0]
    d["subjects"] = rows(conn, "SELECT subject_code, subject FROM bill_subjects WHERE number = ? ORDER BY subject", (number,))
    # Faction: the deputy's faction in that term whose dates cover the filing date (fallback: any in the term).
    d["proponents"] = rows(conn, """
        SELECT p.proponent_id, p.name, p.term, p.signing_order, p.deputy_id,
               dp.province, dp.status AS deputy_status,
               COALESCE(
                 (SELECT f.faction FROM deputy_factions f
                   WHERE f.person_id = dp.person_id AND f.term = p.term
                     AND (f.date_from IS NULL OR f.date_from <= :d)
                     AND (f.date_to IS NULL OR f.date_to >= :d)
                   ORDER BY f.date_from DESC LIMIT 1),
                 (SELECT f.faction FROM deputy_factions f
                   WHERE f.person_id = dp.person_id AND f.term = p.term
                   ORDER BY f.date_from LIMIT 1)) AS faction
        FROM bill_proponents p LEFT JOIN deputies dp ON dp.deputy_id = p.deputy_id
        WHERE p.number = :n ORDER BY p.signing_order, p.proponent_id""",
        {"n": number, "d": bill["date_proposed"] or ""})
    d["steps"] = rows(conn, """SELECT step_id, organ, description, date_start, date_end FROM bill_steps
                               WHERE number = ? ORDER BY date_start, step_id""", (number,))
    d["organs"] = rows(conn, """
        SELECT ob.organ_code, o.name, o.organ_type, o.status AS organ_status,
               ob.date_start, ob.date_end, ob.last_step
        FROM organ_bills ob LEFT JOIN organs o ON o.organ_code = ob.organ_code
        WHERE ob.bill_number = ? ORDER BY ob.date_start""", (number,))
    d["laws"] = rows(conn, "SELECT law_id, law_number, title FROM laws WHERE bill_number = ?", (number,))
    votes = rows(conn, "SELECT * FROM votes WHERE number = ? ORDER BY date", (number,))
    for v in votes:
        v["deputies"] = rows(conn, """SELECT name, party, seat, vote, deputy_id FROM vote_deputies
                                      WHERE vote_id = ? ORDER BY vote, name""", (v["vote_id"],))
    d["votes"] = votes
    d["news"] = rows(conn, """
        SELECT a.id, a.url, a.organization, a.title, a.description, a.date_published, a.author,
               a.section, a.outlet_type, a.extraction_status,
               substr(a.content, 1, 600) AS snippet, length(a.content) AS content_len,
               group_concat(l.source) AS sources
        FROM news_bill_links l JOIN news_articles a ON a.id = l.news_id
        WHERE l.bill_number = ? GROUP BY a.id ORDER BY a.date_published DESC""", (number,))
    conn.close()
    return d


def news_content(news_id):
    conn = connect()
    r = conn.execute("SELECT id, content FROM news_articles WHERE id = ?", (news_id,)).fetchone()
    conn.close()
    return dict(r) if r else None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE), **kw)

    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet

    def send_json(self, body, status=200):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            if path.endswith(".py"):
                return self.send_error(404)
            return super().do_GET()
        parts = path.strip("/").split("/")
        try:
            if parts == ["api", "bills"]:
                return self.send_json(bills_index())
            if len(parts) == 3 and parts[1] == "bill" and parts[2].isdigit():
                d = bill_detail(int(parts[2]))
                return self.send_json(d) if d else self.send_json({"error": "not found"}, 404)
            if len(parts) == 3 and parts[1] == "news":
                d = news_content(parts[2])
                return self.send_json(d) if d else self.send_json({"error": "not found"}, 404)
            return self.send_json({"error": "unknown endpoint"}, 404)
        except sqlite3.Error as e:
            return self.send_json({"error": str(e)}, 500)


def main():
    global DB_PATH
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = ap.parse_args()
    DB_PATH = args.db.resolve()
    if not DB_PATH.exists():
        raise SystemExit(f"No existe la base: {DB_PATH}")
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Explorador en http://localhost:{args.port}  (base: {DB_PATH}, solo lectura)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
