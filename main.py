from pipeline import Pipeline
from tools.scraping_tools.html_fetcher import HTMLFetcher

fetcher: HTMLFetcher = HTMLFetcher("uni-project", 1, 5)
pipeline: Pipeline = Pipeline()

expedientes = pipeline.scrap_delfino(fetcher, True)