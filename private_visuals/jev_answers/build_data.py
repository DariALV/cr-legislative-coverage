"""Builds the data file for the Jev answers viewer (#69).

Reads the corpus run in results/jev/corpus/ (gate.csv, details.csv, news.csv, candidates.csv,
questions.json, run.json) and private_corpus.db read-only (news title, outlet, date and URL; bill
name and status; Delfino links), and writes private_visuals/output/jev_answers/data.js.

Only public fields go in: no article text. Pairs kept: every gate pair with
max(explicit, implicit) >= --floor, plus every Delfino link whose news was in the run (so the page
can show what Jev missed). Detail answers only exist for the pairs the run sent to the detail stage.

Usage: python private_visuals/jev_answers/build_data.py [--floor 0.1]
"""
import argparse
import csv
import json
import sqlite3
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUN_DIR = ROOT / "results" / "jev" / "corpus"
DB_PATH = ROOT / "databases" / "private_corpus.db"
OUT_PATH = ROOT / "private_visuals" / "output" / "jev_answers" / "data.js"


def pct(value):
  """Probability 0-1 as an integer 0-100 (keeps data.js small)."""
  return round(float(value) * 100)


def option_keys(question):
  criteria = question.get("criteria")
  if isinstance(criteria, dict):
    return list(criteria)
  if isinstance(criteria, list):
    return [str(i) for i in range(len(criteria))]
  return ["true"]


