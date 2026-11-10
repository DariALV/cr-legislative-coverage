import re
import sqlite3

from config import Config

# A bill number (20000-25897 in this database), written 25340 or 25.340, with a word that announces a bill shortly
# before it, so amounts like «25.000 personas» mostly stay out. Lists («expedientes 23.414, 23.968 y 25.094») work
# because each number only needs the word somewhere in the CONTEXT_CHARS before it. Amounts with a currency sign
# before them (₡23.722 millones) never count.
NUMBER = re.compile(r"(?<![\d.,₡$])(?<![₡$]\s)(2\d)\.?(\d{3})(?![\d.,]\d)")
CUE = re.compile(r"expedientes?|exp\.|proyectos?|iniciativas?|n\.?\s?[°ºo]\.?|números?|reformas?|ley(es)?",
                 re.IGNORECASE)
CONTEXT_CHARS = 60
UNIT_AFTER = re.compile(r"\s*(colones|millones|personas|dólares|%|metros|hectáreas|votos|años|kilómetros)",
                        re.IGNORECASE)

class ExplicitMentions:
  """
  Bills that a news names by their expediente number (ranker 2026-11-10). The evolved ranker has no feature for it
  and left out 3 of 34 such mentions in the test100 run, so run_candidates adds them to the top-K. Only numbers of
  bills that exist in the database count; a wrong hit costs one extra candidate in the gate, which rejects it.
  """

  def __init__(self, database_path: str | None = None):
    path = database_path or f"{Config.DATABASE_DIR}/{Config.PRIVATE_DATABASE}.db"
    self.connection = sqlite3.connect(f"file:{path}?mode=ro", uri = True)
    self.bills = {number for (number,) in self.connection.execute("SELECT number FROM bills")}

  def find(self, text: str) -> list[int]:
    """Bill numbers named in text, in order of first appearance."""
    found = []
    for match in NUMBER.finditer(text or ""):
      number = int(match.group(1) + match.group(2))
      # round thousands (20.000, 21.000) are almost always amounts («20.000 entradas»): 6 of 332 corpus additions
      if number not in self.bills or number in found or number % 1000 == 0:
        continue
      if not CUE.search(text[max(0, match.start() - CONTEXT_CHARS):match.start()]):
        continue
      if UNIT_AFTER.match(text, match.end()):
        continue
      found.append(number)
    return found

  def for_news(self, news_ids: list[str]) -> dict[str, list[int]]:
    """news_id -> bill numbers named in its title or content (only news that name at least one)."""
    mentions = {}
    for start in range(0, len(news_ids), 900):
      batch = news_ids[start:start + 900]
      for news_id, title, content in self.connection.execute(
          f"SELECT id, title, content FROM news_articles WHERE id IN ({','.join('?' * len(batch))})", batch):
        numbers = self.find(f"{title or ''}\n{content or ''}")
        if numbers:
          mentions[news_id] = numbers
    return mentions
