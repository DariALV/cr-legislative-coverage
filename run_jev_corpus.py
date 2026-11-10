import argparse
import csv
import json
import pathlib

from rich.console import Console

from config import Config
from run_candidates import explicit_report
from tools.display_tools.progress import ProgressBoard
from tools.display_tools.run_log import setup_run_logging
from tools.llm_tools.jev_runner import JevRunner, write_csv
from tools.retrieval_tools.candidate_ranker import CandidateRanker
from tools.retrieval_tools.explicit_mentions import ExplicitMentions

def passing_news(filter_path: pathlib.Path) -> list[str]:
  with filter_path.open(encoding = "utf-8") as handle:
    return [row["news_id"] for row in csv.DictReader(handle) if row["passes"] == "1"]

def build_candidates(news_ids: list[str], output_dir: pathlib.Path, k: int, console: Console):
  """Top-K of the ranker plus the bills each news names by number (run_candidates.py does the same per set)."""
  mentions = ExplicitMentions().for_news(news_ids)
  rows = CandidateRanker().top_k(news_ids, k, forced = mentions)
  write_csv(output_dir / "candidates.csv", rows)
  report = explicit_report(rows, mentions, k)
  (output_dir / "candidates_report.json").write_text(json.dumps(report, indent = 2), encoding = "utf-8")
  console.print(f"candidates: {report['news']} news, {len(rows)} rows; named by number {report['bills_named']} "
                f"({report['added']} added outside the top-{k})", highlight = False)

if __name__ == "__main__":
  # The whole corpus run of Jev in one command (#43): the news that passed the Jev filter (results/jev/corpus_filter/
  # filter.csv) → candidates (ranker top-K ∪ bills named by number) → gate, paid with TYPESAFE_API_KEY_GATE →
  # details of the matches, paid with TYPESAFE_API_KEY_DETAILS. Output in results/jev/<name>/. Every step resumes:
  # the candidates are built once, and answers.jsonl keeps every answered request, so after a cut or an API error
  # running the same command again continues where it stopped. Each stage stops once it spends its cap.
  #   python run_jev_corpus.py --dry-run     (builds the candidates if missing and counts the requests; sends nothing)
  #   python run_jev_corpus.py               (the full run)
  parser = argparse.ArgumentParser(description = "Run the Jev gate and details over the news that passed the filter.")
  parser.add_argument("--name", default = "corpus", help = "run folder inside results/jev/")
  parser.add_argument("--filter-run", default = "corpus_filter", help = "folder of the filter run")
  parser.add_argument("--k", type = int, default = Config.CANDIDATES_K)
  parser.add_argument("--gate-cap", type = float, default = 12.0, help = "USD the gate may spend in this run")
  parser.add_argument("--details-cap", type = float, default = 3.0, help = "USD the details may spend in this run")
  parser.add_argument("--threads", type = int, default = Config.JEV_THREADS)
  parser.add_argument("--dry-run", action = "store_true")
  args = parser.parse_args()

  console = Console()
  log_path = setup_run_logging(console)
  results = pathlib.Path(Config.JEV_RESULTS_DIR)
  output_dir = results / args.name
  output_dir.mkdir(parents = True, exist_ok = True)
  news_ids = passing_news(results / args.filter_run / "filter.csv")
  console.print(f"{len(news_ids)} news passed the filter", highlight = False)
  if not (output_dir / "candidates.csv").exists():
    build_candidates(news_ids, output_dir, args.k, console)
  for stage, cap in [("gate", args.gate_cap), ("details", args.details_cap)]:
    with ProgressBoard(f"Jev {stage} (key {stage}, cap ${cap})", console = console) as board:
      runner = JevRunner(output_dir / "candidates.csv", output_dir, cost_cap_usd = cap, threads = args.threads,
                         stage = stage, board = board)
      summary = runner.run(dry_run = args.dry_run)
    console.print(f"[{stage}] " + json.dumps({k: v for k, v in summary.items() if not isinstance(v, list)}),
                  highlight = False)
  console.print(f"Done. Log: {log_path}", highlight = False)
