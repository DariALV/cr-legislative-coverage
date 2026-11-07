import argparse

from rich.console import Console

from config import Config
from tools.display_tools.progress import ProgressBoard
from tools.display_tools.run_log import setup_run_logging
from tools.embedding_tools.embedding_runner import BILL_VARIANTS, EmbeddingRunner

if __name__ == "__main__":
  # Embeds everything still missing for one model (#32): the gold news in every chunk size and every bill in every
  # variant, one .npz per run in databases/embeddings/<model>/. Finished runs are skipped, so rerun it after a cut.
  #   python run_embeddings.py --model bge-m3
  #   python run_embeddings.py --model qwen3-0.6b --only news --sizes 256 512
  parser = argparse.ArgumentParser(description = "Embed the gold news and all bills for one model.")
  parser.add_argument("--model", required = True, choices = list(Config.EMBEDDING_MODELS))
  parser.add_argument("--only", choices = ["news", "bills"], help = "run only one side")
  parser.add_argument("--sizes", type = int, nargs = "+", default = Config.EMBEDDING_CHUNK_SIZES,
                      help = "news chunk sizes in tokens, title included")
  parser.add_argument("--overlap", type = int, default = 0, help = "tokens shared by consecutive news chunks")
  parser.add_argument("--variants", nargs = "+", choices = BILL_VARIANTS, default = BILL_VARIANTS)
  parser.add_argument("--tokens-per-batch", type = int, default = Config.EMBEDDING_TOKENS_PER_BATCH,
                      help = "lower it if the GPU runs out of memory (batches are also split on their own)")
  args = parser.parse_args()

  console = Console()
  log_path = setup_run_logging(console)
  console.print(f"Log: {log_path}", highlight = False)
  with ProgressBoard(f"embeddings {args.model}", console = console) as board:
    runner = EmbeddingRunner(args.model, board, tokens_per_batch = args.tokens_per_batch)
    runner.run_all(sizes = args.sizes, overlap = args.overlap, variants = args.variants,
                   news = args.only != "bills", bills = args.only != "news")
  console.print(f"Done. Log: {log_path}", highlight = False)
