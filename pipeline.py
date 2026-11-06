import re
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from config import Config, DataPeriod
from tools.scraping_tools.html_fetcher import HTMLFetcher
from tools.scraping_tools.crhoy_parser import CRHoyParser
from tools.scraping_tools.delfino_parser import DelfinoParser
from tools.scraping_tools.nacion_parser import NacionParser
from tools.scraping_tools.expediente_parser import ExpedienteParser
from tools.scraping_tools.news_article import NewsArticle
from tools.scraping_tools.expediente import Expediente
from tools.scraping_tools.url_collector import UrlCollector
from tools.scraping_tools.section_filter import is_relevant_url, is_relevant_delfino_section
from tools.file_tools.file_manager import FileManager
from tools.database_tools.database import Database

class Pipeline:
  def scrap_and_save(self, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                     period: DataPeriod = Config.DATA_PERIOD, first_expediente: int = Config.FIRST_EXPEDIENTE,
                     max_expediente: int = Config.MAX_EXPEDIENTE) -> dict[str, Any]:
    """Scrapes every website in parallel and saves the results into the private corpus database."""
    results: dict[str, Any] = self.scrap_websites(scrap_urls, scrap_new_htmls, period, first_expediente, max_expediente)
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
      database.insert_news_expediente_links_map(delfino["expediente_links"], "link")
      database.insert_expedientes(delfino["expedientes"])
      linked: int = sum(len(numbers) for numbers in delfino["expediente_links"].values())
      print(f"[delfino] saved {len(delfino['news'])} news, {linked} expediente links, {len(delfino['expedientes'])} expedientes")
    if "nacion" in results:
      database.insert_news_articles(results["nacion"])
      print(f"[nacion] saved {len(results['nacion'])} news")

  def scrap_websites(self, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                     period: DataPeriod = Config.DATA_PERIOD, first_expediente: int = Config.FIRST_EXPEDIENTE,
                     max_expediente: int = Config.MAX_EXPEDIENTE) -> dict[str, Any]:
    """
    Scrapes every website in parallel, one thread per website, each with its own fetcher and rate limit.
    Delfino's news and expedientes share a thread because they are the same website.
    Expedientes are walked from first_expediente up to max_expediente (inclusive), independent of the period.
    Results are returned (not inserted): SQLite connections can't be shared across threads, so insert
    them from the calling thread. A website that fails is reported and left out; the others continue.
    """
    jobs: dict[str, Callable[[], Any]] = {
      "crhoy": lambda: self.scrap_crhoy(self.make_fetcher("crhoy"), scrap_urls, scrap_new_htmls, period),
      "delfino": lambda: self.scrap_delfino_website(self.make_fetcher("delfino"), scrap_urls, scrap_new_htmls, period,
                                                    first_expediente, max_expediente),
      "nacion": lambda: self.scrap_nacion(self.make_fetcher("nacion"), scrap_urls, scrap_new_htmls, period),
      # "elmundo": ..., "semanario": ... (one entry per new website)
    }
    return run_in_parallel(jobs)

  def make_fetcher(self, website: str) -> HTMLFetcher:
    return HTMLFetcher(Config.USER_AGENT, Config.rate_limit_for(website), Config.RETRIES, Config.TIMEOUT, website)

  def scrap_delfino_website(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                            period: DataPeriod = Config.DATA_PERIOD, first_expediente: int = Config.FIRST_EXPEDIENTE,
                            max_expediente: int = Config.MAX_EXPEDIENTE) -> dict[str, Any]:
    news_articles, expediente_links = self.scrap_delfino_news(fetcher, scrap_urls, scrap_new_htmls, period)
    expedientes: list[Expediente] = self.scrap_delfino(fetcher, first_expediente, max_expediente)
    return {"news": news_articles, "expediente_links": expediente_links, "expedientes": expedientes}

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

  def scrap_delfino_news(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                         period: DataPeriod = Config.DATA_PERIOD) -> tuple[list[NewsArticle], dict[str, list[int]]]:
    """
    Returns the news inside the period (excluded sections dropped) and, per news id, the expediente
    numbers its body links to (store them with Database.insert_news_expediente_links, source "link").
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
    expediente_links: dict[str, list[int]] = {}
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
        links: list[int] = parser.parse_expediente_links(html)
        if links:
          expediente_links[news_article.id] = links
    print(f"[{fetcher.name}] Delfino: {len(news_articles)} news inside the period out of {len(downloaded_urls)} downloaded")
    return news_articles, expediente_links

  def scrap_delfino(self, fetcher: HTMLFetcher, first_expediente: int = Config.FIRST_EXPEDIENTE, max_expediente: int = Config.MAX_EXPEDIENTE,
                    max_consecutive_errors: int = Config.MAX_CONSECUTIVE_ERRORS) -> list[Expediente]:
    """
    Walks expedientes from first_expediente upwards. Errors only count once we are past the last
    successfully collected expediente; it stops after max_consecutive_errors errors in a row there
    (or at max_expediente).
    """
    save_folder_path: str = f"{Config.RAW_HTML_DIR}/delfino/asamblea/expedientes"
    url_collector: UrlCollector = UrlCollector()
    file_manager: FileManager = FileManager()
    parser: ExpedienteParser = ExpedienteParser()

    last_success: int = self.last_cached_delfino_success(file_manager, url_collector, save_folder_path, first_expediente, max_expediente)
    print(f"[{fetcher.name}] Last expediente already collected: {last_success if last_success >= first_expediente else 'none'}")

    expedientes: list[Expediente] = []
    collected_urls: list[str] = []
    consecutive_errors: int = 0

    for number in range(first_expediente, max_expediente + 1):
      url: str = url_collector.get_delfino_link(number)
      html: str | None = None
      if file_manager.html_exists(save_folder_path, url):
        html = file_manager.load_html(save_folder_path, url)

      # Past the last known expediente, cached errors may be stale (new expedientes get published), so retry them.
      if html is None or (number > last_success and is_error_html(html)):
        print(f"[{fetcher.name}] Scraping expediente {number}")
        html = fetcher.fetch(save_folder_path, url)

      if is_error_html(html):
        print(f"[{fetcher.name}] Url {url} found {html.lower()}")
        if number > last_success:
          consecutive_errors += 1
          if consecutive_errors >= max_consecutive_errors:
            print(f"[{fetcher.name}] {consecutive_errors} consecutive errors after expediente {last_success}, stopping.")
            break
        continue

      consecutive_errors = 0
      last_success = max(last_success, number)
      collected_urls.append(url)
      expediente: Expediente = parser.parse(html, url)
      expedientes.append(expediente)

    file_manager.save_dict_as_json(f"{Config.RAW_LINKS_DIR}/delfino", "delfino_links", {"links": collected_urls})
    return expedientes

  def last_cached_delfino_success(self, file_manager: FileManager, url_collector: UrlCollector, save_folder_path: str,
                                  first_expediente: int, max_expediente: int) -> int:
    """Highest expediente number with a cached, non-error HTML (first_expediente - 1 if none)."""
    for number in range(max_expediente, first_expediente - 1, -1):
      url: str = url_collector.get_delfino_link(number)
      if file_manager.html_exists(save_folder_path, url) and not is_error_html(file_manager.load_html(save_folder_path, url)):
        return number
    return first_expediente - 1

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

def is_error_html(html: str) -> bool:
  return re.fullmatch(r"Error (\d{3})", html) is not None

def news_processed_count(current: int, max: int, name: str = ""):
   prefix: str = f"[{name}] " if name else ""
   print(f"{prefix}{current} out of {max} news processed. ({current * 100.0/max:.2f}% completed)")