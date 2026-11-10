import csv
import json
import logging
import pathlib
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict

from config import Config
from tools.display_tools.progress import ProgressBoard, ProgressTask, silent_task
from tools.llm_tools.jev import Jev, bill_key
from tools.llm_tools.jev_context import JevContext
from tools.llm_tools.jev_questions import (DETAIL_QUESTIONS, GATE_QUESTIONS, MATCH_QUESTIONS, NEWS_DETAIL_QUESTIONS,
                                           NEWS_KEY, detail_questions, gate_questions, genre_question,
                                           news_detail_questions)

logger = logging.getLogger("cr")

class CostCapReached(Exception):
  pass

class JevRunner:
  """
  Runs Jev over the candidates of a set of news (#34, #39, #43) and writes, in <output_dir>:
    answers.jsonl  one line per answered request with everything Jev sent back (see JevResponse: parsed answers,
                   raw body, input and output tokens, headers, time, key), appended as it goes, so a cut run resumes
                   where it stopped and nothing is asked twice
    questions.json the exact questions of each stage, with b<number> standing for each bill's key
    gate.csv       one row per (news, candidate): ranker rank, the gate answers and whether it matched
    news.csv       one row per news: genre (with its probabilities), whether its content was cut, number of matches
    details.csv    long format, one row per (news, bill, question, option): probability, choice and confidence for
                   Choice and Score questions, plus the score for the Score questions. News-level questions have
                   an empty bill
    run.json       settings, models seen, tokens and cost
  Two requests per news: the gate for all its candidates, then the details only for the candidates whose explicit
  or implicit answer reaches the threshold (none if no candidate does). stage runs both, or only one of them, so
  each stage can be paid with its own key: by default the key named after the stage, unless key says otherwise.
  The CSV files are rebuilt from answers.jsonl at the end of every run, so they always match it. No news text is
  written. With a ProgressBoard, run shows one bar per stage, the matches found and the spend against the cap; a
  news whose request fails (after the SDK's retries) is counted as a warning, the others go on, and running again
  retries it.
  """

  def __init__(self, candidates_path: str | pathlib.Path, output_dir: str | pathlib.Path,
               jev: Jev | None = None, context: JevContext | None = None,
               threshold: float = Config.JEV_MATCH_THRESHOLD, cost_cap_usd: float = Config.JEV_COST_CAP_USD,
               threads: int = Config.JEV_THREADS, limit: int | None = None, stage: str = "both",
               key: str | None = None, board: ProgressBoard | None = None):
    if stage not in ("both", "gate", "details"):
      raise ValueError(f"unknown stage {stage}")
    self.candidates = read_candidates(candidates_path)
    if limit:
      self.candidates = dict(list(self.candidates.items())[:limit])
    self.output_dir = pathlib.Path(output_dir)
    self.answers_path = self.output_dir / "answers.jsonl"
    self.jev = jev
    self.stage = stage
    self.key = key
    self.jevs: dict[str, Jev] = {}
    self.context = context or JevContext()
    self.threshold = threshold
    self.cost_cap_usd = cost_cap_usd
    self.threads = threads
    self.lock = threading.Lock()
    self.spent_tokens = 0
    self.cut_news: set[str] = set()
    self.board = board
    self.bars: dict[str, ProgressTask] = {}
    self.spent_cents = 0
    self.failed: list[str] = []

  # ---- entry point ----

  def run(self, dry_run: bool = False) -> dict:
    self.output_dir.mkdir(parents = True, exist_ok = True)
    records = self.load_records()
    pending = [n for n in self.candidates
               if (self.stage != "details" and (n, "gate") not in records)
               or (self.stage != "gate" and self.needs_details(records, n))]
    logger.info(f"[jev] {len(self.candidates)} news, {len(pending)} with requests left")
    if dry_run:
      return {"news": len(self.candidates), "pending": len(pending)}
    self.write_questions()
    self.make_bars(records, pending)
    capped = 0
    with ThreadPoolExecutor(self.threads) as pool:
      futures = {pool.submit(self.process, news_id, records): news_id for news_id in pending}
      for future, news_id in futures.items():
        try:
          future.result()
        except CostCapReached:
          capped += 1
          if capped == 1:
            self.warn(f"cost cap of ${self.cost_cap_usd} reached; run again to continue")
        except Exception as error:   # one news failing must not stop the other thousands; running again retries it
          self.failed.append(news_id)
          self.warn(f"news {news_id[:10]} failed: {type(error).__name__}: {str(error)[:200]}")
    for bar in self.bars.values():
      bar.finish()
    summary = self.write_tables(self.load_records())
    summary |= {"failed_this_run": len(self.failed), "left_by_cap_this_run": capped}
    logger.info(f"[jev] this run: {self.spent_tokens:,} input tokens (~${self.cost(self.spent_tokens):.4f}), "
                f"{len(self.failed)} failed, {capped} left by the cap")
    return summary

  def make_bars(self, records: dict, pending: list[str]):
    """Rows: gate and details (news done / to do), matches found by the gate, and cents spent of the cap."""
    def bar(phase: str, total: int | None) -> ProgressTask:
      return self.board.task("jev", phase, total = total) if self.board else silent_task()
    if self.stage != "details":
      self.bars["gate"] = bar("gate", sum(1 for n in pending if (n, "gate") not in records))
      self.bars["matches"] = bar("matches", None)
    if self.stage != "gate":
      known = sum(1 for n in pending if self.needs_details(records, n))
      self.bars["details"] = bar("details", known if self.stage == "details" else None)
    self.bars["cost"] = bar("¢ of cap", round(self.cost_cap_usd * 100))

  def warn(self, message: str):
    bar = next(iter(self.bars.values()), None)
    if bar is not None and self.board:
      bar.warn(message)
    else:
      logger.warning(f"[jev] {message}")

  # ---- requests ----

  def process(self, news_id: str, records: dict):
    news, cut = self.context.news(news_id)
    if cut:
      self.cut_news.add(news_id)
    gate = records.get((news_id, "gate"))
    if gate is None:
      if self.stage == "details":
        return
      self.check_cap()
      cards = [self.context.card(n) for n, _ in self.candidates[news_id]]
      gate = self.save(news_id, self.client("gate").gate(news, cards), cut)
      records[(news_id, "gate")] = gate
      self.bars["gate"].advance()
      self.bars["matches"].advance(len(self.matches(gate)))
    if self.stage == "gate":
      return
    matched = self.matches(gate)
    if matched and (news_id, "details") not in records:
      self.check_cap()
      cards = [self.context.card(n) for n in matched]
      response = self.client("details").details(news, cards, self.context.roster())
      records[(news_id, "details")] = self.save(news_id, response, cut)
      self.bars["details"].advance()

  def client(self, stage: str) -> Jev:
    """The Jev that pays for stage: the injected one, or one per key."""
    if self.jev is not None:
      return self.jev
    key = self.key or stage
    with self.lock:
      if key not in self.jevs:
        self.jevs[key] = Jev(key)
      return self.jevs[key]

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
      cents = int(self.cost(self.spent_tokens) * 100)
      step, self.spent_cents = cents - self.spent_cents, cents
    if step and "cost" in self.bars:
      self.bars["cost"].advance(step)
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
      news_rows.append({"news_id": news_id, "genre": genre.get("choice"), "genre_confidence": genre.get("confidence"),
                        **{f"genre_{k}": v for k, v in genre.get("probabilities", {}).items()},
                        "cut": int(gate.get("cut", False)), "matches": len(matched)})
      details = records.get((news_id, "details"))
      if details is None:
        continue
      for name, answer in details["answers"].items():
        key, question = name.split("_", 1)
        detail_rows += answer_rows(news_id, "" if key == NEWS_KEY else int(key[1:]), question, answer)
    write_csv(self.output_dir / "gate.csv", gate_rows)
    write_csv(self.output_dir / "news.csv", news_rows)
    write_csv(self.output_dir / "details.csv", detail_rows)
    tokens = sum(r["input_tokens"] for r in records.values())
    output_tokens = sum(r.get("output_tokens") or 0 for r in records.values())
    summary = {"news": len(self.candidates), "news_answered": len(news_rows),
               "news_with_matches": sum(1 for r in news_rows if r["matches"]),
               "matches": sum(r["matches"] for r in news_rows), "news_cut": sum(r["cut"] for r in news_rows),
               "requests": len(records), "input_tokens": tokens, "output_tokens": output_tokens, "cost_usd": round(self.cost(tokens), 4),
               "tokens_by_key": tokens_by_key(records.values()),
               "models": sorted({r["model"] for r in records.values()}), "threshold": self.threshold,
               "gate_questions": GATE_QUESTIONS, "news_detail_questions": NEWS_DETAIL_QUESTIONS,
               "detail_questions": DETAIL_QUESTIONS,
               "max_news_chars": self.context.max_news_chars}
    (self.output_dir / "run.json").write_text(json.dumps(summary, indent = 2), encoding = "utf-8")
    return summary

  def write_questions(self):
    """The exact questions sent, once per run (the requests repeat them for every bill)."""
    dump = lambda questions: {name: q.model_dump(mode = "json", exclude_none = True) for name, q in questions.items()}
    key = "b<number>"
    payload = {"gate": dump({"genre": genre_question()} | gate_questions(key)),
               "details_news": dump(news_detail_questions()), "details": dump(detail_questions(key))}
    (self.output_dir / "questions.json").write_text(json.dumps(payload, indent = 2, ensure_ascii = False),
                                                    encoding = "utf-8")

