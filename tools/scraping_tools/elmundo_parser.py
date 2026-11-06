from config import Config
from tools.scraping_tools.wordpress_parser import WordPressParser

class ElMundoParser(WordPressParser):
  """Parses El Mundo CR posts from its WordPress REST API (elmundo.cr/wp-json/wp/v2/posts)."""
  ORGANIZATION = "elmundo"
  OUTLET_TYPE = Config.GENERAL_OUTLET
  # "Destacada" only marks posts featured on the home page, it is not a section.
  NON_SECTION_CATEGORY_SLUGS = {"featured", "destacadas"}
