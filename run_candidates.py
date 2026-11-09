import argparse
import pathlib

from rich.console import Console

from config import Config
from tools.display_tools.run_log import setup_run_logging
from tools.llm_tools.jev_runner import write_csv
from tools.retrieval_tools.candidate_ranker import CandidateRanker
from tools.sample_tools.sample_labels import read_labels

if __name__ == "__main__":
  # Top-K candidate bills of the evolved ranker (#33, #41, #68) for a set of news, written to
  # results/jev/<name>/candidates.csv for run_jev.py. Needs numpy, the embeddings (news_256_all.npz and the bill
  # vectors) and the cached gold features of databases/retrieval/, so it runs on the machine that has them.
  #   python run_candidates.py --name sample --labels Etiquetas.csv    (the news with "En la muestra" = Sí)
  #   python run_candidates.py --name probe --news-file ids.txt         (one news id per line)
  parser = argparse.ArgumentParser(description = "Top-K candidate bills of the evolved ranker for a set of news.")
  parser.add_argument("--name", required = True, help = "run folder inside results/jev/")
  source = parser.add_mutually_exclusive_group(required = True)
  source.add_argument("--labels", help = "CSV export of the Etiquetas tab of the labeling sheet")
  source.add_argument("--news-file", help = "text file with one news id per line")
  parser.add_argument("--k", type = int, default = Config.CANDIDATES_K)
  parser.add_argument("--recipe", default = Config.RANKER_RECIPE)
  args = parser.parse_args()

  console = Console()
  log_path = setup_run_logging(console)
  if args.labels:
    news_ids = [label.news_id for label in read_labels(args.labels) if label.in_sample]
  else:
    news_ids = [line.strip() for line in open(args.news_file, encoding = "utf-8") if line.strip()]
  rows = CandidateRanker(args.recipe).top_k(news_ids, args.k)
  output = pathlib.Path(Config.JEV_RESULTS_DIR) / args.name / "candidates.csv"
  output.parent.mkdir(parents = True, exist_ok = True)
  write_csv(output, rows)
  console.print(f"{len({r['news_id'] for r in rows})} news, {len(rows)} candidates -> {output}", highlight = False)
  console.print(f"Done. Log: {log_path}", highlight = False)
