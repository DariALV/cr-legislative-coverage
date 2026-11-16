"""Statistics of every Jev question over the corpus run, overall and by outlet, recomputed from the raw answers.

Reads results/jev/corpus/answers.jsonl (gate and details requests), results/jev/corpus_filter/answers.jsonl and
filter.csv (outlet of each news), and results/jev/corpus/questions.json. Writes only aggregates (no news text, no
news ids) to results/jev/question_stats/question_stats.json.

Definitions:
  - noul (yes/no): p is the probability of "yes"; the answer is "yes" when p >= 0.5; certainty = |2p - 1|.
  - choice: the chosen option is Jev's `choice`; certainty = Jev's `confidence`.
  - score: the option is the score rounded to the nearest integer of the scale; certainty = Jev's `confidence`.
  - Certainty buckets: [0, .5), [.5, .75), [.75, .9), [.9, 1].
  - Tokens: each request's input tokens are split evenly among the question instances it carries (genre counts
    once per gate request, explicit/implicit once per candidate, news questions once per details request, bill
    questions once per matched bill). Output tokens are free.
  - Match confidence: max(explicit, implicit) of a matched pair.
  - Gate match: explicit >= 0.5 or implicit >= 0.5 (the run's threshold). Mention: explicit >= 0.5 or
    implicit >= 0.75. Substantive: mention and centrality score / 2 >= 0.25.

    python -I results/jev/scripts/jev_question_stats.py
"""
import collections
import csv
import json
import math
import pathlib
import statistics

ROOT = pathlib.Path(__file__).resolve().parents[3]
JEV = ROOT / "results" / "jev"
OUT = JEV / "question_stats" / "question_stats.json"
PRICE_PER_TOKEN = 0.042 / 1e6
OUTLETS = ["crhoy", "delfino", "elmundo", "nacion", "semanario"]
ALL = "all"
BUCKETS = [0.5, 0.75, 0.9]
SLIDER = [round(0.05 * i, 2) for i in range(1, 20)]
SCORE_LEVELS = {"assembly_image": 5, "stance": 5, "centrality": 3}


def bucket(certainty):
  return sum(certainty >= edge for edge in BUCKETS)


class Tally:
  """Answers of one question (or one option) in one outlet."""

  def __init__(self):
    self.n = 0
    self.certainty_sum = 0.0
    self.buckets = [0, 0, 0, 0]
    self.yes = 0
    self.yes_certainty_sum = 0.0
    self.yes_low = 0
    self.options = collections.Counter()
    self.option_certainty = collections.defaultdict(float)
    self.option_buckets = collections.defaultdict(lambda: [0, 0, 0, 0])
    self.tokens = 0.0
    self.requests = 0

  def add_noul(self, p):
    c = abs(2 * p - 1)
    self.n += 1
    self.certainty_sum += c
    self.buckets[bucket(c)] += 1
    if p >= 0.5:
      self.yes += 1
      self.yes_certainty_sum += c
      self.yes_low += c < 0.5

  def add_option(self, option, c):
    self.n += 1
    self.certainty_sum += c
    self.buckets[bucket(c)] += 1
    self.options[option] += 1
    self.option_certainty[option] += c
    self.option_buckets[option][bucket(c)] += 1

  def to_json(self, kind, option_order):
    out = {
      "answers": self.n,
      "mean_certainty": round(self.certainty_sum / self.n, 4) if self.n else None,
      "certainty_buckets": [round(b / self.n, 4) if self.n else None for b in self.buckets],
      "requests": self.requests,
      "tokens": round(self.tokens),
      "cost_usd": round(self.tokens * PRICE_PER_TOKEN, 4),
      "tokens_per_answer": round(self.tokens / self.n, 1) if self.n else None,
    }
    if kind == "noul":
      out.update({
        "yes": self.yes,
        "yes_share": round(self.yes / self.n, 4) if self.n else None,
        "yes_mean_certainty": round(self.yes_certainty_sum / self.yes, 4) if self.yes else None,
        "yes_low_certainty_share": round(self.yes_low / self.yes, 4) if self.yes else None,
      })
    else:
      out["options"] = {
        o: {
          "count": self.options[o],
          "share": round(self.options[o] / self.n, 4) if self.n else None,
          "mean_certainty": round(self.option_certainty[o] / self.options[o], 4) if self.options[o] else None,
          "certainty_buckets": [round(b / self.options[o], 4) if self.options[o] else None
                                for b in self.option_buckets[o]],
        } for o in option_order}
    return out


