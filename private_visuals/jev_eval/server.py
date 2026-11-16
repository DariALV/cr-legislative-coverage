"""Local page to answer Jev's questions by hand, without seeing Jev's answers (blind evaluation of Jev).

The JSON API of the page in this folder. The news and the bill cards come from JevContext, so they are exactly what
Jev saw: the content cut at JEV_MAX_NEWS_CHARS and the same short card per bill. Nothing from Jev's answers reaches the
page; the candidates keep the ranker's order but go without scores or how they were found.
Answers are saved to results/jev/human_eval/answers.json: ids, options, notes and timings, no news text.

It has no server of its own: private_visuals/server.py serves the page and mounts EvalApp.get() and EvalApp.post()
under /jev_eval/:

    python private_visuals/server.py [--port 8766] [--eval-set pilot|all] [--eval-limit N] [--answers path]

and open http://localhost:8766/jev_eval/.

Endpoints (the page calls them relative to itself, api/...):
    GET  /api/session          the draw in order, the questions, the deputies with their party, the saved answers
    GET  /api/news/<id>        one news as Jev saw it, with its candidate bills
    GET  /api/bills            every bill as [number, title], to add one that is not among the candidates
    GET  /api/card/<number>    the card of one bill
    POST /api/answers/<id>     saves the answers of one news (the entry is replaced whole)
"""
import csv
import json
import os
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)   # Config paths are relative to the repo root

from config import Config
from tools.llm_tools.jev_context import JevContext

DRAW_PATH = ROOT / Config.HUMAN_EVAL_DIR / "draw.csv"
DEFAULT_ANSWERS = ROOT / Config.HUMAN_EVAL_DIR / "answers.json"
CORPUS_DIR = ROOT / Config.JEV_RESULTS_DIR / "corpus"

class AnswerStore:
  """The answers file, {"news": {news_id: entry}}, rewritten whole and atomically on every save."""

  def __init__(self, path: Path):
    self.path = path
    self.lock = threading.Lock()
    self.data = json.loads(path.read_text(encoding = "utf-8")) if path.exists() else {"news": {}}

  def save(self, news_id: str, entry: dict) -> str:
    with self.lock:
      # UTC, like the page's own timestamps (opened_at, completed_at come from the browser as ISO with Z)
      entry["saved_at"] = datetime.now(timezone.utc).isoformat(timespec = "seconds").replace("+00:00", "Z")
      self.data["news"][news_id] = entry
      self.path.parent.mkdir(parents = True, exist_ok = True)
      temporary = self.path.with_suffix(".tmp")
      temporary.write_text(json.dumps(self.data, ensure_ascii = False, indent = 1), encoding = "utf-8")
      os.replace(temporary, self.path)
      return entry["saved_at"]

class EvalApp:
  def __init__(self, set_name: str, answers_path: Path, limit: int | None = None):
    with open(DRAW_PATH, encoding = "utf-8", newline = "") as file:
      rows = [row for row in csv.DictReader(file) if set_name == "all" or row["pilot"] == "1"]
    if limit:
      rows = rows[:limit]
    self.set_name = set_name
    self.items = [{"order": int(row["order"]), "news_id": row["news_id"], "outlet": row["outlet"],
                   "date": row["date"], "pilot": row["pilot"] == "1"} for row in rows]
    self.ids = {item["news_id"] for item in self.items}
    self.context = JevContext()
    self.questions = json.loads((CORPUS_DIR / "questions.json").read_text(encoding = "utf-8"))
    self.candidates = self.load_candidates()
    self.store = AnswerStore(answers_path)
    self.bill_index: list[list] | None = None

  def load_candidates(self) -> dict[str, list[int]]:
    """Jev's candidates for each drawn news (ranker top-K plus bills named by number), in the ranker's order."""
    found: dict[str, dict[int, float]] = {news_id: {} for news_id in self.ids}
    with open(CORPUS_DIR / "candidates.csv", encoding = "utf-8", newline = "") as file:
      for row in csv.DictReader(file):
        if row["news_id"] in found:
          rank = float(row["rank"]) if row["rank"] else float("inf")
          bills = found[row["news_id"]]
          bills[int(row["bill"])] = min(rank, bills.get(int(row["bill"]), float("inf")))
    return {news_id: sorted(bills, key = bills.get) for news_id, bills in found.items()}

  def session(self) -> dict:
    return {"set": self.set_name, "items": self.items, "questions": self.questions, "roster": self.context.roster(),
            "max_chars": self.context.max_news_chars,
            "answers": {news_id: entry for news_id, entry in self.store.data["news"].items() if news_id in self.ids}}

  def news(self, news_id: str) -> dict:
    news, cut = self.context.news(news_id)
    return {"news_id": news_id, **news, "cut": cut,
            "candidates": [self.context.card(number) for number in self.candidates.get(news_id, [])]}

  def bills(self) -> list[list]:
    if self.bill_index is None:
      with self.context.lock:
        self.bill_index = [[number, name or ""] for number, name in
                           self.context.connection.execute("SELECT number, name FROM bills ORDER BY number")]
    return self.bill_index

  # ---- routes, shared with private_visuals/server.py (paths without any mount prefix: "/api/...")

  def get(self, path: str) -> tuple[int, object]:
    try:
      if path == "/api/session":
        return 200, self.session()
      if path == "/api/bills":
        return 200, self.bills()
      if path.startswith("/api/news/"):
        news_id = path.rsplit("/", 1)[1]
        if news_id not in self.ids:
          return 404, {"error": "this news is not in the draw"}
        return 200, self.news(news_id)
      if path.startswith("/api/card/"):
        return 200, self.context.card(int(path.rsplit("/", 1)[1]))
    except Exception as error:
      return 500, {"error": f"{type(error).__name__}: {error}"}
    return 404, {"error": "not found"}

  def post(self, path: str, body: bytes) -> tuple[int, object]:
    if not path.startswith("/api/answers/"):
      return 404, {"error": "not found"}
    news_id = path.rsplit("/", 1)[1]
    if news_id not in self.ids:
      return 404, {"error": "this news is not in the draw"}
    if not body:   # private_visuals/server.py passes an empty body when it is larger than MAX_BODY_BYTES
      return 400, {"error": "empty or too large body"}
    try:
      entry = json.loads(body)
    except ValueError:
      return 400, {"error": "invalid JSON"}
    if not isinstance(entry, dict):
      return 400, {"error": "the answers must be an object"}
    return 200, {"ok": True, "saved_at": self.store.save(news_id, entry)}
