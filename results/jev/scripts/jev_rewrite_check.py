"""
Old vs. rewritten fact_check and press_release (jev 2026-11-10). For every news of test100 with a match, one request
with the same state as the details stage (news, matched bills, deputies) and only these questions:
news_press_release_old, news_press_release, b<n>_fact_check_old, b<n>_fact_check. Old and new go in the same
request, so the only difference is the wording. Paid with the tests key. Output in results/jev/test100_rewrite/.
  python results/jev/scripts/jev_rewrite_check.py [--limit N]
"""
import argparse
import csv
import json
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))
from typesafe_sdk import Noul  # noqa: E402

from tools.llm_tools.jev import Jev, bill_key  # noqa: E402
from tools.llm_tools.jev_context import JevContext  # noqa: E402
from tools.llm_tools.jev_questions import news_detail_questions  # noqa: E402


def fact_check_question(bill: str) -> Noul:
  """The rewritten fact_check that was measured here; dropped from jev_questions afterwards (jev 2026-11-10)."""
  return Noul(
    instructions = f"Does `news` itself, in the outlet's or the journalist's own voice, check a specific claim about "
                   f"{bill} against evidence and say whether it holds?",
    criteria = {
      "true": f"The article's own narration, not a person or body it quotes, says that a claim about {bill} is "
              f"false, inaccurate, misleading or contradicted, or confirms it, and points to evidence: the file's "
              f"text, vote records, earlier statements, or data the outlet gathered. The claim can come from anyone, "
              f"including the file's own exposition of motives. An unsigned editorial counts as the outlet's voice.",
      "false": "One actor calls another a liar or rebuts them and the article only reports both sides; an "
               "institution, court, expert body or association objects, warns or corrects and the article only "
               "relays it; a person explains or defends their own vote or motion; an opinion column signed by "
               "someone argues for or against the file; the article explains what the file does without "
               f"contrasting it with a prior claim; or the checked claim is about another file or a general topic "
               f"and {bill} only appears as an example or a data point."})

RUN = pathlib.Path("results/jev/test100")
OUT = pathlib.Path("results/jev/test100_rewrite")

def old_question(stage: str, name: str, key: str | None = None) -> Noul:
  data = dict(json.loads((RUN / "questions.json").read_text(encoding = "utf-8"))[stage][name])
  data.pop("type")
  if key:
    data = json.loads(json.dumps(data).replace("b<number>", key))
  return Noul(**data)

def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--limit", type = int)
  args = parser.parse_args()
  matched: dict[str, list[int]] = {}
  for row in csv.DictReader(open(RUN / "gate.csv", encoding = "utf-8")):
    if row["match"] == "1":
      matched.setdefault(row["news_id"], []).append(int(row["bill"]))
  news_ids = list(matched)[:args.limit] if args.limit else list(matched)
  OUT.mkdir(parents = True, exist_ok = True)
  answers_path = OUT / "answers.jsonl"
  done = set()
  if answers_path.exists():
    done = {json.loads(line)["news_id"] for line in open(answers_path, encoding = "utf-8") if line.strip()}
  context, jev = JevContext(), Jev("tests")

  def ask(news_id: str) -> dict:
    news, cut = context.news(news_id)
    cards = [context.card(n) for n in matched[news_id]]
    questions = {"news_press_release_old": old_question("details_news", "press_release"),
                 "news_press_release": news_detail_questions()["press_release"]}
    for card in cards:
      key = bill_key(card["number"])
      questions[f"{key}_fact_check_old"] = old_question("details", "fact_check", key)
      questions[f"{key}_fact_check"] = fact_check_question(f"`bills.{key}`")
    state = {"news": news, "bills": {bill_key(c["number"]): c for c in cards}, "deputies": context.roster()}
    return {"news_id": news_id, **asdict(jev.ask("rewrite_check", state, questions)), "cut": cut}

  with ThreadPoolExecutor(3) as pool, answers_path.open("a", encoding = "utf-8") as handle:
    for record in pool.map(ask, [n for n in news_ids if n not in done]):
      handle.write(json.dumps(record, ensure_ascii = False) + "\n")
  records = [json.loads(line) for line in open(answers_path, encoding = "utf-8") if line.strip()]
  tokens = sum(r["input_tokens"] for r in records)
  print(f"{len(records)} requests, {tokens:,} input tokens (~${tokens * 0.042 / 1e6:.4f})")

if __name__ == "__main__":
  main()
