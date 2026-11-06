import logging
import pathlib
from datetime import datetime

from rich.console import Console
from rich.logging import RichHandler

def setup_run_logging(console: Console, folder: str = "logs") -> pathlib.Path:
  """
  Logger "cr" for a run: everything (INFO and up) goes to <folder>/run_<date>_<time>.log, and warnings and
  errors also go to the console, above the progress bars when the console is the one of a live ProgressBoard.
  Returns the log file path.
  """
  path: pathlib.Path = pathlib.Path(folder) / f"run_{datetime.now():%Y-%m-%d_%H%M%S}.log"
  path.parent.mkdir(parents = True, exist_ok = True)

  file_handler = logging.FileHandler(path, encoding = "utf-8")
  file_handler.setLevel(logging.INFO)
  file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(threadName)-10s %(message)s"))

  console_handler = RichHandler(console = console, level = logging.WARNING, show_time = False, show_path = False,
                                markup = False, rich_tracebacks = False)

  logger = logging.getLogger("cr")
  logger.setLevel(logging.INFO)
  logger.propagate = False
  logger.handlers.clear()
  logger.addHandler(file_handler)
  logger.addHandler(console_handler)
  return path
