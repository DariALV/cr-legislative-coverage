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
    self.scrap_delfino()

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

  def scrap_delfino(self, fetcher: HTMLFetcher, scrap_urls: bool = False) -> list[Expediente]:
    save_folder_path: str = "raw/html/delfino/asamblea/expedientes"
    url_collector: UrlCollector = UrlCollector()
    file_manager: FileManager = FileManager()
    parser: DelfinoParser = DelfinoParser()

    delfino_urls: list[str] = []
    if scrap_urls:
      delfino_urls = url_collector.get_delfino_links(25820)
      file_manager.save_dict_as_json("raw/links/delfino", "delfino_links", {"links": delfino_urls})
    else:
      delfino_urls = file_manager.load_json_as_dict("raw/links/delfino", "delfino_links")["links"]
    
    fetcher.fetch_multiple(save_folder_path, delfino_urls)

    expedientes: list[Expediente] = []

    for url in delfino_urls:
      if file_manager.html_exists(save_folder_path, url):
        html = file_manager.load_html(save_folder_path, url)
        if re.fullmatch(r"Error (\d{3})", html):
          print(f"Url {url} found {html.lower()}")
        else:
          expediente: Expediente = parser.parse(html, url)
          expedientes.append(expediente)
      
    return expedientes

  def apply_embeddings(self):
    pass

def news_processed_count(current, max):
   print(f"{current} out of {max} news processed. ({current * 100.0/max:.2f}% completed)")