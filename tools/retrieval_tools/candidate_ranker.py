import json
import logging
import pathlib

import numpy as np

from config import Config
from tools.retrieval_tools.feature_builder import FeatureBuilder, load_features
from tools.retrieval_tools.ranking_problem import BINARY_FEATURES

logger = logging.getLogger("cr")

class CandidateRanker:
  """
  Top-K candidate bills for any news, gold or not (#33, #41, #68), with an evolved recipe of RankingProblem. It
  computes the same features as FeatureBuilder for the given news (cosines over news_<size>_all.npz, background
  z-scores, BM25 and SIL dates) and standardizes the continuous ones with the mean and spread of the gold features
  the recipe was evolved on, so a score here means the same as during the evolution. Numpy only (no torch), in
  batches of news so the whole corpus fits in memory.
  """

  def __init__(self, recipe_path: str = Config.RANKER_RECIPE, model: str = Config.RETRIEVAL_MODEL,
               size: int = Config.RETRIEVAL_CHUNK_SIZE, database_path: str | None = None, batch_size: int = 500):
    self.recipe = json.loads(pathlib.Path(recipe_path).read_text(encoding = "utf-8"))["recipe"]
    self.builder = FeatureBuilder(model, size, database_path)
    self.batch_size = batch_size
    folder = self.builder.embeddings_dir
    self.bill_numbers = np.load(folder / "bills_name.npz")["numbers"]
    self.bills = {}
    for variant in ["exposition", "subjects", "name"]:
      data = np.load(folder / f"bills_{variant}.npz")
      if not np.array_equal(data["numbers"], self.bill_numbers):
        raise ValueError(f"bills_{variant}.npz has other bills than bills_name.npz")
      self.bills[variant] = data["vectors"].astype(np.float32)
    news_path = folder / f"news_{size}_all.npz"
    if not news_path.exists():
      raise FileNotFoundError(f"{news_path} is missing: run python run_embeddings.py --model {model} --all-news")
    news = np.load(news_path)
    self.chunk_news = news["news_ids"].astype(str)
    self.chunk_vectors = news["vectors"]
    gold = load_features(self.builder.output_path)
    if not np.array_equal(gold.bill_numbers, self.bill_numbers):
      raise ValueError("the cached gold features have other bills than the embeddings")
    self.static_names = gold.static_names
    self.mean = gold.static.mean(axis = (1, 2))
    self.std = gold.static.std(axis = (1, 2))

  def top_k(self, news_ids: list[str], k: int = Config.CANDIDATES_K) -> list[dict]:
    """Rows {news_id, rank, bill, score}, ranks from 1, for every news that has embeddings."""
    rows = []
    for start in range(0, len(news_ids), self.batch_size):
      batch = news_ids[start:start + self.batch_size]
      kept, scores = self.scores(batch)
      for news_id, row in zip(kept, scores):
        order = np.argsort(-row, kind = "stable")[:k]
        rows += [{"news_id": news_id, "rank": rank + 1, "bill": int(self.bill_numbers[j]),
                  "score": round(float(row[j]), 4)} for rank, j in enumerate(order)]
      logger.info(f"[candidates] {min(start + self.batch_size, len(news_ids))}/{len(news_ids)} news")
    return rows

  def scores(self, news_ids: list[str]) -> tuple[list[str], np.ndarray]:
    """Recipe score (news × bills) of the news that have embeddings, in the given order."""
    present = set(self.chunk_news)
    missing = [n for n in news_ids if n not in present]
    if missing:
      logger.warning(f"[candidates] {len(missing)} news have no embeddings and are skipped")
    news_ids = [n for n in news_ids if n in present]
    static = self.static_features(news_ids)
    weights = {name: self.recipe[f"w_{name}"] * self.recipe[f"use_{name}"] for name in self.static_names}
    score = np.zeros(static.shape[1:], dtype = np.float32)
    for f, name in enumerate(self.static_names):
      if weights[name]:
        values = static[f] if name in BINARY_FEATURES else (static[f] - self.mean[f]) / (self.std[f] or 1)
        score += weights[name] * values
    dates = self.dates
    count = (dates["events_before"][self.recipe["window_before_days"]].astype(np.float32)
             + dates["events_after"][self.recipe["window_after_days"]].astype(np.float32))
    score += self.recipe["w_active"] * self.recipe["use_active"] * (count > 0)
    score += self.recipe["w_event_count"] * self.recipe["use_event_count"] * np.log1p(count)
    score += (self.recipe["w_age_decay"] * self.recipe["use_age_decay"]
              * np.exp2(-np.maximum(dates["age_days"], 0) / self.recipe["age_half_life_days"]))
    return news_ids, score

  def static_features(self, news_ids: list[str]) -> np.ndarray:
    """(features × news × bills) in the order of the cached gold features, as FeatureBuilder builds them."""
    rows = {n: i for i, n in enumerate(news_ids)}
    mask = np.isin(self.chunk_news, news_ids)
    chunk_rows = np.array([rows[n] for n in self.chunk_news[mask]])
    vectors = self.chunk_vectors[mask].astype(np.float32)
    cosines = {}
    for variant in ["exposition", "subjects", "name"]:
      chunk_scores = vectors @ self.bills[variant].T
      best = np.full((len(news_ids), len(self.bill_numbers)), -np.inf, dtype = np.float32)
      np.maximum.at(best, chunk_rows, chunk_scores)
      cosines[f"cos_{variant}_max"] = best
    # mean: cosine with the mean chunk vector, renormalized (EmbeddingAnalyzer.aggregate)
    sums = np.zeros((len(news_ids), vectors.shape[1]), dtype = np.float32)
    np.add.at(sums, chunk_rows, vectors)
    means = sums / np.bincount(chunk_rows, minlength = len(news_ids))[:, None]
    cosines["cos_exposition_mean"] = (means @ self.bills["exposition"].T) / np.linalg.norm(means, axis = 1)[:, None]
    z = {f"z_{v}": self.builder.z_scores(cosines[f"cos_{v}_max"], v) for v in ["exposition", "subjects"]}
    bm25 = np.log1p(self.builder.bm25(news_ids, self.bill_numbers))
    dates = self.builder.connection.execute(
      f"SELECT id, date_published FROM news_articles WHERE id IN ({','.join('?' * len(news_ids))})", news_ids)
    date_of = {i: (d or "")[:10] for i, d in dates}
    self.dates = self.builder.date_features(np.array([date_of[n] for n in news_ids], dtype = "datetime64[D]"),
                                            self.bill_numbers)
    values = cosines | z | {"bm25": bm25, "event_distance": self.dates["event_distance"],
                            "alive": self.dates["alive"], "filed_after_news": self.dates["filed_after_news"]}
    return np.stack([values[name] for name in self.static_names]).astype(np.float32)
