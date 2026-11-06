import pathlib
import sqlite3
from datetime import datetime

from config import Config

from tools.scraping_tools.bill import Bill
from tools.scraping_tools.news_article import NewsArticle


class Database:

  def __init__(self, save_path: str, name: str):
    pathlib.Path(save_path).mkdir(parents = True, exist_ok = True)   # sqlite creates the file, not the folder
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
    # Bill numbers a news article explicitly points to (e.g. Delfino links to /asamblea/proyecto/<number>).
    # No foreign key to bills: a news can cite a bill that is not collected yet.
    news_exp_links_table = """
      CREATE TABLE IF NOT EXISTS news_bill_links(
          news_id           TEXT NOT NULL REFERENCES news_articles(id),
          bill_number INTEGER NOT NULL,
          source            TEXT NOT NULL,
          PRIMARY KEY (news_id, bill_number, source)
      ) STRICT
      """
    exp_table = """
      CREATE TABLE IF NOT EXISTS bills(
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
      CREATE TABLE IF NOT EXISTS bill_categories(
          number   INTEGER NOT NULL REFERENCES bills(number),
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

  def insert_news_bill_links(self, news_id: str, bill_numbers: list[int], source: str, should_commit: bool = False):
    for number in bill_numbers:
      self.cursor.execute(f"INSERT INTO news_bill_links (news_id, bill_number, source) VALUES (?, ?, ?) ON CONFLICT(news_id, bill_number, source) DO NOTHING", [news_id, number, source])
    if should_commit:
      self.connection.commit()

  def insert_news_bill_links_map(self, links: dict[str, list[int]], source: str):
    """Inserts {news_id: [bill numbers]} (as returned by Pipeline.scrap_delfino_news) and commits."""
    for news_id, bill_numbers in links.items():
      self.insert_news_bill_links(news_id, bill_numbers, source)
    self.connection.commit()

  def get_news_bill_links(self, source: str | None = None) -> list[tuple[str, int, str]]:
    if source is None:
      self.cursor.execute("SELECT news_id, bill_number, source FROM news_bill_links")
    else:
      self.cursor.execute("SELECT news_id, bill_number, source FROM news_bill_links WHERE source = ?", [source])
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

  def insert_bill(self, bill: Bill, should_commit: bool = False):
    number = bill.number
    name = bill.name
    desc = bill.description
    date_extracted = bill.date_extracted.isoformat()
    file_type = bill.file_type
    status = bill.status
    commission = bill.commission
    date_proposed = bill.date_proposed.isoformat() if bill.date_proposed else None   # optional in Bill
    law_number = bill.law_number
    self.cursor.execute(f"INSERT INTO bills (number, name, description, date_extracted, file_type, status, commission, date_proposed, law_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(number) DO NOTHING", [number, name, desc, date_extracted, file_type, status, commission, date_proposed, law_number])
    self.insert_bill_categories(bill, False)
    if should_commit:
      self.connection.commit()

  def insert_bill_categories(self, bill: Bill, should_commit: bool = False):
    number = bill.number
    categories = bill.categories
    for c in categories:
      self.cursor.execute(f"INSERT INTO bill_categories (number, category) VALUES (?, ?) ON CONFLICT(number, category) DO NOTHING", [number, c])
    if should_commit:
      self.connection.commit()

  def insert_bills(self, bill_list: list[Bill]):

    max_steps_to_commit = Config.COMMIT_BATCH_SIZE
    steps_to_commit = max_steps_to_commit

    for bill in bill_list:
      self.insert_bill(bill)
      steps_to_commit -= 1
      if steps_to_commit == 0:
        steps_to_commit = max_steps_to_commit
        self.connection.commit()
    
    self.connection.commit()

  def get_bills(self) -> list[Bill]:
    self.cursor.execute("SELECT * FROM bills")
    results = self.cursor.fetchall()

    bill_categories = {}

    self.cursor.execute("SELECT number, category FROM bill_categories")
    exp_categories_result = self.cursor.fetchall()
    for r in exp_categories_result:
      number = r[0]
      category = r[1]
      if number not in bill_categories.keys():
        bill_categories[number] = [category]
      else:
        bill_categories[number].append(category)

    bills: list[Bill] = []

    for r in results:
      date_proposed = datetime.fromisoformat(r[7]) if r[7] else None
      bill: Bill = Bill(r[0], r[1], r[2], datetime.fromisoformat(r[3]), r[4], r[5], r[6], date_proposed, r[8], bill_categories.get(r[0], []))
      bills.append(bill)
    
    return bills