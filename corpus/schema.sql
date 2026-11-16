CREATE TABLE bill_proponents(
          proponent_id  INTEGER PRIMARY KEY,
          number        INTEGER NOT NULL REFERENCES bills(number),
          name          TEXT NOT NULL,
          term          TEXT,
          signing_order INTEGER,
          deputy_id     INTEGER
      ) STRICT;

CREATE TABLE bill_steps(
          step_id     INTEGER PRIMARY KEY,
          number      INTEGER NOT NULL REFERENCES bills(number),
          organ       TEXT,
          description TEXT NOT NULL,
          date_start  TEXT,
          date_end    TEXT
      ) STRICT;

CREATE TABLE bill_subjects(
          number       INTEGER NOT NULL REFERENCES bills(number),
          subject_code INTEGER NOT NULL,
          subject      TEXT NOT NULL,
          PRIMARY KEY (number, subject_code)
      ) STRICT;

CREATE TABLE bill_texts(
          number           INTEGER PRIMARY KEY REFERENCES bills(number),
          status           TEXT NOT NULL,
          exposition       TEXT,
          total_words      INTEGER,
          exposition_words INTEGER
      ) STRICT;

CREATE TABLE bills(
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
      ) STRICT;

CREATE TABLE corpus_info (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE deputies(
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
      ) STRICT;

CREATE TABLE deputy_bills(
          deputy_id    INTEGER NOT NULL REFERENCES deputies(deputy_id),
          bill_number  INTEGER NOT NULL,
          proponent_id INTEGER NOT NULL,
          term         TEXT,
          PRIMARY KEY (deputy_id, bill_number)
      ) STRICT;

CREATE TABLE deputy_factions(
          person_id  INTEGER,
          faction_id INTEGER NOT NULL,
          term       TEXT NOT NULL,
          faction    TEXT NOT NULL,
          province   TEXT,
          date_from  TEXT,
          date_to    TEXT,
          UNIQUE (person_id, faction_id, date_from)
      ) STRICT;

CREATE TABLE deputy_replacements(
          person_id INTEGER,
          detail    TEXT,
          name      TEXT,
          date      TEXT,
          UNIQUE (person_id, detail, name, date)
      ) STRICT;

CREATE TABLE deputy_terms(
          person_id INTEGER NOT NULL,
          term      TEXT NOT NULL,
          province  TEXT,
          PRIMARY KEY (person_id, term)
      ) STRICT;

CREATE TABLE jev_candidates (
  news_id TEXT NOT NULL, bill_number INTEGER NOT NULL, rank INTEGER, score REAL, source TEXT, named INTEGER,
  explicit REAL, implicit REAL, match INTEGER,
  PRIMARY KEY (news_id, bill_number));

CREATE TABLE jev_details (
  news_id TEXT NOT NULL, bill_number INTEGER, question TEXT NOT NULL, option TEXT, probability REAL,
  choice TEXT, confidence REAL, score REAL, score_01 REAL);

CREATE TABLE jev_filter (news_id TEXT PRIMARY KEY, assembly REAL, passes INTEGER, cut INTEGER);

CREATE TABLE jev_news (
  news_id TEXT PRIMARY KEY, genre TEXT, genre_confidence REAL, genre_news_report REAL, genre_opinion REAL,
  genre_interview REAL, genre_analysis REAL, cut INTEGER, matches INTEGER);

CREATE TABLE jev_questions (
  stage TEXT NOT NULL, question TEXT NOT NULL, type TEXT, instructions TEXT, criteria TEXT,
  PRIMARY KEY (stage, question));

CREATE TABLE laws(
          law_id      INTEGER NOT NULL,
          law_number  INTEGER NOT NULL,
          bill_number INTEGER,
          title       TEXT,
          UNIQUE (law_id, bill_number)
      ) STRICT;

CREATE TABLE links (
  news_id TEXT NOT NULL, bill_number INTEGER NOT NULL,
  jev_match INTEGER NOT NULL, outlet_link INTEGER NOT NULL,
  explicit REAL, implicit REAL, centrality REAL,
  mention INTEGER NOT NULL, substantive INTEGER NOT NULL,
  PRIMARY KEY (news_id, bill_number));

CREATE TABLE news_articles(
  id TEXT,
  url TEXT,
  organization TEXT,
  title TEXT,
  date_published TEXT,
  author TEXT,
  section TEXT,
  outlet_type TEXT,
  extraction_status TEXT
);

CREATE TABLE news_bill_links(
  news_id TEXT,
  bill_number INT,
  source TEXT
);

CREATE TABLE organ_bills(
          organ_code     INTEGER NOT NULL REFERENCES organs(organ_code),
          bill_number    INTEGER NOT NULL,
          date_start     TEXT,
          date_end       TEXT,
          last_step      TEXT,
          date_extracted TEXT NOT NULL,
          PRIMARY KEY (organ_code, bill_number)
      ) STRICT;

CREATE TABLE organ_memberships(
          membership_id INTEGER PRIMARY KEY,
          deputy_id     INTEGER NOT NULL REFERENCES deputies(deputy_id),
          organ_code    INTEGER NOT NULL,
          organ_name    TEXT,
          position      TEXT,
          legislature   TEXT,
          date_joined   TEXT,
          date_left     TEXT
      ) STRICT;

CREATE TABLE organs(
          organ_code       INTEGER PRIMARY KEY,
          organ_id         INTEGER NOT NULL,
          organ_type       TEXT,
          name             TEXT NOT NULL,
          date_constituted TEXT,
          date_dissolved   TEXT,
          status           TEXT,
          date_extracted   TEXT NOT NULL
      ) STRICT;

CREATE INDEX jev_candidates_bill ON jev_candidates (bill_number);

CREATE INDEX jev_details_pair ON jev_details (news_id, bill_number);

CREATE INDEX links_bill ON links (bill_number);

CREATE INDEX news_articles_date ON news_articles (date_published);
