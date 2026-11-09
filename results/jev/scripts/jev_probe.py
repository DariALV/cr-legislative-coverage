"""Throwaway probe of Jev on (news, bill) pairs. Usage: jev_probe.py [--send] [--cap-usd 0.10]
Without --send it only builds the payloads and prints sizes and estimated cost."""
import argparse
import csv
import hashlib
import json
import pathlib
import random
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from sklearn.feature_extraction.text import TfidfVectorizer

ROOT = pathlib.Path(r"D:\UCR\CI-0133_Computacion_y_Sociedad\Github\cr-legislative-coverage")
SCRATCH = pathlib.Path(__file__).parent
PRICE_PER_TOKEN = 0.042 / 1e6
MODEL = "jev-latest"

# draw -> (gold bills, role). Only rows whose review in the sheet is "Correcto".
SHEET = {309: [22817], 316: [23216], 33: [23414], 244: [23736], 34: [24282], 315: [24461], 50: [24717], 104: [23414],
         28: [], 42: [], 45: []}
EXTRA_NEGATIVES = {28: [25589]}   # "alternativos" column of the sheet, asked as negatives
N_DELFINO = 10
N_HARD = 4

ap = argparse.ArgumentParser()
ap.add_argument("--send", action="store_true")
ap.add_argument("--cap-usd", type=float, default=0.10)
ap.add_argument("--tag", default="v1")
args = ap.parse_args()

db = sqlite3.connect(f"file:{ROOT / 'databases' / 'private_corpus.db'}?mode=ro", uri=True)

def news_by_id(news_id):
  r = db.execute("select organization,title,content,date_published from news_articles where id=?", (news_id,)).fetchone()
  return {"outlet": r[0], "date_published": r[3][:10], "title": r[1], "text": r[2]}

queue = {int(r["draw"]): r["news_id"] for r in csv.DictReader(open(ROOT / "results/sample/queue.csv", encoding="utf-8"))}
items = []   # (key, news_id, gold list, forced negatives)
for draw, gold in SHEET.items():
  items.append((f"sheet{draw}", queue[draw], gold, EXTRA_NEGATIVES.get(draw, [])))
in_sheet = {queue[d] for d in queue}
rows = db.execute("""select l.news_id, group_concat(l.bill_number) from news_bill_links l join news_articles n on n.id=l.news_id
                     where n.extraction_status='Success' and length(n.content) between 1500 and 9000
                     group by l.news_id having count(*) <= 2""").fetchall()
rows = [r for r in rows if r[0] not in in_sheet]
random.Random(1).shuffle(rows)
for news_id, bills in rows[:N_DELFINO]:
  items.append((f"delfino{news_id[:6]}", news_id, [int(b) for b in bills.split(",")], []))

# bill cards
bill_rows = db.execute("select b.number,b.name,b.date_proposed,coalesce(t.exposition,'') from bills b left join bill_texts t on t.number=b.number "
                       "where b.number>=20000").fetchall()
subjects, proponents = {}, {}
for n, s in db.execute("select number,subject from bill_subjects"):
  subjects.setdefault(n, []).append(s)
for n, name, order in db.execute("select number,name,signing_order from bill_proponents order by number,signing_order"):
  proponents.setdefault(n, []).append(name)
cards = {n: {"number": n, "name": name, "date_filed": (d or "")[:10], "proponents": proponents.get(n, [])[:3],
             "subjects": subjects.get(n, []), "summary_excerpt": expo[:1500]} for n, name, d, expo in bill_rows}
numbers = [r[0] for r in bill_rows]
docs = [f"{cards[n]['name']} {' '.join(cards[n]['subjects'])} {cards[n]['summary_excerpt']}" for n in numbers]
vec = TfidfVectorizer(sublinear_tf=True, min_df=2, max_df=0.5)
bill_matrix = vec.fit_transform(docs)
index = {n: i for i, n in enumerate(numbers)}

