import csv
import json
import logging
import pathlib
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict

from config import Config
from tools.llm_tools.jev import Jev, bill_key
from tools.llm_tools.jev_context import JevContext
from tools.llm_tools.jev_questions import DETAIL_QUESTIONS, GATE_QUESTIONS, MATCH_QUESTIONS

logger = logging.getLogger("cr")

class CostCapReached(Exception):
  pass

class JevRunner:
  """
  Runs Jev over the candidates of a set of news (#34, #39, #43) and writes, in <output_dir>:
    answers.jsonl  one line per answered request (news_id, stage, model, input tokens, answers): the raw record,
                   appended as it goes, so a cut run resumes where it stopped and nothing is asked twice
    gate.csv       one row per (news, candidate): ranker rank, explicit, implicit, same_topic and whether it matched
    news.csv       one row per news: genre (with its probabilities), whether its content was cut, number of matches
    details.csv    long format, one row per (news, bill, question, option): probability, plus the score for the
                   Score questions
    run.json       settings, models seen, tokens and cost
  Two requests per news: the gate for all its candidates, then the details only for the candidates whose explicit
  or implicit answer reaches the threshold (none if no candidate does). The CSV files are rebuilt from answers.jsonl
  at the end of every run, so they always match it. No news text is written.
  """

  def __init__(self, candidates_path: str | pathlib.Path, output_dir: str | pathlib.Path,
               jev: Jev | None = None, context: JevContext | None = None,
               threshold: float = Config.JEV_MATCH_THRESHOLD, cost_cap_usd: float = Config.JEV_COST_CAP_USD,
               threads: int = Config.JEV_THREADS, limit: int | None = None):
    self.candidates = read_candidates(candidates_path)
    if limit:
      self.candidates = dict(list(self.candidates.items())[:limit])
    self.output_dir = pathlib.Path(output_dir)
    self.answers_path = self.output_dir / "answers.jsonl"
    self.jev = jev
    self.context = context or JevContext()
    self.threshold = threshold
    self.cost_cap_usd = cost_cap_usd
    self.threads = threads
    self.lock = threading.Lock()
    self.spent_tokens = 0
    self.cut_news: set[str] = set()

  # ---- entry point ----

  def run(self, dry_run: bool = False) -> dict:
    self.output_dir.mkdir(parents = True, exist_ok = True)
    records = self.load_records()
    pending = [n for n in self.candidates if (n, "gate") not in records or self.needs_details(records, n)]
    logger.info(f"[jev] {len(self.candidates)} news, {len(pending)} with requests left")
    if dry_run:
      return {"news": len(self.candidates), "pending": len(pending)}
    self.jev = self.jev or Jev()
    try:
      with ThreadPoolExecutor(self.threads) as pool:
        for future in [pool.submit(self.process, news_id, records) for news_id in pending]:
          future.result()
    except CostCapReached:
      logger.warning(f"[jev] cost cap of ${self.cost_cap_usd} reached; run again to continue")
    summary = self.write_tables(self.load_records())
    logger.info(f"[jev] this run: {self.spent_tokens:,} input tokens (~${self.cost(self.spent_tokens):.4f})")
    return summary

  # ---- requests ----

  def process(self, news_id: str, records: dict):
    news, cut = self.context.news(news_id)
    if cut:
      self.cut_news.add(news_id)
    gate = records.get((news_id, "gate"))
    if gate is None:
      self.check_cap()
      cards = [self.context.card(n) for n, _ in self.candidates[news_id]]
      gate = self.save(news_id, self.jev.gate(news, cards), cut)
      records[(news_id, "gate")] = gate
    matched = self.matches(gate)
    if matched and (news_id, "details") not in records:
      self.check_cap()
      cards = [self.context.card(n) for n in matched]
      records[(news_id, "details")] = self.save(news_id, self.jev.details(news, cards, self.context.roster()), cut)

  def check_cap(self):
    with self.lock:
      if self.cost(self.spent_tokens) >= self.cost_cap_usd:
        raise CostCapReached()

  def save(self, news_id: str, response, cut: bool) -> dict:
    record = {"news_id": news_id, **asdict(response), "cut": cut}
    with self.lock:
      self.spent_tokens += response.input_tokens
      with self.answers_path.open("a", encoding = "utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii = False) + "\n")
    return record

  def matches(self, gate: dict) -> list[int]:
    """Candidates (in ranker order) whose explicit or implicit probability reaches the threshold."""
    numbers = [n for n, _ in self.candidates.get(gate["news_id"], [])]
    return [n for n in numbers if max(noul(gate, n, q) for q in MATCH_QUESTIONS) >= self.threshold]

  def needs_details(self, records: dict, news_id: str) -> bool:
    gate = records.get((news_id, "gate"))
    return gate is not None and (news_id, "details") not in records and bool(self.matches(gate))

  def load_records(self) -> dict:
    records = {}
    if self.answers_path.exists():
      with self.answers_path.open(encoding = "utf-8") as handle:
        for line in handle:
          if line.strip():
            record = json.loads(line)
            records[(record["news_id"], record["stage"])] = record
    return records

  @staticmethod
  def cost(tokens: int) -> float:
    return tokens * Config.JEV_PRICE_PER_MILLION / 1e6

  # ---- tables ----

  def write_tables(self, records: dict) -> dict:
    gate_rows, news_rows, detail_rows = [], [], []
    for news_id, candidates in self.candidates.items():
      gate = records.get((news_id, "gate"))
      if gate is None:
        continue
      matched = set(self.matches(gate))
      for number, rank in candidates:
        gate_rows.append({"news_id": news_id, "bill": number, "rank": rank,
                          **{q: noul(gate, number, q) for q in GATE_QUESTIONS}, "match": int(number in matched)})
      genre = gate["answers"].get("genre", {})
      news_rows.append({"news_id": news_id, "genre": genre.get("choice"),
                        **{f"genre_{k}": v for k, v in genre.get("probabilities", {}).items()},
                        "cut": int(gate.get("cut", False)), "matches": len(matched)})
      details = records.get((news_id, "details"))
      if details is None:
        continue
      for name, answer in details["answers"].items():
        key, question = name.split("_", 1)
        detail_rows += answer_rows(news_id, int(key[1:]), question, answer)
    write_csv(self.output_dir / "gate.csv", gate_rows)
    write_csv(self.output_dir / "news.csv", news_rows)
    write_csv(self.output_dir / "details.csv", detail_rows)
    tokens = sum(r["input_tokens"] for r in records.values())
    summary = {"news": len(self.candidates), "news_answered": len(news_rows),
               "news_with_matches": sum(1 for r in news_rows if r["matches"]),
               "matches": sum(r["matches"] for r in news_rows), "news_cut": sum(r["cut"] for r in news_rows),
               "requests": len(records), "input_tokens": tokens, "cost_usd": round(self.cost(tokens), 4),
               "models": sorted({r["model"] for r in records.values()}), "threshold": self.threshold,
               "gate_questions": GATE_QUESTIONS, "detail_questions": DETAIL_QUESTIONS,
               "max_news_chars": self.context.max_news_chars}
    (self.output_dir / "run.json").write_text(json.dumps(summary, indent = 2), encoding = "utf-8")
    return summary

def noul(record: dict, number: int, question: str) -> float:
  return record["answers"].get(f"{bill_key(number)}_{question}", {}).get("noul", 0.0)

def answer_rows(news_id: str, number: int, question: str, answer: dict) -> list[dict]:
  """Long-format rows of one answer. Score questions also get score_01: the score rescaled to 0-1 (score divided by the
  highest level), so centrality goes from 0 (in passing) to 1 (main subject) and stance from 0 (strongly critical)
  through 0.5 (neutral) to 1 (strongly favorable)."""
  base = {"news_id": news_id, "bill": number, "question": question}
  if answer["type"] == "noul":
    return [base | {"option": "true", "probability": answer["noul"], "score": "", "score_01": ""}]
  score = score_01 = ""
  if answer["type"] == "score":
    score = answer["score"]
    top = max(int(level) for level in answer["probabilities"])
    score_01 = round(score / top, 4) if top else ""
  return [base | {"option": option, "probability": p, "score": score, "score_01": score_01}
          for option, p in answer.get("probabilities", {}).items()]

def read_candidates(path: str | pathlib.Path) -> dict[str, list[tuple[int, int]]]:
  """news_id -> [(bill, rank)] in rank order, from a candidates.csv of run_candidates.py."""
  candidates: dict[str, list[tuple[int, int]]] = {}
  with open(path, encoding = "utf-8") as handle:
    for row in csv.DictReader(handle):
      candidates.setdefault(row["news_id"], []).append((int(row["bill"]), int(row["rank"])))
  return {news_id: sorted(rows, key = lambda r: r[1]) for news_id, rows in candidates.items()}

def write_csv(path: pathlib.Path, rows: list[dict]):
  fields = list(dict.fromkeys(k for row in rows for k in row))
  with path.open("w", encoding = "utf-8", newline = "") as handle:
    writer = csv.DictWriter(handle, fieldnames = fields)
    writer.writeheader()
    writer.writerows(rows)
