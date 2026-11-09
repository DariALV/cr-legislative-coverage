from dataclasses import dataclass

from dotenv import load_dotenv
from typesafe_sdk import RetryPolicy, TypeSafeClient

from config import Config
from tools.llm_tools.jev_questions import detail_questions, gate_questions, genre_question

@dataclass
class JevResponse:
  """One answered request. answers maps each question name (b<number>_<question>, or genre) to the answer as the API
  returned it: {"type": "noul", "noul": p}, {"type": "choice", "probabilities": {...}, ...} or {"type": "score",
  "score": s, "probabilities": {...}, ...}."""
  stage: str            # gate or details
  model: str            # model name the API reports having used
  input_tokens: int
  answers: dict

def bill_key(number: int) -> str:
  return f"b{int(number)}"

class Jev:
  """
  Asks Jev (TypeSafe's System One model) about one news and a set of bills (#10, #34). Only talks to the API: it
  gets the news, the bill cards and the deputies already built (see JevContext) and returns the answers; it reads
  no database and writes no file. The API key comes from TYPESAFE_API_KEY in .env.
    gate(news, cards):              explicit, implicit and same_topic for every card, plus the genre of the news
    details(news, cards, deputies): the detail questions of jev_questions for every card
  """

  def __init__(self, model: str = Config.JEV_MODEL, client: TypeSafeClient | None = None):
    load_dotenv()
    self.model = model
    # a gate request carries ~150 questions; the default 30 s per attempt is too tight for it
    self.client = client or TypeSafeClient(model = model, retry = RetryPolicy(max_retries = 4, timeout = 300))

  def gate(self, news: dict, cards: list[dict]) -> JevResponse:
    questions = {"genre": genre_question()}
    for card in cards:
      key = bill_key(card["number"])
      questions |= {f"{key}_{name}": question for name, question in gate_questions(key).items()}
    state = {"news": news, "candidates": {bill_key(c["number"]): c for c in cards}}
    return self.ask("gate", state, questions)

  def details(self, news: dict, cards: list[dict], deputies: list[dict]) -> JevResponse:
    questions = {}
    for card in cards:
      key = bill_key(card["number"])
      questions |= {f"{key}_{name}": question for name, question in detail_questions(key).items()}
    state = {"news": news, "bills": {bill_key(c["number"]): c for c in cards}, "deputies": deputies}
    return self.ask("details", state, questions)

  def ask(self, stage: str, state: dict, questions: dict) -> JevResponse:
    response = self.client.system_one(state = state, questions = questions, model = self.model)
    answers = {name: answer.model_dump(mode = "json") for name, answer in response.answers.items()}
    return JevResponse(stage, response.model, response.usage.input_tokens or 0, answers)
