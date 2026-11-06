from datetime import datetime

from dotenv import load_dotenv

load_dotenv()

from config import DataPeriod
from pipeline import Pipeline

# Proof of concept: one week of news (Oct 24 to Oct 31, 2026) and the last 500 expedientes on Delfino
# (25897 was the latest one on Nov 5, 2026).
TEST_PERIOD = DataPeriod(datetime(2026, 10, 24), datetime(2026, 10, 31, 23, 59, 59))
FIRST_TEST_EXPEDIENTE = 25398
MAX_TEST_EXPEDIENTE = 25897

if __name__ == "__main__":
  # The week's urls are already in raw/links: set scrap_urls = True only to collect them again.
  Pipeline().scrap_and_save(scrap_urls = False, scrap_new_htmls = True, period = TEST_PERIOD,
                            first_expediente = FIRST_TEST_EXPEDIENTE, max_expediente = MAX_TEST_EXPEDIENTE)
