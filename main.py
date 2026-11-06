from dotenv import load_dotenv

load_dotenv()

from rich.console import Console

from pipeline import Pipeline
from tools.display_tools.progress import ProgressBoard
from tools.display_tools.run_log import setup_run_logging

if __name__ == "__main__":
  # Full run: news inside Config.DATA_PERIOD and every bill on Delfino from Config.FIRST_BILL until
  # MAX_CONSECUTIVE_ERRORS errors in a row. Cached HTMLs are reused, so an interrupted run resumes.
  # After an interrupted run, scrap_urls = False reuses the collected urls in raw/links.
  # Start it without redirecting the output: the bars go to the terminal and the full log to logs/.
  console = Console()
  log_path = setup_run_logging(console)
  console.print(f"Log: {log_path}", highlight = False)
  with ProgressBoard("full run", console = console) as board:
    Pipeline(board).scrap_and_save(scrap_urls = True, scrap_new_htmls = True)
  console.print(f"Done. Log: {log_path}", highlight = False)
