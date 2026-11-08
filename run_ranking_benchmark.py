import argparse
import time

import numpy as np
import torch

from tools.evolution_tools.genetic_algorithm import EvolutionSettings, GeneticAlgorithm
from tools.evolution_tools.history import History
from tools.retrieval_tools.feature_builder import FeatureBuilder
from tools.retrieval_tools.ranking_problem import TIE_BREAK, RankingProblem

def legacy_evaluate(problem: RankingProblem, genes: dict) -> np.ndarray:
  """The first implementation of RankingProblem.evaluate (one individual at a time, tensordot, a GPU wait per
  individual), kept here to check that the batched version gives the same fitness."""
  count = len(next(iter(genes.values())))
  fitness = np.empty(count)
  names, n_static = problem.feature_names, len(problem.static_names)
  with torch.no_grad():
    for i in range(count):
      weights = torch.tensor([genes[f"w_{n}"][i] * genes[f"use_{n}"][i] for n in names],
                             dtype = torch.float32, device = problem.device)
      score = torch.tensordot(weights[:n_static], problem.static_rows, dims = 1)
      dynamic = weights[n_static:]
      if dynamic[0] != 0 or dynamic[1] != 0:
        count_ = (problem.events_before[int(genes["window_before_days"][i])][problem.row_index].float()
                  + problem.events_after[int(genes["window_after_days"][i])][problem.row_index].float())
        score = score + dynamic[0] * (count_ > 0).float() + dynamic[1] * torch.log1p(count_)
      if dynamic[2] != 0:
        score = score + dynamic[2] * torch.exp2(-problem.age_rows / float(genes["age_half_life_days"][i]))
      best = problem.best_bill_ranks(problem.link_ranks(score)).float()
      fitness[i] = float((best <= problem.k).float().mean() + TIE_BREAK * (problem.k / (problem.k + best)).mean())
  return fitness

def timed(function, *args) -> tuple[object, float]:
  if torch.cuda.is_available():
    torch.cuda.synchronize()
  start = time.perf_counter()
  result = function(*args)
  if torch.cuda.is_available():
    torch.cuda.synchronize()
  return result, time.perf_counter() - start

if __name__ == "__main__":
  # Checks the batched RankingProblem.evaluate against the first implementation and times both (#68):
  #   python run_ranking_benchmark.py
  parser = argparse.ArgumentParser(description = "Compare and time the ranker fitness implementations.")
  parser.add_argument("--individuals", type = int, default = 200, help = "random recipes for the equivalence check")
  parser.add_argument("--batch-size", type = int, default = 16)
  parser.add_argument("--generations", type = int, default = 20, help = "short evolution to time whole generations")
  parser.add_argument("--device")
  args = parser.parse_args()

  features = FeatureBuilder().load_or_build()
  problem = RankingProblem(features, device = args.device, batch_size = args.batch_size)
  n_news = features.static.shape[1]
  rng = np.random.default_rng(0)
  problem.set_rows(np.sort(rng.permutation(n_news)[:int(n_news * 0.8)]))   # the size of a training fold
  print(f"device {problem.device}, {len(problem.rows)} news, {problem.spec.size} genes, batch {args.batch_size}")

  # Equivalence on random recipes and on the baseline.
  genes = problem.spec.decode(problem.spec.random(args.individuals, rng))
  baseline = problem.baseline()
  problem.evaluate(baseline)            # warm-up (CUDA kernels, allocator)
  legacy_evaluate(problem, baseline)
  new, new_seconds = timed(problem.evaluate, genes)
  old, old_seconds = timed(legacy_evaluate, problem, genes)
  difference = np.abs(new - old)
  print(f"fitness: max |batched - legacy| = {difference.max():.2e}; "
        f"{int((difference > 1e-6).sum())} of {len(new)} differ by more than 1e-6")
  print(f"baseline: batched {problem.evaluate(baseline)[0]:.6f}, legacy {legacy_evaluate(problem, baseline)[0]:.6f}")
  print(f"{args.individuals} individuals: legacy {old_seconds:.2f} s ({1000 * old_seconds / len(new):.1f} ms each), "
        f"batched {new_seconds:.2f} s ({1000 * new_seconds / len(new):.1f} ms each), "
        f"{old_seconds / new_seconds:.1f}x faster")
  if torch.cuda.is_available():
    print(f"GPU memory peak {torch.cuda.max_memory_allocated() / 2 ** 30:.2f} GiB")

  # Whole generations: how much of each one is the fitness and how much the rest (selection, history, decoding).
  settings = EvolutionSettings(max_generations = args.generations, patience = args.generations + 1)
  fitness_seconds = []
  original = problem.evaluate
  def counted(g):
    result, seconds = timed(original, g)
    fitness_seconds.append(seconds)
    return result
  problem.evaluate = counted
  _, total = timed(GeneticAlgorithm(problem, settings, History(problem.spec)).run)
  per_generation = total / (args.generations + 1)
  print(f"{args.generations} generations: {per_generation:.3f} s per generation, of which fitness "
        f"{sum(fitness_seconds) / (args.generations + 1):.3f} s")
