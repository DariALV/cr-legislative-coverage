from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

# Every date in the project is Costa Rica local time, stored without timezone (UTC-6, no daylight saving).
COSTA_RICA_TZ = timezone(timedelta(hours = -6))

@dataclass(frozen = True)
class DataPeriod:
  start: datetime   # inclusive, Costa Rica local time
  end: datetime     # inclusive, Costa Rica local time

  def contains(self, moment: datetime) -> bool:
    return self.start <= moment <= self.end

  def months(self) -> list[tuple[int, int]]:
    """(year, month) pairs the period touches, in order."""
    months: list[tuple[int, int]] = []
    year, month = self.start.year, self.start.month
    while (year, month) <= (self.end.year, self.end.month):
      months.append((year, month))
      year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months

  def years(self) -> list[int]:
    return list(range(self.start.year, self.end.year + 1))

  def start_date(self) -> date:
    return self.start.date()

def to_costa_rica_time(moment_text: str) -> datetime:
  """
  ISO timestamp (with 'Z' or an offset) converted to naive Costa Rica local time. Naive input is returned as is.
  Only for sources whose 'Z' is real UTC (Delfino). CRHoy labels local time with 'Z': don't use it there.
  """
  moment = datetime.fromisoformat(moment_text.replace("Z", "+00:00"))
  if moment.tzinfo is None:
    return moment
  return moment.astimezone(COSTA_RICA_TZ).replace(tzinfo = None)

class Config:
  # Data period (see #20). Extend start to 2025-11-01 to get 12 full months.
  DATA_PERIOD = DataPeriod(datetime(2026, 1, 1), datetime(2026, 10, 31, 23, 59, 59))

  # Fetching. Each website runs in its own thread with its own rate limit, so sites don't slow each other down.
  USER_AGENT = "uni-project"
  RATE_LIMIT = 1                       # seconds between requests to the same website
  RATE_LIMITS = {"semanario": 20}      # per-website overrides (Semanario's robots.txt asks for a 20 s crawl-delay)
  RETRIES = 5
  TIMEOUT = 10
  SITEMAP_TIMEOUT = 60   # some sitemaps list 30,000 urls

  # Storage
  RAW_HTML_DIR = "raw/html"
  RAW_LINKS_DIR = "raw/links"
  DATABASE_DIR = "databases"
  PRIVATE_DATABASE = "private_corpus"
  COMMIT_BATCH_SIZE = 50

  # Bills are collected by number, not by period: news in the period discuss older bills too.
  FIRST_BILL = 20000
  MAX_BILL = 100000
  MAX_CONSECUTIVE_ERRORS = 5

  @staticmethod
  def rate_limit_for(website: str) -> float:
    return Config.RATE_LIMITS.get(website, Config.RATE_LIMIT)

  # Outlet types, used to group the analysis
  GENERAL_OUTLET = "general"
  SPECIALIZED_OUTLET = "specialized"
