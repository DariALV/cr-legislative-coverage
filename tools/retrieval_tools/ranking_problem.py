import numpy as np
import torch

from tools.evolution_tools.genome import Gene, GenomeSpec
from tools.retrieval_tools.feature_builder import RankingFeatures

DYNAMIC_FEATURES = [
  "active",       # 1 if the bill had a SIL progress event inside the evolved window around the news date
  "event_count",  # log(1 + progress events inside that window)
  "age_decay",    # 2 ** -(age / evolved half-life): 1 for a bill filed that day, 0.5 one half-life later
]
BINARY_FEATURES = {"alive", "filed_after_news"}   # left as 0/1 when standardizing
WEIGHT_RANGE = 5.0
TIE_BREAK = 1e-3   # weight of the smooth term that orders individuals with the same coverage

class RankingProblem:
  """
  Evolutionary tuning of the candidate ranker (#68, #33). An individual is a recipe: one weight and one on/off
  switch per feature, the activity window (days before and after the news) and the half-life of the age bonus.
  Its score for a (news, bill) pair is the sum of weight × feature over the switched-on features, with the
  continuous features standardized over all pairs. Fitness, over the news rows it is given (a training fold):
    bill coverage@K (share of the gold bills of those news with at least one news that has it in its top K)
    + TIE_BREAK × mean over those bills of K / (K + best rank), so that recipes with the same coverage are ordered by
      how close their missing bills are.
  Runs on the GPU when there is one; every individual is scored over all bills of all rows at once.
  """

  def __init__(self, features: RankingFeatures, rows: np.ndarray | None = None, k: int = 100,
               device: str | None = None):
    self.features = features
    self.k = k
    self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    self.static_names = features.static_names
    self.feature_names = self.static_names + DYNAMIC_FEATURES
    self.spec = GenomeSpec(
      [Gene(f"w_{name}", "float", -WEIGHT_RANGE, WEIGHT_RANGE) for name in self.feature_names]
      + [Gene(f"use_{name}", "bool") for name in self.feature_names]
      + [Gene("window_before_days", "int", 0, features.events_before.shape[0] - 1),
         Gene("window_after_days", "int", 0, features.events_after.shape[0] - 1),
         Gene("age_half_life_days", "log", 7, 3650)])
    self.static = torch.from_numpy(standardize(features.static, self.static_names)).to(self.device)
    self.events_before = torch.from_numpy(features.events_before).to(self.device)
    self.events_after = torch.from_numpy(features.events_after).to(self.device)
    self.age = torch.from_numpy(np.maximum(features.age_days, 0)).to(self.device)
    self.set_rows(rows if rows is not None else np.arange(features.static.shape[1]))

  def set_rows(self, rows: np.ndarray):
    """News rows the fitness is computed on (e.g. a training fold)."""
    self.rows = np.sort(np.asarray(rows))
    keep = np.isin(self.features.links[:, 0], self.rows)
    links = self.features.links[keep]
    position = {row: i for i, row in enumerate(self.rows)}
    self.link_rows = torch.tensor([position[r] for r in links[:, 0]], device = self.device)
    self.link_bills = torch.tensor(links[:, 1], device = self.device)
    self.row_index = torch.tensor(self.rows, device = self.device)
    self.static_rows = self.static[:, self.row_index]   # copied once per fold, not once per individual
    self.age_rows = self.age[self.row_index]
    bills, self.link_bill_index = np.unique(links[:, 1], return_inverse = True)
    self.link_bill_index = torch.tensor(self.link_bill_index, device = self.device)
    self.n_bills = len(bills)
    news_per_bill = np.bincount(self.link_bill_index.cpu().numpy(), minlength = self.n_bills)
    self.single_news_bills = torch.tensor(news_per_bill == 1, device = self.device)

  # ---- scoring ----

  def scores(self, genes: dict, i: int) -> torch.Tensor:
    """Scores (rows × bills) of individual i of a decoded batch."""
    weights = torch.tensor([genes[f"w_{n}"][i] * genes[f"use_{n}"][i] for n in self.feature_names],
                           dtype = torch.float32, device = self.device)
    score = torch.tensordot(weights[:len(self.static_names)], self.static_rows, dims = 1)
    dynamic = weights[len(self.static_names):]
    if dynamic[0] != 0 or dynamic[1] != 0:
      count = (self.events_before[int(genes["window_before_days"][i])][self.row_index].float()
               + self.events_after[int(genes["window_after_days"][i])][self.row_index].float())
      score = score + dynamic[0] * (count > 0).float() + dynamic[1] * torch.log1p(count)
    if dynamic[2] != 0:
      score = score + dynamic[2] * torch.exp2(-self.age_rows / float(genes["age_half_life_days"][i]))
    return score

  def link_ranks(self, score: torch.Tensor) -> torch.Tensor:
    """Rank of every gold link among the bills of its news. Ties count against the gold bill (it goes last among
    the bills with its score): otherwise a recipe that switches everything off scores every bill 0 and puts every
    gold bill first. The embedding analysis counts ties in favor, which is harmless there because cosines don't tie."""
    gold = score[self.link_rows, self.link_bills]
    return (score[self.link_rows] >= gold[:, None]).sum(dim = 1)

  def best_bill_ranks(self, ranks: torch.Tensor) -> torch.Tensor:
    best = torch.full((self.n_bills,), torch.iinfo(torch.int64).max, device = self.device)
    return best.scatter_reduce(0, self.link_bill_index, ranks, reduce = "amin")

  # ---- Problem interface ----

  def evaluate(self, genes: dict[str, np.ndarray]) -> np.ndarray:
    count = len(next(iter(genes.values())))
    fitness = np.empty(count)
    with torch.no_grad():
      for i in range(count):
        best = self.best_bill_ranks(self.link_ranks(self.scores(genes, i))).float()
        coverage = (best <= self.k).float().mean()
        smooth = (self.k / (self.k + best)).mean()
        fitness[i] = float(coverage + TIE_BREAK * smooth)
    return fitness

  def metrics(self, genes: dict, i: int = 0, ks: list[int] | None = None) -> dict:
    """Full report of one individual over the current rows."""
    with torch.no_grad():
      ranks = self.link_ranks(self.scores(genes, i))
      best = self.best_bill_ranks(ranks)
      result = {"n_news": len(self.rows), "n_links": int(len(ranks)), "n_bills": self.n_bills,
                "n_single_news_bills": int(self.single_news_bills.sum())}
      rows = self.link_rows
      links_per_row = torch.bincount(rows, minlength = len(self.rows)).float()
      present = links_per_row > 0
      for k in ks or [self.k]:
        hit = (ranks <= k).float()
        per_row = torch.bincount(rows, weights = hit, minlength = len(self.rows))
        result |= {
          f"bill_coverage@{k}": float((best <= k).float().mean()),
          f"single_news_bill_coverage@{k}": float((best[self.single_news_bills] <= k).float().mean()),
          f"news_recall@{k}": float((per_row[present] / links_per_row[present]).mean()),
          f"link_recall@{k}": float(hit.mean()),
        }
      result["median_link_rank"] = float(ranks.float().median())
    return result

  def baseline(self, feature: str = "cos_exposition_max") -> dict[str, np.ndarray]:
    """Decoded genes of the recipe 'only this feature, weight 1' (the best single configuration of #38)."""
    values = {g.name: np.array([0.0]) for g in self.spec.genes}
    for name in self.feature_names:
      values[f"use_{name}"] = np.array([name == feature])
    values[f"w_{feature}"] = np.array([1.0])
    values["window_before_days"] = np.array([14])
    values["window_after_days"] = np.array([3])
    values["age_half_life_days"] = np.array([365.0])
    return values

def standardize(static: np.ndarray, names: list[str]) -> np.ndarray:
  """Continuous features to mean 0 and std 1 over all pairs; 0/1 features stay as they are."""
  result = static.astype(np.float32).copy()
  for f, name in enumerate(names):
    if name in BINARY_FEATURES:
      continue
    values = result[f]
    std = values.std()
    result[f] = (values - values.mean()) / (std if std > 0 else 1)
  return result
