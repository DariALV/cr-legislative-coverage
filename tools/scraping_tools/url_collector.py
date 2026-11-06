import re
import time
import requests
from bs4 import BeautifulSoup
from datetime import date, datetime, timedelta

from config import Config, DataPeriod
from tools.scraping_tools.section_filter import is_relevant_url

# Delfino news urls: https://delfino.cr/<year>/<month>/<slug>
DELFINO_NEWS_URL_REGEX = re.compile(r"^https://delfino\.cr/(\d{4})/(\d{2})/[^/]+$")
# La Nación news urls: https://www.nacion.com/<section>/[<subsection>/]<slug>/<arc id>/story/
NACION_NEWS_URL_REGEX = re.compile(r"^https://www\.nacion\.com/.+/[A-Z0-9]{26}/story/$")

class UrlCollector:
  """
  Collects urls with a coarse date filter that never drops a news inside the period. The exact
  filter runs after parsing, on date_published.
  """

  def get_delfino_links(self, max_expediente) -> list[str]:
    urls: list[str] = []
    for i in range(Config.FIRST_EXPEDIENTE, max_expediente + 1):
      urls.append(self.get_delfino_link(i))
    return urls

  def get_delfino_link(self, expediente_number: int) -> str:
    return f"https://delfino.cr/asamblea/proyecto/{expediente_number}"

  def get_delfino_news_links(self, period: DataPeriod = Config.DATA_PERIOD) -> list[str]:
    """News from the yearly sitemaps whose /<year>/<month>/ falls in the period (month precision)."""
    months: set[tuple[int, int]] = set(period.months())
    links: list[str] = []
    for year in period.years():
      sitemap_links = [url for url, _ in self.get_sitemap_entries(f"https://delfino.cr/sitemaps/posts/{year}.xml")]
      for url in sitemap_links:
        match = DELFINO_NEWS_URL_REGEX.match(url)
        # urls without /<year>/<month>/ (e.g. /audio/ podcasts) are not news articles
        if match and (int(match.group(1)), int(match.group(2))) in months:
          links.append(url)
      print(f"Delfino sitemap {year}: {len(sitemap_links)} urls, {len(links)} kept so far")
    return list(dict.fromkeys(links))

  def get_nacion_links(self, period: DataPeriod = Config.DATA_PERIOD) -> list[str]:
    """
    La Nación (Arc Publishing) has one sitemap per day of publication, as a UTC day (lastmod is the
    datePublished). A Costa Rica day ends at 06:00 UTC of the next day, so the day after the period
    end is read too. The exact filter runs after parsing, on date_published.
    """
    links: list[str] = []
    day: date = period.start_date()
    last_day: date = period.end.date() + timedelta(days = 1)
    while day <= last_day:
      sitemap_url: str = f"https://www.nacion.com/arc/outboundfeeds/sitemap/{day.isoformat()}/?outputType=xml"
      day_links = [url for url, _ in self.get_sitemap_entries(sitemap_url) if NACION_NEWS_URL_REGEX.match(url)]
      kept = [url for url in day_links if is_relevant_url("nacion", url)]
      links += kept
      print(f"La Nación sitemap {day}: {len(day_links)} urls, {len(kept)} kept")
      day += timedelta(days = 1)
      time.sleep(Config.rate_limit_for("nacion"))
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
    for sitemap_url in sitemap_urls:
      entries = self.get_sitemap_entries(sitemap_url)
      kept = [url for url, lastmod in entries
              if url != "https://crhoy.com/" and (lastmod is None or datetime.fromisoformat(lastmod[:19]) >= earliest)]
      links += kept
      print(f"{sitemap_url}: {len(entries)} urls, {len(kept)} kept")
    links = list(dict.fromkeys(links))
    return [link for link in links if is_relevant_url("crhoy", link)]

  def get_sitemap_entries(self, sitemap_url: str) -> list[tuple[str, str | None]]:
    """(loc, lastmod) pairs of a sitemap or sitemap index; lastmod is None when missing."""
    response = requests.get(sitemap_url, headers = {"User-Agent": f"{Config.USER_AGENT}/1.0"}, timeout = Config.SITEMAP_TIMEOUT)
    soup = BeautifulSoup(response.content, "xml")
    entries: list[tuple[str, str | None]] = []
    for entry in soup.find_all(["url", "sitemap"]):
      loc = entry.find("loc")
      if loc is None:
        continue
      lastmod = entry.find("lastmod")
      entries.append((loc.text.strip(), lastmod.text.strip() if lastmod else None))
    return entries
