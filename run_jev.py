import argparse
import json
import pathlib

from rich.console import Console

from config import Config
from tools.display_tools.run_log import setup_run_logging
from tools.llm_tools.jev_runner import JevRunner

if __name__ == "__main__":
  # Asks Jev about the candidates of each news (#34, #39, #43): the gate for all K candidates, then the detail
  # questions only for the matches. Input: a candidates.csv from run_candidates.py. Output in results/jev/<name>/.
  # A cut run resumes where it stopped (answers.jsonl), and nothing already answered is asked again.
  #   python run_jev.py --name sample                  (reads results/jev/sample/candidates.csv)
  #   python run_jev.py --name sample --limit 3        (first 3 news only, to try it)
  #   python run_jev.py --name sample --dry-run        (counts the requests left, sends nothing)
  #   python run_jev.py --name corpus --cap 15         (spend at most $15 in this run)
  parser = argparse.ArgumentParser(description = "Ask Jev about the ranker's candidates of each news.")
  parser.add_argument("--name", required = True, help = "run folder inside results/jev/")
  parser.add_argument("--candidates", help = "candidates CSV (default: results/jev/<name>/candidates.csv)")
  parser.add_argument("--threshold", type = float, default = Config.JEV_MATCH_THRESHOLD)
  parser.add_argument("--cap", type = float, default = Config.JEV_COST_CAP_USD, help = "USD this run may spend")
  parser.add_argument("--threads", type = int, default = Config.JEV_THREADS)
  parser.add_argument("--limit", type = int, help = "only the first N news")
  parser.add_argument("--dry-run", action = "store_true")
  args = parser.parse_args()

  console = Console()
  log_path = setup_run_logging(console)
  output_dir = pathlib.Path(Config.JEV_RESULTS_DIR) / args.name
  runner = JevRunner(args.candidates or output_dir / "candidates.csv", output_dir, threshold = args.threshold,
                     cost_cap_usd = args.cap, threads = args.threads, limit = args.limit)
  summary = runner.run(dry_run = args.dry_run)
  console.print(json.dumps(summary, indent = 2), highlight = False)
  console.print(f"Done. Log: {log_path}", highlight = False)
