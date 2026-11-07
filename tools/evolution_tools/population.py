from dataclasses import dataclass

import numpy as np

from tools.evolution_tools.genome import GenomeSpec

ORIGINS = ("random", "elite", "offspring", "immigrant")

@dataclass
class Population:
  """
  One generation, stored as arrays (one row per individual) instead of one object per individual, so every
  operation on it is vectorized.
    genes    (individuals × genes) encoded genomes
    fitness  (individuals,) higher is better; NaN until evaluated
    ids      unique id of each individual across the whole run (an elite keeps its id in the next generation)
    parents  (individuals × 2) ids of the parents, -1 when there is none
    origin   index into ORIGINS: how the individual entered this generation
  """
  generation: int
  genes: np.ndarray
  fitness: np.ndarray
  ids: np.ndarray
  parents: np.ndarray
  origin: np.ndarray

  @property
  def size(self) -> int:
    return len(self.ids)

  def best_index(self) -> int:
    return int(np.nanargmax(self.fitness))

  def ranking(self) -> np.ndarray:
    """Row indices from best to worst."""
    return np.argsort(-np.nan_to_num(self.fitness, nan = -np.inf), kind = "stable")

  def diversity(self, spec: GenomeSpec) -> float:
    """Mean standard deviation of the genes, each scaled by its range: 0 = all clones, ~0.29 = uniform at random."""
    span = np.where(spec.span > 0, spec.span, 1.0)
    return float((self.genes / span).std(axis = 0).mean())
