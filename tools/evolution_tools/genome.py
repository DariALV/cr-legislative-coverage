import math
from dataclasses import asdict, dataclass

import numpy as np

GENE_KINDS = ("float", "int", "bool", "log")

@dataclass(frozen = True)
class Gene:
  """
  One gene. Every gene is stored as a float in the population matrix ("encoded" space) and decoded on demand:
    float  value in [low, high]
    int    rounded value in [low, high] (encoded in [low - 0.5, high + 0.5] so every integer is equally likely)
    bool   encoded in [0, 1], true above 0.5
    log    value in [low, high] on a log scale (encoded as ln(value)), so 10 → 20 is as far as 1000 → 2000
  """
  name: str
  kind: str = "float"
  low: float = 0.0
  high: float = 1.0

  def __post_init__(self):
    if self.kind not in GENE_KINDS:
      raise ValueError(f"gene {self.name!r}: unknown kind {self.kind!r}, expected one of {GENE_KINDS}")
    if self.kind == "log" and self.low <= 0:
      raise ValueError(f"gene {self.name!r}: a log gene needs low > 0")
    if self.kind != "bool" and self.high < self.low:
      raise ValueError(f"gene {self.name!r}: high < low")

  @property
  def encoded_low(self) -> float:
    if self.kind == "log":
      return math.log(self.low)
    return {"float": self.low, "int": self.low - 0.5, "bool": 0.0}[self.kind]

  @property
  def encoded_high(self) -> float:
    if self.kind == "log":
      return math.log(self.high)
    return {"float": self.high, "int": self.high + 0.5, "bool": 1.0}[self.kind]

  def decode(self, values: np.ndarray) -> np.ndarray:
    if self.kind == "float":
      return values.astype(np.float64)
    if self.kind == "int":
      return np.clip(np.rint(values), self.low, self.high).astype(np.int64)
    if self.kind == "bool":
      return values > 0.5
    return np.exp(values)

class GenomeSpec:
  """The ordered list of genes of a problem; column j of a population matrix is gene j."""

  def __init__(self, genes: list[Gene]):
    names = [g.name for g in genes]
    if len(set(names)) != len(names):
      raise ValueError("gene names must be unique")
    self.genes = list(genes)
    self.names = names
    self.low = np.array([g.encoded_low for g in genes])
    self.high = np.array([g.encoded_high for g in genes])
    self.kinds = np.array([g.kind for g in genes])

  @property
  def size(self) -> int:
    return len(self.genes)

  @property
  def span(self) -> np.ndarray:
    return self.high - self.low

  def random(self, count: int, rng: np.random.Generator) -> np.ndarray:
    """count random genomes, uniform in the encoded space."""
    return rng.uniform(self.low, self.high, size = (count, self.size))

  def clip(self, genes: np.ndarray) -> np.ndarray:
    return np.clip(genes, self.low, self.high)

  def decode(self, genes: np.ndarray) -> dict[str, np.ndarray]:
    """Population matrix (individuals × genes) → {gene name: decoded values, one per individual}."""
    genes = np.atleast_2d(genes)
    return {gene.name: gene.decode(genes[:, j]) for j, gene in enumerate(self.genes)}

  def decode_row(self, row: np.ndarray) -> dict:
    """One genome → {gene name: plain Python value}, for JSON and CSV."""
    return {name: values[0].item() for name, values in self.decode(row[None, :]).items()}

  def encode_row(self, values: dict) -> np.ndarray:
    """{gene name: decoded value} → one encoded genome (genes left out get the middle of their range)."""
    row = (self.low + self.high) / 2
    for j, gene in enumerate(self.genes):
      if gene.name not in values:
        continue
      value = values[gene.name]
      if gene.kind == "bool":
        row[j] = 1.0 if value else 0.0
      elif gene.kind == "log":
        row[j] = math.log(value)
      else:
        row[j] = float(value)
    return self.clip(row)

  def to_json(self) -> list[dict]:
    return [asdict(g) for g in self.genes]
