import logging
import re
import time
import requests
from bs4 import BeautifulSoup
from datetime import date, datetime, timedelta

from config import Config, DataPeriod
from tools.scraping_tools.section_filter import is_relevant_url
from tools.scraping_tools.html_fetcher import make_retry_session
from tools.display_tools.progress import ProgressTask, silent_task

logger = logging.getLogger("cr")

# Delfino news urls: https://delfino.cr/<year>/<month>/<slug>
DELFINO_NEWS_URL_REGEX = re.compile(r"^https://delfino\.cr/(\d{4})/(\d{2})/[^/]+$")
# La Nación news urls: https://www.nacion.com/<section>/[<subsection>/]<slug>/<arc id>/story/
NACION_NEWS_URL_REGEX = re.compile(r"^https://www\.nacion\.com/.+/[A-Z0-9]{26}/story/$")

class UrlCollector:
  """
  Collects urls with a coarse date filter that never drops a news inside the period. The exact
  filter runs after parsing, on date_published.
  Not thread-safe (one requests.Session): create one collector per thread/website.
  task (optional) advances once per sitemap read by the get_*_links methods and counts the failed ones.
  """

  def __init__(self, task: ProgressTask | None = None):
    self.session: requests.Session | None = None
    self.failed_sitemaps: list[str] = []
    self.task: ProgressTask = task or silent_task()

  def report_failed_sitemaps(self, name: str):
    """Lists the sitemaps skipped after the retries. Their urls are missing: collect that website's urls again."""
    if self.failed_sitemaps:
      logger.warning(f"[{name}] {len(self.failed_sitemaps)} sitemaps could not be fetched, their urls are missing "
            f"(run again with scrap_urls = True): {self.failed_sitemaps}")

  def get_delfino_news_links(self, period: DataPeriod = Config.DATA_PERIOD) -> list[str]:
    """News from the yearly sitemaps whose /<year>/<month>/ falls in the period (month precision)."""
    months: set[tuple[int, int]] = set(period.months())
    links: list[str] = []
    self.task.set_total(len(period.years()))
    for year in period.years():
      sitemap_links = [url for url, _ in self.get_sitemap_entries(f"https://delfino.cr/sitemaps/posts/{year}.xml")]
      for url in sitemap_links:
        match = DELFINO_NEWS_URL_REGEX.match(url)
        # urls without /<year>/<month>/ (e.g. /audio/ podcasts) are not news articles
        if match and (int(match.group(1)), int(match.group(2))) in months:
          links.append(url)
      logger.info(f"Delfino sitemap {year}: {len(sitemap_links)} urls, {len(links)} kept so far")
      self.task.advance()
    self.task.finish()
    return list(dict.fromkeys(links))

  def get_wordpress_posts_link(self, site_url: str, year: int, month: int, page: int) -> str:
    """
    One page (100 posts, oldest first) of a WordPress REST API (El Mundo, Semanario) for a whole month.
    Months, not the exact period, keep the url (the cache key) stable when the period changes.
    after/before are exclusive and in site time (Costa Rica). The exact filter runs after parsing, on date_published.
    """
    previous_day: datetime = datetime(year, month, 1) - timedelta(seconds = 1)
    next_month: datetime = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    return (f"{site_url}/wp-json/wp/v2/posts?per_page=100&orderby=date&order=asc"
            f"&after={previous_day.isoformat()}&before={next_month.isoformat()}"
            "&_fields=id,link,date,date_gmt,modified_gmt,title,excerpt,content,categories,author"
            f"&page={page}")

  def get_wordpress_categories_link(self, site_url: str, page: int) -> str:
    return f"{site_url}/wp-json/wp/v2/categories?per_page=100&_fields=id,name,slug,parent&page={page}"

  def get_wordpress_users_link(self, site_url: str, page: int) -> str:
    return f"{site_url}/wp-json/wp/v2/users?per_page=100&_fields=id,name&page={page}"

  def get_nacion_links(self, period: DataPeriod = Config.DATA_PERIOD) -> list[str]:
    """
    La Nación (Arc Publishing) has one sitemap per day of publication, as a UTC day (lastmod is the
    datePublished). A Costa Rica day ends at 06:00 UTC of the next day, so the day after the period
    end is read too. The exact filter runs after parsing, on date_published.
    """
    links: list[str] = []
    day: date = period.start_date()
    last_day: date = period.end.date() + timedelta(days = 1)
    self.task.set_total((last_day - day).days + 1)
    while day <= last_day:
      sitemap_url: str = f"https://www.nacion.com/arc/outboundfeeds/sitemap/{day.isoformat()}/?outputType=xml"
      day_links = [url for url, _ in self.get_sitemap_entries(sitemap_url) if NACION_NEWS_URL_REGEX.match(url)]
      kept = [url for url in day_links if is_relevant_url("nacion", url)]
      links += kept
      logger.info(f"La Nación sitemap {day}: {len(day_links)} urls, {len(kept)} kept")
      self.task.advance()
      day += timedelta(days = 1)
      time.sleep(Config.rate_limit_for("nacion"))
    self.task.finish()
    return list(dict.fromkeys(links))

  def get_crhoy_links(self, period: DataPeriod = Config.DATA_PERIOD) -> list[str]:
    """
    Every CRHoy sitemap listed in the index, keeping urls modified on or after the period start.
    lastmod is a modification date (never before publication), so only the lower bound is safe:
    a news published inside the period and edited after it would be lost with an upper bound.
    """
    index_entries = self.get_sitemap_entries("https://crhoy.com/sitemap.xml")
    sitemap_urls = [url for url, _ in index_entries if "/sitemap-news" not in url and "/sitemap-videos" not in url]
    # CRHoy's lastmod is Costa Rica local time labeled with "Z", so the suffix is ignored (not converted).
    earliest = period.start - timedelta(days = 1)   # small safety margin

    links: list[str] = []
    self.task.set_total(len(sitemap_urls))
    for sitemap_url in sitemap_urls:
      entries = self.get_sitemap_entries(sitemap_url)
      kept = [url for url, lastmod in entries
              if url != "https://crhoy.com/" and (lastmod is None or datetime.fromisoformat(lastmod[:19]) >= earliest)]
      links += kept
      logger.info(f"{sitemap_url}: {len(entries)} urls, {len(kept)} kept")
      self.task.advance()
    self.task.finish()
    links = list(dict.fromkeys(links))
    return [link for link in links if is_relevant_url("crhoy", link)]

  def get_sitemap_entries(self, sitemap_url: str) -> list[tuple[str, str | None]]:
    """
    (loc, lastmod) pairs of a sitemap or sitemap index; lastmod is None when missing.
    A sitemap that still fails after the retries (network or HTTP error) is skipped: it returns no entries
    and is added to failed_sitemaps, so the run goes on and report_failed_sitemaps lists it at the end.
    """
    if self.session is None:
      self.session = make_retry_session(Config.USER_AGENT, Config.RETRIES)
    try:
      response = self.session.get(sitemap_url, timeout = Config.SITEMAP_TIMEOUT)
      response.raise_for_status()
    except requests.RequestException as error:
      self.task.warn(f"Could not fetch sitemap {sitemap_url}: {error}")
      self.failed_sitemaps.append(sitemap_url)
      return []
    soup = BeautifulSoup(response.content, "xml")
    entries: list[tuple[str, str | None]] = []
    for entry in soup.find_all(["url", "sitemap"]):
      loc = entry.find("loc")
      if loc is None:
        continue
      lastmod = entry.find("lastmod")
      entries.append((loc.text.strip(), lastmod.text.strip() if lastmod else None))
    return entries
