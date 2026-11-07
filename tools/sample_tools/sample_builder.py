import csv
import pathlib
import random
import re
import sqlite3
import unicodedata

from config import Config

# Broad keyword filter for pool A (#27): words that show up when a news talks about the Asamblea. Pool B is the rest
# of the corpus, sampled too so that implicit mentions the filter misses can enter.
KEYWORDS = re.compile(r"proyecto de ley|expediente|asamblea legislativa|diputad|plenario|comisi[oó]n legislativa"
                      r"|primer debate|segundo debate", re.IGNORECASE)
MIN_CONTENT_CHARS = 300

class SampleBuilder:
  """
  Builds the ordered draw queue for the hand-labeled sample (#27, #28, #31). Every general outlet gets its own queue,
  shuffled with a fixed seed, mixing pool A (keyword filter) and pool B (the rest) in the ratio
  SAMPLE_POOL_A_SHARE; the outlet queues are interleaved round-robin so that taking the first N rows of the result
  gives a balanced draw of any size. Delfino gets a separate queue of news that have gold links, to measure how
  well the links agree with the hand labels. Near-duplicate titles (the same story in two outlets) are skipped.
  The database is opened read-only.
  """

  def __init__(self, seed: int = Config.SAMPLE_SEED, pool_a_share: float = Config.SAMPLE_POOL_A_SHARE):
    self.seed = seed
    self.pool_a_share = pool_a_share
    path = pathlib.Path(Config.DATABASE_DIR) / f"{Config.PRIVATE_DATABASE}.db"
    self.connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri = True)

  @staticmethod
  def title_key(title: str | None) -> str:
    text = unicodedata.normalize("NFKD", (title or "").lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return " ".join(re.findall(r"[a-z0-9]+", text))[:60]

  def news(self) -> list[dict]:
    query = ("SELECT id, organization, url, date_published, section, title, content FROM news_articles "
             "WHERE extraction_status = 'Success' AND length(content) >= ? ORDER BY id")
    rows = []
    linked = {row[0] for row in self.connection.execute("SELECT DISTINCT news_id FROM news_bill_links")}
    for news_id, outlet, url, date, section, title, content in self.connection.execute(query, (MIN_CONTENT_CHARS,)):
      rows.append({"news_id": news_id, "outlet": outlet, "url": url, "date": (date or "")[:10],
                   "section": section or "", "title": title or "",
                   "pool": "A" if KEYWORDS.search(f"{title} {content}") else "B", "gold_linked": news_id in linked})
    return rows

  def outlet_queue(self, rows: list[dict], rng: random.Random) -> list[dict]:
    pool_a = [row for row in rows if row["pool"] == "A"]
    pool_b = [row for row in rows if row["pool"] == "B"]
    rng.shuffle(pool_a)
    rng.shuffle(pool_b)
    queue, taken_a, taken_b = [], 0, 0
    while pool_a or pool_b:
      # Take from A while its share of the queue so far is below the target.
      want_a = pool_a and (not pool_b or taken_a < self.pool_a_share * (taken_a + taken_b + 1))
      queue.append(pool_a.pop() if want_a else pool_b.pop())
      taken_a, taken_b = (taken_a + 1, taken_b) if want_a else (taken_a, taken_b + 1)
    return queue

  def build(self, per_outlet: int = Config.SAMPLE_QUEUE_PER_OUTLET, delfino: int = Config.SAMPLE_DELFINO) -> list[dict]:
    rng = random.Random(self.seed)
    rows = self.news()
    outlets = sorted({row["outlet"] for row in rows} - {"delfino"})
    queues = {outlet: self.outlet_queue([row for row in rows if row["outlet"] == outlet], rng) for outlet in outlets}
    delfino_rows = [row for row in rows if row["outlet"] == "delfino" and row["gold_linked"]]
    rng.shuffle(delfino_rows)

    result, seen = [], set()
    def take(row: dict, group: str, rank: int) -> bool:
      key = self.title_key(row["title"])
      if key in seen:
        return False
      seen.add(key)
      result.append({"draw": len(result) + 1, "group": group, "outlet_rank": rank, **row})
      return True

    ranks = {outlet: 0 for outlet in outlets}
    while any(ranks[outlet] < per_outlet and queues[outlet] for outlet in outlets):
      for outlet in outlets:
        while ranks[outlet] < per_outlet and queues[outlet]:
          if take(queues[outlet].pop(0), "general", ranks[outlet] + 1):
            ranks[outlet] += 1
            break
    taken = 0
    for row in delfino_rows:
      if taken == delfino:
        break
      taken += take(row, "delfino", taken + 1)
    return result

  def save(self, rows: list[dict], path: pathlib.Path) -> None:
    path.parent.mkdir(parents = True, exist_ok = True)
    columns = ["draw", "group", "outlet", "outlet_rank", "pool", "news_id", "date", "section", "url"]
    with open(path, "w", encoding = "utf-8", newline = "") as file:
      writer = csv.DictWriter(file, fieldnames = columns, extrasaction = "ignore")
      writer.writeheader()
      writer.writerows(rows)
