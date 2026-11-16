"""
Builds the public corpus (#44 #45) in corpus/: a SQLite file with the bills, deputies and organs from the SIL, the
metadata of the news (never their text), the news-bill links and Jev's answers, zipped so it fits in GitHub.

  python export_corpus.py [--database databases/private_corpus.db] [--jev-dir results/jev/corpus]
                          [--filter-dir results/jev/corpus_filter] [--out corpus]

Writes corpus/cr_legislative_coverage.zip (the SQLite file inside), corpus/links.csv, corpus/schema.sql and
corpus/SHA256SUMS. The unzipped database is left in databases/public_corpus.db, which git ignores.

What is published and what is not:
  SIL       every table, as stored (bills, steps, subjects, proponents, base text exposition, laws, deputies,
            factions, organs and their members). Official public data of the Asamblea Legislativa
  news      the public fields only: id, url, outlet, title, date, author, section. Never `content` or
            `description`
  links     every Jev match (gate match = 1) and every link an outlet made from a news item to a bill's page, with
            the mention and substantive levels marked
  jev       the news filter, the candidates with the gate answers, and the detail questions in a long table,
            without `headline_misleading` and `author_judges` (they judge the outlet, out of the project's scope).
            The raw API answers (answers.jsonl) are not published
  votes     not published: they come from Delfino, whose terms forbid reproducing or redistributing its content
"""
import argparse
import csv
import hashlib
import json
import sqlite3
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from config import Config

MENTION_EXPLICIT = 0.5
MENTION_IMPLICIT = 0.75
SUBSTANTIVE_CENTRALITY = 0.25
EXCLUDED_QUESTIONS = {"headline_misleading", "author_judges"}
SIL_TABLES = ["bills", "bill_steps", "bill_subjects", "bill_proponents", "bill_texts", "laws", "deputies",
              "deputy_terms", "deputy_factions", "deputy_replacements", "deputy_bills", "organs",
              "organ_memberships", "organ_bills"]
NEWS_COLUMNS = ["id", "url", "organization", "title", "date_published", "author", "section", "outlet_type",
                "extraction_status"]
DATABASE_NAME = "cr_legislative_coverage.db"
ZIP_NAME = "cr_legislative_coverage.zip"

SCHEMA = """
CREATE TABLE corpus_info (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE links (
  news_id TEXT NOT NULL, bill_number INTEGER NOT NULL,
  jev_match INTEGER NOT NULL, outlet_link INTEGER NOT NULL,
  explicit REAL, implicit REAL, centrality REAL,
  mention INTEGER NOT NULL, substantive INTEGER NOT NULL,
  PRIMARY KEY (news_id, bill_number));
CREATE TABLE jev_filter (news_id TEXT PRIMARY KEY, assembly REAL, passes INTEGER, cut INTEGER);
CREATE TABLE jev_news (
  news_id TEXT PRIMARY KEY, genre TEXT, genre_confidence REAL, genre_news_report REAL, genre_opinion REAL,
  genre_interview REAL, genre_analysis REAL, cut INTEGER, matches INTEGER);
CREATE TABLE jev_candidates (
  news_id TEXT NOT NULL, bill_number INTEGER NOT NULL, rank INTEGER, score REAL, source TEXT, named INTEGER,
  explicit REAL, implicit REAL, match INTEGER,
  PRIMARY KEY (news_id, bill_number));
CREATE TABLE jev_details (
  news_id TEXT NOT NULL, bill_number INTEGER, question TEXT NOT NULL, option TEXT, probability REAL,
  choice TEXT, confidence REAL, score REAL, score_01 REAL);
CREATE TABLE jev_questions (
  stage TEXT NOT NULL, question TEXT NOT NULL, type TEXT, instructions TEXT, criteria TEXT,
  PRIMARY KEY (stage, question));
"""
INDEXES = """
CREATE INDEX links_bill ON links (bill_number);
CREATE INDEX jev_candidates_bill ON jev_candidates (bill_number);
CREATE INDEX jev_details_pair ON jev_details (news_id, bill_number);
CREATE INDEX news_articles_date ON news_articles (date_published);
"""


def number(value: str) -> float | None:
  return float(value) if value not in ("", None) else None


def integer(value: str) -> int | None:
  return int(value) if value not in ("", None) else None


def read_csv(path: Path):
  with open(path, encoding = "utf-8") as f:
    yield from csv.DictReader(f)


