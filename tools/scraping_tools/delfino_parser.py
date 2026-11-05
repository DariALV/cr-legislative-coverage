from bs4 import BeautifulSoup
import json
import re
from datetime import datetime

from config import Config, to_costa_rica_time
from tools.scraping_tools.news_article import NewsArticle
from tools.file_tools.file_manager import hash

EXPEDIENTE_LINK_REGEX = re.compile(r"/asamblea/proyecto/(\d+)")
BLOCK_TAGS = ["p", "h2", "h3", "h4", "li", "blockquote"]

def is_nested_block(block, body) -> bool:
  """True if the block sits inside another block tag within the article body."""
  for parent in block.parents:
    if parent is body:
      return False
    if parent.name in BLOCK_TAGS:
      return True
  return False

class DelfinoParser:
  """Parses Delfino news articles (delfino.cr/<year>/<month>/<slug>). Expediente pages use ExpedienteParser."""

  def parse(self, html: str, url: str) -> NewsArticle | None:
    soup = BeautifulSoup(html, "lxml")
    news_article_schema = self.get_news_article_schema(soup)
    if news_article_schema is None:
      print(f"Not a NewsArticle: {url}")
      return None

    id: str = hash(url)
    organization: str = "delfino"
    title: str = news_article_schema["headline"]
    description: str | None = news_article_schema.get("description")
    # Delfino publishes datePublished in UTC ("2026-11-05T18:49:22.000Z")
    date_published: datetime = to_costa_rica_time(news_article_schema["datePublished"])
    author: str | None = self.get_author(news_article_schema)
    content, extraction_status = self.get_all_text(soup)
    date_extracted: datetime = datetime.now()
    outlet_type: str = Config.SPECIALIZED_OUTLET
    section: str | None = news_article_schema.get("articleSection")

    article = NewsArticle(id, url, organization, title, description, date_published, author, content, date_extracted, extraction_status, outlet_type, section)
    return article

  def parse_expediente_links(self, html: str) -> list[int]:
    """Expediente numbers linked (/asamblea/proyecto/<number>) inside the article body."""
    soup = BeautifulSoup(html, "lxml")
    body = soup.find(attrs = {"itemprop": "articleBody"})
    if not body:
      return []
    numbers: set[int] = set()
    for link in body.find_all("a", href = True):
      match = EXPEDIENTE_LINK_REGEX.search(link["href"])
      if match:
        numbers.add(int(match.group(1)))
    return sorted(numbers)

  def get_news_article_schema(self, soup: BeautifulSoup) -> dict | None:
    for script in soup.find_all("script", type = "application/ld+json"):
      try:
        schema = json.loads(script.string or "")
      except json.JSONDecodeError:
        continue
      if isinstance(schema, dict) and schema.get("@type") == "NewsArticle":
        return schema
    return None

  def get_author(self, news_article_schema: dict) -> str | None:
    authors = news_article_schema.get("author")
    if isinstance(authors, dict):
      authors = [authors]
    if not authors:
      return None
    names = [author.get("name") for author in authors if author.get("name")]
    return ", ".join(names) if names else None

  def get_all_text(self, soup: BeautifulSoup) -> tuple[str | None, str]:
    body = soup.find(attrs = {"itemprop": "articleBody"})
    if not body:
      return None, "Partial"
    # One line per block; inline tags (links, italics) stay inside their paragraph.
    # Only outermost blocks, so a <p> inside a <blockquote> (quotes) is not counted twice.
    blocks = [block for block in body.find_all(BLOCK_TAGS) if not is_nested_block(block, body)]
    lines = [" ".join(block.get_text(" ", strip = True).split()) for block in blocks] if blocks else [body.get_text(" ", strip = True)]
    text = "\n".join(line for line in lines if line)
    if not text:
      return None, "Partial"
    return text, "Success"
