"""Local read-only explorer for private_corpus.db.

Serves the static page in this folder plus a small JSON API on top of SQLite.
Standard library only. Run from the repo root or anywhere:

    python private_visuals/db_explorer/server.py [--port 8765] [--db path/to/db]

and open http://localhost:8765

Endpoints (all GET, JSON):
    /api/bills, /api/bill/<n>              bills: compact index (filtered in the browser) and detail
    /api/deputies, /api/deputy/<person_id> deputies: one entry per person (all their terms)
    /api/organs, /api/organ/<organ_code>   organs (committees, Plenario, Directorio...)
    /api/news?q=&org=&from=&to=&linked=&sort=&offset=&limit=   news search (server side: ~30k rows)
    /api/news-facets                       counts for the news filters
    /api/news/<id>                         one article, full content and linked bills
    /photos/<file>                         deputy photos from raw/images/delfino/deputies (fetch_photos.py)

Every person in the JSON carries "photo" (its /photos/ URL, or null) and "ini" (initials of first name and first
surname, shown when there is no photo).
"""
import argparse
import json
import socket
import sqlite3
import unicodedata
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DEFAULT_DB = ROOT / "databases" / "private_corpus.db"
PHOTOS_DIR = ROOT / "raw" / "images" / "delfino" / "deputies"
# Words skipped when taking initials ("DE LA CRUZ" -> "C").
NAME_PARTICLES = {"DE", "DEL", "LA", "LAS", "LOS", "Y"}

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


def unique_organ_code_sql(col):
    """organ_code for a free-text organ name, only when exactly one organ has that name."""
    return f"(SELECT MIN(o.organ_code) FROM organs o WHERE o.name = {col} HAVING COUNT(*) = 1)"


# ---------------------------------------------------------------- people

