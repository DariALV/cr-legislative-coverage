import argparse
import pathlib
from collections import Counter

from config import Config
from tools.sample_tools.sample_builder import SampleBuilder

if __name__ == "__main__":
  # Draw queue for the hand-labeled sample (#27, #28, #31). Same seed, same queue: labeling goes from the top down
  # until the quotas are met, so the labeled set is always a prefix of this file.
  #   python run_sample.py
  parser = argparse.ArgumentParser(description = "Builds the seeded draw queue for the hand-labeled sample.")
  parser.add_argument("--seed", type = int, default = Config.SAMPLE_SEED)
  parser.add_argument("--per-outlet", type = int, default = Config.SAMPLE_QUEUE_PER_OUTLET)
  args = parser.parse_args()

  builder = SampleBuilder(seed = args.seed)
  rows = builder.build(per_outlet = args.per_outlet)
  path = pathlib.Path(Config.SAMPLE_DIR) / "queue.csv"
  builder.save(rows, path)
  print(f"{len(rows)} rows -> {path}")
  print(Counter((row["outlet"], row["pool"]) for row in rows))
