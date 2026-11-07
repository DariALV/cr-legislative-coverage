import argparse
import csv

from rich.console import Console
from rich.table import Table

from config import Config
from tools.display_tools.run_log import setup_run_logging
from tools.embedding_tools.embedding_analyzer import EmbeddingAnalyzer

if __name__ == "__main__":
  # Measures every embedding configuration against the gold links (#38, #33, #6): recall@K, hit@K, MRR, AUC, with
  # bootstrap intervals and strata. Configurations whose .npz files are missing are skipped, so it can run before
  # every model is done. Numbers go to results/embeddings/; the top-K of the best one to the embedding_cross page.
  #   python run_analysis.py
  #   python run_analysis.py --models bge-m3 --bootstrap 0
  parser = argparse.ArgumentParser(description = "Recall of the gold bills for every embedding configuration.")
  parser.add_argument("--models", nargs = "+", choices = list(Config.EMBEDDING_MODELS))
  parser.add_argument("--ks", type = int, nargs = "+", default = Config.EMBEDDING_KS)
  parser.add_argument("--bootstrap", type = int, default = Config.EMBEDDING_BOOTSTRAP, help = "0 skips the intervals")
  parser.add_argument("--rank-by", default = Config.EMBEDDING_RANK_BY,
                      help = "metric that picks the best configuration: recall@K, hit@K or mrr")
  parser.add_argument("--top", type = int, default = 50, help = "bills per news in the embedding_cross export")
  parser.add_argument("--no-export", action = "store_true", help = "don't write the embedding_cross data.js")
  args = parser.parse_args()

  console = Console()
  log_path = setup_run_logging(console)
  console.print(f"Log: {log_path}", highlight = False)
  analyzer = EmbeddingAnalyzer(args.models, ks = args.ks, bootstrap = args.bootstrap, rank_by = args.rank_by)
  with console.status("Analyzing embeddings..."):
    summary = analyzer.run(export_top = None if args.no_export else args.top)

  for path in summary["missing_files"]:
    console.print(f"[yellow]Missing:[/] {path}")
  with open(analyzer.output_dir / "comparison.csv", encoding = "utf-8") as file:
    rows = [r for r in csv.DictReader(file) if r["candidates"] == "all"][:15]
  columns = ["model", "size", "variant", "aggregation", "value", "best_minus_this", "share_best_ahead"]
  table = Table(title = f"Best configurations by {args.rank_by} (all candidates)")
  for column in columns:
    table.add_column(column, no_wrap = True)
  for row in rows:
    table.add_row(*[row.get(c) or "" for c in columns])
  console.print(table)
  console.print(f"Best: {summary['best']}", highlight = False)
  console.print(f"Results: {analyzer.output_dir}  Log: {log_path}", highlight = False)
