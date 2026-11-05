import sqlite3
from datetime import datetime

from config import Config

from tools.scraping_tools.expediente import Expediente
from tools.scraping_tools.news_article import NewsArticle


class Database:

  def __init__(self, save_path: str, name: str):
    self.connection = sqlite3.connect(f"{save_path}/{name}.db")
    self.cursor = self.connection.cursor()
  
  def create_private_corpus_tables(self):
    news_table = """
      CREATE TABLE IF NOT EXISTS news_articles(
          id                TEXT PRIMARY KEY,
          url               TEXT NOT NULL UNIQUE,
          organization      TEXT NOT NULL,
          title             TEXT NOT NULL,
          description       TEXT,
          date_published    TEXT NOT NULL,
          author            TEXT,
          content           TEXT,
          date_extracted    TEXT NOT NULL,
          extraction_status TEXT NOT NULL,
          outlet_type       TEXT NOT NULL DEFAULT 'general',
          section           TEXT
      ) STRICT
      """
    # Expediente numbers a news article explicitly points to (e.g. Delfino links to /asamblea/proyecto/<number>).
    # No foreign key to expedientes: a news can cite an expediente that is not collected yet.
    news_exp_links_table = """
      CREATE TABLE IF NOT EXISTS news_expediente_links(
          news_id           TEXT NOT NULL REFERENCES news_articles(id),
          expediente_number INTEGER NOT NULL,
          source            TEXT NOT NULL,
          PRIMARY KEY (news_id, expediente_number, source)
      ) STRICT
      """
    exp_table = """
      CREATE TABLE IF NOT EXISTS expedientes(
          number         INTEGER PRIMARY KEY,
          name           TEXT NOT NULL,
          description    TEXT,
          date_extracted TEXT NOT NULL,
          file_type      TEXT,
          status         TEXT,
          commission     TEXT,
          date_proposed  TEXT,
          law_number     INTEGER
      ) STRICT
      """
    exp_cat_table = """
      CREATE TABLE IF NOT EXISTS expediente_categories(
          number   INTEGER NOT NULL REFERENCES expedientes(number),
          category TEXT NOT NULL,
          PRIMARY KEY (number, category)
      ) STRICT
      """
    self.cursor.execute(news_table)
    self.add_missing_news_columns()
    self.cursor.execute(news_exp_links_table)
    self.cursor.execute(exp_table)
    self.cursor.execute(exp_cat_table)
    self.connection.commit()

  def add_missing_news_columns(self):
    """Adds outlet_type and section to a news_articles table created before they existed (appended at the end)."""
    self.cursor.execute("PRAGMA table_info(news_articles)")
    columns = [r[1] for r in self.cursor.fetchall()]
    if "outlet_type" not in columns:
      self.cursor.execute("ALTER TABLE news_articles ADD COLUMN outlet_type TEXT NOT NULL DEFAULT 'general'")
    if "section" not in columns:
      self.cursor.execute("ALTER TABLE news_articles ADD COLUMN section TEXT")
  
  def insert_news_article(self, article: NewsArticle, should_commit: bool = False):
    id = article.id
    url = article.url
    organization = article.organization
    title = article.title
    description = article.description
    date_published = article.date_published.isoformat()
    author = article.author
    content = article.content
    date_extracted = article.date_extracted.isoformat()
    extraction_status = article.extraction_status
    outlet_type = article.outlet_type
    section = article.section
    self.cursor.execute(f"INSERT INTO news_articles (id, url, organization, title, description, date_published, author, content, date_extracted, extraction_status, outlet_type, section) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING", [id, url, organization, title, description, date_published, author, content, date_extracted, extraction_status, outlet_type, section])
    if should_commit:
      self.connection.commit()

  def insert_news_expediente_links(self, news_id: str, expediente_numbers: list[int], source: str, should_commit: bool = False):
    for number in expediente_numbers:
      self.cursor.execute(f"INSERT INTO news_expediente_links (news_id, expediente_number, source) VALUES (?, ?, ?) ON CONFLICT(news_id, expediente_number, source) DO NOTHING", [news_id, number, source])
    if should_commit:
      self.connection.commit()

  def get_news_expediente_links(self, source: str | None = None) -> list[tuple[str, int, str]]:
    if source is None:
      self.cursor.execute("SELECT news_id, expediente_number, source FROM news_expediente_links")
    else:
      self.cursor.execute("SELECT news_id, expediente_number, source FROM news_expediente_links WHERE source = ?", [source])
    return self.cursor.fetchall()

  def insert_news_articles(self, article_list: list[NewsArticle]):

    max_steps_to_commit = Config.COMMIT_BATCH_SIZE
    steps_to_commit = max_steps_to_commit

    for article in article_list:
      self.insert_news_article(article)
      steps_to_commit -= 1
      if steps_to_commit == 0:
        steps_to_commit = max_steps_to_commit
        self.connection.commit()
    
    self.connection.commit()

  def get_news_articles(self) -> list[NewsArticle]:
    self.cursor.execute("SELECT * FROM news_articles")
    results = self.cursor.fetchall()

    news_articles: list[NewsArticle] = []

    for r in results:
      article: NewsArticle = NewsArticle(r[0], r[1], r[2], r[3], r[4], datetime.fromisoformat(r[5]), r[6], r[7], datetime.fromisoformat(r[8]), r[9], r[10], r[11])
      news_articles.append(article)
    
    return news_articles

  def insert_expediente(self, exp: Expediente, should_commit: bool = False):
    number = exp.number
    name = exp.name
    desc = exp.description
    date_extracted = exp.date_extracted.isoformat()
    file_type = exp.file_type
    status = exp.status
    commission = exp.commission
    date_proposed = exp.date_proposed.isoformat()
    law_number = exp.law_number
    self.cursor.execute(f"INSERT INTO expedientes (number, name, description, date_extracted, file_type, status, commission, date_proposed, law_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(number) DO NOTHING", [number, name, desc, date_extracted, file_type, status, commission, date_proposed, law_number])
    self.insert_expediente_categories(exp, False)
    if should_commit:
      self.connection.commit()

  def insert_expediente_categories(self, exp: Expediente, should_commit: bool = False):
    number = exp.number
    categories = exp.categories
    for c in categories:
      self.cursor.execute(f"INSERT INTO expediente_categories (number, category) VALUES (?, ?) ON CONFLICT(number, category) DO NOTHING", [number, c])
    if should_commit:
      self.connection.commit()

  def insert_expedientes(self, exp_list: list[Expediente]):

    max_steps_to_commit = Config.COMMIT_BATCH_SIZE
    steps_to_commit = max_steps_to_commit

    for exp in exp_list:
      self.insert_expediente(exp)
      steps_to_commit -= 1
      if steps_to_commit == 0:
        steps_to_commit = max_steps_to_commit
        self.connection.commit()
    
    self.connection.commit()

  def get_expedientes(self) -> list[Expediente]:
    self.cursor.execute("SELECT * FROM expedientes")
    results = self.cursor.fetchall()

    exp_categories = {}

    self.cursor.execute("SELECT number, category FROM expediente_categories")
    exp_categories_result = self.cursor.fetchall()
    for r in exp_categories_result:
      number = r[0]
      category = r[1]
      if number not in exp_categories.keys():
        exp_categories[number] = [category]
      else:
        exp_categories[number].append(category)

    expedientes: list[Expediente] = []

    for r in results:
      exp: Expediente = Expediente(r[0], r[1], r[2], datetime.fromisoformat(r[3]), r[4], r[5], r[6], datetime.fromisoformat(r[7]), r[8], exp_categories[r[0]])
      expedientes.append(exp)
    
    return expedientes