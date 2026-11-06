import pathlib
import sqlite3
from datetime import datetime

from config import Config

from tools.scraping_tools.bill import Bill, BillEvent, BillProponent, DeputyVote
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
          law_number     INTEGER,
          flag           TEXT
      ) STRICT
      """
    exp_cat_table = """
      CREATE TABLE IF NOT EXISTS bill_categories(
          number   INTEGER NOT NULL REFERENCES bills(number),
          category TEXT NOT NULL,
          PRIMARY KEY (number, category)
      ) STRICT
      """
    # Firma Principal (role "main") and Co-proponentes (role "co") of each bill, as Delfino shows them.
    # kind is "deputy" or "special" (the executive, e.g. "Gobierno Chaves Robles"); special ones have no seat.
    proponents_table = """
      CREATE TABLE IF NOT EXISTS bill_proponents(
          number      INTEGER NOT NULL REFERENCES bills(number),
          slug        TEXT NOT NULL,
          name        TEXT NOT NULL,
          role        TEXT NOT NULL,
          kind        TEXT NOT NULL,
          party       TEXT,
          position    TEXT,
          province    TEXT,
          seat        INTEGER,
          PRIMARY KEY (number, slug)
      ) STRICT
      """
    # Histórico de Textos (event_type "text") and Histórico de Votaciones (event_type "vote"), in page order.
    events_table = """
      CREATE TABLE IF NOT EXISTS bill_events(
          number      INTEGER NOT NULL REFERENCES bills(number),
          position    INTEGER NOT NULL,
          event_type  TEXT NOT NULL,
          date        TEXT,
          name        TEXT NOT NULL,
          description TEXT,
          result      TEXT,
          url         TEXT,
          vote_id     TEXT,
          PRIMARY KEY (number, event_type, position)
      ) STRICT
      """
    # How each deputy voted in a Plenario vote (one row per deputy), joined to bill_events by (number, vote_id).
    # vote is "for", "against" or "absent".
    votes_table = """
      CREATE TABLE IF NOT EXISTS bill_votes(
          number      INTEGER NOT NULL REFERENCES bills(number),
          vote_id     TEXT NOT NULL,
          slug        TEXT NOT NULL,
          name        TEXT NOT NULL,
          party       TEXT,
          seat        INTEGER,
          vote        TEXT NOT NULL,
          PRIMARY KEY (number, vote_id, slug)
      ) STRICT
      """
    self.cursor.execute(news_table)
    self.add_missing_news_columns()
    self.cursor.execute(news_exp_links_table)
    self.cursor.execute(exp_table)
    self.add_missing_bill_columns()
    self.cursor.execute(exp_cat_table)
    self.cursor.execute(proponents_table)
    self.cursor.execute(events_table)
    self.add_missing_bill_event_columns()
    self.cursor.execute(votes_table)
    self.connection.commit()

  def add_missing_bill_columns(self):
    """Adds flag to a bills table created before it existed (#21)."""
    self.cursor.execute("PRAGMA table_info(bills)")
    columns = [r[1] for r in self.cursor.fetchall()]
    if "flag" not in columns:
      self.cursor.execute("ALTER TABLE bills ADD COLUMN flag TEXT")

  def add_missing_bill_event_columns(self):
    """Adds vote_id to a bill_events table created before it existed."""
    self.cursor.execute("PRAGMA table_info(bill_events)")
    columns = [r[1] for r in self.cursor.fetchall()]
    if "vote_id" not in columns:
      self.cursor.execute("ALTER TABLE bill_events ADD COLUMN vote_id TEXT")

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
    flag = bill.flag
    # Upsert: a refreshed bill (#23) overwrites status, commission, law number... of the stored one.
    self.cursor.execute(f"""INSERT INTO bills (number, name, description, date_extracted, file_type, status, commission, date_proposed, law_number, flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(number) DO UPDATE SET name = excluded.name, description = excluded.description,
        date_extracted = excluded.date_extracted, file_type = excluded.file_type, status = excluded.status,
        commission = excluded.commission, date_proposed = excluded.date_proposed, law_number = excluded.law_number,
        flag = excluded.flag""",
      [number, name, desc, date_extracted, file_type, status, commission, date_proposed, law_number, flag])
    self.insert_bill_categories(bill, False)
    self.insert_bill_proponents(bill, False)
    self.insert_bill_events(bill, False)
    if should_commit:
      self.connection.commit()

  def insert_bill_categories(self, bill: Bill, should_commit: bool = False):
    """Replaces the bill's categories with the current ones (they can change on a refresh)."""
    number = bill.number
    categories = bill.categories
    self.cursor.execute("DELETE FROM bill_categories WHERE number = ?", [number])
    for c in categories:
      self.cursor.execute(f"INSERT INTO bill_categories (number, category) VALUES (?, ?) ON CONFLICT(number, category) DO NOTHING", [number, c])
    if should_commit:
      self.connection.commit()

  def insert_bill_proponents(self, bill: Bill, should_commit: bool = False):
    """Replaces the bill's proponents with the current ones. A deputy listed twice keeps the first role (main)."""
    self.cursor.execute("DELETE FROM bill_proponents WHERE number = ?", [bill.number])
    for p in bill.proponents:
      self.cursor.execute("INSERT INTO bill_proponents (number, slug, name, role, kind, party, position, province, seat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(number, slug) DO NOTHING",
                          [bill.number, p.slug, p.name, p.role, p.kind, p.party, p.position, p.province, p.seat])
    if should_commit:
      self.connection.commit()

  def insert_bill_events(self, bill: Bill, should_commit: bool = False):
    """
    Replaces the bill's text and vote history with the current one; position keeps Delfino's order per type.
    The deputies' votes are replaced too, except when the new events carry none (vote pages not read in this run).
    """
    self.cursor.execute("DELETE FROM bill_events WHERE number = ?", [bill.number])
    has_deputy_votes: bool = any(e.deputy_votes for e in bill.events)
    if has_deputy_votes:
      self.cursor.execute("DELETE FROM bill_votes WHERE number = ?", [bill.number])
    positions: dict[str, int] = {}
    for e in bill.events:
      position = positions.get(e.event_type, 0)
      positions[e.event_type] = position + 1
      date = e.date.date().isoformat() if e.date else None
      self.cursor.execute("INSERT INTO bill_events (number, position, event_type, date, name, description, result, url, vote_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                          [bill.number, position, e.event_type, date, e.name, e.description, e.result, e.url, e.vote_id])
      for v in e.deputy_votes:
        self.cursor.execute("INSERT INTO bill_votes (number, vote_id, slug, name, party, seat, vote) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(number, vote_id, slug) DO NOTHING",
                            [bill.number, e.vote_id, v.slug, v.name, v.party, v.seat, v.vote])
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
    self.cursor.execute("SELECT number, name, description, date_extracted, file_type, status, commission, date_proposed, law_number, flag FROM bills")
    results = self.cursor.fetchall()

    proponents: dict[int, list[BillProponent]] = {}
    self.cursor.execute("SELECT number, slug, name, role, kind, party, position, province, seat FROM bill_proponents ORDER BY number, rowid")   # insertion order = page order
    for r in self.cursor.fetchall():
      proponents.setdefault(r[0], []).append(BillProponent(r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]))

    deputy_votes: dict[tuple[int, str], list[DeputyVote]] = {}
    self.cursor.execute("SELECT number, vote_id, slug, name, vote, party, seat FROM bill_votes ORDER BY number, vote_id, rowid")
    for r in self.cursor.fetchall():
      deputy_votes.setdefault((r[0], r[1]), []).append(DeputyVote(r[2], r[3], r[4], r[5], r[6]))

    events: dict[int, list[BillEvent]] = {}
    self.cursor.execute("SELECT number, event_type, date, name, description, result, url, vote_id FROM bill_events ORDER BY number, event_type, position")
    for r in self.cursor.fetchall():
      events.setdefault(r[0], []).append(BillEvent(r[1], datetime.fromisoformat(r[2]) if r[2] else None, r[3], r[4], r[5], r[6], r[7],
                                                   deputy_votes.get((r[0], r[7]), [])))

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
      bill: Bill = Bill(r[0], r[1], r[2], datetime.fromisoformat(r[3]), r[4], r[5], r[6], date_proposed, r[8], bill_categories.get(r[0], []),
                        r[9], proponents.get(r[0], []), events.get(r[0], []))
      bills.append(bill)
    
    return bills