@lru_cache(maxsize=1)
def photos():
    """{person_id: photo file} from fetch_photos.py's index (empty if it was not run)."""
    try:
        index = json.loads((PHOTOS_DIR / "index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out = {}
    for e in index.get("deputies", []):
        if e.get("person_id") is not None and e.get("file") and (PHOTOS_DIR / e["file"]).is_file():
            out.setdefault(e["person_id"], e["file"])
    return out


def initials(names, surnames):
    """First letter of the first name and of the first surname: "ANA LUCÍA" "DELGADO ORQUERA" -> "AD"."""
    first = lambda s: next((w for w in (s or "").split() if w.upper() not in NAME_PARTICLES), "")[:1]
    return (first(names) + first(surnames)).upper()


def add_face(d, person_id, names, surnames):
    """Adds "photo" and "ini" to a person dict (names/surnames None when the person is not a known deputy)."""
    file = photos().get(person_id)
    d["photo"] = f"/photos/{file}" if file else None
    d["ini"] = initials(names, surnames) if names or surnames else None
    return d


# ---------------------------------------------------------------- bills

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
               dp.person_id, dp.province, dp.status AS deputy_status, dp.names, dp.surnames,
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
    # Steps name their organ in free text; it is linked only when it matches one organ name exactly.
    for p in d["proponents"]:
        add_face(p, p["person_id"], p.pop("names"), p.pop("surnames"))
    d["steps"] = rows(conn, f"""
        SELECT s.step_id, s.organ, s.description, s.date_start, s.date_end,
               {unique_organ_code_sql("s.organ")} AS organ_code
        FROM bill_steps s WHERE s.number = ? ORDER BY s.date_start, s.step_id""", (number,))
    d["organs"] = rows(conn, """
        SELECT ob.organ_code, o.name, o.organ_type, o.status AS organ_status,
               ob.date_start, ob.date_end, ob.last_step
        FROM organ_bills ob LEFT JOIN organs o ON o.organ_code = ob.organ_code
        WHERE ob.bill_number = ? ORDER BY ob.date_start""", (number,))
    d["laws"] = rows(conn, "SELECT law_id, law_number, title FROM laws WHERE bill_number = ?", (number,))
    d["votes"] = votes_with_deputies(conn, "SELECT * FROM votes WHERE number = ? ORDER BY date", (number,))
    d["news"] = rows(conn, """
        SELECT a.id, a.url, a.organization, a.title, a.description, a.date_published, a.author,
               a.section, a.outlet_type, a.extraction_status,
               substr(a.content, 1, 600) AS snippet, length(a.content) AS content_len,
               group_concat(l.source) AS sources
        FROM news_bill_links l JOIN news_articles a ON a.id = l.news_id
        WHERE l.bill_number = ? GROUP BY a.id ORDER BY a.date_published DESC""", (number,))
    conn.close()
    return d


def votes_with_deputies(conn, sql, args):
    votes = rows(conn, sql, args)
    for v in votes:
        v["deputies"] = rows(conn, """
            SELECT vd.name, vd.party, vd.seat, vd.vote, vd.deputy_id, dp.person_id
            FROM vote_deputies vd LEFT JOIN deputies dp ON dp.deputy_id = vd.deputy_id
            WHERE vd.vote_id = ? ORDER BY vd.vote, vd.name""", (v["vote_id"],))
    return votes


# ---------------------------------------------------------------- deputies

def full_name(r):
    return f'{r["names"]} {r["surnames"]}'.strip()


@lru_cache(maxsize=1)
def deputies_index():
    """One entry per person (person_id), with all their terms."""
    conn = connect()
    people = {}
    for r in conn.execute("SELECT * FROM deputies ORDER BY date_from"):
        p = people.setdefault(r["person_id"], {"id": r["person_id"], "terms": [], "provinces": [], "deputy_ids": []})
        p["name"] = full_name(r)          # latest term wins
        p["sort"] = f'{r["surnames"]} {r["names"]}'
        add_face(p, r["person_id"], r["names"], r["surnames"])
        p["status"] = r["status"]
        p["terms"].append(r["term"])
        p["deputy_ids"].append(r["deputy_id"])
        if r["province"] and r["province"] not in p["provinces"]:
            p["provinces"].append(r["province"])
    factions = {}
    for r in conn.execute("SELECT person_id, faction FROM deputy_factions ORDER BY date_from"):
        lst = factions.setdefault(r["person_id"], [])
        if r["faction"] not in lst:
            lst.append(r["faction"])
    bills = dict(conn.execute("""SELECT d.person_id, COUNT(DISTINCT db.bill_number) FROM deputy_bills db
                                 JOIN deputies d ON d.deputy_id = db.deputy_id GROUP BY 1""").fetchall())
    organs = dict(conn.execute("""SELECT d.person_id, COUNT(DISTINCT m.organ_code) FROM organ_memberships m
                                  JOIN deputies d ON d.deputy_id = m.deputy_id WHERE m.organ_code != 0
                                  GROUP BY 1""").fetchall())
    out = []
    for pid, p in people.items():
        fx = factions.get(pid, [])
        p.update({
            "factions": fx,
            "faction": fx[-1] if fx else None,
            "bills": bills.get(pid, 0),
            "organs": organs.get(pid, 0),
            "hay": norm(" ".join([p["name"], *fx, *p["provinces"], *p["terms"]])),
        })
        del p["deputy_ids"]
        out.append(p)
    out.sort(key=lambda p: norm(p["sort"]))
    totals = {
        "people": len(out),
        "rows": conn.execute("SELECT COUNT(*) FROM deputies").fetchone()[0],
        "current": sum(1 for p in out if p["status"] == "VIGENTE"),
        "factions": conn.execute("SELECT COUNT(DISTINCT faction) FROM deputy_factions").fetchone()[0],
        "memberships": conn.execute("SELECT COUNT(*) FROM organ_memberships").fetchone()[0],
    }
    conn.close()
    return json.dumps({"deputies": out, "totals": totals}, ensure_ascii=False).encode("utf-8")


@lru_cache(maxsize=1)
def deputy_names():
    """Normalized 'SURNAMES NAMES' -> person_id, only for unambiguous names (to link replacements)."""
    conn = connect()
    seen = {}
    for r in conn.execute("SELECT DISTINCT person_id, surnames, names FROM deputies"):
        seen.setdefault(norm(f'{r["surnames"]} {r["names"]}'), set()).add(r["person_id"])
    conn.close()
    return {k: next(iter(v)) for k, v in seen.items() if len(v) == 1}


def deputy_detail(person_id):
    conn = connect()
    terms = rows(conn, "SELECT * FROM deputies WHERE person_id = ? ORDER BY date_from", (person_id,))
    if not terms:
        conn.close()
        return None
    ids = [t["deputy_id"] for t in terms]
    q = ",".join("?" * len(ids))
    d = add_face({"person_id": person_id, "name": full_name(terms[-1]), "terms": terms},
                 person_id, terms[-1]["names"], terms[-1]["surnames"])
    d["factions"] = rows(conn, "SELECT * FROM deputy_factions WHERE person_id = ? ORDER BY date_from", (person_id,))
    reps = rows(conn, "SELECT * FROM deputy_replacements WHERE person_id = ? ORDER BY date", (person_id,))
    names = deputy_names()
    for r in reps:
        r["other_person_id"] = names.get(norm(r["name"]))
    d["replacements"] = reps
    # Replaced by / replacing this person, seen from the other side.
    d["replaced_in"] = rows(conn, f"""
        SELECT r.*, d.names || ' ' || d.surnames AS other_name FROM deputy_replacements r
        JOIN (SELECT DISTINCT person_id, names, surnames FROM deputies) d ON d.person_id = r.person_id
        WHERE r.person_id != ? AND r.name IN (SELECT surnames || ' ' || names FROM deputies WHERE person_id = ?)""",
        (person_id, person_id))
    d["memberships"] = rows(conn, f"""
        SELECT m.organ_code, COALESCE(o.name, m.organ_name) AS organ_name, o.organ_type,
               m.position, m.legislature, m.date_joined, m.date_left,
               (o.organ_code IS NOT NULL) AS known
        FROM organ_memberships m LEFT JOIN organs o ON o.organ_code = m.organ_code
        WHERE m.deputy_id IN ({q}) ORDER BY m.date_joined DESC, organ_name""", ids)
    # deputy_bills has every bill the deputy filed, including ones before the corpus (< 20000).
    d["bills"] = rows(conn, f"""
        SELECT db.bill_number, db.term, b.name, b.status, b.date_proposed, b.law_number, b.flag,
               (b.number IS NOT NULL) AS in_corpus,
               (SELECT p.signing_order FROM bill_proponents p WHERE p.proponent_id = db.proponent_id) AS signing_order
        FROM deputy_bills db LEFT JOIN bills b ON b.number = db.bill_number
        WHERE db.deputy_id IN ({q}) ORDER BY db.bill_number DESC""", ids)
    d["votes"] = rows(conn, f"""
        SELECT v.vote_id, v.number, v.date, v.name, v.result, vd.vote, vd.party
        FROM vote_deputies vd JOIN votes v ON v.vote_id = vd.vote_id
        WHERE vd.deputy_id IN ({q}) ORDER BY v.date DESC""", ids)
    conn.close()
    return d


# ---------------------------------------------------------------- organs

@lru_cache(maxsize=1)
def organs_index():
    conn = connect()
    members = dict(conn.execute("SELECT organ_code, COUNT(DISTINCT deputy_id) FROM organ_memberships GROUP BY 1").fetchall())
    bills = dict(conn.execute("SELECT organ_code, COUNT(*) FROM organ_bills GROUP BY 1").fetchall())
    out = []
    for r in conn.execute("SELECT * FROM organs ORDER BY name"):
        c = r["organ_code"]
        out.append({
            "code": c, "name": r["name"], "type": r["organ_type"], "status": r["status"],
            "from": r["date_constituted"], "to": r["date_dissolved"],
            "members": members.get(c, 0), "bills": bills.get(c, 0),
            "hay": norm(" ".join([str(c), r["name"] or "", r["organ_type"] or ""])),
        })
    totals = {
        "organs": len(out),
        "active": sum(1 for o in out if o["status"] == "ACTIVO"),
        "with_members": sum(1 for o in out if o["members"]),
        "with_bills": sum(1 for o in out if o["bills"]),
        "organ_bills": conn.execute("SELECT COUNT(*) FROM organ_bills").fetchone()[0],
    }
    conn.close()
    return json.dumps({"organs": out, "totals": totals}, ensure_ascii=False).encode("utf-8")


def organ_detail(code):
    conn = connect()
    organ = conn.execute("SELECT * FROM organs WHERE organ_code = ?", (code,)).fetchone()
    if not organ:
        conn.close()
        return None
    d = {"organ": dict(organ)}
    d["members"] = rows(conn, """
        SELECT m.deputy_id, d.person_id, d.names || ' ' || d.surnames AS name, d.names, d.surnames, d.province, d.term,
               m.position, m.legislature, m.date_joined, m.date_left
        FROM organ_memberships m LEFT JOIN deputies d ON d.deputy_id = m.deputy_id
        WHERE m.organ_code = ? ORDER BY m.legislature DESC, m.position = 'INTEGRANTE', m.position, name""", (code,))
    for m in d["members"]:
        add_face(m, m["person_id"], m.pop("names"), m.pop("surnames"))
    d["bills"] = rows(conn, """
        SELECT ob.bill_number, ob.date_start, ob.date_end, ob.last_step,
               b.name, b.status, b.date_proposed, (b.number IS NOT NULL) AS in_corpus
        FROM organ_bills ob LEFT JOIN bills b ON b.number = ob.bill_number
        WHERE ob.organ_code = ? ORDER BY ob.date_start DESC, ob.bill_number DESC""", (code,))
    # How many steps name this organ (only meaningful when the name is unique).
    same = conn.execute("SELECT COUNT(*) FROM organs WHERE name = ?", (organ["name"],)).fetchone()[0]
    d["steps"] = conn.execute("SELECT COUNT(*) FROM bill_steps WHERE organ = ?", (organ["name"],)).fetchone()[0] if same == 1 else None
    conn.close()
    return d


# ---------------------------------------------------------------- news

@lru_cache(maxsize=1)
def news_index():
    """In-memory list of every article without content, for server-side search (built once)."""
    conn = connect()
    links = dict(conn.execute("SELECT news_id, COUNT(DISTINCT bill_number) FROM news_bill_links GROUP BY 1").fetchall())
    out = []
    for r in conn.execute("""SELECT id, organization, title, description, date_published, author, section,
                                    length(content) AS content_len FROM news_articles
                             ORDER BY date_published DESC"""):
        item = dict(r)
        item["bills"] = links.get(r["id"], 0)
        item["_hay"] = norm(" ".join(filter(None, [r["title"], r["description"], r["author"], r["section"]])))
        out.append(item)
    conn.close()
    return out


@lru_cache(maxsize=1)
def news_facets():
    idx = news_index()
    orgs = {}
    for a in idx:
        orgs[a["organization"]] = orgs.get(a["organization"], 0) + 1
    return {
        "total": len(idx),
        "linked": sum(1 for a in idx if a["bills"]),
        "organizations": orgs,
        "date_min": min((a["date_published"] for a in idx), default=None),
        "date_max": max((a["date_published"] for a in idx), default=None),
    }


def news_search(params):
    get = lambda k, default="": (params.get(k) or [default])[0]
    words = norm(get("q")).split()
    org, dfrom, dto = get("org"), get("from"), get("to")
    linked = get("linked") == "1"
    offset = max(int(get("offset", "0") or 0), 0)
    limit = min(max(int(get("limit", "50") or 50), 1), 200)
    hits = [a for a in news_index()
            if (not org or a["organization"] == org)
            and (not dfrom or a["date_published"][:10] >= dfrom)
            and (not dto or a["date_published"][:10] <= dto)
            and (not linked or a["bills"])
            and all(w in a["_hay"] for w in words)]
    if get("sort") == "asc":
        hits.reverse()
    elif get("sort") == "bills":
        hits.sort(key=lambda a: -a["bills"])
    page = [{k: v for k, v in a.items() if k != "_hay"} for a in hits[offset:offset + limit]]
    for a in page:
        if a["description"] and len(a["description"]) > 280:
            a["description"] = a["description"][:280] + "…"
    return {"total": len(hits), "offset": offset, "items": page}


def news_detail(news_id):
    conn = connect()
    r = conn.execute("SELECT * FROM news_articles WHERE id = ?", (news_id,)).fetchone()
    if not r:
        conn.close()
        return None
    d = dict(r)
    d["bills"] = rows(conn, """
        SELECT l.bill_number, group_concat(l.source) AS sources, b.name, b.status, b.date_proposed,
               (b.number IS NOT NULL) AS in_corpus
        FROM news_bill_links l LEFT JOIN bills b ON b.number = l.bill_number
        WHERE l.news_id = ? GROUP BY l.bill_number ORDER BY l.bill_number DESC""", (news_id,))
    conn.close()
    return d


# ---------------------------------------------------------------- http

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

    def send_photo(self, name):
        # Only files listed in the index: nothing else under raw/ can be read through this route.
        if name not in set(photos().values()):
            return self.send_error(404)
        body = (PHOTOS_DIR / name).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg" if name.lower().endswith((".jpg", ".jpeg")) else "image/png")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # Static files too: no caching, so edits to the page show up on reload.
        if self.path.startswith("/photos/"):
            self.send_header("Cache-Control", "max-age=86400")
        elif not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        if path.startswith("/photos/"):
            return self.send_photo(path.removeprefix("/photos/"))
        if not path.startswith("/api/"):
            if path.endswith(".py"):
                return self.send_error(404)
            return super().do_GET()
        parts = path.strip("/").split("/")
        notfound = lambda: self.send_json({"error": "not found"}, 404)
        try:
            if parts == ["api", "bills"]:
                return self.send_json(bills_index())
            if parts == ["api", "deputies"]:
                return self.send_json(deputies_index())
            if parts == ["api", "organs"]:
                return self.send_json(organs_index())
            if parts == ["api", "news"]:
                return self.send_json(news_search(parse_qs(url.query)))
            if parts == ["api", "news-facets"]:
                return self.send_json(news_facets())
            if len(parts) == 3:
                kind, key = parts[1], parts[2]
                if kind == "news":
                    d = news_detail(key)
                elif not key.isdigit():
                    d = None
                elif kind == "bill":
                    d = bill_detail(int(key))
                elif kind == "deputy":
                    d = deputy_detail(int(key))
                elif kind == "organ":
                    d = organ_detail(int(key))
                else:
                    return self.send_json({"error": "unknown endpoint"}, 404)
                return self.send_json(d) if d else notfound()
            return self.send_json({"error": "unknown endpoint"}, 404)
        except (sqlite3.Error, ValueError) as e:
            return self.send_json({"error": str(e)}, 500)


class Server(ThreadingHTTPServer):
    """Refuses to start if the port is taken.

    http.server sets SO_REUSEADDR, which on Windows lets a second process bind the same port while an
    old server (with old code) keeps answering. Exclusive bind avoids that.
    """
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):  # Windows only
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    global DB_PATH
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = ap.parse_args()
    DB_PATH = args.db.resolve()
    if not DB_PATH.exists():
        raise SystemExit(f"No existe la base: {DB_PATH}")
    try:
        srv = Server(("127.0.0.1", args.port), Handler)
    except OSError:
        raise SystemExit(f"El puerto {args.port} ya está en uso (¿otro explorador corriendo?). "
                         f"Cerralo o usá --port <otro>.")
    print(f"Explorador en http://localhost:{args.port}  (base: {DB_PATH}, solo lectura)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