def main():
  questions = json.loads((JEV / "corpus" / "questions.json").read_text(encoding="utf-8"))
  outlet_of = {}
  filter_p = {}
  with open(JEV / "corpus_filter" / "filter.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
      outlet_of[row["news_id"]] = row["outlet"]
      filter_p[row["news_id"]] = float(row["assembly"])

  tallies = collections.defaultdict(lambda: collections.defaultdict(Tally))   # question -> outlet -> Tally
  stage_tokens = collections.defaultdict(collections.Counter)                 # outlet -> stage -> tokens
  stage_requests = collections.defaultdict(collections.Counter)
  pair_max = collections.defaultdict(list)       # news -> [max(explicit, implicit) per candidate]
  pair_explicit = {}
  pair_implicit = {}
  centrality = {}
  option_order = {}

  # Filter stage: one question per news.
  with open(JEV / "corpus_filter" / "answers.jsonl", encoding="utf-8") as f:
    for line in f:
      d = json.loads(line)
      outlet = outlet_of[d["news_id"]]
      for key in (outlet, ALL):
        t = tallies["assembly"][key]
        t.add_noul(d["answers"]["assembly"]["noul"])
        t.tokens += d["input_tokens"]
        t.requests += 1
        stage_tokens[key]["filter"] += d["input_tokens"]
        stage_requests[key]["filter"] += 1

  with open(JEV / "corpus" / "answers.jsonl", encoding="utf-8") as f:
    for line in f:
      d = json.loads(line)
      news, stage, answers = d["news_id"], d["stage"], d["answers"]
      outlet = outlet_of[news]
      share = d["input_tokens"] / len(answers)
      seen = set()
      for full, a in answers.items():
        if full.startswith("b") and "_" in full:
          bill, q = full[1:].split("_", 1)
        elif full.startswith("news_"):
          bill, q = None, full[5:]
        else:
          bill, q = None, full
        for key in (outlet, ALL):
          t = tallies[q][key]
          t.tokens += share
          if (q, key) not in seen:
            t.requests += 1
            seen.add((q, key))
          if a["type"] == "noul":
            t.add_noul(a["noul"])
          elif a["type"] == "choice":
            option_order.setdefault(q, list(a["probabilities"]))
            t.add_option(a["choice"], a["confidence"])
          else:
            levels = SCORE_LEVELS[q]
            option_order.setdefault(q, [str(i) for i in range(levels)])
            t.add_option(str(min(levels - 1, max(0, round(a["score"])))), a["confidence"])
        if stage == "gate" and q in ("explicit", "implicit"):
          (pair_explicit if q == "explicit" else pair_implicit)[(news, bill)] = a["noul"]
        if q == "centrality":
          centrality[(news, bill)] = a["score"] / 2
      for key in (outlet, ALL):
        stage_tokens[key][stage] += d["input_tokens"]
        stage_requests[key][stage] += 1

  # Per news: candidates' gate answers and the three levels of match.
  per_news = {}
  for (news, bill), e in pair_explicit.items():
    i = pair_implicit[(news, bill)]
    r = per_news.setdefault(news, {"max": [], "match": 0, "mention": 0, "substantive": 0, "match_conf": []})
    r["max"].append(max(e, i))
    if e >= 0.5 or i >= 0.5:
      r["match"] += 1
      r["match_conf"].append(max(e, i))
    if e >= 0.5 or i >= 0.75:
      r["mention"] += 1
      if centrality.get((news, bill), 0) >= 0.25:
        r["substantive"] += 1

  def distribution(counts):
    c = collections.Counter(min(n, 5) for n in counts)
    total = len(counts)
    return {
      "news": total,
      "with_bills": sum(n > 0 for n in counts),
      "pairs": sum(counts),
      "mean_bills": round(sum(counts) / total, 3) if total else None,
      "mean_bills_when_any": round(sum(counts) / max(1, sum(n > 0 for n in counts)), 3),
      "median_bills_when_any": statistics.median([n for n in counts if n > 0]) if any(counts) else None,
      "bills_per_news": {("5+" if k == 5 else str(k)): c[k] for k in range(6)},
    }

  general = {}
  for key in OUTLETS + [ALL]:
    news_all = [n for n, o in outlet_of.items() if key == ALL or o == key]
    gated = [n for n in news_all if n in per_news]
    level = {lv: distribution([per_news[n][lv] for n in gated]) for lv in ("match", "mention", "substantive")}
    gate_slider = {}
    for th in SLIDER:
      gate_slider[str(th)] = distribution([sum(m >= th for m in per_news[n]["max"]) for n in gated])
    filter_slider = {str(th): sum(filter_p[n] >= th for n in news_all) for th in SLIDER}
    tokens = stage_tokens[key]
    confidences = [c for n in gated for c in per_news[n]["match_conf"]]
    general[key] = {
      "news_with_text": len(news_all),
      "pass_filter": len(gated),
      "mean_match_confidence": round(sum(confidences) / len(confidences), 4) if confidences else None,
      "levels": level,
      "gate_threshold_slider": gate_slider,
      "filter_threshold_slider": filter_slider,
      "requests": dict(stage_requests[key]),
      "tokens": dict(tokens),
      "cost_usd": {s: round(v * PRICE_PER_TOKEN, 4) for s, v in tokens.items()},
      "cost_usd_total": round(sum(tokens.values()) * PRICE_PER_TOKEN, 4),
    }

  stage_of = {"assembly": "filter"}
  for group, names in questions.items():
    for q in names:
      stage_of[q] = {"gate": "gate", "details_news": "details_news", "details": "details_bill"}[group]
  per_question = {}
  for q, by_outlet in tallies.items():
    group = next((g for g, names in questions.items() if q in names), None)
    spec = questions[group][q] if group else None
    kind = spec["type"] if spec else "noul"
    per_question[q] = {
      "stage": stage_of[q],
      "type": kind,
      "instructions": spec.get("instructions") if spec else None,
      "criteria": spec.get("criteria") if spec else None,
      "by_outlet": {key: by_outlet[key].to_json(kind, option_order.get(q, [])) for key in OUTLETS + [ALL]},
    }

  OUT.parent.mkdir(parents=True, exist_ok=True)
  OUT.write_text(json.dumps({
    "definitions": __doc__.split("Definitions:")[1].split("python -I")[0].strip(),
    "price_per_million_input_tokens": 0.042,
    "outlets": OUTLETS,
    "general": general,
    "questions": per_question,
  }, ensure_ascii=False, indent=1), encoding="utf-8")
  print(f"{len(per_question)} questions, {len(per_news)} gated news -> {OUT} ({OUT.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
  main()
