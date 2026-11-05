import re

from tools.scraping_tools.html_fetcher import HTMLFetcher
from tools.scraping_tools.crhoy_parser import CRHoyParser
from tools.scraping_tools.delfino_parser import DelfinoParser, Metadata
from tools.scraping_tools.news_article import NewsArticle
from tools.scraping_tools.expediente import Expediente
from tools.scraping_tools.url_collector import UrlCollector
from tools.file_tools.file_manager import FileManager

class Pipeline:
  def scrap_websites(self):
    fetcher: HTMLFetcher = HTMLFetcher("uni-project", 1, 5)
    self.scrap_crhoy(fetcher)
    self.scrap_delfino(fetcher)

  def scrap_crhoy(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False) -> list[NewsArticle]:
    save_folder_path: str = "raw/html/crhoy/news"
    url_collector: UrlCollector = UrlCollector()
    file_manager: FileManager = FileManager()
    parser: CRHoyParser = CRHoyParser()

    crhoy_urls: list[str] = []
    if scrap_urls:
      crhoy_urls = url_collector.get_crhoy_links()
      file_manager.save_dict_as_json("raw/links/crhoy", "crhoy_links", {"links": crhoy_urls})
    else:
      crhoy_urls = file_manager.load_json_as_dict("raw/links/crhoy", "crhoy_links")["links"]
    
    if scrap_new_htmls:
      fetcher.fetch_multiple(save_folder_path, crhoy_urls)

    news_articles: list[NewsArticle] = []

    filtered_urls: list[str] = []
    for url in crhoy_urls:
      if not "/caricaturas/" in url and not "/gusto/" in url and file_manager.html_exists(save_folder_path, url):
        filtered_urls.append(url)

    for i in range(len(filtered_urls)):
      url: str = filtered_urls[i]
      news_processed_count(i + 1, len(filtered_urls))
      html = file_manager.load_html(save_folder_path, url)
      if re.fullmatch(r"Error (\d{3})", html):
        print(f"Url {url} found {html.lower()}")
      else:
        news_article: NewsArticle = parser.parse(html, url)
        if news_article:
          news_articles.append(news_article)
    return news_articles

  def scrap_delfino(self, fetcher: HTMLFetcher, first_expediente: int = 20000, max_expediente: int = 100000,
                    max_consecutive_errors: int = 5) -> list[Expediente]:
    """
    Walks expedientes from first_expediente upwards. Errors only count once we are past the last
    successfully collected expediente; it stops after max_consecutive_errors errors in a row there
    (or at max_expediente).
    """
    save_folder_path: str = "raw/html/delfino/asamblea/expedientes"
    url_collector: UrlCollector = UrlCollector()
    file_manager: FileManager = FileManager()
    parser: DelfinoParser = DelfinoParser()

    last_success: int = self.last_cached_delfino_success(file_manager, url_collector, save_folder_path, first_expediente, max_expediente)
    print(f"Last expediente already collected: {last_success if last_success >= first_expediente else 'none'}")

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
        print(f"Scraping expediente {number}")
        html = fetcher.fetch(save_folder_path, url)

      if is_error_html(html):
        print(f"Url {url} found {html.lower()}")
        if number > last_success:
          consecutive_errors += 1
          if consecutive_errors >= max_consecutive_errors:
            print(f"{consecutive_errors} consecutive errors after expediente {last_success}, stopping.")
            break
        continue

      consecutive_errors = 0
      last_success = max(last_success, number)
      collected_urls.append(url)
      expediente: Expediente = parser.parse(html, url)
      expedientes.append(expediente)

    file_manager.save_dict_as_json("raw/links/delfino", "delfino_links", {"links": collected_urls})
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

def is_error_html(html: str) -> bool:
  return re.fullmatch(r"Error (\d{3})", html) is not None

def news_processed_count(current: int, max: int):
   print(f"{current} out of {max} news processed. ({current * 100.0/max:.2f}% completed)")