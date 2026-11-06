import pathlib
import sqlite3
from datetime import date, datetime

from config import Config

from tools.scraping_tools.asamblea import AsambleaData
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
    self.create_asamblea_tables()
    self.connection.commit()

  def create_asamblea_tables(self):
    """
    Deputies and legislative organs from the Asamblea's SIL (#65). Ids are the SIL's. No cédulas are stored:
    person_id is the SIL's internal IdCEDULA. Bill numbers have no foreign key (bills from SIL come in #66).
    """
    tables = [
      # One deputy in one term (IdDIPUTADO). Only terms still running on or after Config.DEPUTIES_SINCE.
      """CREATE TABLE IF NOT EXISTS deputies(
          deputy_id      INTEGER PRIMARY KEY,
          person_id      INTEGER,
          surnames       TEXT NOT NULL,
          names          TEXT NOT NULL,
          term           TEXT NOT NULL,
          province       TEXT,
          seat           INTEGER,
          status         TEXT,
          date_from      TEXT,
          date_to        TEXT,
          date_extracted TEXT NOT NULL
      ) STRICT""",
      # Faction stints of each person (all their terms): a deputy who became independent has two rows in a term.
      # faction_id is the SIL's id of the faction (e.g. 43 = Liberación Nacional in every term), not of the stint.
      """CREATE TABLE IF NOT EXISTS deputy_factions(
          person_id  INTEGER,
          faction_id INTEGER NOT NULL,
          term       TEXT NOT NULL,
          faction    TEXT NOT NULL,
          province   TEXT,
          date_from  TEXT,
          date_to    TEXT,
          UNIQUE (person_id, faction_id, date_from)
      ) STRICT""",
      # Every term each person served (Administraciones), including those before Config.DEPUTIES_SINCE.
      """CREATE TABLE IF NOT EXISTS deputy_terms(
          person_id INTEGER NOT NULL,
          term      TEXT NOT NULL,
          province  TEXT,
          PRIMARY KEY (person_id, term)
      ) STRICT""",
      """CREATE TABLE IF NOT EXISTS deputy_replacements(
          person_id INTEGER,
          detail    TEXT,
          name      TEXT,
          date      TEXT,
          UNIQUE (person_id, detail, name, date)
      ) STRICT""",
      # Bills each deputy term signed (Expedientes presentados), main signer or co-signer.
      """CREATE TABLE IF NOT EXISTS deputy_bills(
          deputy_id    INTEGER NOT NULL REFERENCES deputies(deputy_id),
          bill_number  INTEGER NOT NULL,
          proponent_id INTEGER NOT NULL,
          term         TEXT,
          PRIMARY KEY (deputy_id, bill_number)
      ) STRICT""",
      """CREATE TABLE IF NOT EXISTS organs(
          organ_code       INTEGER PRIMARY KEY,
          organ_id         INTEGER NOT NULL,
          organ_type       TEXT,
          name             TEXT NOT NULL,
          date_constituted TEXT,
          date_dissolved   TEXT,
          status           TEXT,
          date_extracted   TEXT NOT NULL
      ) STRICT""",
      # Positions of each deputy term in each organ, per one-year legislature (Puestos). organ_code joins organs.
      """CREATE TABLE IF NOT EXISTS organ_memberships(
          membership_id INTEGER PRIMARY KEY,
          deputy_id     INTEGER NOT NULL REFERENCES deputies(deputy_id),
          organ_code    INTEGER NOT NULL,
          organ_name    TEXT,
          position      TEXT,
          legislature   TEXT,
          date_joined   TEXT,
          date_left     TEXT
      ) STRICT""",
      # Bills each active organ holds on date_extracted (Expedientes que atiende): a snapshot, not a history.
      """CREATE TABLE IF NOT EXISTS organ_bills(
          organ_code     INTEGER NOT NULL REFERENCES organs(organ_code),
          bill_number    INTEGER NOT NULL,
          date_start     TEXT,
          date_end       TEXT,
          last_step      TEXT,
          date_extracted TEXT NOT NULL,
          PRIMARY KEY (organ_code, bill_number)
      ) STRICT""",
    ]
    for table in tables:
      self.cursor.execute(table)

  def replace_asamblea_tables(self, data: AsambleaData, date_extracted: datetime) -> dict[str, int]:
    """
    Replaces every SIL table with data (built from the cached CSVs), in one transaction: an error or Ctrl+C
    leaves the previous tables untouched. Rows repeated across terms of the same person are kept once.
    Returns the number of rows per table.
    """
    extracted = date_extracted.isoformat()
    try:
      for table in ["organ_bills", "organ_memberships", "deputy_bills", "deputy_replacements", "deputy_terms",
                    "deputy_factions", "deputies", "organs"]:
        self.cursor.execute(f"DELETE FROM {table}")
      self.cursor.executemany("INSERT INTO deputies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [(d.deputy_id, d.person_id, d.surnames, d.names, d.term, d.province, d.seat, d.status,
          iso(d.date_from), iso(d.date_to), extracted) for d in data.deputies])
      self.cursor.executemany("INSERT INTO deputy_factions VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        [(f.person_id, f.faction_id, f.term, f.faction, f.province, iso(f.date_from), iso(f.date_to)) for f in data.deputy_factions])
      self.cursor.executemany("INSERT INTO deputy_terms VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        [(t.person_id, t.term, t.province) for t in data.deputy_terms])
      self.cursor.executemany("INSERT INTO deputy_replacements VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
        [(r.person_id, r.detail, r.name, iso(r.date)) for r in data.deputy_replacements])
      self.cursor.executemany("INSERT INTO deputy_bills VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
        [(b.deputy_id, b.bill_number, b.proponent_id, b.term) for b in data.deputy_bills])
      self.cursor.executemany("INSERT INTO organs VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [(o.organ_code, o.organ_id, o.organ_type, o.name, iso(o.date_constituted), iso(o.date_dissolved), o.status, extracted)
         for o in data.organs])
      self.cursor.executemany("INSERT INTO organ_memberships VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        [(m.membership_id, m.deputy_id, m.organ_code, m.organ_name, m.position, m.legislature, iso(m.date_joined), iso(m.date_left))
         for m in data.organ_memberships])
      self.cursor.executemany("INSERT INTO organ_bills VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        [(b.organ_code, b.bill_number, iso(b.date_start), iso(b.date_end), b.last_step, extracted) for b in data.organ_bills])
      self.connection.commit()
    except BaseException:
      self.connection.rollback()
      raise
    counts: dict[str, int] = {}
    for table in ["deputies", "deputy_factions", "deputy_terms", "deputy_replacements", "deputy_bills", "organs",
                  "organ_memberships", "organ_bills"]:
      self.cursor.execute(f"SELECT COUNT(*) FROM {table}")
      counts[table] = self.cursor.fetchone()[0]
    return counts

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

def iso(value: date | None) -> str | None:
  return value.isoformat() if value else None
