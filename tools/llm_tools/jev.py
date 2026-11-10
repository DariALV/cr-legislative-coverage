import datetime
import os
import time
from dataclasses import dataclass, field

from dotenv import load_dotenv
from typesafe_sdk import RetryPolicy, TypeSafeClient

from config import Config
from tools.llm_tools.jev_questions import (NEWS_KEY, detail_questions, filter_questions, gate_questions, genre_question,
                                           news_detail_questions)

KEY_ENV = "TYPESAFE_API_KEY_{}"   # one key per stage in .env (tests, filter, gate, details), so each one's spend shows
                                   # apart in the console (jev 2026-11-10)
SKIPPED_HEADERS = {"set-cookie"}

@dataclass
class JevResponse:
  """One answered request, with everything the API sent back. answers maps each question name (b<number>_<question>,
  news_<question> or genre) to the answer as the SDK parsed it: {"type": "noul", "noul": p}, {"type": "choice",
  "choice": c, "confidence": x, "probabilities": {...}} or {"type": "score", "score": s, "confidence": x, "legend":
  {...}, "probabilities": {...}}. raw is the response body as the API sent it, before the SDK drops anything."""
  stage: str            # filter, gate or details
  model: str            # model name the API reports having used
  input_tokens: int
  answers: dict
  output_tokens: int | None = None
  key: str = ""         # which .env key paid for it (tests, filter, gate or details)
  requested_at: str = ""   # UTC, ISO 8601
  elapsed_s: float = 0.0   # wall time of the call, retries included
  headers: dict = field(default_factory = dict)
  raw: dict | None = None

def bill_key(number: int) -> str:
  return f"b{int(number)}"

def merge_responses(responses: list[JevResponse]) -> JevResponse:
  """Several requests of one stage for the same news as one response: answers joined, tokens and time added, and
  the raw bodies and headers kept as lists, one per request in order."""
  first = responses[0]
  answers = {name: answer for response in responses for name, answer in response.answers.items()}
  return JevResponse(first.stage, first.model, sum(r.input_tokens for r in responses), answers,
                     output_tokens = sum(r.output_tokens or 0 for r in responses), key = first.key,
                     requested_at = first.requested_at, elapsed_s = round(sum(r.elapsed_s for r in responses), 3),
                     headers = {"batches": [r.headers for r in responses]},
                     raw = {"batches": [r.raw for r in responses]})

class Jev:
  """
  Asks Jev (TypeSafe's System One model) about one news and a set of bills (#10, #34). Only talks to the API: it
  gets the news, the bill cards and the deputies already built (see JevContext) and returns the answers; it reads
  no database and writes no file. key picks the API key: TYPESAFE_API_KEY_<KEY> in .env.
    gate(news, cards):              explicit and implicit for every card, plus the genre of the news
    details(news, cards, deputies): the detail questions of jev_questions for every card, plus the news-level ones
    filter(news):                   the broad news-level question (assembly), asked over the whole corpus first
  """

  def __init__(self, key: str, model: str = Config.JEV_MODEL, client: TypeSafeClient | None = None):
    load_dotenv()
    self.key = key
    self.model = model
    if client is None:
      env = KEY_ENV.format(key.upper())
      api_key = os.environ.get(env)
      if not api_key:
        raise RuntimeError(f"{env} is not set in .env")
      # a gate request carries ~150 questions; the default 30 s per attempt is too tight for it
      client = TypeSafeClient(api_key = api_key, model = model, retry = RetryPolicy(max_retries = 4, timeout = 300))
    self.client = client

  def gate(self, news: dict, cards: list[dict]) -> JevResponse:
    questions = {"genre": genre_question()}
    for card in cards:
      key = bill_key(card["number"])
      questions |= {f"{key}_{name}": question for name, question in gate_questions(key).items()}
    state = {"news": news, "candidates": {bill_key(c["number"]): c for c in cards}}
    return self.ask("gate", state, questions)

  def details(self, news: dict, cards: list[dict], deputies: list[dict]) -> JevResponse:
    """One request per batch of Config.JEV_DETAILS_BATCH bills: a request with 21 or more bills went over Jev's
    ~64k tokens (max_tokens_exceeded, jev 2026-11-10). The news-level questions go only in the first batch, and the
    batches are merged into one response, so callers see a single details answer per news."""
    batches = [cards[i:i + Config.JEV_DETAILS_BATCH] for i in range(0, len(cards), Config.JEV_DETAILS_BATCH)]
    responses = []
    for index, batch in enumerate(batches):
      questions = ({f"{NEWS_KEY}_{name}": question for name, question in news_detail_questions().items()}
                   if index == 0 else {})
      for card in batch:
        key = bill_key(card["number"])
        questions |= {f"{key}_{name}": question for name, question in detail_questions(key).items()}
      state = {"news": news, "bills": {bill_key(c["number"]): c for c in batch}, "deputies": deputies}
      responses.append(self.ask("details", state, questions))
    return responses[0] if len(responses) == 1 else merge_responses(responses)

  def filter(self, news: dict) -> JevResponse:
    return self.ask("filter", {"news": news}, filter_questions())

  def ask(self, stage: str, state: dict, questions: dict) -> JevResponse:
    requested_at = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec = "seconds")
    start = time.perf_counter()
    response = self.client.system_one(state = state, questions = questions, model = self.model)
    elapsed = round(time.perf_counter() - start, 3)
    answers = {name: answer.model_dump(mode = "json") for name, answer in response.answers.items()}
    http = response.raw_http_response
    try:
      raw = http.json()
    except ValueError:
      raw = {"undecoded": http.text}
    headers = {k: v for k, v in http.headers.items() if k.lower() not in SKIPPED_HEADERS}
    return JevResponse(stage, response.model, response.usage.input_tokens or 0, answers,
                       output_tokens = response.usage.output_tokens, key = self.key, requested_at = requested_at,
                       elapsed_s = elapsed, headers = headers, raw = raw)
