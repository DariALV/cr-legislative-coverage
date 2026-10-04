from pipeline import Pipeline
from tools.scraping_tools.html_fetcher import HTMLFetcher
from tools.file_tools.file_manager import FileManager
from tools.scraping_tools.url_collector import UrlCollector
from tools.database_tools.database import Database

fetcher: HTMLFetcher = HTMLFetcher("uni-project", 1, 5)
pipeline: Pipeline = Pipeline()
database: Database = Database("databases", "private_corpus")

news_articles = pipeline.scrap_crhoy(fetcher)

# expedientes = pipeline.scrap_delfino(fetcher)

database.create_private_corpus_tables()
database.insert_news_articles(news_articles)

articles_from_db = database.get_news_articles()

for art in articles_from_db:
  print(art)

print(len(articles_from_db))