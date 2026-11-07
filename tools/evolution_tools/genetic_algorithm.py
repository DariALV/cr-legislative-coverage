import logging
import time
from dataclasses import asdict, dataclass
from typing import Callable, Protocol

import numpy as np

from tools.evolution_tools.genome import GenomeSpec
from tools.evolution_tools.history import History
from tools.evolution_tools.population import ORIGINS, Population

logger = logging.getLogger("cr")

class Problem(Protocol):
  """What the algorithm optimizes. It knows nothing else about the problem."""
  spec: GenomeSpec

  def evaluate(self, genes: dict[str, np.ndarray]) -> np.ndarray:
    """Decoded genes of many individuals ({gene name: one value per individual}) → one fitness per individual,
    higher is better. Gets whole batches so it can vectorize (or use the GPU) over the individuals."""
    ...

@dataclass
class EvolutionSettings:
  population_size: int = 50
  elites: int = 2                     # best individuals copied unchanged into the next generation
  immigrant_rate: float = 0.1         # share of every new generation that is brand new random individuals
  selection: str = "tournament"       # "tournament" or "truncation"
  tournament_size: int = 3
  truncation_share: float = 0.5       # with truncation, only this best share can be a parent
  crossover_rate: float = 0.9         # otherwise the child is a copy of its first parent (before mutation)
  crossover: str = "blend"            # "uniform" (each gene from one parent) or "blend" (BLX-alpha; bool genes uniform)
  blend_alpha: float = 0.5
  mutation_rate: float | None = None  # chance that each gene mutates; None = 1 / number of genes
  mutation_scale: float = 0.1         # Gaussian step as a share of the gene's range (bool genes flip instead)
  reset_rate: float = 0.02            # chance that each gene is redrawn at random in its whole range
  max_generations: int = 300
  patience: int = 30                  # stop after this many generations without a better best fitness
  min_improvement: float = 1e-9
  seed: int = 7

  def validate(self):
    if self.selection not in ("tournament", "truncation"):
      raise ValueError(f"unknown selection {self.selection!r}")
    if self.crossover not in ("uniform", "blend"):
      raise ValueError(f"unknown crossover {self.crossover!r}")
    immigrants = int(round(self.immigrant_rate * self.population_size))
    if self.elites + immigrants >= self.population_size:
      raise ValueError("elites + immigrants leave no room for offspring")

