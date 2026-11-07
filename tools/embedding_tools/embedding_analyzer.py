import csv
import json
import logging
import pathlib
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from config import Config
from tools.embedding_tools.embedding_runner import BILL_VARIANTS

logger = logging.getLogger("cr")

AGGREGATIONS = ["mean", "max", "top3"]   # how the chunk scores of one news become one score per bill
WHOLE_SIZE = 8000                          # news that fit in one chunk: only "mean" is evaluated
CANDIDATE_SETS = ["all", "no_flagged", "by_date"]
NAME_CITED_CHARS = 60                      # a link counts as "name cited" if the news has this start of the bill name

@dataclass(frozen = True)
class AnalysisConfig:
  """One ranking: which vectors were compared and how the news chunks were combined."""
  model: str
  size: int
  variant: str
  aggregation: str

  @property
  def label(self) -> str:
    return f"{self.model}/news_{self.size}/bills_{self.variant}/{self.aggregation}"

@dataclass
class GoldSet:
  news_ids: list[str]                 # gold news, in the order of the score rows
  links: list[tuple[int, int]]        # (news row, bill column) for every gold link whose bill exists
  news_dates: np.ndarray              # 'YYYY-MM-DD' per news row
  bill_numbers: np.ndarray            # bill number per column
  bill_dates: np.ndarray              # 'YYYY-MM-DD' per column ('' when unknown)
  bill_flags: np.ndarray              # '' or administrative / honorific / ... per column
  name_cited: np.ndarray              # bool per link: the news text has the start of the bill name
  news_meta: dict[str, dict] = field(default_factory = dict)   # for the top-K export
  bill_meta: dict[int, dict] = field(default_factory = dict)
  dropped_links: int = 0              # links to bills that are not in bills

