import csv
import json
import pathlib

import numpy as np

from tools.evolution_tools.genome import GenomeSpec
from tools.evolution_tools.population import ORIGINS, Population

class History:
  """
  What happened in a run, generation by generation (#68):
    history.csv     one row per generation: fitness summary, diversity, how many immigrants, elapsed time
    population.csv  one row per individual per generation: id, parents, origin, fitness and decoded genes,
                    so the run can be replayed and every lineage followed
  keep_population = False keeps only the summary.
  """

  def __init__(self, spec: GenomeSpec, keep_population: bool = True, decimals: int = 6):
    self.spec = spec
    self.keep_population = keep_population
    self.decimals = decimals
    self.generations: list[dict] = []
    self.individuals: list[dict] = []

  def record(self, population: Population, elapsed_seconds: float):
    fitness = population.fitness
    best = population.best_index()
    self.generations.append({
      "generation": population.generation,
      "best_fitness": float(fitness[best]),
      "mean_fitness": float(np.mean(fitness)),
      "median_fitness": float(np.median(fitness)),
      "worst_fitness": float(np.min(fitness)),
      "fitness_std": float(np.std(fitness)),
      "diversity": population.diversity(self.spec),
      "immigrants": int((population.origin == ORIGINS.index("immigrant")).sum()),
      "best_id": int(population.ids[best]),
      "elapsed_seconds": elapsed_seconds,
    })
    if self.keep_population:
      decoded = self.spec.decode(population.genes)
      for row in range(population.size):
        self.individuals.append({
          "generation": population.generation,
          "individual_id": int(population.ids[row]),
          "parent_a": int(population.parents[row, 0]),
          "parent_b": int(population.parents[row, 1]),
          "origin": ORIGINS[population.origin[row]],
          "fitness": float(fitness[row]),
        } | {name: values[row].item() for name, values in decoded.items()})

  @property
  def best(self) -> dict:
    """Generation summary row with the best fitness of the whole run."""
    return max(self.generations, key = lambda row: row["best_fitness"])

  def write(self, folder: str | pathlib.Path):
    folder = pathlib.Path(folder)
    folder.mkdir(parents = True, exist_ok = True)
    write_csv(folder / "history.csv", self.generations, self.decimals)
    if self.keep_population:
      write_csv(folder / "population.csv", self.individuals, self.decimals)

def write_csv(path: pathlib.Path, rows: list[dict], decimals: int):
  if not rows:
    return
  with path.open("w", newline = "", encoding = "utf-8") as handle:
    writer = csv.DictWriter(handle, fieldnames = list(rows[0]))
    writer.writeheader()
    for row in rows:
      writer.writerow({k: round(v, decimals) if isinstance(v, float) else v for k, v in row.items()})

def write_json(path: str | pathlib.Path, data: dict):
  pathlib.Path(path).parent.mkdir(parents = True, exist_ok = True)
  pathlib.Path(path).write_text(json.dumps(data, indent = 2, ensure_ascii = False), encoding = "utf-8")
