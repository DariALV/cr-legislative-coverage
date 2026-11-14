"""
Exports the public data of the site (site/src/data/) from the private database and the Jev corpus run.

  python export_public.py [--database databases/private_corpus.db] [--jev-dir results/jev/corpus]
                          [--out site/src/data] [--texts-dir raw/text/asamblea/bills]
                          [--texts-out site/public/textos]

Writes bills.json, bills/<number>.json, news.json, outlets.json and stats/factions.json, following the
contract in site/src/lib/types.ts. Values are kept as they are in the database, except the controlled
vocabularies stored in English (bill status, vote, vote kind, link source), which are translated to Spanish.

What is published:
  links   substantive coverage only: a Jev match with explicit >= 0.5 or implicit >= 0.75, and
          centrality >= 0.25 (same rule as private_visuals/graph/build_graph.py)
  news    only the articles with at least one published link. Never the body: title, outlet, section,
          date and url only
  bills   the ones with a published link, or with activity in the data period (filed, a step or a vote)
  votes   every vote of the published bills, whatever its date. Motions are published as a summary
          (count by kind of motion and result), because a single bill can have thousands of them
  texts   the base text of each published bill (the one it was filed with, an official public document),
          as site/public/textos/<number>.txt, one line per paragraph. Texts longer than TEXT_MAX_CHARS
          (budgets and their tables, mostly) are cut at a paragraph
"""
import argparse
import csv
import json
import shutil
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

from config import Config

MENTION_EXPLICIT = 0.5
MENTION_IMPLICIT = 0.75
SUBSTANTIVE_CENTRALITY = 0.25

STATUS_LABELS = {"in progress": "En trámite", "archived": "Archivado", "law": "Convertido en ley"}
VOTE_KEYS = {"for": "a_favor", "against": "en_contra", "absent": "ausente", "Abstención": "abstencion",
             "Ausente (pierde dieta)": "ausente_pierde_dieta"}
VOTE_KIND_LABELS = {"plenary": "Plenario", "full_committee": "Comisión con potestad legislativa plena"}
# A link the outlet itself made to the bill's page (news_bill_links.source = "link"), or one found by Jev.
# Votes whose name starts like this are motions; the rest are steps of the procedure (debates, waivers...).
MOTION_PREFIX = "Moción"
MOTION_RESULT_FIELDS = {"Aprobado": "approved", "Rechazado": "rejected"}   # annulled and tied go to "other"
# Base texts longer than this are cut: the page reads them in a scroll box, and the long ones are tables.
TEXT_MAX_CHARS = 150_000
LINK_FROM_OUTLET = "enlace"
LINK_FROM_MODEL = "modelo"
OUTLET_NAMES = {"crhoy": "CRHoy", "delfino": "Delfino", "elmundo": "El Mundo CR", "nacion": "La Nación",
                "semanario": "Semanario Universidad"}


def substantive_links(jev_dir: Path) -> dict[tuple[str, int], float]:
  """(news id, bill) -> confidence (the higher of Jev's explicit and implicit probabilities)."""
  centrality = {}
  with open(jev_dir / "details.csv", encoding = "utf-8") as f:
    for row in csv.DictReader(f):
      if row["question"] == "centrality" and row["bill"] and row["score_01"] != "":
        centrality[(row["news_id"], int(row["bill"]))] = float(row["score_01"])
  links = {}
  with open(jev_dir / "gate.csv", encoding = "utf-8") as f:
    for row in csv.DictReader(f):
      explicit, implicit = float(row["explicit"]), float(row["implicit"])
      key = (row["news_id"], int(row["bill"]))
      if row["match"] != "1" or not (explicit >= MENTION_EXPLICIT or implicit >= MENTION_IMPLICIT):
        continue
      if centrality.get(key, 0) >= SUBSTANTIVE_CENTRALITY:
        links[key] = round(max(explicit, implicit), 2)
  return links


def active_bills(con: sqlite3.Connection) -> set[int]:
  """Bills filed, with a step or with a vote inside the data period."""
  start = Config.DATA_PERIOD.start.date().isoformat()
  end = Config.DATA_PERIOD.end.date().isoformat() + "T99"   # also covers values that carry a time
  period = (start, end)
  active = {n for (n,) in con.execute("SELECT number FROM bills WHERE date_proposed BETWEEN ? AND ?", period)}
  active |= {n for (n,) in con.execute(
    "SELECT DISTINCT number FROM bill_steps WHERE date_start BETWEEN ? AND ? OR date_end BETWEEN ? AND ?",
    period + period)}
  active |= {n for (n,) in con.execute("SELECT DISTINCT number FROM votes WHERE date BETWEEN ? AND ?", period)}
  return active


