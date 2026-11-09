import argparse
import collections
import csv
import json
import pathlib

from config import Config
from tools.llm_tools.jev_runner import write_csv
from tools.sample_tools.sample_labels import read_labels

THRESHOLDS = [round(0.05 * i, 2) for i in range(1, 20)]
CENTRALITY_LEVEL = {"De paso": 0, "Secundario": 1, "Central": 2}

def read_csv(path: pathlib.Path) -> list[dict]:
  with path.open(encoding = "utf-8") as handle:
    return list(csv.DictReader(handle))

def evaluate(labels, gate, ranks, threshold: float) -> dict:
  """Bill-level and news-level metrics at one threshold. Truth = primary + other mentioned bills; a match on an
  'alternative' bill is not counted as a false positive (the label says it could also be right)."""
  found = missed = false_positive = in_candidates = truth_total = 0
  negatives = negatives_clean = positives = positives_found = 0
  for label in labels:
    scores = gate.get(label.news_id, {})
    matched = {bill for bill, s in scores.items() if s["match_score"] >= threshold}
    truth = label.mentioned
    truth_total += len(truth)
    in_candidates += len(truth & ranks.get(label.news_id, {}).keys())
    found += len(truth & matched)
    missed += len(truth - matched)
    false_positive += len(matched - truth - set(label.alternatives))
    if label.positive:
      positives += 1
      positives_found += bool(matched & truth)
    else:
      negatives += 1
      negatives_clean += not (matched - set(label.alternatives))
  return {"threshold": threshold, "news": len(labels), "truth_bills": truth_total,
          "ranker_recall": ratio(in_candidates, truth_total), "recall": ratio(found, truth_total),
          "recall_given_candidate": ratio(found, in_candidates), "precision": ratio(found, found + false_positive),
          "found": found, "missed": missed, "false_positives": false_positive,
          "positive_news_found": ratio(positives_found, positives), "none_accuracy": ratio(negatives_clean, negatives),
          "positives": positives, "negatives": negatives}

def ratio(a: int, b: int) -> float | None:
  return round(a / b, 4) if b else None

def errors(labels, gate, ranks, threshold: float) -> list[dict]:
  """Every missed truth bill and every false positive at the threshold, for the adjudication of the sample."""
  rows = []
  for label in labels:
    scores = gate.get(label.news_id, {})
    matched = {bill for bill, s in scores.items() if s["match_score"] >= threshold}
    for bill in sorted(label.mentioned - matched):
      rows.append({"news_id": label.news_id, "draw": label.draw, "review": label.review, "kind": "missed",
                   "bill": bill, "rank": ranks.get(label.news_id, {}).get(bill, ""),
                   "match_score": scores.get(bill, {}).get("match_score", "")})
    for bill in sorted(matched - label.mentioned - set(label.alternatives)):
      rows.append({"news_id": label.news_id, "draw": label.draw, "review": label.review, "kind": "false_positive",
                   "bill": bill, "rank": ranks[label.news_id].get(bill, ""), "match_score": scores[bill]["match_score"]})
  return rows

def centrality(labels, details) -> list[dict]:
  """Jev's centrality score (0 to 2) for the labeled primary bill, against the hand label."""
  by_label = collections.defaultdict(list)
  for label in labels:
    score = details.get((label.news_id, label.primary))
    if label.primary and label.centrality in CENTRALITY_LEVEL and score is not None:
      by_label[label.centrality].append(score)
  rows = []
  for name, level in CENTRALITY_LEVEL.items():
    values = by_label.get(name, [])
    rows.append({"label": name, "n": len(values), "mean_jev_score": round(sum(values) / len(values), 3) if values else None,
                 "rounded_agrees": ratio(sum(round(v) == level for v in values), len(values))})
  return rows

if __name__ == "__main__":
  # Compares a Jev run on the hand-labeled sample with the labels (#39, #34): bill recall and precision, accuracy of
  # "none" on the negatives, the curves over the match threshold, by outlet, centrality, and the list of errors.
  # Everything for all the news in the sample and again for the rows reviewed as Correcto.
  #   python run_jev_eval.py --name sample --labels Etiquetas.csv
  parser = argparse.ArgumentParser(description = "Evaluate a Jev run against the hand-labeled sample.")
  parser.add_argument("--name", required = True, help = "run folder inside results/jev/")
  parser.add_argument("--labels", required = True, help = "CSV export of the Etiquetas tab of the labeling sheet")
  parser.add_argument("--threshold", type = float, default = Config.JEV_MATCH_THRESHOLD)
  args = parser.parse_args()

  folder = pathlib.Path(Config.JEV_RESULTS_DIR) / args.name
  gate = collections.defaultdict(dict)
  for row in read_csv(folder / "gate.csv"):
    gate[row["news_id"]][int(row["bill"])] = {"match_score": max(float(row["explicit"]), float(row["implicit"])),
                                              "same_topic": float(row["same_topic"])}
  ranks = collections.defaultdict(dict)
  for row in read_csv(folder / "candidates.csv"):
    ranks[row["news_id"]][int(row["bill"])] = int(row["rank"])
  details = {}
  if (folder / "details.csv").exists():
    for row in read_csv(folder / "details.csv"):
      if row["question"] == "centrality" and row["score"] != "":
        details[(row["news_id"], int(row["bill"]))] = float(row["score"])

  labels = [label for label in read_labels(args.labels) if label.in_sample and label.news_id in gate]
  subsets = {"all": labels, "correcto": [label for label in labels if label.review == "Correcto"]}
  summary, curve, by_outlet = {}, [], []
  for subset, rows in subsets.items():
    summary[subset] = evaluate(rows, gate, ranks, args.threshold)
    curve += [{"subset": subset, **evaluate(rows, gate, ranks, t)} for t in THRESHOLDS]
    for outlet in sorted({label.outlet for label in rows}):
      by_outlet.append({"subset": subset, "outlet": outlet,
                        **evaluate([l for l in rows if l.outlet == outlet], gate, ranks, args.threshold)})
  # same_topic on the negatives: descriptive only (the negative subtypes are no longer maintained)
  negatives = [label for label in labels if not label.positive]
  topical = [any(s["same_topic"] >= args.threshold for s in gate[label.news_id].values()) for label in negatives]
  summary["same_topic_on_negatives"] = {"negatives": len(negatives), "with_same_topic_candidate": sum(topical)}
  summary["labels_missing_from_run"] = sum(1 for label in read_labels(args.labels)
                                           if label.in_sample and label.news_id not in gate)

  write_csv(folder / "eval_curve.csv", curve)
  write_csv(folder / "eval_by_outlet.csv", by_outlet)
  write_csv(folder / "eval_centrality.csv", centrality(labels, details))
  write_csv(folder / "eval_errors.csv", errors(labels, gate, ranks, args.threshold))
  (folder / "eval_summary.json").write_text(json.dumps(summary, indent = 2), encoding = "utf-8")
  print(json.dumps(summary, indent = 2))