class EmbeddingAnalyzer:
  """
  Measures how well each embedding configuration retrieves the gold bills of each gold news (#38, #33, #6).
  A configuration is model × news chunk size × bill variant × aggregation of the chunk scores; the vectors come
  from the .npz files of EmbeddingRunner (configurations without their files are skipped and reported).
  For every configuration and candidate set (all bills, without flagged bills, only bills filed by the news date):
    recall@K per news (averaged), hit@K, recall@K over all links, MRR, median rank of the gold bills and the AUC of
    gold vs non-gold scores; recall@K and MRR get 95 % bootstrap intervals over news, and the configurations are
    compared paired (same resamples) against the best one. Recall@K is also split by strata, over links.
  Writes numbers only (no news text) to output_dir; the top-K of the best configuration can be exported to the
  embedding_cross page, which does carry titles and stays out of git.
  """

  def __init__(self, models: list[str] | None = None, database_path: str | None = None,
               embeddings_dir: str = Config.EMBEDDINGS_DIR, output_dir: str = Config.EMBEDDING_RESULTS_DIR,
               ks: list[int] | None = None, bootstrap: int = Config.EMBEDDING_BOOTSTRAP, seed: int = 7,
               rank_by: str = Config.EMBEDDING_RANK_BY):
    self.models = models or list(Config.EMBEDDING_MODELS)
    self.database_path = database_path or f"{Config.DATABASE_DIR}/{Config.PRIVATE_DATABASE}.db"
    self.embeddings_dir = pathlib.Path(embeddings_dir)
    self.output_dir = pathlib.Path(output_dir)
    self.ks = ks or Config.EMBEDDING_KS
    self.bootstrap = bootstrap
    self.seed = seed
    self.rank_by = rank_by
    self.connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri = True)
    self.gold: GoldSet | None = None

  # ---- entry point ----

  def run(self, export_top: int | None = 50) -> dict:
    configs, missing = self.available_configs()
    for path in missing:
      logger.warning(f"[analysis] missing {path}, its configurations are skipped")
    if not configs:
      raise FileNotFoundError(f"no embedding files found in {self.embeddings_dir}")
    bill_numbers = None
    metric_rows, strata_rows, per_news = [], [], {}
    for model, size, variant in sorted({(c.model, c.size, c.variant) for c in configs}):
      news_file = np.load(self.embeddings_dir / model / f"news_{size}.npz")
      bills_file = np.load(self.embeddings_dir / model / f"bills_{variant}.npz")
      if bill_numbers is None:
        bill_numbers = bills_file["numbers"]
        self.gold = self.load_gold(bill_numbers)
      elif not np.array_equal(bill_numbers, bills_file["numbers"]):
        raise ValueError(f"{model}/bills_{variant}.npz has other bills than the first file")
      fallback = bills_file["fallback"]
      chunk_scores, chunk_news, mean_norms = self.chunk_scores(news_file, bills_file["vectors"])
      for config in [c for c in configs if (c.model, c.size, c.variant) == (model, size, variant)]:
        scores = self.aggregate(chunk_scores, chunk_news, mean_norms, config.aggregation)
        for candidates in CANDIDATE_SETS:
          result = self.evaluate(scores, candidates)
          per_news[(config, candidates)] = result
          metric_rows.append(self.metric_row(config, candidates, result))
          if candidates == "all":
            strata_rows += self.strata_rows(config, result, fallback)
        logger.info(f"[analysis] {config.label} done")
    comparison_rows, best = self.compare(per_news)
    summary = self.summary(configs, missing, best)
    self.write(metric_rows, strata_rows, comparison_rows, summary)
    if export_top and best:
      config = next(c for c in configs if c.label == best["config"])
      self.export_top(config, self.scores(config), export_top)
    return summary

  def scores(self, config: AnalysisConfig) -> np.ndarray:
    folder = self.embeddings_dir / config.model
    news_file = np.load(folder / f"news_{config.size}.npz")
    chunk_scores, chunk_news, mean_norms = self.chunk_scores(news_file,
                                                             np.load(folder / f"bills_{config.variant}.npz")["vectors"])
    return self.aggregate(chunk_scores, chunk_news, mean_norms, config.aggregation)

  # ---- inputs ----

  def available_configs(self) -> tuple[list[AnalysisConfig], list[str]]:
    configs, missing = [], set()
    for model in self.models:
      folder = self.embeddings_dir / model
      for size in Config.EMBEDDING_CHUNK_SIZES:
        for variant in BILL_VARIANTS:
          paths = [folder / f"news_{size}.npz", folder / f"bills_{variant}.npz"]
          absent = [p for p in paths if not p.exists()]
          if absent:
            missing.update(p.as_posix() for p in absent)
            continue
          for aggregation in (["mean"] if size == WHOLE_SIZE else AGGREGATIONS):
            configs.append(AnalysisConfig(model, size, variant, aggregation))
    return configs, sorted(missing)

  def load_gold(self, bill_numbers: np.ndarray) -> GoldSet:
    column = {int(n): i for i, n in enumerate(bill_numbers)}
    bills = {row[0]: row[1:] for row in self.connection.execute(
      "SELECT number, name, flag, date_proposed, status FROM bills")}
    organs = {number: name for number, name in self.connection.execute(
      "SELECT b.bill_number, o.name FROM organ_bills b JOIN organs o ON o.organ_code = b.organ_code")}
    news_ids = [r[0] for r in self.connection.execute("SELECT DISTINCT news_id FROM news_bill_links ORDER BY news_id")]
    row_of = {news_id: i for i, news_id in enumerate(news_ids)}
    news = {r[0]: r[1:] for r in self.connection.execute(
      f"SELECT id, url, organization, title, content, date_published, section FROM news_articles "
      f"WHERE id IN ({','.join('?' * len(news_ids))})", news_ids)}
    links, cited, dropped = [], [], 0
    for news_id, number in self.connection.execute(
        "SELECT DISTINCT news_id, bill_number FROM news_bill_links ORDER BY news_id, bill_number"):
      if number not in column:
        dropped += 1
        continue
      links.append((row_of[news_id], column[number]))
      text = normalize(f"{news[news_id][2] or ''} {news[news_id][3] or ''}")
      name = normalize(bills[number][0] if number in bills else "")
      cited.append(bool(name) and name[:NAME_CITED_CHARS] in text)
    if dropped:
      logger.info(f"[analysis] {dropped} gold links point to bills that are not in bills, dropped")
    info = [bills.get(int(n), ("", "", "", "")) for n in bill_numbers]
    return GoldSet(
      news_ids = news_ids, links = links,
      news_dates = np.array([(news[i][4] or "")[:10] for i in news_ids]),
      bill_numbers = bill_numbers,
      bill_dates = np.array([(row[2] or "")[:10] for row in info]),
      bill_flags = np.array([row[1] or "" for row in info]),
      name_cited = np.array(cited),
      news_meta = {i: {"id": i, "url": news[i][0], "outlet": news[i][1], "title": news[i][2],
                       "section": news[i][5], "date": news[i][4]} for i in news_ids},
      bill_meta = {int(n): {"name": clean_name(row[0] or ""), "status": row[3], "commission": organs.get(int(n)),
                            "date_proposed": (row[2] or "")[:10] or None} for n, row in zip(bill_numbers, info)},
      dropped_links = dropped)

  # ---- scores ----

  def chunk_scores(self, news_file, bill_vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Cosine of every news chunk against every bill (vectors are normalized), the gold row of each chunk and the
    norm of the mean chunk vector of each news."""
    row_of = {news_id: i for i, news_id in enumerate(self.gold.news_ids)}
    chunk_news = np.array([row_of.get(str(n), -1) for n in news_file["news_ids"]])
    if (chunk_news < 0).any() or len(set(chunk_news)) != len(row_of):
      raise ValueError("the news file doesn't hold exactly the gold news")
    vectors = news_file["vectors"].astype(np.float32)
    mean_norms = np.array([np.linalg.norm(vectors[chunk_news == row].mean(axis = 0)) for row in range(len(row_of))],
                          dtype = np.float32)
    return vectors @ bill_vectors.astype(np.float32).T, chunk_news, mean_norms

  def aggregate(self, chunk_scores: np.ndarray, chunk_news: np.ndarray, mean_norms: np.ndarray,
                aggregation: str) -> np.ndarray:
    """One score per (news, bill). mean = cosine with the mean of the chunk vectors (same ranking as averaging
    scores, but comparable across news); max = best chunk; top3 = mean of the three best chunks."""
    scores = np.empty((len(self.gold.news_ids), chunk_scores.shape[1]), dtype = np.float32)
    for row in range(len(self.gold.news_ids)):
      block = chunk_scores[chunk_news == row]
      if aggregation == "mean":
        scores[row] = block.mean(axis = 0)
      elif aggregation == "max":
        scores[row] = block.max(axis = 0)
      elif aggregation == "top3":
        top = min(3, len(block))
        scores[row] = np.partition(block, len(block) - top, axis = 0)[-top:].mean(axis = 0)
      else:
        raise ValueError(f"unknown aggregation {aggregation!r}")
    if aggregation == "mean":
      # the mean of unit vectors is shorter than 1; dividing by its norm turns the averaged score into a cosine
      scores /= mean_norms[:, None]
    return scores

  # ---- metrics ----

  def candidate_mask(self, candidates: str) -> np.ndarray:
    """True where a bill is a candidate for a news."""
    gold = self.gold
    shape = (len(gold.news_ids), len(gold.bill_numbers))
    if candidates == "all":
      return np.ones(shape, dtype = bool)
    if candidates == "no_flagged":
      return np.broadcast_to(gold.bill_flags == "", shape)
    if candidates == "by_date":
      return (gold.bill_dates[None, :] <= gold.news_dates[:, None]) | (gold.bill_dates[None, :] == "")
    raise ValueError(f"unknown candidate set {candidates!r}")

  def evaluate(self, scores: np.ndarray, candidates: str) -> dict:
    """Rank of every gold link among the candidates of its news, and the per-news and per-link metrics."""
    mask = self.candidate_mask(candidates)
    masked = np.where(mask, scores, -np.inf)
    links = [(n, b, i) for i, (n, b) in enumerate(self.gold.links) if mask[n, b]]
    rows = np.array([n for n, _, _ in links])
    cols = np.array([b for _, b, _ in links])
    link_ids = np.array([i for _, _, i in links])
    gold_scores = masked[rows, cols]
    ranks = (masked[rows] > gold_scores[:, None]).sum(axis = 1) + 1   # ties count in favor of the gold bill
    news_rows = np.unique(rows)
    position = {row: i for i, row in enumerate(news_rows)}
    per_news_links = np.bincount([position[r] for r in rows], minlength = len(news_rows))
    recall = {}
    hit = {}
    for k in self.ks:
      found = np.bincount([position[r] for r in rows], weights = ranks <= k, minlength = len(news_rows))
      recall[k] = found / per_news_links
      hit[k] = (found > 0).astype(float)
    best_rank = np.full(len(news_rows), np.inf)
    np.minimum.at(best_rank, [position[r] for r in rows], ranks)
    positives = np.zeros(mask.shape, dtype = bool)
    positives[rows, cols] = True
    return {"news_rows": news_rows, "recall": recall, "hit": hit, "rr": 1 / best_rank, "ranks": ranks,
            "link_ids": link_ids, "links_per_news": per_news_links,
            "auc": auc(masked[mask & positives], masked[mask & ~positives]) if candidates == "all" else None}

  def metric_row(self, config: AnalysisConfig, candidates: str, result: dict) -> dict:
    row = {"model": config.model, "size": config.size, "variant": config.variant,
           "aggregation": config.aggregation, "candidates": candidates,
           "n_news": len(result["news_rows"]), "n_links": len(result["ranks"])}
    for k in self.ks:
      low, high = self.interval(result["recall"][k])
      row |= {f"recall@{k}": result["recall"][k].mean(), f"recall@{k}_low": low, f"recall@{k}_high": high}
    for k in self.ks:
      row[f"hit@{k}"] = result["hit"][k].mean()
    for k in self.ks:
      row[f"link_recall@{k}"] = (result["ranks"] <= k).mean()
    low, high = self.interval(result["rr"])
    row |= {"mrr": result["rr"].mean(), "mrr_low": low, "mrr_high": high,
            "median_rank": float(np.median(result["ranks"])), "auc": result["auc"]}
    return row

  def strata_rows(self, config: AnalysisConfig, result: dict, fallback: np.ndarray) -> list[dict]:
    """Recall@K over the links of each stratum (all candidates)."""
    gold = self.gold
    ids = result["link_ids"]
    ranks = result["ranks"]
    links_of_news = dict(zip(result["news_rows"], result["links_per_news"]))
    count = np.array([links_of_news[gold.links[i][0]] for i in ids])
    strata = {
      ("name_cited", "yes"): gold.name_cited[ids], ("name_cited", "no"): ~gold.name_cited[ids],
      ("news_links", "1"): count == 1, ("news_links", "2-10"): (count >= 2) & (count <= 10),
      ("news_links", ">10"): count > 10,
      ("bill_fallback", "yes"): fallback[[gold.links[i][1] for i in ids]],
      ("bill_fallback", "no"): ~fallback[[gold.links[i][1] for i in ids]],
      ("bill_flagged", "yes"): gold.bill_flags[[gold.links[i][1] for i in ids]] != "",
      ("bill_flagged", "no"): gold.bill_flags[[gold.links[i][1] for i in ids]] == "",
    }
    rows = []
    for (stratum, value), selected in strata.items():
      if not selected.any():
        continue
      row = {"model": config.model, "size": config.size, "variant": config.variant,
             "aggregation": config.aggregation, "stratum": stratum, "value": value, "n_links": int(selected.sum())}
      for k in self.ks:
        row[f"recall@{k}"] = (ranks[selected] <= k).mean()
      row["mrr_links"] = (1 / ranks[selected]).mean()
      rows.append(row)
    return rows

  # ---- uncertainty and comparison ----

  def resamples(self, n: int) -> np.ndarray:
    """The same bootstrap resamples (indices over news) for every configuration, so comparisons are paired."""
    if not hasattr(self, "_resamples") or self._resamples.shape[1] != n:
      self._resamples = np.random.default_rng(self.seed).integers(0, n, size = (self.bootstrap, n))
    return self._resamples

  def interval(self, values: np.ndarray) -> tuple[float, float]:
    if not self.bootstrap:
      return float("nan"), float("nan")
    means = values[self.resamples(len(values))].mean(axis = 1)
    return tuple(np.percentile(means, [2.5, 97.5]))

  def metric_values(self, result: dict) -> np.ndarray:
    if self.rank_by == "mrr":
      return result["rr"]
    kind, k = self.rank_by.split("@")
    return result[kind][int(k)]

  def compare(self, per_news: dict) -> tuple[list[dict], dict | None]:
    """Per candidate set: every configuration against the best one on rank_by, with paired bootstrap."""
    rows, best_overall = [], None
    for candidates in CANDIDATE_SETS:
      results = {c: r for (c, s), r in per_news.items() if s == candidates}
      if not results:
        continue
      best = max(results, key = lambda c: (self.metric_values(results[c]).mean(), results[c]["rr"].mean()))
      best_values = self.metric_values(results[best])
      for config, result in results.items():
        if not np.array_equal(result["news_rows"], results[best]["news_rows"]):
          raise ValueError("configurations evaluated on different news can't be compared paired")
        difference = best_values - self.metric_values(result)
        row = {"candidates": candidates, "model": config.model, "size": config.size, "variant": config.variant,
               "aggregation": config.aggregation, "metric": self.rank_by,
               "value": self.metric_values(result).mean(), "best_minus_this": difference.mean()}
        if self.bootstrap and config != best:
          means = difference[self.resamples(len(difference))].mean(axis = 1)
          row |= {"difference_low": np.percentile(means, 2.5), "difference_high": np.percentile(means, 97.5),
                  "share_best_ahead": (means > 0).mean()}
        rows.append(row)
      if candidates == "all":
        best_overall = {"config": best.label, "metric": self.rank_by,
                        "value": float(best_values.mean()), "mrr": float(results[best]["rr"].mean())}
    rows.sort(key = lambda r: (r["candidates"], -r["value"]))
    return rows, best_overall

  # ---- outputs ----

  def summary(self, configs: list[AnalysisConfig], missing: list[str], best: dict | None) -> dict:
    gold = self.gold
    return {
      "generated": datetime.now().isoformat(timespec = "seconds"),
      "database_modified": datetime.fromtimestamp(pathlib.Path(self.database_path).stat().st_mtime)
                                   .isoformat(timespec = "seconds"),
      "models": self.models, "n_configurations": len(configs), "missing_files": missing,
      "ks": self.ks, "bootstrap": self.bootstrap, "seed": self.seed, "rank_by": self.rank_by,
      "candidate_sets": CANDIDATE_SETS, "aggregations": AGGREGATIONS,
      "n_news": len(gold.news_ids), "n_links": len(gold.links), "dropped_links": gold.dropped_links,
      "n_bills": len(gold.bill_numbers), "links_name_cited": int(gold.name_cited.sum()),
      "links_to_flagged": int(sum(gold.bill_flags[b] != "" for _, b in gold.links)),
      "best": best,
    }

  def write(self, metric_rows, strata_rows, comparison_rows, summary):
    self.output_dir.mkdir(parents = True, exist_ok = True)
    write_csv(self.output_dir / "metrics.csv", metric_rows)
    write_csv(self.output_dir / "strata.csv", strata_rows)
    write_csv(self.output_dir / "comparison.csv", comparison_rows)
    (self.output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii = False, indent = 2),
                                                  encoding = "utf-8")
    logger.info(f"[analysis] results written to {self.output_dir}")

  def export_top(self, config: AnalysisConfig, scores: np.ndarray, top: int,
                 path: str = Config.EMBEDDING_CROSS_DATA):
    """Top bills of every gold news for the embedding_cross page (private: it carries titles)."""
    gold = self.gold
    linked: dict[int, set[int]] = {}
    for n, b in gold.links:
      linked.setdefault(n, set()).add(b)
    news, used = [], set()
    for row, news_id in enumerate(gold.news_ids):
      order = np.argsort(-scores[row])[:top]
      matches = [[int(gold.bill_numbers[b]), round(float(scores[row, b]), 4), int(b in linked.get(row, ()))]
                 for b in order]
      used.update(m[0] for m in matches)
      news.append(gold.news_meta[news_id] | {"matches": matches})
    news.sort(key = lambda n: n["matches"][0][1] if n["matches"] else 0, reverse = True)
    payload = {"meta": {"test_data": False, "generated_at": datetime.now().isoformat(timespec = "seconds"),
                        "model": config.label, "top_k": top, "news_count": len(news),
                        "bills_in_corpus": len(gold.bill_numbers)},
               "news": news, "bills": {n: gold.bill_meta[n] for n in sorted(used)}}
    output = pathlib.Path(path)
    output.parent.mkdir(parents = True, exist_ok = True)
    output.write_text("window.EMBEDDING_CROSS = " + json.dumps(payload, ensure_ascii = False) + ";\n",
                      encoding = "utf-8")
    logger.info(f"[analysis] top {top} of {config.label} exported to {output}")

def auc(positives: np.ndarray, negatives: np.ndarray) -> float:
  """Probability that a gold pair scores above a non-gold pair (Mann-Whitney, ties count half)."""
  values = np.concatenate([positives, negatives])
  order = values.argsort(kind = "mergesort")
  ranks = np.empty(len(values))
  sorted_values = values[order]
  # average ranks for ties
  starts = np.r_[0, np.flatnonzero(np.diff(sorted_values)) + 1]
  ends = np.r_[starts[1:], len(values)]
  average = (starts + ends + 1) / 2
  ranks[order] = np.repeat(average, ends - starts)
  n_pos, n_neg = len(positives), len(negatives)
  return float((ranks[:n_pos].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))

def normalize(text: str) -> str:
  text = "".join(ch if ord(ch) >= 32 else " " for ch in text.lower())
  return re.sub(r"\s+", " ", text).strip()

def clean_name(name: str) -> str:
  return "".join(ch if ord(ch) >= 32 else " " for ch in name).strip()

def write_csv(path: pathlib.Path, rows: list[dict]):
  with open(path, "w", newline = "", encoding = "utf-8") as file:
    if not rows:
      return
    fieldnames = list(dict.fromkeys(key for row in rows for key in row))
    writer = csv.DictWriter(file, fieldnames = fieldnames)
    writer.writeheader()
    for row in rows:
      writer.writerow({k: round(v, 4) if isinstance(v, (float, np.floating)) else v for k, v in row.items()})