def load_details(questions):
  """(news_id, bill or '') -> {question: answer} with answers shaped for the page.

  noul -> probability of true (0-100); choice -> probabilities per option (0-100);
  score -> [expected score * 100, confidence 0-100, probabilities per option...].
  """
  order = {}
  for stage in ("details_news", "details"):
    for key, q in questions[stage].items():
      order[key] = (q["type"], option_keys(q))
  raw = defaultdict(lambda: defaultdict(dict))
  extra = {}
  with open(RUN_DIR / "details.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
      key = (row["news_id"], row["bill"])
      raw[key][row["question"]][row["option"]] = pct(row["probability"])
      if row["score"]:
        extra[key + (row["question"],)] = (round(float(row["score"]) * 100), pct(row["confidence"] or 0))
  out = {}
  for key, answers in raw.items():
    shaped = {}
    for question, probs in answers.items():
      qtype, options = order[question]
      if qtype == "noul":
        shaped[question] = probs.get("true", 0)
      elif qtype == "choice":
        shaped[question] = [probs.get(o, 0) for o in options]
      else:
        score, conf = extra.get(key + (question,), (0, 0))
        shaped[question] = [score, conf] + [probs.get(o, 0) for o in options]
    out[key] = shaped
  return out


# Party names as they appear in vote_deputies and deputy_factions -> the actor keys of Jev's questions.
PARTY_KEYS = {
  "pueblo soberano": "pueblo_soberano",
  "liberacion nacional": "liberacion_nacional",
  "frente amplio": "frente_amplio",
  "unidad social cristiana": "unidad_social_cristiana",
  "agenda ciudadana": "agenda_ciudadana",
  "poder ejecutivo": "executive",
}
# Votes whose "for" means supporting the bill itself; motions are only used for party cohesion.
SUBSTANTIVE_VOTES = ("Primer debate", "Segundo debate", "Ratificación de nombramiento", "Acuerdo Legislativo",
                     "Reforma al Reglamento", "Primer debate de primera legislatura")
VOTE_CHOICES = {"for": 0, "against": 1}


def party_key(name):
  """Maps a party or faction name to an actor key; other parties keep their own name."""
  plain = unicodedata.normalize("NFKD", (name or "").lower())
  plain = "".join(ch for ch in plain if not unicodedata.combining(ch))
  for needle, key in PARTY_KEYS.items():
    if needle in plain:
      return key
  return (name or "").strip().title() or "?"


def chunked(con, sql, numbers, size=500):
  numbers = list(numbers)
  for i in range(0, len(numbers), size):
    chunk = numbers[i:i + size]
    yield from con.execute(sql.format(marks=",".join("?" * len(chunk))), chunk)


def load_context(con, bill_numbers, news_dates):
  """Bill context from the database: proponent parties, committees, SIL steps and votes.

  Steps, committees and votes are limited to the news period (a month of margin before it).
  """
  start = (min(news_dates)[:7] + "-01") if news_dates else "2026-05-01"
  year, month = int(start[:4]), int(start[5:7]) - 1
  start = f"{year - (month == 0)}-{(month or 12):02d}-01"

  # Proponents: faction of each signing deputy on the filing date (the Executive has no deputy_id).
  factions = defaultdict(list)
  for person_id, faction, date_from, date_to in con.execute(
      "SELECT person_id, faction, date_from, date_to FROM deputy_factions"):
    factions[person_id].append((date_from or "", date_to or "9999", faction))
  deputy_person = dict(con.execute("SELECT deputy_id, person_id FROM deputies"))
  proposed = dict(chunked(con, "SELECT number, date_proposed FROM bills WHERE number IN ({marks})", bill_numbers))
  proponents = defaultdict(lambda: {"first": None, "parties": defaultdict(int), "n": 0})
  for number, name, order, deputy_id in chunked(
      con, "SELECT number, name, signing_order, deputy_id FROM bill_proponents WHERE number IN ({marks}) "
           "ORDER BY number, signing_order", bill_numbers):
    if deputy_id is None:
      party = party_key(name)
    else:
      day = proposed.get(number) or ""
      spans = factions.get(deputy_person.get(deputy_id), [])
      hit = [f for a, b, f in spans if a <= day <= b] or [f for _, _, f in sorted(spans)[-1:]]
      party = party_key(hit[0]) if hit else "?"
    entry = proponents[number]
    entry["parties"][party] += 1
    entry["n"] += 1
    if entry["first"] is None:
      entry["first"] = party

  # Committees and plenary the bill went through during the period.
  organs = {code: (name, kind or "") for code, name, kind in con.execute("SELECT organ_code, name, organ_type FROM organs")}
  organ_index = {}
  committees = defaultdict(list)
  for code, number, date_start, date_end in chunked(
      con, "SELECT organ_code, bill_number, date_start, date_end FROM organ_bills WHERE bill_number IN ({marks})",
      bill_numbers):
    if date_end and date_end < start:
      continue
    if code not in organ_index:
      organ_index[code] = len(organ_index)
    committees[number].append([organ_index[code], date_start or "", date_end or ""])
  organ_list = [list(organs.get(code, (str(code), ""))) for code in organ_index]

  steps = defaultdict(list)
  for number, organ, description, date_start in chunked(
      con, "SELECT number, organ, description, date_start FROM bill_steps WHERE number IN ({marks}) "
           f"AND date_start >= '{start}' ORDER BY date_start", bill_numbers):
    steps[number].append([date_start, organ or "", description])

  # Every vote of the period with the tally per party ([for, against, absent]).
  tallies = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))
  for vote_id, party, vote in con.execute(
      "SELECT vd.vote_id, vd.party, vd.vote FROM vote_deputies vd JOIN votes v USING (vote_id) WHERE v.date >= ?", (start,)):
    tallies[vote_id][party_key(party)][VOTE_CHOICES.get(vote, 2)] += 1
  votes = []
  for vote_id, number, date, name, description, result in con.execute(
      "SELECT vote_id, number, date, name, description, result FROM votes WHERE date >= ? ORDER BY date", (start,)):
    votes.append([vote_id, number, date, name, (description or "")[:240], result or "",
                  int(name in SUBSTANTIVE_VOTES), dict(tallies[vote_id])])

  return {
    "proponents": {n: [e["first"], dict(e["parties"]), e["n"]] for n, e in proponents.items()},
    "organs": organ_list,
    "committees": dict(committees),
    "steps": dict(steps),
    "votes": votes,
  }


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--floor", type=float, default=0.1, help="min max(explicit, implicit) to keep a pair")
  args = parser.parse_args()

  questions = json.loads((RUN_DIR / "questions.json").read_text(encoding="utf-8"))
  run = json.loads((RUN_DIR / "run.json").read_text(encoding="utf-8"))

  run_news = {}
  with open(RUN_DIR / "news.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
      run_news[row["news_id"]] = row

  gate = {}
  with open(RUN_DIR / "gate.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
      gate[(row["news_id"], row["bill"])] = row

  con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
  delfino = set()
  for news_id, bill in con.execute("SELECT news_id, bill_number FROM news_bill_links"):
    if news_id in run_news:
      delfino.add((news_id, str(bill)))

  keep = {k for k, g in gate.items() if max(float(g["explicit"]), float(g["implicit"])) >= args.floor}
  keep |= delfino

  named = {}
  with open(RUN_DIR / "candidates.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
      key = (row["news_id"], row["bill"])
      if key in keep:
        named[key] = (row["source"], int(row["named"]))

  details = load_details(questions)

  news_ids = sorted({k[0] for k in keep})
  news_index = {nid: i for i, nid in enumerate(news_ids)}
  meta_rows = {}
  for i in range(0, len(news_ids), 500):
    chunk = news_ids[i:i + 500]
    marks = ",".join("?" * len(chunk))
    for row in con.execute(
        f"SELECT id, organization, title, date_published, url FROM news_articles WHERE id IN ({marks})", chunk):
      meta_rows[row[0]] = row

  genre_options = option_keys(questions["gate"]["genre"])
  news = []
  for nid in news_ids:
    _, outlet, title, date, url = meta_rows[nid]
    r = run_news[nid]
    news.append({
      "o": outlet, "t": title, "d": date, "u": url,
      "g": [pct(r.get(f"genre_{o}") or 0) for o in genre_options],
      "c": int(r["cut"]),
      "a": details.get((nid, ""), {}),
    })

  # Bills with SIL activity (a step or a vote) during the news period also go in, covered or not,
  # so the page can show the ones the media ignored.
  period_start = min(n["d"][:10] for n in news)
  active = sorted({r[0] for r in con.execute(
    "SELECT number FROM bill_steps WHERE date_start >= ? UNION SELECT number FROM votes WHERE date >= ?",
    (period_start, period_start))})
  bill_numbers = sorted({int(k[1]) for k in keep} | set(active))
  bills = {}
  for i in range(0, len(bill_numbers), 500):
    chunk = bill_numbers[i:i + 500]
    marks = ",".join("?" * len(chunk))
    for number, name, file_type, status, proposed in con.execute(
        f"SELECT number, name, file_type, status, date_proposed FROM bills WHERE number IN ({marks})", chunk):
      kind = (file_type or "").replace("PROCEDIMIENTO ", "").capitalize()
      bills[number] = [name, status or "", kind, proposed or ""]

  context = load_context(con, bill_numbers, news_dates=[n["d"][:10] for n in news])

  # [news index, bill, rank, explicit, implicit, delfino, named, detail answers or 0]
  pairs = []
  for nid, bill in sorted(keep, key=lambda k: (news_index[k[0]], k[1])):
    g = gate.get((nid, bill))
    source, is_named = named.get((nid, bill), ("", 0))
    pairs.append([
      news_index[nid], int(bill),
      int(g["rank"]) if g else 0,
      pct(g["explicit"]) if g else -1,
      pct(g["implicit"]) if g else -1,
      int((nid, bill) in delfino),
      is_named,
      details.get((nid, bill), 0),
    ])

  question_meta = {}
  for stage, qs in questions.items():
    for key, q in qs.items():
      question_meta[key] = {"stage": stage, "type": q["type"], "options": option_keys(q),
                            "text": q.get("instructions", ""), "criteria": q.get("criteria")}

  data = {
    "meta": {
      "model": ", ".join(run.get("models", [])),
      "threshold": run.get("threshold"),
      "floor": args.floor,
      "news_run": run.get("news"),
      "news_with_matches": run.get("news_with_matches"),
      "matches": run.get("matches"),
      "cost_usd": run.get("cost_usd"),
      "genre_options": genre_options,
      "news_questions": run.get("news_detail_questions", []),
      "pair_questions": run.get("detail_questions", []),
    },
    "questions": question_meta,
    "bills": bills,
    "news": news,
    "pairs": pairs,
    **context,
    "active": active,
  }
  OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
  payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
  OUT_PATH.write_text(f"window.JEV_ANSWERS = {payload};\n", encoding="utf-8")
  with_detail = sum(1 for p in pairs if p[7])
  print(f"news {len(news)}, bills {len(bills)}, pairs {len(pairs)} ({with_detail} with detail, "
        f"{len(delfino)} Delfino links), {OUT_PATH.stat().st_size / 1e6:.1f} MB -> {OUT_PATH}")


if __name__ == "__main__":
  main()
