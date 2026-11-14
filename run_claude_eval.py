import argparse
import csv
import json
import pathlib

from config import Config
from tools.sample_tools.claude_eval_batch import ClaudeEvalBatch

BATCH_DIR = "raw/claude_eval"                       # batches hold news text: outside git
RESULTS_DIR = f"{Config.JEV_RESULTS_DIR}/claude_eval"   # ids and options only, kept in git

def check(entry: dict, questions: dict) -> tuple[dict, list[str]]:
  """The entry in the same shape as the person's answers, and what was wrong with it."""
  problems: list[str] = []

  def valid(spec: dict, value) -> bool:
    if spec["type"] == "noul":
      return isinstance(value, bool)
    if spec["type"] == "score":
      return isinstance(value, int) and not isinstance(value, bool) and 0 <= value < len(spec["criteria"])
    return value in spec["criteria"]

  genre = entry.get("genre")
  if not valid(questions["gate"]["genre"], genre):
    problems.append(f"genre {genre!r}")
  bills = {}
  for number, bill in (entry.get("bills") or {}).items():
    if not str(number).isdigit() or bill.get("mention") not in ("explicit", "implicit"):
      problems.append(f"file {number!r} mention {bill.get('mention')!r}")
      continue
    answers = {key: value for key, value in (bill.get("answers") or {}).items()
               if key in questions["details"] and valid(questions["details"][key], value)}
    missing = [key for key in questions["details"] if key not in answers]
    if missing:
      problems.append(f"file {number}: missing or invalid {missing}")
    bills[str(number)] = {"mention": bill["mention"], "added": False, "answers": answers}
  news_answers = {key: value for key, value in (entry.get("news_answers") or {}).items()
                  if key in questions["details_news"] and valid(questions["details_news"][key], value)}
  if bills and len(news_answers) < len(questions["details_news"]):
    problems.append(f"news answers: {len(news_answers)} of {len(questions['details_news'])}")
  if not bills:
    news_answers = {}
  complete = not problems
  clean = {"genre": genre if valid(questions["gate"]["genre"], genre) else None, "candidates_done": True, "bills": bills,
           "news_answers": news_answers, "doubtful": [item for item in entry.get("doubtful") or [] if isinstance(item, str)],
           "note": str(entry.get("note") or "")[:300], "outside_list": str(entry.get("outside_list") or "")[:300],
           "complete": complete}
  return clean, problems

if __name__ == "__main__":
  # Claude as a second blind reader of Jev's questions, under the same rules a person gets in the answering page.
  # Subagents read raw/claude_eval/batch_NN.md and write raw/claude_eval/out_NN.json; collect checks the answers and
  # merges them into results/jev/claude_eval/answers.json, in the same shape as the person's answers.
  #   python run_claude_eval.py batches --first 30 --size 10
  #   python run_claude_eval.py collect
  parser = argparse.ArgumentParser(description = "Claude as a second blind reader of Jev's questions.")
  commands = parser.add_subparsers(dest = "command", required = True)
  batches = commands.add_parser("batches", help = "writes the batch files for the first rows of the hand draw")
  batches.add_argument("--first", type = int, default = 30, help = "rows of results/jev/human_eval/draw.csv")
  batches.add_argument("--size", type = int, default = 10, help = "news per batch (one subagent each)")
  commands.add_parser("collect", help = "checks the subagents' answers and merges them")
  args = parser.parse_args()

  if args.command == "batches":
    with open(pathlib.Path(Config.HUMAN_EVAL_DIR) / "draw.csv", encoding = "utf-8", newline = "") as file:
      ids = [row["news_id"] for row in csv.DictReader(file)][:args.first]
    for path in ClaudeEvalBatch(BATCH_DIR).write(ids, args.size):
      print(f"{path} ({path.stat().st_size // 1024} KB)")
  else:
    questions = json.loads((pathlib.Path(Config.JEV_RESULTS_DIR) / "corpus" / "questions.json").read_text(encoding = "utf-8"))
    merged: dict[str, dict] = {}
    for path in sorted(pathlib.Path(BATCH_DIR).glob("out_*.json")):
      for news_id, entry in json.loads(path.read_text(encoding = "utf-8"))["news"].items():
        clean, problems = check(entry, questions)
        merged[news_id] = clean
        if problems:
          print(f"{path.name} {news_id[:10]}: {'; '.join(problems)}")
    out = pathlib.Path(RESULTS_DIR)
    out.mkdir(parents = True, exist_ok = True)
    (out / "answers.json").write_text(json.dumps({"news": merged}, ensure_ascii = False, indent = 1), encoding = "utf-8")
    print(f"{len(merged)} news ({sum(entry['complete'] for entry in merged.values())} complete) -> {out / 'answers.json'}")
