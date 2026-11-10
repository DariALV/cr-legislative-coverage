import argparse
import json
import pathlib

from rich.console import Console

from config import Config
from tools.display_tools.run_log import setup_run_logging
from tools.llm_tools.jev_filter_runner import JevFilterRunner

if __name__ == "__main__":
  # Asks Jev the news-level filter question (assembly) about every news of the corpus (#43). The news whose
  # probability reaches the threshold go on to the ranker and the gate. Output in results/jev/<name>/.
  # The news are asked in a fixed random order, so --limit N is a random pilot; a cut run resumes where it stopped.
  #   python run_jev_filter.py --dry-run                 (counts the news left and estimates the cost, sends nothing)
  #   python run_jev_filter.py --limit 300 --cap 0.1     (pilot: the first 300 news of the random order)
  #   python run_jev_filter.py --cap 3                   (the rest of the corpus, at most $3 in this run)
  parser = argparse.ArgumentParser(description = "Ask Jev whether each news talks about the Assembly or a bill.")
  parser.add_argument("--name", default = "corpus_filter", help = "run folder inside results/jev/")
  parser.add_argument("--threshold", type = float, default = Config.JEV_FILTER_THRESHOLD)
  parser.add_argument("--cap", type = float, default = Config.JEV_COST_CAP_USD, help = "USD this run may spend")
  parser.add_argument("--threads", type = int, default = Config.JEV_THREADS)
  parser.add_argument("--limit", type = int, help = "only the first N news of the random order")
  parser.add_argument("--dry-run", action = "store_true")
  args = parser.parse_args()

  console = Console()
  log_path = setup_run_logging(console)
  runner = JevFilterRunner(pathlib.Path(Config.JEV_RESULTS_DIR) / args.name, threshold = args.threshold,
                           cost_cap_usd = args.cap, threads = args.threads, limit = args.limit)
  summary = runner.run(dry_run = args.dry_run)
  console.print(json.dumps(summary, indent = 2), highlight = False)
  console.print(f"Done. Log: {log_path}", highlight = False)
