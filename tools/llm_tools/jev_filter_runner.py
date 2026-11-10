import json
import logging
import pathlib
import random
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict

from config import Config
from tools.llm_tools.jev import Jev
from tools.llm_tools.jev_context import JevContext
from tools.llm_tools.jev_questions import filter_questions
from tools.llm_tools.jev_runner import CostCapReached, JevRunner, write_csv

logger = logging.getLogger("cr")

ORDER_SEED = 2026   # the news are asked in a fixed random order, so the first N (--limit) are a random pilot

class JevFilterRunner:
  """
  Asks Jev the news-level filter question (assembly) about every news of the corpus (#43), before the ranker and the
  gate. Writes, in <output_dir>:
    answers.jsonl  one line per answered news (news_id, stage, model, input tokens, answers, cut): the raw record,
                   appended as it goes, so a cut run resumes where it stopped and nothing is asked twice
    filter.csv     one row per answered news: outlet, date, assembly probability, whether it passes the threshold and
                   whether its content was cut
    run.json       settings, models seen, tokens and cost
  Every probability is stored, so the threshold can be changed later without asking again. No news text is written.
  """

  def __init__(self, output_dir: str | pathlib.Path, jev: Jev | None = None, context: JevContext | None = None,
               threshold: float = Config.JEV_FILTER_THRESHOLD, cost_cap_usd: float = Config.JEV_COST_CAP_USD,
               threads: int = Config.JEV_THREADS, limit: int | None = None):
    self.output_dir = pathlib.Path(output_dir)
    self.answers_path = self.output_dir / "answers.jsonl"
    self.jev = jev
    self.context = context or JevContext()
    self.threshold = threshold
    self.cost_cap_usd = cost_cap_usd
    self.threads = threads
    self.lock = threading.Lock()
    self.spent_tokens = 0
    self.meta = self.read_news()
    self.news_ids = list(self.meta)
    if limit:
      self.news_ids = self.news_ids[:limit]

  def read_news(self) -> dict[str, dict]:
    """news_id -> {outlet, date} for every news whose extraction succeeded (the Partial ones have no content), in the
    fixed random order of ORDER_SEED."""
    connection = sqlite3.connect(f"file:{self.context.database_path}?mode=ro", uri = True)
    rows = connection.execute("SELECT id, organization, date_published FROM news_articles "
                              "WHERE extraction_status = 'Success' ORDER BY id").fetchall()
    connection.close()
    random.Random(ORDER_SEED).shuffle(rows)
    return {news_id: {"outlet": outlet, "date": (published or "")[:10]} for news_id, outlet, published in rows}

  # ---- entry point ----

  def run(self, dry_run: bool = False) -> dict:
    self.output_dir.mkdir(parents = True, exist_ok = True)
    records = self.load_records()
    pending = [n for n in self.news_ids if n not in records]
    logger.info(f"[jev filter] {len(self.news_ids)} news, {len(pending)} left to ask")
    if dry_run:
      return {"news": len(self.news_ids), "pending": len(pending), **self.estimate(pending)}
    self.jev = self.jev or Jev("filter")
    try:
      with ThreadPoolExecutor(self.threads) as pool:
        for future in [pool.submit(self.process, news_id) for news_id in pending]:
          future.result()
    except CostCapReached:
      logger.warning(f"[jev filter] cost cap of ${self.cost_cap_usd} reached; run again to continue")
    summary = self.write_tables(self.load_records())
    logger.info(f"[jev filter] this run: {self.spent_tokens:,} input tokens (~${JevRunner.cost(self.spent_tokens):.4f})")
    return summary

  def estimate(self, pending: list[str]) -> dict:
    """Rough cost of the pending news, from the characters of their request state and the questions. Measured on the
    first filter test: ~1,850 billed tokens per news (general 2026-11-08 20:52); use it only as an order of magnitude."""
    chars = 0
    questions = json.dumps({k: q.model_dump(mode = "json") for k, q in filter_questions().items()}, ensure_ascii = False)
    for news_id in pending:
      news, _ = self.context.news(news_id)
      chars += len(json.dumps({"news": news}, ensure_ascii = False)) + len(questions)
    tokens = int(chars / 3.8)
    return {"estimated_tokens": tokens, "estimated_cost_usd": round(JevRunner.cost(tokens), 2)}

  # ---- requests ----

  def process(self, news_id: str):
    with self.lock:
      if JevRunner.cost(self.spent_tokens) >= self.cost_cap_usd:
        raise CostCapReached()
    news, cut = self.context.news(news_id)
    response = self.jev.filter(news)
    record = {"news_id": news_id, **asdict(response), "cut": cut}
    with self.lock:
      self.spent_tokens += response.input_tokens
      with self.answers_path.open("a", encoding = "utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii = False) + "\n")

  def load_records(self) -> dict:
    records = {}
    if self.answers_path.exists():
      with self.answers_path.open(encoding = "utf-8") as handle:
        for line in handle:
          if line.strip():
            record = json.loads(line)
            records[record["news_id"]] = record
    return records

  # ---- tables ----

  def write_tables(self, records: dict) -> dict:
    rows = []
    for news_id in self.meta:   # every answered news, also those outside --limit
      record = records.get(news_id)
      if record is None:
        continue
      assembly = record["answers"]["assembly"]["noul"]
      rows.append({"news_id": news_id, **self.meta[news_id], "assembly": assembly,
                   "passes": int(assembly >= self.threshold), "cut": int(record.get("cut", False))})
    write_csv(self.output_dir / "filter.csv", rows)
    tokens = sum(r["input_tokens"] for r in records.values())
    summary = {"news_in_corpus": len(self.meta), "news_answered": len(rows),
               "news_passing": sum(r["passes"] for r in rows), "news_cut": sum(r["cut"] for r in rows),
               "threshold": self.threshold, "input_tokens": tokens, "cost_usd": round(JevRunner.cost(tokens), 4),
               "tokens_per_news": round(tokens / len(rows)) if rows else 0,
               "models": sorted({r["model"] for r in records.values()}), "questions": list(filter_questions()),
               "max_news_chars": self.context.max_news_chars, "order_seed": ORDER_SEED}
    (self.output_dir / "run.json").write_text(json.dumps(summary, indent = 2), encoding = "utf-8")
    return summary
