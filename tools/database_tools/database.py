import pathlib
import sqlite3
from datetime import date, datetime

from config import Config

from tools.scraping_tools.asamblea import AsambleaData
from tools.scraping_tools.bill import Bill, Law, Vote
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
    self.cursor.execute(news_table)
    self.add_missing_news_columns()
    self.cursor.execute(news_exp_links_table)
    self.drop_delfino_bill_tables()
    self.create_bill_tables()
    self.create_asamblea_tables()
    self.connection.commit()

  def drop_delfino_bill_tables(self):
    """
    Bills used to come from Delfino (bills with a description column, bill_categories, bill_events, bill_votes).
    They are replaced by the SIL tables and the Delfino vote tables (#66), so the old ones are dropped once.
    """
    self.cursor.execute("PRAGMA table_info(bills)")
    if "description" in [r[1] for r in self.cursor.fetchall()]:
      for table in ["bill_votes", "bill_events", "bill_categories", "bill_proponents", "bills"]:
        self.cursor.execute(f"DROP TABLE IF EXISTS {table}")

  def create_bill_tables(self):
    """
    Bills from the Asamblea's SIL (#66) and Plenario votes from Delfino (#22). Bill numbers in votes have no foreign
    key: Delfino lists votes of bills the SIL tables may not hold yet.
    """
    tables = [
      # status is derived: "law" (has a law number), "archived" (has an archive number) or "in progress".
      """CREATE TABLE IF NOT EXISTS bills(
          number                INTEGER PRIMARY KEY,
          name                  TEXT NOT NULL,
          file_type             TEXT,
          date_proposed         TEXT,
          law_number            INTEGER,
          archive_number        INTEGER,
          date_expiry           TEXT,
          date_expiry_four_year TEXT,
          status                TEXT,
          flag                  TEXT,
          date_extracted        TEXT NOT NULL
      ) STRICT""",
      # Signers in signing order (1 = main signer). deputy_id is matched by name and term; None for the executive.
      """CREATE TABLE IF NOT EXISTS bill_proponents(
          proponent_id  INTEGER PRIMARY KEY,
          number        INTEGER NOT NULL REFERENCES bills(number),
          name          TEXT NOT NULL,
          term          TEXT,
          signing_order INTEGER,
          deputy_id     INTEGER
      ) STRICT""",
      # Tramitación: every step of the bill, in every organ.
      """CREATE TABLE IF NOT EXISTS bill_steps(
          step_id     INTEGER PRIMARY KEY,
          number      INTEGER NOT NULL REFERENCES bills(number),
          organ       TEXT,
          description TEXT NOT NULL,
          date_start  TEXT,
          date_end    TEXT
      ) STRICT""",
      # Materias: the SIL's official descriptors (replace Delfino's categories).
      """CREATE TABLE IF NOT EXISTS bill_subjects(
          number       INTEGER NOT NULL REFERENCES bills(number),
          subject_code INTEGER NOT NULL,
          subject      TEXT NOT NULL,
          PRIMARY KEY (number, subject_code)
      ) STRICT""",
      # "Texto base" (#32): one row per bill whose text was downloaded. status is "ok", "no_exposition" (text without
      # the markers, e.g. budget bills) or "no_text" (the SIL has none). The full text stays in raw/text/asamblea/bills.
      """CREATE TABLE IF NOT EXISTS bill_texts(
          number           INTEGER PRIMARY KEY REFERENCES bills(number),
          status           TEXT NOT NULL,
          exposition       TEXT,
          total_words      INTEGER,
          exposition_words INTEGER
      ) STRICT""",
      # Every law in the SIL (not only those of bills from Config.FIRST_BILL on). One row per law × bill: a few old
      # laws merged several bills (e.g. law 4347 of 1969 came from 4).
      """CREATE TABLE IF NOT EXISTS laws(
          law_id      INTEGER NOT NULL,
          law_number  INTEGER NOT NULL,
          bill_number INTEGER,
          title       TEXT,
          UNIQUE (law_id, bill_number)
      ) STRICT""",
      # Plenario and comisión plena votes from Delfino's votes list. kind is "plenary" or "full_committee".
      """CREATE TABLE IF NOT EXISTS votes(
          vote_id     TEXT PRIMARY KEY,
          number      INTEGER NOT NULL,
          date        TEXT,
          name        TEXT NOT NULL,
          description TEXT,
          result      TEXT,
          url         TEXT,
          kind        TEXT NOT NULL DEFAULT 'plenary'
      ) STRICT""",
      # How each deputy voted (one row per deputy): vote is "for", "against" or "absent" (other labels kept).
      # deputy_id is matched to deputies by name and the vote date.
      """CREATE TABLE IF NOT EXISTS vote_deputies(
          vote_id   TEXT NOT NULL REFERENCES votes(vote_id),
          slug      TEXT NOT NULL,
          name      TEXT NOT NULL,
          party     TEXT,
          seat      INTEGER,
          vote      TEXT NOT NULL,
          deputy_id INTEGER,
          PRIMARY KEY (vote_id, slug)
      ) STRICT""",
    ]
    for table in tables:
      self.cursor.execute(table)
    self.add_missing_vote_columns()

  def add_missing_vote_columns(self):
    """Adds kind to a votes table created before it existed (appended at the end; earlier rows are Plenario votes)."""
    self.cursor.execute("PRAGMA table_info(votes)")
    if "kind" not in [r[1] for r in self.cursor.fetchall()]:
      self.cursor.execute("ALTER TABLE votes ADD COLUMN kind TEXT NOT NULL DEFAULT 'plenary'")

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

  def replace_bill_tables(self, bills: list[Bill], laws: list[Law]) -> dict[str, int]:
    """
    Replaces the SIL bill tables (bills, proponents, steps, subjects, texts, laws) in one transaction: an error or
    Ctrl+C leaves the previous tables untouched. Returns the number of rows per table.
    """
    tables = ["bill_texts", "bill_subjects", "bill_steps", "bill_proponents", "bills", "laws"]
    try:
      for table in tables:
        self.cursor.execute(f"DELETE FROM {table}")
      self.cursor.executemany("INSERT INTO bills VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [(b.number, b.name, b.file_type, iso(b.date_proposed), b.law_number, b.archive_number, iso(b.date_expiry),
          iso(b.date_expiry_four_year), b.status, b.flag, b.date_extracted.isoformat()) for b in bills])
      self.cursor.executemany("INSERT INTO bill_proponents VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        [(p.proponent_id, b.number, p.name, p.term, p.signing_order, p.deputy_id) for b in bills for p in b.proponents])
      self.cursor.executemany("INSERT INTO bill_steps VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        [(s.step_id, b.number, s.organ, s.description, iso(s.date_start), iso(s.date_end)) for b in bills for s in b.steps])
      self.cursor.executemany("INSERT INTO bill_subjects VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        [(b.number, s.subject_code, s.subject) for b in bills for s in b.subjects])
      self.cursor.executemany("INSERT INTO bill_texts VALUES (?, ?, ?, ?, ?)",
        [(b.number, b.text_status, b.exposition, b.total_words, b.exposition_words) for b in bills if b.text_status])
      self.cursor.executemany("INSERT INTO laws VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
        [(l.law_id, l.law_number, l.bill_number, l.title) for l in laws])
      self.connection.commit()
    except BaseException:
      self.connection.rollback()
      raise
    return self.count_rows(tables)

  def replace_vote_tables(self, votes: list[Vote]) -> dict[str, int]:
    """Replaces votes and vote_deputies in one transaction. Returns the number of rows per table."""
    try:
      self.cursor.execute("DELETE FROM vote_deputies")
      self.cursor.execute("DELETE FROM votes")
      self.cursor.executemany("""INSERT INTO votes (vote_id, number, date, name, description, result, url, kind)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING""",
        [(v.vote_id, v.number, iso(v.date), v.name, v.description, v.result, v.url, v.kind) for v in votes])
      self.cursor.executemany("INSERT INTO vote_deputies VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        [(v.vote_id, d.slug, d.name, d.party, d.seat, d.vote, d.deputy_id) for v in votes for d in v.deputy_votes])
      self.connection.commit()
    except BaseException:
      self.connection.rollback()
      raise
    return self.count_rows(["votes", "vote_deputies"])

  def get_deputies_for_matching(self) -> list[tuple[int, str, str, str | None, str | None]]:
    """(deputy_id, surnames, names, date_from, date_to) of every stored deputy term (empty if not collected yet)."""
    self.cursor.execute("SELECT deputy_id, surnames, names, date_from, date_to FROM deputies")
    return self.cursor.fetchall()

  def get_vote_deputies_for_matching(self) -> list[tuple[str, str, str, str | None]]:
    """(vote_id, slug, name, vote date) of every deputy vote."""
    self.cursor.execute("SELECT d.vote_id, d.slug, d.name, v.date FROM vote_deputies d JOIN votes v ON v.vote_id = d.vote_id")
    return self.cursor.fetchall()

  def update_vote_deputy_ids(self, matches: list[tuple[int | None, str, str]]):
    """matches: (deputy_id or None, vote_id, slug)."""
    self.cursor.executemany("UPDATE vote_deputies SET deputy_id = ? WHERE vote_id = ? AND slug = ?", matches)
    self.connection.commit()

  def count_rows(self, tables: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in tables:
      self.cursor.execute(f"SELECT COUNT(*) FROM {table}")
      counts[table] = self.cursor.fetchone()[0]
    return counts

def iso(value: date | None) -> str | None:
  return value.isoformat() if value else None
