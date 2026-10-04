import sqlite3
from datetime import datetime

from tools.scraping_tools.expediente import Expediente


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
          extraction_status TEXT NOT NULL
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
    self.cursor.execute(exp_table)
    self.cursor.execute(exp_cat_table)
    self.connection.commit()
  
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

    max_steps_to_commit = 50
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