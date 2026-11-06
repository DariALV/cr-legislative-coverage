import logging
from bs4 import BeautifulSoup
import html as html_lib
import json
from datetime import datetime

from config import Config, to_costa_rica_time
from tools.scraping_tools.news_article import NewsArticle
from tools.scraping_tools.delfino_parser import BLOCK_TAGS, is_nested_block
from tools.file_tools.file_manager import hash

logger = logging.getLogger("cr")

# Posts dated before this are broken (Semanario has some at 1970-01-01), not old news.
EARLIEST_VALID_DATE: datetime = datetime(2000, 1, 1)

class WordPressParser:
  """
  Parses posts from a WordPress REST API (/wp-json/wp/v2/posts). Each post already carries the full
  body in content.rendered, so no article HTML is downloaded. One subclass per outlet sets the class
  attributes below.
  """
  ORGANIZATION: str = ""
  OUTLET_TYPE: str = Config.GENERAL_OUTLET
  # Category slugs that only mark layout or placement (home page, print edition...), not a section.
  NON_SECTION_CATEGORY_SLUGS: set[str] = set()

  def parse_page(self, raw: str) -> list[dict]:
    """Items of one cached REST response (a JSON list). Anything else (error object, bad JSON) gives []."""
    try:
      items = json.loads(raw)
    except json.JSONDecodeError:
      return []
    return items if isinstance(items, list) else []

  def parse_categories(self, categories: list[dict]) -> dict[int, str]:
    """{category id: name}, leaving out the categories that are not sections."""
    return {category["id"]: html_lib.unescape(category["name"]) for category in categories
            if category.get("slug") not in self.NON_SECTION_CATEGORY_SLUGS}

  def parse_authors(self, users: list[dict]) -> dict[int, str]:
    return {user["id"]: html_lib.unescape(user["name"]) for user in users}

  def parse(self, post: dict, categories: dict[int, str], authors: dict[int, str]) -> NewsArticle | None:
    url: str | None = post.get("link")
    date_published: datetime | None = self.get_date_published(post)
    if not url or date_published is None:
      logger.info(f"[{self.ORGANIZATION}] Not a valid post (no link or broken date): {post.get('id')} {url}")
      return None

    id: str = hash(url)
    organization: str = self.ORGANIZATION
    title: str = html_lib.unescape(post["title"]["rendered"])
    description: str | None = self.get_plain_text(post.get("excerpt", {}).get("rendered", "")) or None
    author: str | None = self.get_author(post, authors)
    content, extraction_status = self.get_all_text(post.get("content", {}).get("rendered", ""))
    date_extracted: datetime = datetime.now()
    outlet_type: str = self.OUTLET_TYPE
    names: list[str] = [categories[category_id] for category_id in post.get("categories", []) if category_id in categories]
    section: str | None = ", ".join(names) if names else None

    article = NewsArticle(id, url, organization, title, description, date_published, author, content, date_extracted, extraction_status, outlet_type, section)
    return article

  def get_date_published(self, post: dict) -> datetime | None:
    """
    date_gmt is real UTC (date is the site's local time without offset); converting date_gmt avoids
    depending on the site's timezone setting. None when missing or broken.
    """
    try:
      date_published: datetime = to_costa_rica_time(post["date_gmt"] + "Z")
    except (KeyError, TypeError, ValueError):
      return None
    return date_published if date_published >= EARLIEST_VALID_DATE else None

  def get_author(self, post: dict, authors: dict[int, str]) -> str | None:
    return authors.get(post.get("author"))

  def get_plain_text(self, rendered: str) -> str:
    return " ".join(BeautifulSoup(rendered, "lxml").get_text(" ", strip = True).split())

  def get_all_text(self, rendered: str) -> tuple[str | None, str]:
    if not rendered.strip():
      return None, "Partial"
    body = BeautifulSoup(rendered, "lxml").body
    if body is None:
      return None, "Partial"
    self.remove_noise(body)
    # Same block extraction as Delfino: one line per outermost block, inline tags stay in their paragraph.
    blocks = [block for block in body.find_all(BLOCK_TAGS) if not is_nested_block(block, body)]
    lines = [" ".join(block.get_text(" ", strip = True).split()) for block in blocks] if blocks else [body.get_text(" ", strip = True)]
    text = "\n".join(line for line in lines if line)
    if not text:
      return None, "Partial"
    return text, "Success"

  def remove_noise(self, body):
    """Drops scripts and styles (and, in subclasses, ads) before extracting text."""
    for tag in body.find_all(["script", "style", "noscript"]):
      tag.decompose()