QUESTIONS = {
  "explicit": {"type": "noul", "instructions": "Does `news` identify `bill` directly, by its number, its official name, or a nickname for it?",
               "criteria": {"true": "The news gives this bill's expediente number, quotes its official title, or uses a nickname that refers to this bill.",
                            "false": "The news never names this bill, even if it discusses a similar subject."}},
  "implicit": {"type": "noul", "instructions": "Does `news` talk about `bill` without naming it, by describing what it would change, or by pointing to who proposed it or where it stands?",
               "criteria": {"true": "The news describes the content of this specific bill, or says who proposed it or what step it is in, without giving its number or title.",
                            "false": "The news does not describe this specific bill."}},
  "same_topic": {"type": "noul", "instructions": "Is `news` about the same subject as `bill`?"},
  "centrality": {"type": "score", "instructions": "How much of `news` is about `bill`?",
                 "criteria": ["The bill appears in passing, in one sentence or in a list, and the news is about something else.",
                              "The bill is one part of the news but not its main subject.",
                              "The news is mainly about the bill."]},
  "stance": {"type": "score", "instructions": "What opinion of `bill` does `news` convey?",
             "criteria": ["The news is strongly critical of the bill.", "The news is mildly critical of the bill.",
                          "The news presents the bill without taking a side.", "The news is mildly favorable to the bill.",
                          "The news is strongly favorable to the bill."]},
  "author_judges": {"type": "noul", "instructions": "Does the author of `news`, and not a person the news quotes, say that `bill` is good or bad?"},
  "new_development": {"type": "noul", "instructions": "Does `news` report something that just happened to `bill` in the legislative process, such as filing, a committee report or a vote?"},
}

def build_pairs():
  pairs = []
  for key, news_id, gold, forced in items:
    news = news_by_id(news_id)
    q = vec.transform([f"{news['title']} {news['text']}"])
    sims = (bill_matrix @ q.T).toarray().ravel()
    order = [numbers[i] for i in np.argsort(-sims)]
    hard = [n for n in order if n not in gold and n not in forced][:N_HARD]
    easy = [n for n in random.Random(hash(key) % 1000).sample(numbers, 5) if n not in gold][:1]
    cand = [(n, "gold") for n in gold] + [(n, "forced_negative") for n in forced] + [(n, "hard_negative") for n in hard] + [(n, "random") for n in easy]
    for n, role in cand:
      state = {"news": news, "bill": cards[n]}
      pairs.append({"key": key, "news_id": news_id, "bill": n, "role": role,
                    "payload": {"model": MODEL, "state": state, "questions": QUESTIONS}})
  return pairs

pairs = build_pairs()
for p in pairs:
  p["chars"] = len(json.dumps(p["payload"]["state"], ensure_ascii=False))
print(f"{len(items)} news, {len(pairs)} pairs; roles:", {r: sum(p['role'] == r for p in pairs) for r in ('gold', 'forced_negative', 'hard_negative', 'random')})
for key, news_id, gold, forced in items:
  n = news_by_id(news_id)
  print(f"  {key:16s} {n['outlet']:10s} {n['date_published']} gold={gold} :: {n['title'][:90]}")
est_tokens = sum(p["chars"] for p in pairs) / 3.3 + len(pairs) * 700
print(f"estimated input tokens {est_tokens:,.0f} (~${est_tokens * PRICE_PER_TOKEN:.3f}); cap ${args.cap_usd}")
(SCRATCH / f"payloads_{args.tag}.json").write_text(json.dumps(pairs, ensure_ascii=False), encoding="utf-8")
if not args.send:
  sys.exit(0)

key_line = [l for l in open(ROOT / ".env", encoding="utf-8") if l.startswith("TYPESAFE_API_KEY=")][0]
API_KEY = key_line.split("=", 1)[1].strip().strip('"').strip("'")
spent = {"tokens": 0}
out_path = SCRATCH / f"answers_{args.tag}.jsonl"
done = {}
if out_path.exists():
  for line in open(out_path, encoding="utf-8"):
    r = json.loads(line); done[(r["key"], r["bill"])] = r

def call(p):
  k = (p["key"], p["bill"])
  if k in done:
    return done[k]
  if spent["tokens"] * PRICE_PER_TOKEN > args.cap_usd:
    raise SystemExit("cost cap reached")
  for attempt in range(4):
    resp = requests.post("https://api.typesafe.ai/v1/systemone", json=p["payload"], timeout=120,
                         headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"})
    if resp.status_code == 429:
      time.sleep(2 ** attempt); continue
    if resp.status_code != 200:
      raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
    body = resp.json()
    spent["tokens"] += body["usage"]["input_tokens"]
    r = {k2: p[k2] for k2 in ("key", "news_id", "bill", "role", "chars")} | {"answers": body["answers"], "usage": body["usage"], "model": body["model"]}
    with open(out_path, "a", encoding="utf-8") as f:
      f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return r
  raise RuntimeError("rate limited")

with ThreadPoolExecutor(4) as pool:
  results = list(pool.map(call, pairs))
print(f"done {len(results)} calls; input tokens this run {spent['tokens']:,} (~${spent['tokens'] * PRICE_PER_TOKEN:.4f})")