class GeneticAlgorithm:
  """
  Generational genetic algorithm over a population matrix (#68). Every generation is: the elites (copied, same id),
  random immigrants, and offspring. Each offspring has two parents picked by selection (tournament: best of
  tournament_size drawn with replacement; truncation: uniform among the best share), recombined by crossover and
  then mutated (Gaussian steps, bool flips and random resets). The whole old generation is then replaced. Only new
  individuals are evaluated (elites keep their fitness, so the problem must be deterministic).
  """

  def __init__(self, problem: Problem, settings: EvolutionSettings | None = None, history: History | None = None,
               on_generation: Callable[[Population], None] | None = None):
    self.problem = problem
    self.spec = problem.spec
    self.settings = settings or EvolutionSettings()
    self.settings.validate()
    self.history = history
    self.on_generation = on_generation
    self.rng = np.random.default_rng(self.settings.seed)
    self.next_id = 0

  @property
  def mutation_rate(self) -> float:
    return self.settings.mutation_rate if self.settings.mutation_rate is not None else 1 / self.spec.size

  # ---- main loop ----

  def run(self, initial: np.ndarray | None = None) -> Population:
    """Evolves until max_generations or patience; returns the last generation. initial (encoded genomes) seeds the
    first generation, the rest is random."""
    start = time.perf_counter()
    population = self.first_generation(initial)
    self.evaluate(population, np.ones(population.size, dtype = bool))
    self.record(population, start)
    best = population.fitness.max()
    stale = 0
    for generation in range(1, self.settings.max_generations + 1):
      population = self.next_generation(population)
      self.record(population, start)
      current = population.fitness.max()
      if current > best + self.settings.min_improvement:
        best, stale = current, 0
      else:
        stale += 1
      if stale >= self.settings.patience:
        logger.info(f"[evolution] stopped at generation {generation}: no improvement in {stale} generations")
        break
    return population

  def first_generation(self, initial: np.ndarray | None) -> Population:
    size = self.settings.population_size
    genes = self.spec.random(size, self.rng)
    if initial is not None:
      initial = self.spec.clip(np.atleast_2d(initial))[:size]
      genes[:len(initial)] = initial
    return Population(0, genes, np.full(size, np.nan), self.new_ids(size), np.full((size, 2), -1, dtype = np.int64),
                      np.full(size, ORIGINS.index("random"), dtype = np.int8))

  def next_generation(self, population: Population) -> Population:
    settings = self.settings
    size = settings.population_size
    ranking = population.ranking()
    elites = ranking[:settings.elites]
    immigrants = int(round(settings.immigrant_rate * size))
    children = size - len(elites) - immigrants

    first, second = self.select(population, children), self.select(population, children)
    child_genes = self.mutate(self.recombine(population.genes[first], population.genes[second]))

    genes = np.vstack([population.genes[elites], self.spec.random(immigrants, self.rng), child_genes])
    fitness = np.concatenate([population.fitness[elites], np.full(immigrants + children, np.nan)])
    ids = np.concatenate([population.ids[elites], self.new_ids(immigrants + children)])
    parents = np.vstack([np.full((len(elites) + immigrants, 2), -1, dtype = np.int64),
                         np.stack([population.ids[first], population.ids[second]], axis = 1)])
    origin = np.concatenate([np.full(len(elites), ORIGINS.index("elite")),
                             np.full(immigrants, ORIGINS.index("immigrant")),
                             np.full(children, ORIGINS.index("offspring"))]).astype(np.int8)
    result = Population(population.generation + 1, genes, fitness, ids, parents, origin)
    self.evaluate(result, np.isnan(fitness))
    return result

  # ---- operators ----

  def select(self, population: Population, count: int) -> np.ndarray:
    """Row index of one parent for each of count children."""
    fitness = np.nan_to_num(population.fitness, nan = -np.inf)
    if self.settings.selection == "truncation":
      keep = max(2, int(round(self.settings.truncation_share * population.size)))
      return self.rng.choice(population.ranking()[:keep], size = count)
    draws = self.rng.integers(0, population.size, size = (count, self.settings.tournament_size))
    return draws[np.arange(count), fitness[draws].argmax(axis = 1)]

  def recombine(self, first: np.ndarray, second: np.ndarray) -> np.ndarray:
    count = len(first)
    crossed = self.rng.random(count) < self.settings.crossover_rate
    uniform = np.where(self.rng.random(first.shape) < 0.5, first, second)
    if self.settings.crossover == "uniform":
      mixed = uniform
    else:
      alpha = self.settings.blend_alpha
      low, high = np.minimum(first, second), np.maximum(first, second)
      extra = alpha * (high - low)
      mixed = self.rng.uniform(low - extra, high + extra)
      mixed = np.where(self.spec.kinds[None, :] == "bool", uniform, mixed)
    return self.spec.clip(np.where(crossed[:, None], mixed, first))

  def mutate(self, genes: np.ndarray) -> np.ndarray:
    genes = genes.copy()
    is_bool = self.spec.kinds[None, :] == "bool"
    mutate = self.rng.random(genes.shape) < self.mutation_rate
    steps = self.rng.normal(0, self.settings.mutation_scale, genes.shape) * self.spec.span[None, :]
    genes = np.where(mutate & ~is_bool, genes + steps, genes)
    genes = np.where(mutate & is_bool, 1.0 - genes, genes)
    reset = self.rng.random(genes.shape) < self.settings.reset_rate
    genes = np.where(reset, self.spec.random(len(genes), self.rng), genes)
    return self.spec.clip(genes)

  # ---- helpers ----

  def evaluate(self, population: Population, rows: np.ndarray):
    if rows.any():
      fitness = np.asarray(self.problem.evaluate(self.spec.decode(population.genes[rows])), dtype = np.float64)
      if fitness.shape != (int(rows.sum()),):
        raise ValueError(f"evaluate returned shape {fitness.shape}, expected ({int(rows.sum())},)")
      population.fitness[rows] = fitness

  def record(self, population: Population, start: float):
    if self.history is not None:
      self.history.record(population, time.perf_counter() - start)
    if self.on_generation is not None:
      self.on_generation(population)

  def new_ids(self, count: int) -> np.ndarray:
    ids = np.arange(self.next_id, self.next_id + count, dtype = np.int64)
    self.next_id += count
    return ids

  def settings_json(self) -> dict:
    return asdict(self.settings) | {"effective_mutation_rate": self.mutation_rate}
