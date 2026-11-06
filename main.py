from dotenv import load_dotenv

load_dotenv()

from pipeline import Pipeline

if __name__ == "__main__":
  # Full run: news inside Config.DATA_PERIOD and every bill on Delfino from Config.FIRST_BILL until
  # MAX_CONSECUTIVE_ERRORS errors in a row. Cached HTMLs are reused, so an interrupted run resumes.
  # After an interrupted run, scrap_urls = False reuses the collected urls in raw/links.
  Pipeline().scrap_and_save(scrap_urls = True, scrap_new_htmls = True)
