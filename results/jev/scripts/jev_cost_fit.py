import json, sys, csv, statistics as st
import numpy as np
sys.path.insert(0, ".")
from tools.llm_tools import jev_questions as jq

def qchars(qs):
  return sum(len(json.dumps(q.model_dump(mode="json"), ensure_ascii=False)) for q in qs.values())

# --- question sizes (current code) ---
k = "b25615"
cur = {"filter": qchars(jq.filter_questions()), "genre": qchars({"g": jq.genre_question()}),
       "gate_per_bill": qchars(jq.gate_questions(k)), "detail_per_bill": qchars(jq.detail_questions(k)),
       "detail_news": qchars(jq.news_detail_questions()),
       "n_detail_per_bill": len(jq.detail_questions(k)), "n_detail_news": len(jq.news_detail_questions())}
print("current question chars:", cur)

# --- filter: news tokens ---
meta = {r["news_id"]: r for r in csv.DictReader(open("results/jev/corpus_filter/filter.csv", encoding="utf-8"))}
ftok = {}
for line in open("results/jev/corpus_filter/answers.jsonl", encoding="utf-8"):
  r = json.loads(line); ftok[r["news_id"]] = r["input_tokens"]
print("filter records", len(ftok))

# --- test100 fits ---
gate, det = [], []
for line in open("results/jev/test100/answers.jsonl", encoding="utf-8"):
  r = json.loads(line); a = r["answers"]
  if r["news_id"] not in ftok: continue
  if r["stage"] == "gate":
    nb = sum(1 for x in a if x.endswith("_explicit"))
    gate.append((ftok[r["news_id"]], nb, r["input_tokens"]))
  else:
    nb = sum(1 for x in a if x.endswith("_centrality"))
    det.append((ftok[r["news_id"]], nb, r["input_tokens"]))
for name, rows in [("gate", gate), ("details", det)]:
  X = np.array([[1, f, b] for f, b, _ in rows], float); y = np.array([t for *_, t in rows], float)
  coef, *_ = np.linalg.lstsq(X, y, rcond=None)
  res = y - X @ coef
  print(name, len(rows), "coef [const, per filter-token, per bill] =", coef.round(2), "resid sd", res.std().round(0),
        "bills mean", np.mean([b for _, b, _ in rows]).round(2), "tokens mean", y.mean().round(0))