def copy_private_tables(con: sqlite3.Connection) -> None:
  """SIL tables as they are, and the news without their text."""
  for table in SIL_TABLES:
    create = con.execute("SELECT sql FROM private.sqlite_master WHERE type = 'table' AND name = ?",
                         (table,)).fetchone()[0]
    con.execute(create)
    con.execute(f"INSERT INTO main.{table} SELECT * FROM private.{table}")
  columns = ", ".join(NEWS_COLUMNS)
  con.execute(f"CREATE TABLE news_articles AS SELECT {columns} FROM private.news_articles ORDER BY date_published")
  con.execute("CREATE TABLE news_bill_links AS SELECT * FROM private.news_bill_links")


def load_jev(con: sqlite3.Connection, jev_dir: Path, filter_dir: Path) -> None:
  con.executemany("INSERT INTO jev_filter VALUES (?, ?, ?, ?)", (
    (row["news_id"], number(row["assembly"]), integer(row["passes"]), integer(row["cut"]))
    for row in read_csv(filter_dir / "filter.csv")))
  con.executemany("INSERT INTO jev_news VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (
    (row["news_id"], row["genre"] or None, number(row["genre_confidence"]), number(row["genre_news_report"]),
     number(row["genre_opinion"]), number(row["genre_interview"]), number(row["genre_analysis"]),
     integer(row["cut"]), integer(row["matches"]))
    for row in read_csv(jev_dir / "news.csv")))
  gate = {(row["news_id"], int(row["bill"])): row for row in read_csv(jev_dir / "gate.csv")}
  rows = []
  for row in read_csv(jev_dir / "candidates.csv"):
    answer = gate.get((row["news_id"], int(row["bill"])), {})
    rows.append((row["news_id"], int(row["bill"]), integer(row["rank"]), number(row["score"]), row["source"],
                 integer(row["named"]), number(answer.get("explicit")), number(answer.get("implicit")),
                 integer(answer.get("match"))))
  con.executemany("INSERT INTO jev_candidates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
  con.executemany("INSERT INTO jev_details VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (
    (row["news_id"], integer(row["bill"]), row["question"], row["option"] or None, number(row["probability"]),
     row["choice"] or None, number(row["confidence"]), number(row["score"]), number(row["score_01"]))
    for row in read_csv(jev_dir / "details.csv") if row["question"] not in EXCLUDED_QUESTIONS))
  questions = json.loads((jev_dir / "questions.json").read_text(encoding = "utf-8"))
  con.executemany("INSERT INTO jev_questions VALUES (?, ?, ?, ?, ?)", (
    (stage, name, spec.get("type"), spec.get("instructions"), json.dumps(spec.get("criteria"), ensure_ascii = False))
    for stage, group in questions.items() for name, spec in group.items() if name not in EXCLUDED_QUESTIONS))


def build_links(con: sqlite3.Connection) -> None:
  """One row per (news, bill) that Jev matched or that the outlet itself linked."""
  con.execute(f"""
    INSERT INTO links
    WITH pairs AS (
      SELECT news_id, bill_number FROM jev_candidates WHERE match = 1
      UNION SELECT news_id, bill_number FROM news_bill_links),
    centrality AS (
      -- one row per option, all with the same score_01
      SELECT news_id, bill_number, MAX(score_01) AS value FROM jev_details WHERE question = 'centrality'
      GROUP BY news_id, bill_number)
    SELECT p.news_id, p.bill_number,
           COALESCE(c.match, 0) = 1 AS jev_match,
           EXISTS (SELECT 1 FROM news_bill_links l WHERE l.news_id = p.news_id AND l.bill_number = p.bill_number),
           c.explicit, c.implicit, ce.value,
           COALESCE(c.match, 0) = 1 AND (c.explicit >= {MENTION_EXPLICIT} OR c.implicit >= {MENTION_IMPLICIT}),
           COALESCE(c.match, 0) = 1 AND (c.explicit >= {MENTION_EXPLICIT} OR c.implicit >= {MENTION_IMPLICIT})
             AND COALESCE(ce.value, 0) >= {SUBSTANTIVE_CENTRALITY}
    FROM pairs p
    LEFT JOIN jev_candidates c ON c.news_id = p.news_id AND c.bill_number = p.bill_number
    LEFT JOIN centrality ce ON ce.news_id = p.news_id AND ce.bill_number = p.bill_number
    ORDER BY p.news_id, p.bill_number""")


