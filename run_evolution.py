import argparse
import json
import logging
import pathlib
from datetime import datetime

import numpy as np
from rich.console import Console
from rich.table import Table

from config import Config
from tools.display_tools.progress import ProgressBoard
from tools.display_tools.run_log import setup_run_logging
from tools.evolution_tools.genetic_algorithm import EvolutionSettings, GeneticAlgorithm
from tools.evolution_tools.history import History, write_json
from tools.retrieval_tools.feature_builder import FeatureBuilder
from tools.retrieval_tools.ranking_problem import RankingProblem

logger = logging.getLogger("cr")

def evolve(problem: RankingProblem, settings: EvolutionSettings, folder: pathlib.Path, board: ProgressBoard,
           label: str) -> tuple[dict, History, GeneticAlgorithm]:
  """One evolution on the problem's current rows; writes history.csv and population.csv to folder."""
  history = History(problem.spec)
  task = board.task(label, "generations", total = settings.max_generations + 1)
  algorithm = GeneticAlgorithm(problem, settings, history, on_generation = lambda population: task.advance())
  population = algorithm.run()
  task.finish()
  history.write(folder)
  best = population.best_index()
  return problem.spec.decode(population.genes[best:best + 1]), history, algorithm

def recipe(genes: dict) -> dict:
  return {name: values[0].item() for name, values in genes.items()}

def replay_part(label: str, history: History, problem: RankingProblem, extra: dict) -> dict:
  """Compact copy of one evolution for the replay page: columns instead of rows."""
  columns = list(history.individuals[0])
  return {"label": label, "genes": problem.spec.to_json(), "settings": extra,
          "history": {c: [row[c] for row in history.generations] for c in history.generations[0]},
          "population": {c: [row[c] for row in history.individuals] for c in columns}}

