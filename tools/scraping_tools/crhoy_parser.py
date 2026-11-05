from bs4 import BeautifulSoup
import json
from datetime import datetime

from config import Config
from tools.scraping_tools.news_article import NewsArticle
from tools.scraping_tools.section_filter import url_section
from tools.file_tools.file_manager import hash

class CRHoyParser:
  
  def parse(self, html: str, url: str) -> NewsArticle:
    soup = BeautifulSoup(html, "lxml")
    scripts = soup.find_all("script", type="application/ld+json")

    for script in scripts:
        news_article_schema = json.loads(script.string)
        if news_article_schema["@type"] == "NewsArticle":

          id: str = hash(url)
          organization: str = "crhoy"
          title: str = news_article_schema["headline"]
          description: str = news_article_schema["description"]
          # CRHoy timestamps are Costa Rica local time. The JSON-LD has no offset, but its meta tags and
          # sitemaps label the same local time with "Z", so any suffix is ignored instead of converted.
          date_published: datetime = datetime.fromisoformat(news_article_schema["datePublished"][:19])
          author: str = news_article_schema["author"]["name"]
          content, extraction_status = get_all_text(soup, url)
          date_extracted: datetime = datetime.now()
          outlet_type: str = Config.GENERAL_OUTLET
          section: str | None = url_section(url)

          article = NewsArticle(id, url, organization, title, description, date_published, author, content, date_extracted, extraction_status, outlet_type, section)
          return article
        else:
           print("Not a NewsArticle")
    return None

def get_all_text(soup: BeautifulSoup, url: str) -> str:

  article_div = soup.find("div", class_="wp-article")
  if not article_div:
     return None, "Partial"
  text = article_div.text
  text = text.replace("(CRHoy.com)", "")
  return text, "Success"