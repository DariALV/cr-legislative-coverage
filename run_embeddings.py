import argparse

from rich.console import Console

from config import Config
from tools.display_tools.progress import ProgressBoard
from tools.display_tools.run_log import setup_run_logging
from tools.embedding_tools.embedding_runner import BILL_VARIANTS, EmbeddingRunner
from tools.retrieval_tools.feature_builder import background_news_ids

if __name__ == "__main__":
  # Embeds everything still missing for one model (#32): the gold news in every chunk size and every bill in every
  # variant, one .npz per run in databases/embeddings/<model>/. Finished runs are skipped, so rerun it after a cut.
  #   python run_embeddings.py --model bge-m3
  #   python run_embeddings.py --model qwen3-0.6b --only news --sizes 256 512
  # --background embeds instead the fixed background sample of legislative news used for the ranker z-scores (#68):
  #   python run_embeddings.py --model qwen3-0.6b --background
  # --all-news embeds every news article (29.9k, ~129k chunks at 256 tokens, ~75 min on an RTX 2060):
  #   python run_embeddings.py --model qwen3-0.6b --all-news
  parser = argparse.ArgumentParser(description = "Embed the gold news and all bills for one model.")
  parser.add_argument("--model", required = True, choices = list(Config.EMBEDDING_MODELS))
  parser.add_argument("--only", choices = ["news", "bills"], help = "run only one side")
  parser.add_argument("--sizes", type = int, nargs = "+", default = Config.EMBEDDING_CHUNK_SIZES,
                      help = "news chunk sizes in tokens, title included")
  parser.add_argument("--overlap", type = int, default = 0, help = "tokens shared by consecutive news chunks")
  parser.add_argument("--variants", nargs = "+", choices = BILL_VARIANTS, default = BILL_VARIANTS)
  parser.add_argument("--tokens-per-batch", type = int, default = Config.EMBEDDING_TOKENS_PER_BATCH,
                      help = "lower it if the GPU runs out of memory (batches are also split on their own)")
  parser.add_argument("--background", action = "store_true",
                      help = f"embed the background sample (news_<size>_background.npz) at {Config.RETRIEVAL_CHUNK_SIZE} "
                             "tokens (or --sizes) instead of the gold news; no bills")
  parser.add_argument("--all-news", action = "store_true",
                      help = f"embed every news article, gold included (news_<size>_all.npz), at "
                             f"{Config.RETRIEVAL_CHUNK_SIZE} tokens (or --sizes) instead of the gold news; no bills")
  args = parser.parse_args()
  if args.background and args.all_news:
    parser.error("--background and --all-news are different news sets, pick one")

  console = Console()
  log_path = setup_run_logging(console)
  console.print(f"Log: {log_path}", highlight = False)
  with ProgressBoard(f"embeddings {args.model}", console = console) as board:
    runner = EmbeddingRunner(args.model, board, tokens_per_batch = args.tokens_per_batch)
    if args.background or args.all_news:
      sizes = args.sizes if args.sizes != Config.EMBEDDING_CHUNK_SIZES else [Config.RETRIEVAL_CHUNK_SIZE]
      news_ids, tag = ((background_news_ids(runner.connection), "background") if args.background
                       else (runner.all_news_ids(), "all"))
      runner.run_all(sizes = sizes, overlap = args.overlap, bills = False, news_ids = news_ids, tag = tag)
    else:
      runner.run_all(sizes = args.sizes, overlap = args.overlap, variants = args.variants,
                     news = args.only != "bills", bills = args.only != "news")
  console.print(f"Done. Log: {log_path}", highlight = False)
