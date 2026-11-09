"""Throwaway: does Jev agree with our labels on the 187 sample rows reviewed as Correcto?
 (a) news-level Choice over the news types (all 187);  (b) pair-level Noul per mention type + centrality Score on the 62 positives (gold bill)
 plus one hard-negative bill per positive news as a control.   Usage: jev_types.py [--send] [--cap-usd 0.10]"""
import argparse
import csv
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
sys.path.insert(0, str(SCRATCH))
import sheet_labels as SL
import sheet_pairs as SP
import sheet_review as SR

PRICE = 0.042 / 1e6
MAX_CHARS = 15000
ap = argparse.ArgumentParser()
ap.add_argument("--send", action="store_true")
ap.add_argument("--cap-usd", type=float, default=0.10)
args = ap.parse_args()

queue = {int(r["draw"]): r["news_id"] for r in csv.DictReader(open(ROOT / "results/sample/queue.csv", encoding="utf-8"))}
db = sqlite3.connect(f"file:{ROOT / 'databases' / 'private_corpus.db'}?mode=ro", uri=True)

def news_state(nid):
  r = db.execute("select organization,title,content,date_published from news_articles where id=?", (nid,)).fetchone()
  return {"outlet": r[0], "date_published": r[3][:10], "title": r[1], "text": (r[2] or "")[:MAX_CHARS]}

NEWS_TYPE = {"Número": "bill_discussed", "Nombre oficial": "bill_discussed", "Apodo": "bill_discussed", "Descripción": "bill_discussed",
             "Proponente o trámite": "bill_discussed", "ACT": "legislative_activity_no_bill", "Decreto": "executive_action",
             "Mismo": "same_topic_no_bill", "Anunciado": "announced_not_filed", "Ley": "law_in_force", "SR": "unrelated"}
MENTION = {"Número": "cites_number", "Nombre oficial": "uses_official_name", "Apodo": "uses_nickname", "Descripción": "describes_content",
           "Proponente o trámite": "by_proponent_or_step"}

NEWS_Q = {"news_type": {"type": "choice", "instructions": "How does `news` relate to proposed laws and to the Legislative Assembly?",
  "criteria": {
    "bill_discussed": "The news names a bill or proposed law, or describes what one would change, and reports or comments on it.",
    "legislative_activity_no_bill": "The news is about something the Assembly or its deputies do that is not a bill: political oversight, an investigative commission, an appointment or election of officials, or internal procedure.",
    "executive_action": "The news is about a decree, a policy or an action of the executive branch, and not about a bill.",
    "same_topic_no_bill": "The news is about a subject for which a bill exists in the Assembly, but it never mentions or describes that bill; it covers the subject through a court ruling, a policy, a protest or an event.",
    "announced_not_filed": "The news says someone will present, or is preparing, a bill that has not been filed yet.",
    "law_in_force": "The news is about a law or regulation that is already in force and is being applied or discussed, not a bill under consideration.",
    "unrelated": "The news has nothing to do with the Assembly, bills or laws."}}}

PAIR_Q = {
  "cites_number": {"type": "noul", "instructions": "Does `news` state the expediente number of `bill`?",
                   "criteria": {"true": "The number of this bill appears in the news, written for example as 23.216 or 23216.", "false": "The number of this bill does not appear in the news."}},
  "uses_official_name": {"type": "noul", "instructions": "Does `news` refer to `bill` by its official title, in full or shortened?",
                         "criteria": {"true": "The news quotes the title of this bill, or a shortened form of it made of the main words of the title.", "false": "The news does not refer to this bill by its title."}},
  "uses_nickname": {"type": "noul", "instructions": "Does `news` call `bill` by a popular nickname or a short slogan?",
                    "criteria": {"true": "The news uses a nickname or slogan for this bill that is not part of its official title.", "false": "The news uses no nickname for this bill."}},
  "describes_content": {"type": "noul", "instructions": "Does `news` describe what `bill` would change?",
                        "criteria": {"true": "The news explains the content or effect of this bill's proposal.", "false": "The news does not explain what this bill would change."}},
  "by_proponent_or_step": {"type": "noul", "instructions": "Does `news` point to `bill` by who proposed it or by the step it is in?",
                           "criteria": {"true": "The news identifies this bill through its proponent, a deputy or a party, or through its procedural step.", "false": "The news does not mention who proposed this bill or where it stands."}},
  "centrality": {"type": "score", "instructions": "How much of `news` is about `bill`?",
                 "criteria": ["The bill appears in passing, in one sentence or in a list, and the news is about something else.",
                              "The bill is one part of the news but not its main subject.", "The news is mainly about the bill."]},
}

