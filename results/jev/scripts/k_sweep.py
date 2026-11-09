"""Throwaway analysis: recall vs K for the saved evolved recipes (held-out folds), no retraining."""
import json
import pathlib
import sys

ROOT = pathlib.Path(r"D:\UCR\CI-0133_Computacion_y_Sociedad\Github\cr-legislative-coverage")
sys.path.insert(0, str(ROOT))
import os
os.chdir(ROOT)

import numpy as np
import torch

from config import Config
from tools.retrieval_tools.feature_builder import FeatureBuilder
from tools.retrieval_tools.ranking_problem import RankingProblem

KS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 300]
RUNS = ["2026-11-07_excl15_seed7", "2026-11-07_excl15_seed100"]

features = FeatureBuilder().load_or_build(False)
problem = RankingProblem(features, k=100)
n_news = features.static.shape[1]
links_per_news = np.bincount(features.links[:, 0], minlength=n_news)
excluded = np.flatnonzero(links_per_news >= 15)
kept = np.setdiff1d(np.arange(n_news), excluded)

def to_genes(recipe):
  return {k: np.array([v]) for k, v in recipe.items()}

def ranks_for(genes, rows):
  """Per-link ranks and per-bill best ranks (numpy) on the given news rows."""
  problem.set_rows(rows)
  with torch.no_grad():
    ranks = problem.link_ranks(problem.scores(genes, 0))
    best = problem.best_bill_ranks(ranks)
  return ranks.cpu().numpy(), best.cpu().numpy(), problem.single_news_bills.cpu().numpy()

out = {"ks": KS, "runs": {}}
baseline = problem.baseline()
for name in RUNS:
  folder = ROOT / "results" / "evolution" / name
  run = json.loads((folder / "run.json").read_text())
  seed, nfolds = run["seed"], run["folds"]
  folds = np.array_split(np.random.default_rng(seed).permutation(kept), nfolds)
  pool = {"evolved": [[], [], []], "baseline": [[], [], []]}
  for f, test in enumerate(folds, start=1):
    recipe = json.loads((folder / f"fold_{f}" / "best.json").read_text())["recipe"]
    for label, genes in (("evolved", to_genes(recipe)), ("baseline", baseline)):
      r, b, s = ranks_for(genes, test)
      pool[label][0].append(r); pool[label][1].append(b); pool[label][2].append(s)
  # excluded agenda news with the final recipe
  final = json.loads((folder / "final" / "best.json").read_text())["recipe"]
  r_ex, b_ex, _ = ranks_for(to_genes(final), excluded)
  res = {}
  for label in pool:
    r = np.concatenate(pool[label][0]); b = np.concatenate(pool[label][1]); s = np.concatenate(pool[label][2])
    res[label] = {"n_links": int(len(r)), "n_bills": int(len(b)),
                  "link_recall": [float((r <= k).mean()) for k in KS],
                  "bill_coverage": [float((b <= k).mean()) for k in KS],
                  "single_news_bill_coverage": [float((b[s] <= k).mean()) for k in KS],
                  "median_link_rank": float(np.median(r)),
                  "link_rank_quantiles": {q: float(np.quantile(r, q)) for q in (0.5, 0.75, 0.9, 0.95, 0.99)}}
  res["agenda_excluded_final"] = {"n_links": int(len(r_ex)), "n_bills": int(len(b_ex)),
                                  "link_recall": [float((r_ex <= k).mean()) for k in KS],
                                  "bill_coverage": [float((b_ex <= k).mean()) for k in KS]}
  res["n_test_news"] = int(sum(len(t) for t in folds))
  res["n_excluded_news"] = int(len(excluded))
  out["runs"][name] = res

path = pathlib.Path(sys.argv[1])
path.write_text(json.dumps(out, indent=1))
print("written", path)