def corpus_info(con: sqlite3.Connection, jev_dir: Path) -> dict:
  run = json.loads((jev_dir / "run.json").read_text(encoding = "utf-8"))
  counts = {table: con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for (table,) in con.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'corpus_info' ORDER BY name").fetchall()}
  return {
    "built_utc": datetime.now(timezone.utc).isoformat(timespec = "seconds"),
    "news_period": f"{Config.DATA_PERIOD.start.date()} / {Config.DATA_PERIOD.end.date()}",
    "jev_models": ", ".join(run.get("models", [])),
    "jev_match_threshold": str(run.get("threshold")),
    "mention_rule": f"jev_match and (explicit >= {MENTION_EXPLICIT} or implicit >= {MENTION_IMPLICIT})",
    "substantive_rule": f"mention and centrality >= {SUBSTANTIVE_CENTRALITY}",
    "max_news_chars": str(run.get("max_news_chars")),
    "license": "CC BY 4.0 (see LICENSE)",
    **{f"rows.{table}": str(n) for table, n in counts.items()},
  }


def sha256(path: Path) -> str:
  digest = hashlib.sha256()
  with open(path, "rb") as f:
    for block in iter(lambda: f.read(1 << 20), b""):
      digest.update(block)
  return digest.hexdigest()


def write_outputs(database: Path, out: Path) -> None:
  out.mkdir(parents = True, exist_ok = True)
  con = sqlite3.connect(database)
  (out / "schema.sql").write_text(
    ";\n\n".join(sql for (sql,) in con.execute(
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type DESC, name")) + ";\n", encoding = "utf-8")
  cursor = con.execute("""
    SELECT l.news_id, n.organization, substr(n.date_published, 1, 10), l.bill_number, l.jev_match, l.outlet_link,
           l.explicit, l.implicit, l.centrality, l.mention, l.substantive
    FROM links l JOIN news_articles n ON n.id = l.news_id ORDER BY n.date_published, l.news_id, l.bill_number""")
  with open(out / "links.csv", "w", encoding = "utf-8", newline = "") as f:
    writer = csv.writer(f)
    writer.writerow(["news_id", "outlet", "date", "bill_number", "jev_match", "outlet_link", "explicit", "implicit",
                     "centrality", "mention", "substantive"])
    writer.writerows(cursor)
  con.close()
  with zipfile.ZipFile(out / ZIP_NAME, "w", compression = zipfile.ZIP_DEFLATED, compresslevel = 9) as archive:
    archive.write(database, DATABASE_NAME)
  sums = {DATABASE_NAME: sha256(database)}
  for name in (ZIP_NAME, "links.csv", "schema.sql"):
    sums[name] = sha256(out / name)
  (out / "SHA256SUMS").write_text("".join(f"{digest}  {name}\n" for name, digest in sums.items()), encoding = "utf-8")


def export(database: Path, jev_dir: Path, filter_dir: Path, out: Path, public: Path) -> None:
  public.parent.mkdir(parents = True, exist_ok = True)
  public.unlink(missing_ok = True)
  con = sqlite3.connect(f"file:{public.as_posix()}", uri = True)   # URI mode, so the private file attaches read-only
  con.execute("PRAGMA journal_mode = DELETE")
  con.execute("ATTACH DATABASE ? AS private", (f"file:{database.as_posix()}?mode=ro",))
  copy_private_tables(con)
  con.executescript(SCHEMA)
  load_jev(con, jev_dir, filter_dir)
  build_links(con)
  con.executescript(INDEXES)
  con.executemany("INSERT INTO corpus_info VALUES (?, ?)", corpus_info(con, jev_dir).items())
  con.commit()
  con.execute("DETACH DATABASE private")
  con.execute("VACUUM")
  con.close()
  write_outputs(public, out)
  print(f"{public}: {public.stat().st_size / 1e6:.1f} MB; {out / ZIP_NAME}: {(out / ZIP_NAME).stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
  parser = argparse.ArgumentParser(description = "Build the public corpus (SQLite, zipped) in corpus/.")
  parser.add_argument("--database", type = Path, default = Path("databases/private_corpus.db"))
  parser.add_argument("--jev-dir", type = Path, default = Path("results/jev/corpus"))
  parser.add_argument("--filter-dir", type = Path, default = Path("results/jev/corpus_filter"))
  parser.add_argument("--out", type = Path, default = Path("corpus"))
  parser.add_argument("--public", type = Path, default = Path("databases/public_corpus.db"),
                      help = "where the unzipped public database is left (ignored by git)")
  args = parser.parse_args()
  export(args.database, args.jev_dir, args.filter_dir, args.out, args.public)
