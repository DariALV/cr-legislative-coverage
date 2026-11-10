import collections
import csv
import json
import logging
import math
import pathlib
import random
import re
import sqlite3
import unicodedata
from dataclasses import dataclass

import numpy as np

from config import Config
from tools.embedding_tools.embedding_analyzer import AnalysisConfig, EmbeddingAnalyzer
from tools.sample_tools.sample_builder import KEYWORDS, MIN_CONTENT_CHARS

logger = logging.getLogger("cr")

# Fixed features: one float32 matrix (gold news × bills) each.
STATIC_FEATURES = [
  "cos_exposition_max",    # best news chunk vs bill name + exposition
  "cos_subjects_max",      # best news chunk vs bill name + subjects
  "cos_name_max",          # best news chunk vs bill name
  "cos_exposition_mean",   # mean of the news chunks vs bill name + exposition
  "z_exposition",          # cos_exposition_max against that bill's usual score on background news
  "z_subjects",
  "bm25",                  # log(1 + BM25) of the news words against bill name + subjects
  "event_distance",        # log(1 + days to the nearest SIL progress event), capped at EVENT_DISTANCE_CAP
  "alive",                 # 1 if the bill was filed, not archived and not a law yet on the news date
  "filed_after_news",      # 1 if the bill was filed after the news
]
BINARY_FEATURES = {"alive", "filed_after_news"}   # left as 0/1 when standardizing
EVENT_DISTANCE_CAP = 365
ARCHIVE_PREFIX = "ARCHIVO"          # SIL steps that archive the bill; every other step counts as progress
LAW_STEP = "PUBLICACION DE LA LEY"  # SIL step (accents removed) that turns the bill into a law
UNKNOWN_AGE_DAYS = 3650             # bills without a filing date are treated as old

@dataclass
class RankingFeatures:
  """Everything the ranker needs about the gold set; see FeatureBuilder."""
  static: np.ndarray        # (features × news × bills) float32, in STATIC_FEATURES order
  events_before: np.ndarray # (MAX_WINDOW_BEFORE + 1 × news × bills) uint8: progress events in [news - k, news] days
  events_after: np.ndarray  # (MAX_WINDOW_AFTER + 1 × news × bills) uint8: progress events in (news, news + k] days
  age_days: np.ndarray      # (news × bills) float32: news date - bill filing date (negative if filed after)
  links: np.ndarray         # (links × 2) int: (news row, bill column) of every gold link
  news_ids: np.ndarray
  bill_numbers: np.ndarray
  meta: dict

  @property
  def static_names(self) -> list[str]:
    return list(self.meta["static_features"])

