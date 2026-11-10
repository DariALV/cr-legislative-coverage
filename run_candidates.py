import argparse
import json
import pathlib

from rich.console import Console

from config import Config
from tools.display_tools.run_log import setup_run_logging
from tools.llm_tools.jev_runner import write_csv
from tools.retrieval_tools.candidate_ranker import CandidateRanker
from tools.retrieval_tools.explicit_mentions import ExplicitMentions
from tools.sample_tools.sample_labels import read_labels

def explicit_report(rows: list[dict], mentions: dict[str, list[int]], k: int) -> dict:
  """How many bills the news name by number, how many the ranker already had in its top-K, and the ones added."""
  named = [r for r in rows if r["named"]]
  added = [r for r in named if r["source"] == "explicit"]
  return {"k": k, "news": len({r["news_id"] for r in rows}), "news_naming_bills": len(mentions),
          "bills_named": len(named), "named_in_top_k": len(named) - len(added), "added": len(added),
          "added_rows": [{"news_id": r["news_id"], "bill": r["bill"], "ranker_rank": r["rank"]} for r in added]}

if __name__ == "__main__":
  # Top-K candidate bills of the evolved ranker (#33, #41, #68) for a set of news, written to
  # results/jev/<name>/candidates.csv for run_jev.py, plus every bill the news names by its expediente number
  # (source "explicit", with the rank the ranker gave it; ranker 2026-11-10). candidates_report.json says how many
  # were named, how many the ranker already had and which were added. Needs numpy, the embeddings
  # (news_256_all.npz and the bill vectors) and the cached gold features of databases/retrieval/.
  #   python run_candidates.py --name sample --labels Etiquetas.csv    (the news with "En la muestra" = Sí)
  #   python run_candidates.py --name probe --news-file ids.txt         (one news id per line)
  #   python run_candidates.py --name probe --news-file ids.txt --no-explicit   (the top-K alone)
  parser = argparse.ArgumentParser(description = "Top-K candidate bills of the evolved ranker for a set of news.")
  parser.add_argument("--name", required = True, help = "run folder inside results/jev/")
  source = parser.add_mutually_exclusive_group(required = True)
  source.add_argument("--labels", help = "CSV export of the Etiquetas tab of the labeling sheet")
  source.add_argument("--news-file", help = "text file with one news id per line")
  parser.add_argument("--k", type = int, default = Config.CANDIDATES_K)
  parser.add_argument("--recipe", default = Config.RANKER_RECIPE)
  parser.add_argument("--no-explicit", action = "store_true", help = "do not add the bills named by number")
  args = parser.parse_args()

  console = Console()
  log_path = setup_run_logging(console)
  if args.labels:
    news_ids = [label.news_id for label in read_labels(args.labels) if label.in_sample]
  else:
    news_ids = [line.strip() for line in open(args.news_file, encoding = "utf-8") if line.strip()]
  mentions = {} if args.no_explicit else ExplicitMentions().for_news(news_ids)
  rows = CandidateRanker(args.recipe).top_k(news_ids, args.k, forced = mentions)
  output = pathlib.Path(Config.JEV_RESULTS_DIR) / args.name / "candidates.csv"
  output.parent.mkdir(parents = True, exist_ok = True)
  write_csv(output, rows)
  report = explicit_report(rows, mentions, args.k)
  (output.parent / "candidates_report.json").write_text(json.dumps(report, indent = 2), encoding = "utf-8")
  console.print(f"{report['news']} news, {len(rows)} candidates -> {output}", highlight = False)
  console.print(f"named by number: {report['bills_named']} ({report['named_in_top_k']} already in the top-{args.k}, "
                f"{report['added']} added)", highlight = False)
  console.print(f"Done. Log: {log_path}", highlight = False)
