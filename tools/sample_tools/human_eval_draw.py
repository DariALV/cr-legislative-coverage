import csv
import glob
import pathlib
import random
import re
import sqlite3
from collections import Counter

from config import Config

# News already seen while tuning or reviewing Jev (questions, filter, gate, match review) or labeled for the first
# sample. They stay out of the blind evaluation, so it is a clean test. CSV files are read by their news_id column;
# the raw answer files are scanned for news ids (64 hex characters).
USED_CSV = ["results/sample/queue.csv", "results/jev/sample/news.csv", "results/jev/sample_final/news.csv",
            "results/jev/test100/news.csv", "results/jev/corpus_analysis/match_review.csv",
            "results/jev/filter_v1.csv", "results/jev/probe_v1.csv", "results/jev/types_v1.csv"]
USED_JSONL = ["results/jev/answers/*.jsonl", "results/jev/test100*/answers.jsonl"]
NEWS_ID = re.compile(r"\b[0-9a-f]{64}\b")

class HumanEvalDraw:
  """
  Draws the news for the blind evaluation of Jev's answers. Two groups come from Jev's corpus run: news with at least
  one gate match (and at most max_matches) and news that passed the filter but matched nothing. Only news of at most
  max_chars characters enter, because they are answered by hand; longer news are left to Claude.

  The rows come in blocks. By the end of block i every outlet has stages[i] news in each group, so stopping at a block
  boundary still leaves a balanced set (stages (3, 5): 30 rows, then 50). Inside a block the order is random. News
  already answered (`keep`) go first and count toward their outlet and group. The first `pilot` rows are the pilot;
  the pilot rows that are not kept are the shortest news of the first block, so the pilot goes quickly.

  The saved draw has no group column on purpose: whoever answers must not know which news Jev matched. The group is
  read back from Jev's results when the answers are evaluated.
  """

  def __init__(self, seed: int = Config.HUMAN_EVAL_SEED, max_matches: int = Config.HUMAN_EVAL_MAX_MATCHES,
               max_chars: int = Config.HUMAN_EVAL_MAX_CHARS, corpus_dir: str = f"{Config.JEV_RESULTS_DIR}/corpus",
               filter_path: str = f"{Config.JEV_RESULTS_DIR}/corpus_filter/filter.csv"):
    self.seed = seed
    self.max_matches = max_matches
    self.max_chars = max_chars
    self.news = self.read_csv(pathlib.Path(filter_path))   # outlet and date of every news in the corpus
    self.matches = {news_id: int(float(row["matches"] or 0))
                    for news_id, row in self.read_csv(pathlib.Path(corpus_dir) / "news.csv").items()}
    self.lengths = self.content_lengths()

  def group_of(self, news_id: str) -> str:
    return "matched" if self.matches[news_id] > 0 else "unmatched"

  def draw(self, stages: tuple[int, ...] = Config.HUMAN_EVAL_STAGES, pilot: int = Config.HUMAN_EVAL_PILOT,
           keep: list[str] = ()) -> list[dict]:
    """Rows in answering order: order, news_id, outlet, date, pilot (1 for the pilot news)."""
    rng = random.Random(self.seed)
    keep = list(keep)
    taken = Counter((self.group_of(news_id), self.news[news_id]["outlet"]) for news_id in keep)
    available = {key: rng.sample(sorted(ids), len(ids)) for key, ids in sorted(self.pools(exclude = set(keep)).items())}
    blocks: list[list[str]] = []
    for quota in stages:
      block: list[str] = []
      for key in sorted(available):
        need = quota - taken[key]
        if need <= 0:
          continue
        if len(available[key]) < need:
          raise ValueError(f"only {len(available[key])} news left for {key}, {need} needed")
        block += available[key][:need]
        available[key] = available[key][need:]
        taken[key] += need
      rng.shuffle(block)
      blocks.append(block)
    if blocks and pilot > len(keep):
      shortest = sorted(blocks[0], key = lambda news_id: (self.lengths.get(news_id, 0), news_id))[:pilot - len(keep)]
      rng.shuffle(shortest)
      blocks[0] = shortest + [news_id for news_id in blocks[0] if news_id not in shortest]
    ordered = keep + [news_id for block in blocks for news_id in block]
    return [{"order": order, "news_id": news_id, "outlet": self.news[news_id]["outlet"], "date": self.news[news_id]["date"],
             "pilot": int(order <= pilot)} for order, news_id in enumerate(ordered, start = 1)]

  def pools(self, exclude: set[str] = frozenset()) -> dict[tuple[str, str], list[str]]:
    """Eligible news ids by (group, outlet): unused, short enough and with at most max_matches gate matches."""
    used = self.used_news() | set(exclude)
    pools: dict[tuple[str, str], list[str]] = {}
    for news_id, matches in self.matches.items():
      if news_id in used or matches > self.max_matches or self.lengths.get(news_id, 0) > self.max_chars:
        continue
      pools.setdefault((self.group_of(news_id), self.news[news_id]["outlet"]), []).append(news_id)
    return pools

  @staticmethod
  def content_lengths() -> dict[str, int]:
    path = pathlib.Path(Config.DATABASE_DIR) / f"{Config.PRIVATE_DATABASE}.db"
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri = True)
    try:
      return {news_id: length or 0 for news_id, length in connection.execute("SELECT id, length(content) FROM news_articles")}
    finally:
      connection.close()

  @staticmethod
  def used_news() -> set[str]:
    used: set[str] = set()
    for path in USED_CSV:
      if pathlib.Path(path).exists():
        used.update(HumanEvalDraw.read_csv(pathlib.Path(path)))
    for pattern in USED_JSONL:
      for path in glob.glob(pattern):
        with open(path, encoding = "utf-8") as file:
          for line in file:
            used.update(NEWS_ID.findall(line))
    return used

  @staticmethod
  def read_csv(path: pathlib.Path) -> dict[str, dict]:
    """Rows by news_id. A few older result files are Latin-1."""
    for encoding in ("utf-8-sig", "latin-1"):
      try:
        with open(path, encoding = encoding, newline = "") as file:
          return {row["news_id"]: row for row in csv.DictReader(file) if row.get("news_id")}
      except UnicodeDecodeError:
        continue
    raise ValueError(f"can't decode {path}")

  @staticmethod
  def save(rows: list[dict], path: pathlib.Path) -> None:
    path.parent.mkdir(parents = True, exist_ok = True)
    with open(path, "w", encoding = "utf-8", newline = "") as file:
      writer = csv.DictWriter(file, fieldnames = ["order", "news_id", "outlet", "date", "pilot"])
      writer.writeheader()
      writer.writerows(rows)
