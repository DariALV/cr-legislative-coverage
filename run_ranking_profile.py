import argparse
import time

import numpy as np
import torch
from torch.profiler import ProfilerActivity, profile

from tools.evolution_tools.genetic_algorithm import EvolutionSettings, GeneticAlgorithm
from tools.evolution_tools.history import History
from tools.retrieval_tools.feature_builder import FeatureBuilder
from tools.retrieval_tools.ranking_problem import RankingProblem

def timed(function, *args) -> float:
  if torch.cuda.is_available():
    torch.cuda.synchronize()
  start = time.perf_counter()
  function(*args)
  if torch.cuda.is_available():
    torch.cuda.synchronize()
  return time.perf_counter() - start

def stage_times(problem: RankingProblem, genes: dict, size: int):
  """Time each step of one batch separately (with a GPU wait after each) and the memory it moves."""
  device = problem.device
  rows = []
  def step(name, function):
    torch.cuda.synchronize()
    start = time.perf_counter()
    result = function()
    torch.cuda.synchronize()
    rows.append((name, time.perf_counter() - start, result))
    return result
  def mb(*tensors):
    return sum(t.numel() * t.element_size() for t in tensors) / 2 ** 20
  names, n_static = problem.feature_names, len(problem.static_names)
  with torch.no_grad():
    weights = step("weights to GPU", lambda: torch.from_numpy(np.stack(
      [genes[f"w_{n}"][:size] * genes[f"use_{n}"][:size] for n in names], axis = 1).astype(np.float32)).to(device))
    score = step("einsum static", lambda: torch.einsum("bs,snm->bnm", weights[:, :n_static], problem.static_rows))
    before = torch.from_numpy(genes["window_before_days"][:size].astype(np.int64)).to(device)
    after = torch.from_numpy(genes["window_after_days"][:size].astype(np.int64)).to(device)
    gathered = step("gather event windows", lambda: (problem.events_before_rows[before], problem.events_after_rows[after]))
    count = step("count float sum", lambda: gathered[0].float() + gathered[1].float())
    step("active + log1p terms", lambda: (count > 0).float() * weights[:, n_static, None, None]
         + torch.log1p(count) * weights[:, n_static + 1, None, None])
    half_life = torch.from_numpy(genes["age_half_life_days"][:size].astype(np.float32)).to(device)
    step("age term", lambda: weights[:, -1, None, None] * torch.exp2(-problem.age_rows[None] / half_life[:, None, None]))
    gold = step("gold score per link", lambda: score[:, problem.link_rows, problem.link_bills])
    candidates = step("gather score rows of links", lambda: score[:, problem.link_rows])
    beaten = step("compare >= gold", lambda: candidates >= gold[:, :, None])
    ranks = step("sum -> link ranks", lambda: beaten.sum(dim = 2))
    best = step("best rank per bill", lambda: problem.best_bill_ranks(ranks).float())
    step("fitness", lambda: (best <= problem.k).float().mean(dim = 1))
    sizes = {"einsum static": mb(score), "gather score rows of links": mb(candidates), "compare >= gold": mb(candidates, beaten),
             "sum -> link ranks": mb(beaten), "count float sum": mb(count)}
  print(f"stages of one batch of {size} (ms; MB of the main tensors, GB/s if the whole tensor is read once):")
  for name, seconds, _ in rows:
    extra = f"  {sizes[name]:.0f} MB, {sizes[name] / 1024 / seconds:.0f} GB/s" if name in sizes else ""
    print(f"  {name:30s} {1000 * seconds:8.2f}{extra}")


def describe(name: str, problem: RankingProblem, genes: dict, repeats: int):
  count = len(genes["window_before_days"])
  times = [timed(problem.evaluate, genes) for _ in range(repeats)]
  names, n_static = problem.feature_names, len(problem.static_names)
  dynamic_on = {n: int((genes[f"use_{n}"] * (genes[f"w_{n}"] != 0)).sum()) for n in names[n_static:]}
  print(f"{name}: {count} individuals, {1000 * min(times) / count:.1f} ms each (best of {repeats}), "
        f"{1000 * np.median(times) / count:.1f} ms each (median); dynamic terms on: {dynamic_on}; "
        f"window before mean {genes['window_before_days'].mean():.0f}, after mean {genes['window_after_days'].mean():.0f}")

if __name__ == "__main__":
  # Where the time of the ranker fitness goes (#68):  python run_ranking_profile.py
  parser = argparse.ArgumentParser(description = "Profile the ranker fitness on random and evolved populations.")
  parser.add_argument("--population", type = int, default = 48, help = "individuals per generation (non-elites)")
  parser.add_argument("--warmup-generations", type = int, default = 30, help = "generations to evolve first")
  parser.add_argument("--batch-size", type = int, default = 16)
  parser.add_argument("--repeats", type = int, default = 3)
  parser.add_argument("--device")
  args = parser.parse_args()

  features = FeatureBuilder().load_or_build()
  problem = RankingProblem(features, device = args.device, batch_size = args.batch_size)
  n_news = features.static.shape[1]
  rng = np.random.default_rng(0)
  problem.set_rows(np.sort(rng.permutation(n_news)[:int(n_news * 0.8)]))
  print(f"device {problem.device}, {len(problem.rows)} news, {len(problem.link_rows)} links, {problem.n_bills} bills")
  if torch.cuda.is_available():
    print(f"GPU {torch.cuda.get_device_name()}, memory {torch.cuda.get_device_properties(0).total_memory / 2 ** 30:.1f} GiB")

  random_genes = problem.spec.decode(problem.spec.random(args.population, rng))
  problem.evaluate(problem.baseline())   # warm-up
  describe("random", problem, random_genes, args.repeats)

  settings = EvolutionSettings(max_generations = args.warmup_generations, patience = args.warmup_generations + 1)
  evolved = GeneticAlgorithm(problem, settings, History(problem.spec)).run()
  evolved_genes = problem.spec.decode(evolved.genes[:args.population])
  describe("evolved", problem, evolved_genes, args.repeats)

  for batch_size in (1, 4, 8, 16, 32, 64):
    problem.batch_size = batch_size
    describe(f"evolved, batch {batch_size}", problem, evolved_genes, 2)
  problem.batch_size = args.batch_size

  if torch.cuda.is_available():
    stage_times(problem, evolved_genes, args.batch_size)   # warm-up of these exact shapes
    stage_times(problem, evolved_genes, args.batch_size)

  activities = [ProfilerActivity.CPU] + ([ProfilerActivity.CUDA] if torch.cuda.is_available() else [])
  with profile(activities = activities) as profiler:
    problem.evaluate(evolved_genes)
    if torch.cuda.is_available():
      torch.cuda.synchronize()
  sort_by = "cuda_time_total" if torch.cuda.is_available() else "cpu_time_total"
  print(profiler.key_averages().table(sort_by = sort_by, row_limit = 15, max_name_column_width = 60))
