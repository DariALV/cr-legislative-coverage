"""Throwaway: news-level filter question for Jev on the 300 manual-sample news plus the Delfino gold news.
Usage: jev_filter.py [--send] [--cap-usd 0.15]  (without --send it only builds the requests and prints the estimate)"""
import argparse
import csv
import json
import pathlib
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import requests

ROOT = pathlib.Path(r"D:\UCR\CI-0133_Computacion_y_Sociedad\Github\cr-legislative-coverage")
SCRATCH = pathlib.Path(__file__).parent
sys.path.insert(0, str(SCRATCH))
import sheet_labels as SL
import sheet_review as SR

PRICE = 0.042 / 1e6
MAX_CHARS = 15000

ap = argparse.ArgumentParser()
ap.add_argument("--send", action="store_true")
ap.add_argument("--cap-usd", type=float, default=0.15)
args = ap.parse_args()

assert len(SL.DRAWS) == 300 and len(SR.REVIEW) == 300, (len(SL.DRAWS), len(SR.REVIEW))
queue = {int(r["draw"]): r["news_id"] for r in csv.DictReader(open(ROOT / "results/sample/queue.csv", encoding="utf-8"))}
db = sqlite3.connect(f"file:{ROOT / 'databases' / 'private_corpus.db'}?mode=ro", uri=True)

items = {}   # news_id -> meta
for draw, tipo, review in zip(SL.DRAWS, SL.TIPOS[:300], SR.REVIEW):
  items[queue[draw]] = {"source": "sample", "draw": draw, "type": tipo, "review": review, "positive": tipo in SL.POSITIVE}
gold_ids = [r[0] for r in db.execute("select distinct l.news_id from news_bill_links l join news_articles n on n.id=l.news_id where n.extraction_status='Success'")]
for nid in gold_ids:
  if nid in items:
    items[nid]["in_gold"] = True
  else:
    items[nid] = {"source": "gold", "draw": None, "type": "gold", "review": "", "positive": True, "in_gold": True}

QUESTIONS = {
  "assembly": {"type": "noul",
               "instructions": "Does `news` talk about the Legislative Assembly or about a proposed law, even without naming a specific bill?",
               "criteria": {"true": "The news reports or comments on a bill, a proposed reform, a vote, a committee or the plenary session, or on what deputies are doing as legislators.",
                            "false": "The news is about something else, and the Assembly or any proposed law does not come up."}},
  "bill": {"type": "noul",
           "instructions": "Does `news` talk about a specific bill or law reform, either by naming it or by describing what it would change?",
           "criteria": {"true": "The news gives the number or title of a bill, or describes the content of a proposed law or reform.",
                        "false": "The news does not describe any specific proposed law or reform."}},
}

requests_ = []
for nid, meta in items.items():
  r = db.execute("select organization,title,content,date_published from news_articles where id=?", (nid,)).fetchone()
  state = {"outlet": r[0], "date_published": r[3][:10], "title": r[1], "text": (r[2] or "")[:MAX_CHARS]}
  requests_.append({"news_id": nid, "meta": meta, "payload": {"model": "jev-latest", "state": state, "questions": QUESTIONS}})

chars = sum(len(json.dumps(r["payload"], ensure_ascii=False)) for r in requests_)
est = chars / 3.8
print(f"{len(requests_)} news: sample {sum(m['source']=='sample' for m in (r['meta'] for r in requests_))}, "
      f"gold-only {sum(m['source']=='gold' for m in (r['meta'] for r in requests_))}; "
      f"est tokens {est:,.0f} (~${est * PRICE:.3f}); cap ${args.cap_usd}")
print("sample review counts:", {k: SR.REVIEW.count(k) for k in set(SR.REVIEW)}, "| positives:", sum(m['positive'] and m['source']=='sample' for m in (r['meta'] for r in requests_)))
if not args.send:
  sys.exit(0)

API_KEY = [l for l in open(ROOT / ".env", encoding="utf-8") if l.startswith("TYPESAFE_API_KEY=")][0].split("=", 1)[1].strip().strip('"').strip("'")
out = SCRATCH / "answers_filter_v1.jsonl"
done = {json.loads(l)["news_id"] for l in open(out, encoding="utf-8")} if out.exists() else set()
spent = {"t": 0}
errors = []

def call(r):
  if r["news_id"] in done:
    return
  if spent["t"] * PRICE > args.cap_usd:
    raise SystemExit("cost cap reached")
  for attempt in range(5):
    resp = requests.post("https://api.typesafe.ai/v1/systemone", json=r["payload"], timeout=300,
                         headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"})
    if resp.status_code == 429:
      time.sleep(2 ** attempt); continue
    if resp.status_code != 200:
      errors.append((r["news_id"][:8], resp.status_code, resp.text[:120])); return
    body = resp.json()
    spent["t"] += body["usage"]["input_tokens"]
    with open(out, "a", encoding="utf-8") as f:
      f.write(json.dumps({"news_id": r["news_id"], "meta": r["meta"], "assembly": body["answers"]["assembly"]["noul"],
                          "bill": body["answers"]["bill"]["noul"], "tokens": body["usage"]["input_tokens"]}) + "\n")
    return
  errors.append((r["news_id"][:8], "rate limited", ""))

t0 = time.time()
with ThreadPoolExecutor(4) as pool:
  list(pool.map(call, requests_))
print(f"done in {time.time() - t0:.0f}s; input tokens {spent['t']:,} (~${spent['t'] * PRICE:.4f}); errors {len(errors)} {errors[:5]}")
