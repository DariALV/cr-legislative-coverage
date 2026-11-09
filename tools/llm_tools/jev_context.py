import collections
import sqlite3
import threading

from config import Config

ROSTER_TERM = "2026-2030"   # the Assembly in office during the data period (May to October 2026)
MAX_PROPONENTS = 3

class JevContext:
  """
  Reads, read-only, what goes into Jev's request state (#34): the news, one short card per bill and the list of
  deputies in office with their party. The card leaves out the exposition of motives on purpose: with it, a request
  with 50 candidates goes over Jev's ~32k tokens per question (jev 2026-11-08 20:05).
  """

  def __init__(self, database_path: str | None = None, max_news_chars: int = Config.JEV_MAX_NEWS_CHARS):
    self.database_path = database_path or f"{Config.DATABASE_DIR}/{Config.PRIVATE_DATABASE}.db"
    self.max_news_chars = max_news_chars
    # read-only and shared by JevRunner's threads, one query at a time
    self.connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri = True, check_same_thread = False)
    self.lock = threading.RLock()
    self._cards: dict[int, dict] | None = None
    self._roster: list[dict] | None = None

  def news(self, news_id: str) -> tuple[dict, bool]:
    """The news as Jev sees it, and whether its content was cut at max_news_chars."""
    with self.lock:
      row = self.connection.execute(
        "SELECT organization, title, date_published, content FROM news_articles WHERE id = ?", (news_id,)).fetchone()
    if row is None:
      raise KeyError(f"news {news_id} is not in news_articles")
    outlet, title, published, content = row
    content = content or ""
    cut = len(content) > self.max_news_chars
    return {"outlet": outlet, "date": (published or "")[:10], "title": title or "",
            "content": content[:self.max_news_chars]}, cut

  def card(self, number: int) -> dict:
    with self.lock:
      if self._cards is None:
        self._cards = self.load_cards()
    return self._cards.get(int(number), {"number": int(number)})

  def roster(self) -> list[dict]:
    """Deputies of ROSTER_TERM with their party, so Jev can tell the party of a deputy the news names alone."""
    with self.lock:
      if self._roster is None:
        self._roster = self.load_roster()
    return self._roster

  def load_roster(self) -> list[dict]:
    return [{"name": f"{names} {surnames}".strip(), "party": faction} for names, surnames, faction in
            self.connection.execute(
              "SELECT d.names, d.surnames, f.faction FROM deputies d JOIN deputy_factions f "
              "ON f.person_id = d.person_id AND f.term = d.term WHERE d.term = ? "
              "GROUP BY d.deputy_id ORDER BY d.surnames", (ROSTER_TERM,))]

  def load_cards(self) -> dict[int, dict]:
    subjects: dict[int, list[str]] = collections.defaultdict(list)
    for number, subject in self.connection.execute("SELECT number, subject FROM bill_subjects ORDER BY number"):
      if subject and not subject.strip().isdigit():
        subjects[number].append(subject)
    proponents: dict[int, list[dict]] = collections.defaultdict(list)
    for number, name, party in self.connection.execute(
        "SELECT p.number, p.name, MAX(f.faction) FROM bill_proponents p "
        "LEFT JOIN deputies d ON d.deputy_id = p.deputy_id "
        "LEFT JOIN deputy_factions f ON f.person_id = d.person_id AND f.term = p.term "
        "GROUP BY p.proponent_id ORDER BY p.number, p.signing_order"):
      if len(proponents[number]) < MAX_PROPONENTS:
        proponents[number].append({"name": name, "party": party} if party else {"name": name})
    return {number: {"number": number, "name": name or "", "date_filed": (filed or "")[:10],
                     "proponents": proponents.get(number, []), "subjects": subjects.get(number, [])}
            for number, name, filed in self.connection.execute("SELECT number, name, date_proposed FROM bills")}
