from pipeline import Pipeline
from tools.scraping_tools.html_fetcher import HTMLFetcher
from tools.file_tools.file_manager import FileManager
from tools.scraping_tools.url_collector import UrlCollector

fetcher: HTMLFetcher = HTMLFetcher("uni-project", 1, 5)
pipeline: Pipeline = Pipeline()

expedientes = pipeline.scrap_delfino(fetcher)

for exp in expedientes:
  print(exp)