"""
Third round of detail questions on test100 (jev 2026-11-10): the rewritten voice_affected (next to the old wording,
in the same request) and the new own_evidence, next_step and source_count. One request per news of test100 with a
match, with the same state as the details stage. Paid with the tests key. Output in results/jev/test100_round3/.
  python results/jev/scripts/jev_round3_check.py [--limit N]
own_evidence and source_count were dropped from jev_questions after this run (jev 2026-11-10), so the script no
longer runs as it is; it stays as the record of what was asked.
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
from tools.llm_tools.jev_questions import detail_questions, news_detail_questions  # noqa: E402

RUN = pathlib.Path("results/jev/test100")
OUT = pathlib.Path("results/jev/test100_round3")
BILL_QUESTIONS = ["voice_affected", "own_evidence", "next_step"]

def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--limit", type = int)
  args = parser.parse_args()
  matched: dict[str, list[int]] = {}
  for row in csv.DictReader(open(RUN / "gate.csv", encoding = "utf-8")):
    if row["match"] == "1":
      matched.setdefault(row["news_id"], []).append(int(row["bill"]))
  news_ids = list(matched)[:args.limit] if args.limit else list(matched)
  old_affected = dict(json.loads((RUN / "questions.json").read_text(encoding = "utf-8"))["details"]["voice_affected"])
  old_affected.pop("type")
  OUT.mkdir(parents = True, exist_ok = True)
  answers_path = OUT / "answers.jsonl"
  done = set()
  if answers_path.exists():
    done = {json.loads(line)["news_id"] for line in open(answers_path, encoding = "utf-8") if line.strip()}
  context, jev = JevContext(), Jev("tests")

  def ask(news_id: str) -> dict:
    news, cut = context.news(news_id)
    cards = [context.card(n) for n in matched[news_id]]
    questions = {"news_source_count": news_detail_questions()["source_count"]}
    for card in cards:
      key = bill_key(card["number"])
      new = detail_questions(key)
      questions |= {f"{key}_{name}": new[name] for name in BILL_QUESTIONS}
      questions[f"{key}_voice_affected_old"] = Noul(**json.loads(json.dumps(old_affected).replace("b<number>", key)))
    state = {"news": news, "bills": {bill_key(c["number"]): c for c in cards}, "deputies": context.roster()}
    return {"news_id": news_id, **asdict(jev.ask("round3_check", state, questions)), "cut": cut}

  with ThreadPoolExecutor(3) as pool, answers_path.open("a", encoding = "utf-8") as handle:
    for record in pool.map(ask, [n for n in news_ids if n not in done]):
      handle.write(json.dumps(record, ensure_ascii = False) + "\n")
  records = [json.loads(line) for line in open(answers_path, encoding = "utf-8") if line.strip()]
  tokens = sum(r["input_tokens"] for r in records)
  print(f"{len(records)} requests, {tokens:,} input tokens (~${tokens * 0.042 / 1e6:.4f})")

if __name__ == "__main__":
  main()