def grouped(con: sqlite3.Connection, query: str) -> dict[int, list[tuple]]:
  """Rows of `query` grouped by their first column, which is dropped."""
  groups = defaultdict(list)
  for row in con.execute(query):
    groups[row[0]].append(row[1:])
  return groups


def export_text(number: int, texts_dir: Path, texts_out: Path) -> dict:
  """Copies the bill's base text to the site, cut if too long. Returns what the bill page needs to know."""
  source = texts_dir / f"{number}.txt"
  text = source.read_text(encoding = "utf-8").strip() if source.exists() else ""
  if not text:
    return {"available": False, "truncated": False, "words": 0}
  words = len(text.split())
  truncated = len(text) > TEXT_MAX_CHARS
  if truncated:
    text = text[:text.rfind("\n", 0, TEXT_MAX_CHARS)]
  texts_out.mkdir(parents = True, exist_ok = True)
  (texts_out / f"{number}.txt").write_text(text + "\n", encoding = "utf-8")
  return {"available": True, "truncated": truncated, "words": words}


def write_json(path: Path, data) -> None:
  path.parent.mkdir(parents = True, exist_ok = True)
  path.write_text(json.dumps(data, ensure_ascii = False, separators = (",", ":")), encoding = "utf-8")


def export(database: Path, jev_dir: Path, out: Path, texts_dir: Path, texts_out: Path) -> None:
  con = sqlite3.connect(f"file:{database}?mode=ro", uri = True)
  links = substantive_links(jev_dir)
  outlet_links = {(news_id, bill) for news_id, bill in con.execute(
    "SELECT news_id, bill_number FROM news_bill_links WHERE source = 'link'")}
  news_by_bill, bills_by_news = defaultdict(list), defaultdict(list)
  for news_id, bill in links:
    news_by_bill[bill].append(news_id)
    bills_by_news[news_id].append(bill)

  def link_fields(news_id: str, bill: int) -> dict:
    source = LINK_FROM_OUTLET if (news_id, bill) in outlet_links else LINK_FROM_MODEL
    return {"link_source": source, "confidence": links[(news_id, bill)]}

  # News: only the public fields, never `content`.
  articles = {}
  for news_id, url, organization, title, date_published, outlet_type, section in con.execute(
      "SELECT id, url, organization, title, date_published, outlet_type, section FROM news_articles"):
    if news_id in bills_by_news:
      articles[news_id] = {"id": news_id, "title": title, "organization": organization,
                           "outlet_type": outlet_type, "section": section or "",
                           "date_published": date_published[:19], "url": url}
  news = [{**article, "bills": [{"number": bill, **link_fields(article["id"], bill)}
                                for bill in sorted(bills_by_news[article["id"]])]}
          for article in sorted(articles.values(), key = lambda a: a["date_published"], reverse = True)]

  # Bills
  published = set(news_by_bill) | active_bills(con)
  subjects = grouped(con, "SELECT number, subject FROM bill_subjects ORDER BY number, subject_code")
  steps = grouped(con, "SELECT number, organ, description, date_start, date_end FROM bill_steps "
                       "ORDER BY number, date_start, step_id")
  # The faction and province are the ones of the deputy in the term in which the bill was signed.
  proponents = grouped(con, """
    SELECT p.number, p.name, COALESCE(f.faction, ''), COALESCE(f.province, d.province, ''), p.signing_order
    FROM bill_proponents p
    LEFT JOIN deputies d ON d.deputy_id = p.deputy_id
    LEFT JOIN deputy_factions f ON f.person_id = d.person_id AND f.term = p.term
    GROUP BY p.proponent_id
    ORDER BY p.number, p.signing_order""")
  votes = grouped(con, "SELECT number, vote_id, date, name, result, kind FROM votes ORDER BY number, date, vote_id")
  vote_deputies = grouped(con, "SELECT vote_id, name, party, vote FROM vote_deputies ORDER BY vote_id, seat")

  summaries, faction_counts, faction_deputies = [], defaultdict(Counter), defaultdict(set)
  votes_exported = motions_exported = 0
  shutil.rmtree(out / "bills", ignore_errors = True)
  shutil.rmtree(texts_out, ignore_errors = True)
  if not texts_dir.is_dir():
    print(f"warning: {texts_dir} not found, no bill texts are exported")
  texts = Counter()
  for number, name, file_type, date_proposed, law_number, status in con.execute(
      "SELECT number, name, file_type, date_proposed, law_number, status FROM bills ORDER BY number DESC"):
    if number not in published:
      continue
    bill_proponents = [{"name": p[0], "faction": p[1], "province": p[2], "signing_order": p[3]}
                       for p in proponents.get(number, [])]
    bill_votes, motions = [], {}
    for vote_id, date, vote_name, result, kind in votes.get(number, []):
      if vote_name.startswith(MOTION_PREFIX):
        motion = motions.setdefault(vote_name, {"name": vote_name, "approved": 0, "rejected": 0, "other": 0,
                                                "date_first": date, "date_last": date})
        motion[MOTION_RESULT_FIELDS.get(result, "other")] += 1
        motion["date_first"], motion["date_last"] = min(motion["date_first"], date), max(motion["date_last"], date)
        motions_exported += 1
        continue
      deputies = [{"name": d[0], "party": d[1], "vote": VOTE_KEYS[d[2]]} for d in vote_deputies.get(vote_id, [])]
      for deputy in deputies:
        faction_counts[deputy["party"]][deputy["vote"]] += 1
        faction_deputies[deputy["party"]].add(deputy["name"])
      bill_votes.append({"vote_id": int(vote_id), "date": date, "name": vote_name, "result": result,
                         "kind": VOTE_KIND_LABELS[kind], "deputies": deputies})
    votes_exported += len(bill_votes)
    bill_news = sorted(({**{k: articles[news_id][k] for k in ("id", "title", "organization", "date_published", "url")},
                         **link_fields(news_id, number)} for news_id in news_by_bill.get(number, [])),
                       key = lambda item: item["date_published"], reverse = True)
    summary = {"number": number, "name": name, "file_type": file_type, "date_proposed": date_proposed,
               "status": STATUS_LABELS[status], "law_number": law_number,
               "subjects": [s[0] for s in subjects.get(number, [])],
               "proponents": [p["name"] for p in bill_proponents],
               "news_count": len(bill_news), "votes_count": len(bill_votes),
               "motions_count": sum(m["approved"] + m["rejected"] + m["other"] for m in motions.values())}
    summaries.append(summary)
    text = export_text(number, texts_dir, texts_out)
    texts["available"] += text["available"]
    texts["truncated"] += text["truncated"]
    write_json(out / "bills" / f"{number}.json", {
      "bill": summary, "proponents": bill_proponents,
      "steps": [{"organ": s[0], "description": s[1], "date_start": s[2], "date_end": s[3]}
                for s in steps.get(number, [])],
      "votes": bill_votes,
      "motions": sorted(motions.values(), key = lambda m: -(m["approved"] + m["rejected"] + m["other"])),
      "text": text,
      "news": bill_news})

  write_json(out / "bills.json", summaries)
  write_json(out / "news.json", news)
  outlet_types = dict(con.execute("SELECT DISTINCT organization, outlet_type FROM news_articles"))
  write_json(out / "outlets.json", [{"key": key, "name": OUTLET_NAMES.get(key, key), "type": outlet_types[key]}
                                    for key in sorted(outlet_types)])
  vote_keys = list(VOTE_KEYS.values())
  write_json(out / "stats" / "factions.json", {
    "generated_from_votes": votes_exported,
    "factions": [{"faction": faction, "deputies": len(faction_deputies[faction]),
                  "counts": {key: faction_counts[faction][key] for key in vote_keys}}
                 for faction in sorted(faction_counts)]})

  covered = sum(1 for s in summaries if s["news_count"])
  from_outlet = sum(1 for key in links if key in outlet_links)
  print(f"links: {len(links)} substantive ({from_outlet} also linked by the outlet, {len(links) - from_outlet} model only)")
  print(f"news: {len(news)}")
  print(f"bills: {len(summaries)} ({covered} with coverage, {len(summaries) - covered} with activity only)")
  print(f"votes: {votes_exported} in detail, {motions_exported} motions summarized")
  print(f"texts: {texts['available']} ({texts['truncated']} cut at {TEXT_MAX_CHARS} characters), "
        f"{len(summaries) - texts['available']} bills without text")
  print(f"written to {out} and {texts_out}")


if __name__ == "__main__":
  parser = argparse.ArgumentParser(description = "Export the public data of the site.")
  parser.add_argument("--database", type = Path,
                      default = Path(Config.DATABASE_DIR) / f"{Config.PRIVATE_DATABASE}.db",
                      help = "private SQLite database (opened read-only)")
  parser.add_argument("--jev-dir", type = Path, default = Path("results/jev/corpus"),
                      help = "folder with gate.csv and details.csv of the Jev corpus run")
  parser.add_argument("--out", type = Path, default = Path("site/src/data"), help = "output folder")
  parser.add_argument("--texts-dir", type = Path, default = Path(Config.RAW_TEXT_DIR) / "asamblea" / "bills",
                      help = "folder with the base text of each bill, <number>.txt")
  parser.add_argument("--texts-out", type = Path, default = Path("site/public/textos"),
                      help = "output folder of the bill texts")
  arguments = parser.parse_args()
  export(arguments.database, arguments.jev_dir, arguments.out, arguments.texts_dir, arguments.texts_out)
