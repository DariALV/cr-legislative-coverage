import logging
import re
from urllib.parse import urlparse

from config import Config
from tools.scraping_tools.news_article import NewsArticle
from tools.scraping_tools.wordpress_parser import WordPressParser

logger = logging.getLogger("cr")

CARICATURA_SLUG_REGEX = re.compile(r"^el-chancletazo(-\d+)?$")

class SemanarioParser(WordPressParser):
  """
  Parses Semanario Universidad posts from its WordPress REST API (semanariouniversidad.com/wp-json/wp/v2/posts).
  Bylines come from Co-Authors Plus, whose REST endpoint (/wp/v2/coauthors) is closed (401), and the
  WordPress user in "author" is the account that uploaded the post, not the journalist: author stays None.
  """
  ORGANIZATION = "semanario"
  OUTLET_TYPE = Config.GENERAL_OUTLET
  # Home page blocks, print edition and breaking-news flags: placement, not sections.
  NON_SECTION_CATEGORY_SLUGS = {"destacadas", "impreso", "impresogrande", "primeranota", "bloque1",
                                "ultima-hora", "sin-categoria"}

  def parse(self, post: dict, categories: dict[int, str], authors: dict[int, str]) -> NewsArticle | None:
    if self.is_caricatura(post):
      logger.info(f"[{self.ORGANIZATION}] Skipping caricatura: {post.get('link')}")
      return None
    return super().parse(post, categories, authors)

  def is_caricatura(self, post: dict) -> bool:
    """
    "El chancletazo" (weekly cartoon, filed under País) and any other post that is only images:
    nothing to read for the analysis.
    """
    if CARICATURA_SLUG_REGEX.match(post.get("slug") or urlparse(post.get("link", "")).path.rstrip("/").split("/")[-1]):
      return True
    rendered: str = post.get("content", {}).get("rendered", "")
    content, _ = self.get_all_text(rendered)
    return content is None and "<img" in rendered

  def get_author(self, post: dict, authors: dict[int, str]) -> str | None:
    return None

  def remove_noise(self, body):
    """Also drops the in-article ads (Advanced Ads placements, labeled "Publicidad")."""
    super().remove_noise(body)
    for ad in body.select('[aria-label="Publicidad"], .seman-entity-placement'):
      ad.decompose()