class FeatureBuilder:
  """
  Builds the features of every (gold news, bill) pair for the candidate ranker (#33, #68) and caches them in
  <Config.RETRIEVAL_DIR>/features_<model>_<size>.npz:
    cosines of the news chunks (max and mean) against the bill vectors of EmbeddingRunner;
    z-scores of those cosines against each bill's mean and spread over a fixed background of legislative news
      (news_<size>_background.npz, embedded with run_embeddings.py --background), so bills that look like
      everything don't win everywhere;
    BM25 of the news words against bill name + subjects;
    SIL dates: progress events (archive steps excluded) around the news date, kept as counts for every window
      width up to the maximum so the window can be chosen later without recomputing, whether the bill was alive,
      and its age.
  Votes from Delfino are left out on purpose, so no feature comes from the same outlet as the gold links.
  """

  def __init__(self, model: str = Config.RETRIEVAL_MODEL, size: int = Config.RETRIEVAL_CHUNK_SIZE,
               database_path: str | None = None, output_dir: str = Config.RETRIEVAL_DIR):
    self.model = model
    self.size = size
    self.database_path = database_path or f"{Config.DATABASE_DIR}/{Config.PRIVATE_DATABASE}.db"
    self.output_path = pathlib.Path(output_dir) / f"features_{model}_{size}.npz"
    self.embeddings_dir = pathlib.Path(Config.EMBEDDINGS_DIR) / model
    self.connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri = True)

  # ---- entry point ----

  def load_or_build(self, rebuild: bool = False) -> RankingFeatures:
    if self.output_path.exists() and not rebuild:
      logger.info(f"[features] loading {self.output_path}")
      return load_features(self.output_path)
    features = self.build()
    self.output_path.parent.mkdir(parents = True, exist_ok = True)
    partial = self.output_path.with_suffix(".partial.npz")
    np.savez(partial, static = features.static, events_before = features.events_before,
             events_after = features.events_after, age_days = features.age_days, links = features.links,
             news_ids = features.news_ids, bill_numbers = features.bill_numbers,
             meta = np.array(json.dumps(features.meta)))
    partial.replace(self.output_path)
    logger.info(f"[features] saved {self.output_path}")
    return features

  def build(self) -> RankingFeatures:
    analyzer = EmbeddingAnalyzer([self.model], database_path = self.database_path)
    bill_numbers = np.load(self.embeddings_dir / "bills_name.npz")["numbers"]
    analyzer.gold = gold = analyzer.load_gold(bill_numbers)
    news_dates = np.array(gold.news_dates, dtype = "datetime64[D]")

    logger.info("[features] cosines")
    cosines = {}
    for variant, aggregation in [("exposition", "max"), ("subjects", "max"), ("name", "max"), ("exposition", "mean")]:
      cosines[f"cos_{variant}_{aggregation}"] = analyzer.scores(
        AnalysisConfig(self.model, self.size, variant, aggregation)).astype(np.float32)
    logger.info("[features] background z-scores")
    z = {f"z_{variant}": self.z_scores(cosines[f"cos_{variant}_max"], variant) for variant in ["exposition", "subjects"]}
    logger.info("[features] bm25")
    bm25 = np.log1p(self.bm25(gold.news_ids, bill_numbers))
    logger.info("[features] SIL dates")
    dates = self.date_features(news_dates, bill_numbers)

    static = np.stack([cosines["cos_exposition_max"], cosines["cos_subjects_max"], cosines["cos_name_max"],
                       cosines["cos_exposition_mean"], z["z_exposition"], z["z_subjects"], bm25,
                       dates["event_distance"], dates["alive"], dates["filed_after_news"]]).astype(np.float32)
    meta = {"model": self.model, "chunk_size": self.size, "static_features": STATIC_FEATURES,
            "max_window_before": Config.RETRIEVAL_MAX_WINDOW_BEFORE,
            "max_window_after": Config.RETRIEVAL_MAX_WINDOW_AFTER,
            "n_news": len(gold.news_ids), "n_bills": len(bill_numbers), "n_links": len(gold.links),
            "dropped_links": gold.dropped_links, "background_news": self.background_count,
            "unknown_filing_dates": dates["unknown_filing_dates"]}
    return RankingFeatures(static, dates["events_before"], dates["events_after"], dates["age_days"],
                           np.array(gold.links, dtype = np.int64), np.array(gold.news_ids), bill_numbers, meta)

  # ---- features ----

  def z_scores(self, scores: np.ndarray, variant: str) -> np.ndarray:
    """(score - bill mean) / bill std, the mean and std taken over the background news (best chunk per news)."""
    path = self.embeddings_dir / f"news_{self.size}_background.npz"
    if not path.exists():
      raise FileNotFoundError(f"{path} is missing: run python run_embeddings.py --model {self.model} --background")
    news_file = np.load(path)
    bills = np.load(self.embeddings_dir / f"bills_{variant}.npz")["vectors"].astype(np.float32)
    _, row = np.unique(news_file["news_ids"], return_inverse = True)
    order = np.argsort(row, kind = "stable")
    starts = np.flatnonzero(np.r_[True, np.diff(row[order]) != 0])
    chunk_scores = news_file["vectors"].astype(np.float32)[order] @ bills.T
    best = np.maximum.reduceat(chunk_scores, starts, axis = 0)
    self.background_count = int(len(starts))
    mean, std = best.mean(axis = 0), best.std(axis = 0)
    return ((scores - mean[None, :]) / np.where(std > 0, std, 1)[None, :]).astype(np.float32)

  def bm25(self, news_ids: list[str], bill_numbers: np.ndarray, k1: float = 1.2, b: float = 0.75) -> np.ndarray:
    """BM25 with the news (title counted twice + content) as the query and bill name + subjects as the documents."""
    names = dict(self.connection.execute("SELECT number, name FROM bills"))
    subjects: dict[int, list[str]] = collections.defaultdict(list)
    for number, subject in self.connection.execute("SELECT number, subject FROM bill_subjects"):
      subjects[number].append(subject or "")
    documents = [tokens(f"{names.get(int(n), '')} {' '.join(subjects.get(int(n), []))}") for n in bill_numbers]
    average = np.mean([len(d) for d in documents])
    frequency = collections.Counter(word for d in documents for word in set(d))
    idf = {w: math.log(1 + (len(documents) - f + 0.5) / (f + 0.5)) for w, f in frequency.items()}
    postings: dict[str, list[tuple[int, float]]] = collections.defaultdict(list)
    for column, document in enumerate(documents):
      for word, count in collections.Counter(document).items():
        weight = idf[word] * count * (k1 + 1) / (count + k1 * (1 - b + b * len(document) / average))
        postings[word].append((column, weight))
    texts = dict((row[0], row[1:]) for row in self.connection.execute(
      f"SELECT id, title, content FROM news_articles WHERE id IN ({','.join('?' * len(news_ids))})", news_ids))
    result = np.zeros((len(news_ids), len(bill_numbers)), dtype = np.float32)
    for row, news_id in enumerate(news_ids):
      title, content = texts[news_id]
      for word, count in collections.Counter(tokens(f"{title or ''} {title or ''} {content or ''}")).items():
        for column, weight in postings.get(word, ()):
          result[row, column] += weight * min(count, 3)
    return result

  def date_features(self, news_dates: np.ndarray, bill_numbers: np.ndarray) -> dict:
    before_max, after_max = Config.RETRIEVAL_MAX_WINDOW_BEFORE, Config.RETRIEVAL_MAX_WINDOW_AFTER
    news_days = news_dates.astype(np.int64)
    column = {int(n): j for j, n in enumerate(bill_numbers)}
    progress: dict[int, list[int]] = collections.defaultdict(list)
    archived: dict[int, int] = {}
    law: dict[int, int] = {}
    for number, description, start in self.connection.execute(
        "SELECT number, description, date_start FROM bill_steps WHERE date_start IS NOT NULL"):
      if number not in column:
        continue
      day = int(np.datetime64(start[:10], "D").astype(np.int64))
      text = strip_accents(description or "").upper()
      if text.startswith(ARCHIVE_PREFIX):
        archived[number] = min(day, archived.get(number, day))
      else:
        progress[number].append(day)
        if text.startswith(LAW_STEP):
          law[number] = min(day, law.get(number, day))
    filed = {number: int(np.datetime64(date[:10], "D").astype(np.int64))
             for number, date in self.connection.execute("SELECT number, date_proposed FROM bills") if date}

    shape = (len(news_days), len(bill_numbers))
    events_before = np.zeros((before_max + 1,) + shape, dtype = np.uint8)
    events_after = np.zeros((after_max + 1,) + shape, dtype = np.uint8)
    distance = np.full(shape, EVENT_DISTANCE_CAP, dtype = np.float32)
    offsets_before = np.arange(before_max + 1)[:, None]
    offsets_after = np.arange(after_max + 1)[:, None]
    for number, days in progress.items():
      j = column[number]
      days = np.sort(np.array(days))
      at_or_before = np.searchsorted(days, news_days, side = "right")
      events_before[:, :, j] = np.minimum(
        at_or_before[None, :] - np.searchsorted(days, news_days[None, :] - offsets_before, side = "left"), 255)
      events_after[:, :, j] = np.minimum(
        np.searchsorted(days, news_days[None, :] + offsets_after, side = "right") - at_or_before[None, :], 255)
      nearest = np.abs(days[None, :] - news_days[:, None]).min(axis = 1)
      distance[:, j] = np.minimum(nearest, EVENT_DISTANCE_CAP)

    filed_days = np.array([filed.get(int(n), -10 ** 9) for n in bill_numbers])
    unknown = filed_days == -10 ** 9
    age = (news_days[:, None] - filed_days[None, :]).astype(np.float32)
    age[:, unknown] = UNKNOWN_AGE_DAYS
    ends = np.array([min(archived.get(int(n), 10 ** 9), law.get(int(n), 10 ** 9)) for n in bill_numbers])
    alive = (age >= 0) & (news_days[:, None] < ends[None, :])
    return {"events_before": events_before, "events_after": events_after,
            "event_distance": np.log1p(distance), "alive": alive.astype(np.float32),
            "filed_after_news": (age < 0).astype(np.float32), "age_days": age,
            "unknown_filing_dates": int(unknown.sum())}

