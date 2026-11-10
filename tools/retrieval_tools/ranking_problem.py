import numpy as np
import torch

from tools.evolution_tools.genome import Gene, GenomeSpec
from tools.retrieval_tools.feature_builder import BINARY_FEATURES, RankingFeatures

DYNAMIC_FEATURES = [
  "active",       # 1 if the bill had a SIL progress event inside the evolved window around the news date
  "event_count",  # log(1 + progress events inside that window)
  "age_decay",    # 2 ** -(age / evolved half-life): 1 for a bill filed that day, 0.5 one half-life later
]
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
  Runs on the GPU when there is one. Individuals are scored in batches of batch_size, each over all bills of all rows
  at once, with no CPU-GPU synchronization until the fitness of the whole population is copied back. A batch takes
  roughly 100 MB × batch_size of GPU memory with the full gold set (less with a fold).
  """

  def __init__(self, features: RankingFeatures, rows: np.ndarray | None = None, k: int = 100,
               device: str | None = None, batch_size: int = 16):
    self.features = features
    self.k = k
    self.batch_size = batch_size
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
    # Copied once per fold, not once per individual. Free the previous fold's copies first so two never coexist.
    self.static_rows = self.events_before_rows = self.events_after_rows = None
    self.static_rows = self.static[:, self.row_index]
    self.events_before_rows = self.events_before[:, self.row_index]
    self.events_after_rows = self.events_after[:, self.row_index]
    self.age_rows = self.age[self.row_index]
    bills, self.link_bill_index = np.unique(links[:, 1], return_inverse = True)
    self.link_bill_index = torch.tensor(self.link_bill_index, device = self.device)
    self.n_bills = len(bills)
    news_per_bill = np.bincount(self.link_bill_index.cpu().numpy(), minlength = self.n_bills)
    self.single_news_bills = torch.tensor(news_per_bill == 1, device = self.device)

  # ---- scoring ----

  def batch_scores(self, genes: dict, start: int, stop: int) -> torch.Tensor:
    """Scores (individuals × rows × bills) of individuals start..stop-1 of a decoded batch. Which terms are needed is
    decided on the CPU from the numpy genes, so nothing waits for the GPU."""
    weights = np.stack([genes[f"w_{n}"][start:stop] * genes[f"use_{n}"][start:stop] for n in self.feature_names],
                       axis = 1).astype(np.float32)
    n_static = len(self.static_names)
    static = torch.from_numpy(weights[:, :n_static]).to(self.device)
    score = torch.einsum("bs,snm->bnm", static, self.static_rows)
    active, event_count, age_decay = weights[:, n_static:].T
    if active.any() or event_count.any():
      before = torch.from_numpy(genes["window_before_days"][start:stop].astype(np.int64)).to(self.device)
      after = torch.from_numpy(genes["window_after_days"][start:stop].astype(np.int64)).to(self.device)
      count = self.events_before_rows[before].float() + self.events_after_rows[after].float()
      score += torch.from_numpy(active).to(self.device)[:, None, None] * (count > 0).float()
      score += torch.from_numpy(event_count).to(self.device)[:, None, None] * torch.log1p(count)
      del count
    if age_decay.any():
      half_life = torch.from_numpy(genes["age_half_life_days"][start:stop].astype(np.float32)).to(self.device)
      score += (torch.from_numpy(age_decay).to(self.device)[:, None, None]
                * torch.exp2(-self.age_rows[None] / half_life[:, None, None]))
    return score

  def scores(self, genes: dict, i: int) -> torch.Tensor:
    """Scores (rows × bills) of individual i of a decoded batch."""
    return self.batch_scores(genes, i, i + 1)[0]

  def link_ranks(self, score: torch.Tensor) -> torch.Tensor:
    """Rank of every gold link among the bills of its news, for scores (rows × bills) → (links,) or (individuals ×
    rows × bills) → (individuals × links). Ties count against the gold bill (it goes last among the bills with its
    score): otherwise a recipe that switches everything off scores every bill 0 and puts every gold bill first. The
    embedding analysis counts ties in favor, which is harmless there because cosines don't tie."""
    if score.dim() == 2:
      return self.link_ranks(score[None])[0]
    gold = score[:, self.link_rows, self.link_bills]
    return (score[:, self.link_rows] >= gold[:, :, None]).sum(dim = 2)

  def best_bill_ranks(self, ranks: torch.Tensor) -> torch.Tensor:
    """Best rank of every gold bill over its links, for ranks (links,) or (individuals × links)."""
    if ranks.dim() == 1:
      return self.best_bill_ranks(ranks[None])[0]
    best = torch.full((len(ranks), self.n_bills), torch.iinfo(torch.int64).max, device = self.device)
    index = self.link_bill_index[None].expand(len(ranks), -1)
    return best.scatter_reduce(1, index, ranks, reduce = "amin")

  # ---- Problem interface ----

  def evaluate(self, genes: dict[str, np.ndarray]) -> np.ndarray:
    count = len(next(iter(genes.values())))
    parts = []
    with torch.no_grad():
      for start in range(0, count, self.batch_size):
        stop = min(start + self.batch_size, count)
        best = self.best_bill_ranks(self.link_ranks(self.batch_scores(genes, start, stop))).float()
        coverage = (best <= self.k).float().mean(dim = 1)
        smooth = (self.k / (self.k + best)).mean(dim = 1)
        parts.append(coverage + TIE_BREAK * smooth)
      return torch.cat(parts).double().cpu().numpy()   # the only wait for the GPU

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
