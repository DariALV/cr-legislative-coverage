import argparse
import json
import pathlib
from collections import Counter

from config import Config
from tools.sample_tools.human_eval_analysis import HumanEvalAnalysis
from tools.sample_tools.human_eval_draw import HumanEvalDraw

if __name__ == "__main__":
  # Blind evaluation of Jev's answers. The news are answered in the local page private_visuals/jev_eval/ (server.py),
  # which reads the draw and writes answers.json.
  #   python run_human_eval.py draw                          draws the news (pilot first, then balanced blocks)
  #   python run_human_eval.py draw --force --keep-answered  draws again, keeping the news already answered first
  #   python run_human_eval.py analyze                       compares the hand answers with Jev's (analysis/)
  parser = argparse.ArgumentParser(description = "Blind evaluation of Jev's answers: draw the news, analyze the answers.")
  commands = parser.add_subparsers(dest = "command", required = True)
  draw_parser = commands.add_parser("draw", help = "draws the news to answer by hand")
  draw_parser.add_argument("--seed", type = int, default = Config.HUMAN_EVAL_SEED)
  draw_parser.add_argument("--max-chars", type = int, default = Config.HUMAN_EVAL_MAX_CHARS,
                           help = "longest news content allowed; longer news are left to Claude")
  draw_parser.add_argument("--pilot", type = int, default = Config.HUMAN_EVAL_PILOT, help = "pilot news (the first rows)")
  draw_parser.add_argument("--keep-answered", action = "store_true",
                           help = "keep the news already answered in full, first and in their order")
  draw_parser.add_argument("--force", action = "store_true",
                           help = "draw again over an existing draw; the old one is kept as draw_v<n>.csv")
  commands.add_parser("analyze", help = "compares the hand answers with Jev's and writes analysis/")
  args = parser.parse_args()
  folder = pathlib.Path(Config.HUMAN_EVAL_DIR)

  if args.command == "draw":
    path = folder / "draw.csv"
    keep: list[str] = []
    if path.exists():
      if not args.force:
        raise SystemExit(f"{path} already exists; use --force to draw again")
      answers_path = folder / "answers.json"
      if args.keep_answered and answers_path.exists():
        answers = json.loads(answers_path.read_text(encoding = "utf-8"))["news"]
        with open(path, encoding = "utf-8") as file:
          keep = [line.split(",")[1] for line in file.read().splitlines()[1:]
                  if answers.get(line.split(",")[1], {}).get("complete")]
      version = 1
      while (folder / f"draw_v{version}.csv").exists():
        version += 1
      path.rename(folder / f"draw_v{version}.csv")
      print(f"previous draw kept as draw_v{version}.csv; {len(keep)} answered news kept first")
    builder = HumanEvalDraw(seed = args.seed, max_chars = args.max_chars)
    pools = builder.pools(exclude = set(keep))
    print("eligible by group and outlet:", {f"{group}/{outlet}": len(ids) for (group, outlet), ids in sorted(pools.items())})
    rows = builder.draw(pilot = args.pilot, keep = keep)
    builder.save(rows, path)
    print(f"{len(rows)} news -> {path} ({sum(row['pilot'] for row in rows)} in the pilot)")
    print("by outlet:", dict(sorted(Counter(row["outlet"] for row in rows).items())))
  else:
    summary = HumanEvalAnalysis().run()
    print(json.dumps({key: value for key, value in summary.items() if key != "by_question"}, indent = 1))
    print("disagreements by question:", {question: f"{stats['agree']}/{stats['n']}"
                                         for question, stats in summary["by_question"].items() if stats["agree"] < stats["n"]})