def background_news_ids(connection: sqlite3.Connection, count: int = Config.RETRIEVAL_BACKGROUND_SIZE,
                        seed: int = Config.RETRIEVAL_BACKGROUND_SEED) -> list[str]:
  """A fixed random sample of legislative news (keyword filter of the sample) from every outlet, leaving out the
  gold news and every news in the hand-labeled sample queue, so the test sample stays untouched."""
  excluded = {row[0] for row in connection.execute("SELECT DISTINCT news_id FROM news_bill_links")}
  queue = pathlib.Path(Config.SAMPLE_DIR) / "queue.csv"
  if queue.exists():
    with queue.open(encoding = "utf-8") as handle:
      excluded |= {row["news_id"] for row in csv.DictReader(handle)}
  candidates = [news_id for news_id, title, content in connection.execute(
    "SELECT id, title, content FROM news_articles WHERE extraction_status = 'Success' AND length(content) >= ? "
    "ORDER BY id", (MIN_CONTENT_CHARS,))
    if news_id not in excluded and KEYWORDS.search(f"{title} {content}")]
  return sorted(random.Random(seed).sample(candidates, min(count, len(candidates))))

def load_features(path: str | pathlib.Path) -> RankingFeatures:
  data = np.load(path)
  return RankingFeatures(data["static"], data["events_before"], data["events_after"], data["age_days"],
                         data["links"], data["news_ids"], data["bill_numbers"], json.loads(str(data["meta"])))

def strip_accents(text: str) -> str:
  text = unicodedata.normalize("NFKD", text)
  return "".join(ch for ch in text if not unicodedata.combining(ch))

def tokens(text: str) -> list[str]:
  return re.findall(r"[a-z0-9]{3,}", strip_accents((text or "").lower()))