if __name__ == "__main__":
  # Evolves the candidate ranker recipe (#68, #33): feature weights and switches, activity window, age half-life.
  # Fitness = bill coverage@K on the gold set. 5-fold cross-validation by news (evolve on 4 folds, measure the best
  # recipe on the 5th), then a final evolution on every gold news. Needs the background embeddings first:
  #   python run_embeddings.py --model qwen3-0.6b --background
  #   python run_evolution.py
  #   python run_evolution.py --name truncation --selection truncation --immigrant-rate 0
  defaults = EvolutionSettings()
  parser = argparse.ArgumentParser(description = "Evolve the candidate ranker on the gold set.")
  parser.add_argument("--name", help = "run folder in results/evolution/ (default: date and time)")
  parser.add_argument("--k", type = int, default = Config.EVOLUTION_K, help = "candidates per news in the fitness")
  parser.add_argument("--folds", type = int, default = Config.EVOLUTION_FOLDS, help = "0 = only the final run")
  parser.add_argument("--no-final", action = "store_true", help = "skip the evolution on every gold news")
  parser.add_argument("--population", type = int, default = defaults.population_size)
  parser.add_argument("--generations", type = int, default = defaults.max_generations)
  parser.add_argument("--patience", type = int, default = defaults.patience)
  parser.add_argument("--selection", choices = ["tournament", "truncation"], default = defaults.selection)
  parser.add_argument("--tournament-size", type = int, default = defaults.tournament_size)
  parser.add_argument("--immigrant-rate", type = float, default = defaults.immigrant_rate)
  parser.add_argument("--reset-rate", type = float, default = defaults.reset_rate)
  parser.add_argument("--seed", type = int, default = Config.EVOLUTION_SEED)
  parser.add_argument("--max-links", type = int, default = Config.EVOLUTION_MAX_LINKS_PER_NEWS,
                      help = "leave out news with this many gold links or more (agenda lists, reported apart); 0 = keep all")
  parser.add_argument("--device", help = "cuda or cpu (default: cuda when available)")
  parser.add_argument("--batch-size", type = int, default = 16,
                      help = "individuals scored at once on the GPU (~100 MB each); lower it if memory runs out")
  parser.add_argument("--rebuild-features", action = "store_true", help = "recompute the cached feature matrices")
  args = parser.parse_args()

  console = Console()
  log_path = setup_run_logging(console)
  console.print(f"Log: {log_path}", highlight = False)
  name = args.name or f"{datetime.now():%Y-%m-%d_%H%M%S}"
  output = pathlib.Path(Config.EVOLUTION_RESULTS_DIR) / name
  if output.exists():
    raise SystemExit(f"{output} already exists; pick another --name")

  features = FeatureBuilder().load_or_build(args.rebuild_features)
  n_news = features.static.shape[1]
  problem = RankingProblem(features, k = args.k, device = args.device, batch_size = args.batch_size)
  logger.info(f"[evolution] {name}: {n_news} news, {len(features.links)} links, {problem.spec.size} genes, "
              f"device {problem.device}")

  def settings_for(seed: int) -> EvolutionSettings:
    return EvolutionSettings(population_size = args.population, max_generations = args.generations,
                             patience = args.patience, selection = args.selection,
                             tournament_size = args.tournament_size, immigrant_rate = args.immigrant_rate,
                             reset_rate = args.reset_rate, seed = seed)

  links_per_news = np.bincount(features.links[:, 0], minlength = n_news)
  excluded = np.flatnonzero(links_per_news >= args.max_links) if args.max_links else np.array([], dtype = int)
  kept = np.setdiff1d(np.arange(n_news), excluded)
  if len(excluded):
    logger.info(f"[evolution] leaving out {len(excluded)} news with {args.max_links}+ links "
                f"({int(links_per_news[excluded].sum())} of {len(features.links)} links); {len(kept)} news kept")
  folds = np.array_split(np.random.default_rng(args.seed).permutation(kept), args.folds) if args.folds else []
  baseline = problem.baseline()
  parts, fold_rows, recipes = [], [], {}
  with ProgressBoard(f"evolution {name}", console = console) as board:
    for f, test in enumerate(folds, start = 1):
      train = np.setdiff1d(kept, test)
      problem.set_rows(train)
      settings = settings_for(args.seed + f)
      best, history, algorithm = evolve(problem, settings, output / f"fold_{f}", board, f"fold {f}")
      train_metrics = problem.metrics(best, ks = Config.EVOLUTION_REPORT_KS)
      problem.set_rows(test)
      row = {"fold": f, "generations": history.generations[-1]["generation"],
             "train": train_metrics, "test": problem.metrics(best, ks = Config.EVOLUTION_REPORT_KS),
             "baseline_test": problem.metrics(baseline, ks = Config.EVOLUTION_REPORT_KS), "recipe": recipe(best)}
      write_json(output / f"fold_{f}" / "best.json", row)
      fold_rows.append(row)
      recipes[f"fold_{f}"] = best
      parts.append(replay_part(f"fold {f}", history, problem, algorithm.settings_json()))
      logger.info(f"[evolution] fold {f}: test bill_coverage@{args.k} {row['test'][f'bill_coverage@{args.k}']:.3f} "
                  f"vs baseline {row['baseline_test'][f'bill_coverage@{args.k}']:.3f}")
    final = None
    if not args.no_final:
      problem.set_rows(kept)
      best, history, algorithm = evolve(problem, settings_for(args.seed), output / "final", board, "final")
      final = {"generations": history.generations[-1]["generation"], "recipe": recipe(best),
               "train": problem.metrics(best, ks = Config.EVOLUTION_REPORT_KS),
               "baseline": problem.metrics(baseline, ks = Config.EVOLUTION_REPORT_KS)}
      write_json(output / "final" / "best.json", final)
      recipes["final"] = best
      parts.append(replay_part("final", history, problem, algorithm.settings_json()))

  keys = [k for k in fold_rows[0]["test"] if "@" in k] if fold_rows else []
  cross_validation = {
    "evolved": {k: float(np.mean([r["test"][k] for r in fold_rows])) for k in keys},
    "baseline": {k: float(np.mean([r["baseline_test"][k] for r in fold_rows])) for k in keys},
  } if fold_rows else None
  write_json(output / "run.json", {
    "name": name, "created": datetime.now().isoformat(timespec = "seconds"), "k": args.k, "folds": args.folds,
    "seed": args.seed, "max_links_per_news": args.max_links, "settings": settings_for(args.seed).__dict__, "features": features.meta,
    "genes": problem.spec.to_json(), "device": str(problem.device), "baseline": "cos_exposition_max only"})
  excluded_news = None
  if len(excluded):
    # No recipe saw these news while evolving, so every recipe's numbers on them are held out.
    problem.set_rows(excluded)
    excluded_news = {"max_links": args.max_links, "n_news": len(excluded),
                     "news": [{"id": str(features.news_ids[r]), "links": int(links_per_news[r])} for r in excluded],
                     "baseline": problem.metrics(baseline, ks = Config.EVOLUTION_REPORT_KS),
                     "recipes": {label: problem.metrics(genes, ks = Config.EVOLUTION_REPORT_KS)
                                 for label, genes in recipes.items()}}
  write_json(output / "summary.json", {"cross_validation": cross_validation, "folds": fold_rows, "final": final,
                                       "excluded_news": excluded_news})

  replay = pathlib.Path(Config.EVOLUTION_REPLAY_DATA)
  replay.parent.mkdir(parents = True, exist_ok = True)
  replay.write_text("window.EVOLUTION_DATA = " + json.dumps({"name": name, "k": args.k, "parts": parts}) + ";\n",
                    encoding = "utf-8")

  if cross_validation:
    table = Table(title = f"Cross-validation ({args.folds} folds, test news only)")
    for column in ["metric", "evolved", "baseline"]:
      table.add_column(column)
    for k in keys:
      table.add_row(k, f"{cross_validation['evolved'][k]:.3f}", f"{cross_validation['baseline'][k]:.3f}")
    console.print(table)
  if excluded_news:
    final_row = excluded_news["recipes"].get("final") or next(iter(excluded_news["recipes"].values()))
    key = f"bill_coverage@{args.k}"
    console.print(f"Left out {excluded_news['n_news']} agenda news ({args.max_links}+ links): {key} "
                  f"{final_row[key]:.3f} vs baseline {excluded_news['baseline'][key]:.3f}")
  console.print(f"Results: {output}  Replay: {replay}  Log: {log_path}", highlight = False)