def tokens_by_key(records) -> dict:
  totals: dict[str, int] = {}
  for record in records:
    key = record.get("key") or "unknown"
    totals[key] = totals.get(key, 0) + record["input_tokens"]
  return totals

def noul(record: dict, number: int, question: str) -> float:
  return record["answers"].get(f"{bill_key(number)}_{question}", {}).get("noul", 0.0)

def answer_rows(news_id: str, number: int | str, question: str, answer: dict) -> list[dict]:
  """Long-format rows of one answer. Score questions also get score_01: the score rescaled to 0-1 (score divided by the
  highest level), so centrality goes from 0 (in passing) to 1 (main subject) and stance from 0 (strongly critical)
  through 0.5 (neutral) to 1 (strongly favorable)."""
  base = {"news_id": news_id, "bill": number, "question": question}
  if answer["type"] == "noul":
    return [base | {"option": "true", "probability": answer["noul"], "choice": "", "confidence": "", "score": "",
                    "score_01": ""}]
  score = score_01 = ""
  if answer["type"] == "score":
    score = answer["score"]
    top = max(int(level) for level in answer["probabilities"])
    score_01 = round(score / top, 4) if top else ""
  extra = {"choice": answer.get("choice", ""), "confidence": answer.get("confidence", "")}
  return [base | {"option": option, "probability": p, **extra, "score": score, "score_01": score_01}
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
