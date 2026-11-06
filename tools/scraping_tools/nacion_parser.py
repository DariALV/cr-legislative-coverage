from bs4 import BeautifulSoup
import json
import re
from datetime import datetime

from config import Config, to_costa_rica_time
from tools.scraping_tools.news_article import NewsArticle
from tools.scraping_tools.delfino_parser import BLOCK_TAGS, is_nested_block
from tools.file_tools.file_manager import hash

# La Nación pads its paragraphs with zero-width non-joiners (U+200C), some blocks are nothing else.
INVISIBLE_CHARACTERS: dict[int, None] = {ord("‌"): None, ord("​"): None, ord("﻿"): None}

# La Nación's terms of use (#11) exclude content licensed from agencies and third parties, even for
# academic use. Those pieces carry the agency as their byline ("AFP", "Europa Press"); Arc's
# distributor field does not mark them. Only the byline is checked: staff articles may cite "(AP)".
AGENCY_BYLINE_REGEX = re.compile(
  r"\b(?:Agencia\s+)?(?:EFE|AFP|AP|Reuters|Associated Press|Agence France[- ]Presse|Europa Press|DPA|dpa|ANSA|"
  r"Xinhua|Bloomberg|Sputnik|The New York Times|The Washington Post|El País|BBC(?: Mundo)?)\b")

class NacionParser:
  """
  Parses La Nación news articles (nacion.com/<section>/.../<id>/story/). The site is on Arc Publishing:
  the metadata comes from the NewsArticle JSON-LD and the body from .article-body-wrapper. Articles are
  marked isAccessibleForFree false, but the paywall is applied in the browser: the HTML has the full body.
  """

  def parse(self, html: str, url: str) -> NewsArticle | None:
    soup = BeautifulSoup(html, "lxml")
    news_article_schema = self.get_news_article_schema(soup)
    if news_article_schema is None:
      print(f"Not a NewsArticle: {url}")
      return None

    author: str | None = self.get_author(news_article_schema)
    if self.is_agency(author):
      print(f"[nacion] Skipping agency news ({author}): {url}")
      return None

    id: str = hash(url)
    organization: str = "nacion"
    title: str = news_article_schema["headline"]
    description: str | None = news_article_schema.get("description") or None
    # La Nación publishes datePublished in UTC ("2026-10-27T23:24:40.088Z")
    date_published: datetime = to_costa_rica_time(news_article_schema["datePublished"])
    content, extraction_status = self.get_all_text(soup)
    date_extracted: datetime = datetime.now()
    outlet_type: str = Config.GENERAL_OUTLET
    section: str | None = self.get_section(news_article_schema)

    article = NewsArticle(id, url, organization, title, description, date_published, author, content, date_extracted, extraction_status, outlet_type, section)
    return article

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
    # Names sometimes carry double spaces ("Yucsiany  Salazar Serrano")
    names = [" ".join(author["name"].split()) for author in authors if isinstance(author, dict) and author.get("name")]
    return ", ".join(names) if names else None

  def is_agency(self, author: str | None) -> bool:
    """True if any byline is a news agency or a third-party outlet (co-signed pieces count too)."""
    return author is not None and AGENCY_BYLINE_REGEX.search(author) is not None

  def get_section(self, news_article_schema: dict) -> str | None:
    """articleSection is a list, most specific first (["Cartas", "Opinión"])."""
    sections = news_article_schema.get("articleSection")
    if isinstance(sections, str):
      sections = [sections]
    if not sections:
      return None
    return ", ".join(sections)

  def get_all_text(self, soup: BeautifulSoup) -> tuple[str | None, str]:
    body = soup.select_one(".article-body-wrapper")
    if not body:
      return None, "Partial"
    # Same block extraction as Delfino: one line per outermost block, inline tags stay in their paragraph.
    # Image captions are <figcaption>, not a block tag, so they are left out.
    blocks = [block for block in body.find_all(BLOCK_TAGS) if not is_nested_block(block, body)]
    lines = [self.clean(block.get_text(" ", strip = True)) for block in blocks] if blocks else [self.clean(body.get_text(" ", strip = True))]
    text = "\n".join(line for line in lines if line)
    if not text:
      return None, "Partial"
    return text, "Success"

  def clean(self, text: str) -> str:
    return " ".join(text.translate(INVISIBLE_CHARACTERS).split())
