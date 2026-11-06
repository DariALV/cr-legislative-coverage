import os
import re
import traceback
import requests
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from config import Config, DataPeriod
from tools.scraping_tools.html_fetcher import HTMLFetcher
from tools.scraping_tools.crhoy_parser import CRHoyParser
from tools.scraping_tools.delfino_parser import DelfinoParser
from tools.scraping_tools.elmundo_parser import ElMundoParser
from tools.scraping_tools.semanario_parser import SemanarioParser
from tools.scraping_tools.wordpress_parser import WordPressParser
from tools.scraping_tools.nacion_parser import NacionParser
from tools.scraping_tools.bill_parser import BillParser
from tools.scraping_tools.news_article import NewsArticle
from tools.scraping_tools.bill import Bill
from tools.scraping_tools.url_collector import UrlCollector
from tools.scraping_tools.section_filter import is_relevant_url, is_relevant_categories, is_relevant_delfino_section
from tools.file_tools.file_manager import FileManager
from tools.database_tools.database import Database

class Pipeline:
  def scrap_and_save(self, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                     period: DataPeriod = Config.DATA_PERIOD, first_bill: int = Config.FIRST_BILL,
                     max_bill: int = Config.MAX_BILL) -> dict[str, Any]:
    """Scrapes every website in parallel and saves the results into the private corpus database."""
    results: dict[str, Any] = self.scrap_websites(scrap_urls, scrap_new_htmls, period, first_bill, max_bill)
    database: Database = Database(Config.DATABASE_DIR, Config.PRIVATE_DATABASE)
    database.create_private_corpus_tables()
    self.save_results(results, database)
    return results

  def save_results(self, results: dict[str, Any], database: Database):
    """Inserts what scrap_websites returned. Runs in the calling thread (SQLite connections are per thread)."""
    if "crhoy" in results:
      database.insert_news_articles(results["crhoy"])
      print(f"[crhoy] saved {len(results['crhoy'])} news")
    if "delfino" in results:
      delfino: dict[str, Any] = results["delfino"]
      database.insert_news_articles(delfino["news"])
      database.insert_news_bill_links_map(delfino["bill_links"], "link")
      database.insert_bills(delfino["bills"])
      linked: int = sum(len(numbers) for numbers in delfino["bill_links"].values())
      print(f"[delfino] saved {len(delfino['news'])} news, {linked} bill links, {len(delfino['bills'])} bills")
    if "elmundo" in results:
      database.insert_news_articles(results["elmundo"])
      print(f"[elmundo] saved {len(results['elmundo'])} news")
    if "semanario" in results:
      database.insert_news_articles(results["semanario"])
      print(f"[semanario] saved {len(results['semanario'])} news")
    if "nacion" in results:
      database.insert_news_articles(results["nacion"])
      print(f"[nacion] saved {len(results['nacion'])} news")

  def scrap_websites(self, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                     period: DataPeriod = Config.DATA_PERIOD, first_bill: int = Config.FIRST_BILL,
                     max_bill: int = Config.MAX_BILL) -> dict[str, Any]:
    """
    Scrapes every website in parallel, one thread per website, each with its own fetcher and rate limit.
    Delfino's news and bills share a thread because they are the same website.
    Bills are walked from first_bill up to max_bill (inclusive), independent of the period.
    Results are returned (not inserted): SQLite connections can't be shared across threads, so insert
    them from the calling thread. A website that fails is reported and left out; the others continue.
    """
    jobs: dict[str, Callable[[], Any]] = {
      "crhoy": lambda: self.scrap_crhoy(self.make_fetcher("crhoy"), scrap_urls, scrap_new_htmls, period),
      "delfino": lambda: self.scrap_delfino_website(self.make_fetcher("delfino"), scrap_urls, scrap_new_htmls, period,
                                                    first_bill, max_bill),
      "elmundo": lambda: self.scrap_elmundo(self.make_fetcher("elmundo"), scrap_urls, scrap_new_htmls, period),
      "nacion": lambda: self.scrap_nacion(self.make_fetcher("nacion"), scrap_urls, scrap_new_htmls, period),
      "semanario": lambda: self.scrap_semanario(self.make_fetcher("semanario"), scrap_urls, scrap_new_htmls, period),
    }
    return run_in_parallel(jobs)

  def make_fetcher(self, website: str) -> HTMLFetcher:
    return HTMLFetcher(Config.USER_AGENT, Config.rate_limit_for(website), Config.RETRIES, Config.TIMEOUT, website)

  def scrap_delfino_website(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                            period: DataPeriod = Config.DATA_PERIOD, first_bill: int = Config.FIRST_BILL,
                            max_bill: int = Config.MAX_BILL) -> dict[str, Any]:
    news_articles, bill_links = self.scrap_delfino_news(fetcher, scrap_urls, scrap_new_htmls, period)
    bills: list[Bill] = self.scrap_delfino(fetcher, first_bill, max_bill)
    return {"news": news_articles, "bill_links": bill_links, "bills": bills}

  def scrap_crhoy(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                  period: DataPeriod = Config.DATA_PERIOD) -> list[NewsArticle]:
    save_folder_path: str = f"{Config.RAW_HTML_DIR}/crhoy/news"
    links_folder_path: str = f"{Config.RAW_LINKS_DIR}/crhoy"
    url_collector: UrlCollector = UrlCollector()
    file_manager: FileManager = FileManager()
    parser: CRHoyParser = CRHoyParser()

    crhoy_urls: list[str] = []
    if scrap_urls:
      crhoy_urls = url_collector.get_crhoy_links(period)
      file_manager.save_dict_as_json(links_folder_path, "crhoy_links", {"links": crhoy_urls})
    else:
      crhoy_urls = file_manager.load_json_as_dict(links_folder_path, "crhoy_links")["links"]

    if scrap_new_htmls:
      fetcher.fetch_multiple(save_folder_path, crhoy_urls)

    filtered_urls: list[str] = []
    for url in crhoy_urls:
      if is_relevant_url("crhoy", url) and file_manager.html_exists(save_folder_path, url):
        filtered_urls.append(url)

    news_articles: list[NewsArticle] = []
    for i in range(len(filtered_urls)):
      url: str = filtered_urls[i]
      news_processed_count(i + 1, len(filtered_urls), fetcher.name)
      html = file_manager.load_html(save_folder_path, url)
      if is_error_html(html):
        print(f"[{fetcher.name}] Url {url} found {html.lower()}")
        continue
      news_article: NewsArticle | None = parser.parse(html, url)
      if news_article and period.contains(news_article.date_published):
        news_articles.append(news_article)
    print(f"[{fetcher.name}] CRHoy: {len(news_articles)} news inside the period out of {len(filtered_urls)} downloaded")
    return news_articles

  def scrap_nacion(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                   period: DataPeriod = Config.DATA_PERIOD) -> list[NewsArticle]:
    save_folder_path: str = f"{Config.RAW_HTML_DIR}/nacion/news"
    links_folder_path: str = f"{Config.RAW_LINKS_DIR}/nacion"
    url_collector: UrlCollector = UrlCollector()
    file_manager: FileManager = FileManager()
    parser: NacionParser = NacionParser()

    nacion_urls: list[str] = []
    if scrap_urls:
      nacion_urls = url_collector.get_nacion_links(period)
      file_manager.save_dict_as_json(links_folder_path, "nacion_links", {"links": nacion_urls})
    else:
      nacion_urls = file_manager.load_json_as_dict(links_folder_path, "nacion_links")["links"]

    if scrap_new_htmls:
      fetcher.fetch_multiple(save_folder_path, nacion_urls)

    filtered_urls: list[str] = []
    for url in nacion_urls:
      if is_relevant_url("nacion", url) and file_manager.html_exists(save_folder_path, url):
        filtered_urls.append(url)

    news_articles: list[NewsArticle] = []
    for i in range(len(filtered_urls)):
      url: str = filtered_urls[i]
      news_processed_count(i + 1, len(filtered_urls), fetcher.name)
      html = file_manager.load_html(save_folder_path, url)
      if is_error_html(html):
        print(f"[{fetcher.name}] Url {url} found {html.lower()}")
        continue
      news_article: NewsArticle | None = parser.parse(html, url)
      if news_article and period.contains(news_article.date_published):
        news_articles.append(news_article)
    print(f"[{fetcher.name}] La Nación: {len(news_articles)} news inside the period out of {len(filtered_urls)} downloaded")
    return news_articles

  def scrap_elmundo(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                    period: DataPeriod = Config.DATA_PERIOD) -> list[NewsArticle]:
    return self.scrap_wordpress(fetcher, ElMundoParser(), "https://elmundo.cr", True, scrap_urls, scrap_new_htmls, period)

  def scrap_semanario(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                      period: DataPeriod = Config.DATA_PERIOD) -> list[NewsArticle]:
    # Semanario's /users answers an HTML page and its bylines are not public in the API (see SemanarioParser).
    return self.scrap_wordpress(fetcher, SemanarioParser(), "https://semanariouniversidad.com", False, scrap_urls, scrap_new_htmls, period)

  def scrap_wordpress(self, fetcher: HTMLFetcher, parser: WordPressParser, site_url: str, with_users: bool,
                      scrap_urls: bool = False, scrap_new_htmls: bool = False,
                      period: DataPeriod = Config.DATA_PERIOD) -> list[NewsArticle]:
    """
    A WordPress outlet (El Mundo, Semanario) through its REST API: each response page (100 posts of one
    month) is the raw file and already has the full body, so collecting urls and downloading news are the
    same requests. Missing pages are fetched when scrap_urls or scrap_new_htmls is set; otherwise only
    the cache is read. with_users maps the post's WordPress user to its name (only where it's the byline).
    """
    outlet: str = parser.ORGANIZATION
    api_folder_path: str = f"{Config.RAW_HTML_DIR}/{outlet}/api"
    links_folder_path: str = f"{Config.RAW_LINKS_DIR}/{outlet}"
    url_collector: UrlCollector = UrlCollector()
    file_manager: FileManager = FileManager()
    fetch_missing: bool = scrap_urls or scrap_new_htmls

    # Categories and authors change rarely and are a handful of requests: refreshed on every fetching run.
    category_items: list[dict] = self.fetch_wordpress_pages(
      fetcher, file_manager, parser, api_folder_path,
      lambda page: url_collector.get_wordpress_categories_link(site_url, page), fetch_missing, fetch_missing)
    categories: dict[int, str] = parser.parse_categories(category_items)
    category_slugs: dict[int, str] = {category["id"]: category.get("slug", "") for category in category_items}
    authors: dict[int, str] = {}
    if with_users:
      authors = parser.parse_authors(self.fetch_wordpress_pages(
        fetcher, file_manager, parser, api_folder_path,
        lambda page: url_collector.get_wordpress_users_link(site_url, page), fetch_missing, fetch_missing))

    posts: list[dict] = []
    for year, month in period.months():
      next_month: datetime = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
      page_link = lambda page, year = year, month = month: url_collector.get_wordpress_posts_link(site_url, year, month, page)
      # A month cached before it ended (plus a day for late edits) is incomplete: refresh its pages.
      refresh_before: datetime = next_month + timedelta(days = 1)
      month_posts: list[dict] = self.fetch_wordpress_pages(fetcher, file_manager, parser, api_folder_path, page_link,
                                                           fetch_missing, False, refresh_before)
      print(f"[{fetcher.name}] {year}-{month:02d}: {len(month_posts)} posts")
      posts += month_posts

    news_articles: list[NewsArticle] = []
    links: list[str] = []
    for i in range(len(posts)):
      news_processed_count(i + 1, len(posts), fetcher.name)
      news_article: NewsArticle | None = parser.parse(posts[i], categories, authors)
      if news_article and period.contains(news_article.date_published):
        links.append(news_article.url)
        slugs: list[str] = [category_slugs.get(category_id, "") for category_id in posts[i].get("categories", [])]
        if is_relevant_url(outlet, news_article.url) and is_relevant_categories(outlet, slugs):
          news_articles.append(news_article)
    file_manager.save_dict_as_json(links_folder_path, f"{outlet}_links", {"links": list(dict.fromkeys(links))})
    print(f"[{fetcher.name}] {len(news_articles)} relevant news inside the period out of {len(links)}")
    return news_articles

  def fetch_wordpress_pages(self, fetcher: HTMLFetcher, file_manager: FileManager, parser: WordPressParser, folder_path: str,
                            page_link: Callable[[int], str], fetch_missing: bool, refresh: bool = False,
                            refresh_before: datetime | None = None) -> list[dict]:
    """
    Items of every page of a REST collection, page 1 upwards, until a page has fewer than 100 items or
    an error (WordPress answers 400 past the last page). Cached pages are reused unless refresh is set
    or they were saved before refresh_before. Without fetch_missing nothing is downloaded.
    """
    items: list[dict] = []
    page: int = 1
    while True:
      url: str = page_link(page)
      raw: str | None = None
      if file_manager.html_exists(folder_path, url):
        stale: bool = refresh or (refresh_before is not None and saved_before(file_manager, folder_path, url, refresh_before))
        if not (fetch_missing and stale):
          raw = file_manager.load_html(folder_path, url)
      if raw is None:
        if not fetch_missing:
          break
        try:
          raw = fetcher.fetch(folder_path, url)
        except requests.RequestException as error:
          # Nothing is saved, so the page is fetched again on the next run.
          print(f"[{fetcher.name}] Could not fetch {url}: {error}")
          break

      if is_error_html(raw):
        if not (page > 1 and raw == "Error 400"):
          print(f"[{fetcher.name}] Url {url} found {raw.lower()}")
        break
      page_items: list[dict] = parser.parse_page(raw)
      items += page_items
      if len(page_items) < 100:
        break
      page += 1
    return items

  def scrap_delfino_news(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                         period: DataPeriod = Config.DATA_PERIOD) -> tuple[list[NewsArticle], dict[str, list[int]]]:
    """
    Returns the news inside the period (excluded sections dropped) and, per news id, the bill
    numbers its body links to (store them with Database.insert_news_bill_links, source "link").
    """
    save_folder_path: str = f"{Config.RAW_HTML_DIR}/delfino/news"
    links_folder_path: str = f"{Config.RAW_LINKS_DIR}/delfino"
    url_collector: UrlCollector = UrlCollector()
    file_manager: FileManager = FileManager()
    parser: DelfinoParser = DelfinoParser()

    delfino_urls: list[str] = []
    if scrap_urls:
      delfino_urls = url_collector.get_delfino_news_links(period)
      file_manager.save_dict_as_json(links_folder_path, "delfino_news_links", {"links": delfino_urls})
    else:
      delfino_urls = file_manager.load_json_as_dict(links_folder_path, "delfino_news_links")["links"]

    if scrap_new_htmls:
      fetcher.fetch_multiple(save_folder_path, delfino_urls)

    downloaded_urls: list[str] = [url for url in delfino_urls if file_manager.html_exists(save_folder_path, url)]

    news_articles: list[NewsArticle] = []
    bill_links: dict[str, list[int]] = {}
    for i in range(len(downloaded_urls)):
      url: str = downloaded_urls[i]
      news_processed_count(i + 1, len(downloaded_urls), fetcher.name)
      html = file_manager.load_html(save_folder_path, url)
      if is_error_html(html):
        print(f"[{fetcher.name}] Url {url} found {html.lower()}")
        continue
      news_article: NewsArticle | None = parser.parse(html, url)
      # Delfino urls carry no section, so the section filter runs here, on the page's articleSection
      if news_article and period.contains(news_article.date_published) and is_relevant_delfino_section(news_article.section):
        news_articles.append(news_article)
        links: list[int] = parser.parse_bill_links(html)
        if links:
          bill_links[news_article.id] = links
    print(f"[{fetcher.name}] Delfino: {len(news_articles)} news inside the period out of {len(downloaded_urls)} downloaded")
    return news_articles, bill_links

  def scrap_delfino(self, fetcher: HTMLFetcher, first_bill: int = Config.FIRST_BILL, max_bill: int = Config.MAX_BILL,
                    max_consecutive_errors: int = Config.MAX_CONSECUTIVE_ERRORS) -> list[Bill]:
    """
    Walks bills from first_bill upwards. Errors only count once we are past the last
    successfully collected bill; it stops after max_consecutive_errors errors in a row there
    (or at max_bill).
    """
    save_folder_path: str = f"{Config.RAW_HTML_DIR}/delfino/asamblea/bills"
    url_collector: UrlCollector = UrlCollector()
    file_manager: FileManager = FileManager()
    parser: BillParser = BillParser()

    last_success: int = self.last_cached_delfino_success(file_manager, url_collector, save_folder_path, first_bill, max_bill)
    print(f"[{fetcher.name}] Last bill already collected: {last_success if last_success >= first_bill else 'none'}")

    bills: list[Bill] = []
    collected_urls: list[str] = []
    consecutive_errors: int = 0

    for number in range(first_bill, max_bill + 1):
      url: str = url_collector.get_delfino_link(number)
      html: str | None = None
      if file_manager.html_exists(save_folder_path, url):
        html = file_manager.load_html(save_folder_path, url)

      # Past the last known bill, cached errors may be stale (new bills get published), so retry them.
      if html is None or (number > last_success and is_error_html(html)):
        print(f"[{fetcher.name}] Scraping bill {number}")
        html = fetcher.fetch(save_folder_path, url)

      if is_error_html(html):
        print(f"[{fetcher.name}] Url {url} found {html.lower()}")
        if number > last_success:
          consecutive_errors += 1
          if consecutive_errors >= max_consecutive_errors:
            print(f"[{fetcher.name}] {consecutive_errors} consecutive errors after bill {last_success}, stopping.")
            break
        continue

      consecutive_errors = 0
      last_success = max(last_success, number)
      collected_urls.append(url)
      bill: Bill = parser.parse(html, url)
      bills.append(bill)

    file_manager.save_dict_as_json(f"{Config.RAW_LINKS_DIR}/delfino", "delfino_links", {"links": collected_urls})
    return bills

  def last_cached_delfino_success(self, file_manager: FileManager, url_collector: UrlCollector, save_folder_path: str,
                                  first_bill: int, max_bill: int) -> int:
    """Highest bill number with a cached, non-error HTML (first_bill - 1 if none)."""
    for number in range(max_bill, first_bill - 1, -1):
      url: str = url_collector.get_delfino_link(number)
      if file_manager.html_exists(save_folder_path, url) and not is_error_html(file_manager.load_html(save_folder_path, url)):
        return number
    return first_bill - 1

  def apply_embeddings(self):
    pass

def run_in_parallel(jobs: dict[str, Callable[[], Any]]) -> dict[str, Any]:
  """Runs each job in its own thread. Returns {name: result} for the jobs that finished without errors."""
  results: dict[str, Any] = {}
  if not jobs:
    return results
  with ThreadPoolExecutor(max_workers = len(jobs), thread_name_prefix = "scraper") as executor:
    futures = {name: executor.submit(job) for name, job in jobs.items()}
    for name, future in futures.items():
      try:
        results[name] = future.result()
        print(f"[{name}] finished")
      except Exception:
        print(f"[{name}] failed, the other websites were not affected:\n{traceback.format_exc()}")
  return results

def saved_before(file_manager: FileManager, folder_path: str, name: str, moment: datetime) -> bool:
  """True if the cached file was written before moment (local machine time)."""
  return datetime.fromtimestamp(os.path.getmtime(file_manager.get_path(folder_path, name, ".html", True))) < moment

def is_error_html(html: str) -> bool:
  return re.fullmatch(r"Error (\d{3})", html) is not None

def news_processed_count(current: int, max: int, name: str = ""):
   prefix: str = f"[{name}] " if name else ""
   print(f"{prefix}{current} out of {max} news processed. ({current * 100.0/max:.2f}% completed)")