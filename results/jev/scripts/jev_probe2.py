"""Throwaway probe v2: ONE request per news with K=50 candidate bills in the state and the 3 gate questions per bill.
Usage: jev_probe2.py --variant short|full [--send] [--cap-usd 0.12]"""
import argparse
import json
import pathlib
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from sklearn.feature_extraction.text import TfidfVectorizer

ROOT = pathlib.Path(r"D:\UCR\CI-0133_Computacion_y_Sociedad\Github\cr-legislative-coverage")
SCRATCH = pathlib.Path(__file__).parent
PRICE = 0.042 / 1e6
K = 50

ap = argparse.ArgumentParser()
ap.add_argument("--variant", choices=["short", "full"], required=True)
ap.add_argument("--send", action="store_true")
ap.add_argument("--cap-usd", type=float, default=0.12)
args = ap.parse_args()

v1 = json.loads((SCRATCH / "payloads_v1.json").read_text(encoding="utf-8"))
per_news = {}
for p in v1:
  per_news.setdefault(p["key"], {"news": p["payload"]["state"]["news"], "news_id": p["news_id"], "bills": {}})["bills"][p["bill"]] = (p["role"], p["payload"]["state"]["bill"])

db = sqlite3.connect(f"file:{ROOT / 'databases' / 'private_corpus.db'}?mode=ro", uri=True)
rows = db.execute("select b.number,b.name,b.date_proposed,coalesce(t.exposition,'') from bills b left join bill_texts t on t.number=b.number where b.number>=20000").fetchall()
subjects, proponents = {}, {}
for n, s in db.execute("select number,subject from bill_subjects"):
  subjects.setdefault(n, []).append(s)
for n, name in db.execute("select number,name from bill_proponents order by number,signing_order"):
  proponents.setdefault(n, []).append(name)

def card(n, name, d, expo):
  c = {"number": n, "name": name, "date_filed": (d or "")[:10], "proponents": proponents.get(n, [])[:3], "subjects": subjects.get(n, [])}
  if args.variant == "full":
    c["summary_excerpt"] = expo[:1500]
  return c

cards = {n: card(n, name, d, expo) for n, name, d, expo in rows}
numbers = [r[0] for r in rows]
docs = [f"{r[1]} {' '.join(subjects.get(r[0], []))} {r[3][:1500]}" for r in rows]
vec = TfidfVectorizer(sublinear_tf=True, min_df=2, max_df=0.5)
bill_matrix = vec.fit_transform(docs)

GATE = {
  "explicit": ("Does `news` identify `{p}` directly, by its number, its official name, or a nickname for it?",
               {"true": "The news gives this bill's expediente number, quotes its official title, or uses a nickname that refers to this bill.",
                "false": "The news never names this bill, even if it discusses a similar subject."}),
  "implicit": ("Does `news` talk about `{p}` without naming it, by describing what it would change, or by pointing to who proposed it or where it stands?",
               {"true": "The news describes the content of this specific bill, or says who proposed it or what step it is in, without giving its number or title.",
                "false": "The news does not describe this specific bill."}),
  "same_topic": ("Is `news` about the same subject as `{p}`?", None),
}

requests_ = []
for key, d in per_news.items():
  chosen = list(d["bills"])
  q = vec.transform([f"{d['news']['title']} {d['news']['text']}"])
  order = [numbers[i] for i in np.argsort(-(bill_matrix @ q.T).toarray().ravel())]
  for n in order:
    if len(chosen) >= K:
      break
    if n not in chosen:
      chosen.append(n)
  candidates = {f"b{n}": cards[n] for n in chosen}
  questions = {}
  for n in chosen:
    for name, (text, criteria) in GATE.items():
      qd = {"type": "noul", "instructions": text.format(p=f"candidates.b{n}")}
      if criteria:
        qd["criteria"] = criteria
      questions[f"b{n}_{name}"] = qd
  requests_.append({"key": key, "news_id": d["news_id"], "bills": chosen, "original": list(d["bills"]),
                    "payload": {"model": "jev-latest", "state": {"news": d["news"], "candidates": candidates}, "questions": questions}})

chars = [len(json.dumps(r["payload"], ensure_ascii=False)) for r in requests_]
est = sum(chars) / 3.8
print(f"variant {args.variant}: {len(requests_)} requests, {sum(len(r['bills']) for r in requests_)} candidates, "
      f"{sum(len(r['payload']['questions']) for r in requests_)} questions; payload chars mean {np.mean(chars):,.0f} max {max(chars):,}; "
      f"est tokens {est:,.0f} (~${est * PRICE:.3f}); est max per request {max(chars) / 3.8:,.0f}")
if not args.send:
  sys.exit(0)

API_KEY = [l for l in open(ROOT / ".env", encoding="utf-8") if l.startswith("TYPESAFE_API_KEY=")][0].split("=", 1)[1].strip().strip('"').strip("'")
out = SCRATCH / f"answers_v2_{args.variant}.jsonl"
done = {json.loads(l)["key"] for l in open(out, encoding="utf-8")} if out.exists() else set()
spent = {"t": 0}

def call(r):
  if r["key"] in done:
    return
  if spent["t"] * PRICE > args.cap_usd:
    raise SystemExit("cost cap reached")
  for attempt in range(4):
    resp = requests.post("https://api.typesafe.ai/v1/systemone", json=r["payload"], timeout=300,
                         headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"})
    if resp.status_code == 429:
      time.sleep(2 ** attempt); continue
    if resp.status_code != 200:
      print("HTTP", resp.status_code, resp.text[:300], r["key"]); return
    body = resp.json()
    spent["t"] += body["usage"]["input_tokens"]
    with open(out, "a", encoding="utf-8") as f:
      f.write(json.dumps({"key": r["key"], "news_id": r["news_id"], "bills": r["bills"], "original": r["original"],
                          "answers": body["answers"], "usage": body["usage"], "seconds": None}, ensure_ascii=False) + "\n")
    return

t0 = time.time()
with ThreadPoolExecutor(3) as pool:
  list(pool.map(call, requests_))
print(f"done in {time.time() - t0:.0f}s; input tokens {spent['t']:,} (~${spent['t'] * PRICE:.4f})")