# bills
bill_rows = db.execute("select b.number,b.name,b.date_proposed,coalesce(t.exposition,'') from bills b left join bill_texts t on t.number=b.number where b.number>=20000").fetchall()
subjects, proponents = {}, {}
for n, s in db.execute("select number,subject from bill_subjects"):
  subjects.setdefault(n, []).append(s)
for n, name in db.execute("select number,name from bill_proponents order by number,signing_order"):
  proponents.setdefault(n, []).append(name)
cards = {n: {"number": n, "name": name, "date_filed": (d or "")[:10], "proponents": proponents.get(n, [])[:3], "subjects": subjects.get(n, []),
             "summary_excerpt": expo[:800]} for n, name, d, expo in bill_rows}
numbers = [r[0] for r in bill_rows]
vec = TfidfVectorizer(sublinear_tf=True, min_df=2, max_df=0.5)
mat = vec.fit_transform([f"{r[1]} {' '.join(subjects.get(r[0], []))} {r[3][:1500]}" for r in bill_rows])

reqs = []
for i in range(300):
  if SR.REVIEW[i] != "Correcto":
    continue
  nid = queue[SL.DRAWS[i]]; tipo = SL.TIPOS[i]; st = news_state(nid)
  reqs.append({"id": f"news:{i}", "kind": "news", "pos": i, "news_id": nid, "label": tipo,
               "payload": {"model": "jev-latest", "state": {"news": st}, "questions": NEWS_Q}})
  if tipo in SL.POSITIVE:
    bill, cen = (int(SP.F150[i][0]), SP.L150[i][0]) if i < 150 else SP.LATE[i]
    q = vec.transform([f"{st['title']} {st['text']}"])
    order = [numbers[j] for j in np.argsort(-(mat @ q.T).toarray().ravel())]
    ctrl = next(n for n in order if n != bill)
    for role, b in (("gold", bill), ("control", ctrl)):
      reqs.append({"id": f"pair:{i}:{role}", "kind": "pair", "pos": i, "news_id": nid, "label": tipo, "role": role, "bill": b, "centrality_label": cen,
                   "payload": {"model": "jev-latest", "state": {"news": st, "bill": cards[b]}, "questions": PAIR_Q}})
chars = sum(len(json.dumps(r["payload"], ensure_ascii=False)) for r in reqs)
est = chars / 3.8
print(f"{len(reqs)} requests ({sum(r['kind']=='news' for r in reqs)} news-level, {sum(r['kind']=='pair' for r in reqs)} pair-level); est tokens {est:,.0f} (~${est * PRICE:.3f}); cap ${args.cap_usd}")
if not args.send:
  sys.exit(0)

API_KEY = [l for l in open(ROOT / ".env", encoding="utf-8") if l.startswith("TYPESAFE_API_KEY=")][0].split("=", 1)[1].strip().strip('"').strip("'")
out = SCRATCH / "answers_types.jsonl"
done = {json.loads(l)["id"] for l in open(out, encoding="utf-8")} if out.exists() else set()
spent = {"t": 0}
errors = []

def call(r):
  if r["id"] in done:
    return
  if spent["t"] * PRICE > args.cap_usd:
    raise SystemExit("cost cap reached")
  for attempt in range(5):
    resp = requests.post("https://api.typesafe.ai/v1/systemone", json=r["payload"], timeout=300,
                         headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"})
    if resp.status_code == 429:
      time.sleep(2 ** attempt); continue
    if resp.status_code != 200:
      errors.append((r["id"], resp.status_code, resp.text[:120])); return
    body = resp.json(); spent["t"] += body["usage"]["input_tokens"]
    meta = {k: r[k] for k in r if k not in ("payload",)}
    with open(out, "a", encoding="utf-8") as f:
      f.write(json.dumps(meta | {"answers": body["answers"], "tokens": body["usage"]["input_tokens"]}, ensure_ascii=False) + "\n")
    return
  errors.append((r["id"], "rate limited", ""))

t0 = time.time()
with ThreadPoolExecutor(4) as pool:
  list(pool.map(call, reqs))
print(f"done in {time.time() - t0:.0f}s; input tokens {spent['t']:,} (~${spent['t'] * PRICE:.4f}); errors {len(errors)} {errors[:5]}")
