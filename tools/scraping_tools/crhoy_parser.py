from bs4 import BeautifulSoup
import json
from datetime import datetime

from tools.scraping_tools.html_fetcher import HTMLResponse
from tools.scraping_tools.news_article import NewsArticle

class CRHoyParser:
  
  def parse(self, html_response: HTMLResponse) -> NewsArticle:
    soup = BeautifulSoup(html_response.html, "lxml")
    scripts = soup.find_all("script", type="application/ld+json")

    for script in scripts:
        news_article_schema = json.loads(script.string)
        if news_article_schema["@type"] == "NewsArticle":

          organization: str = "crhoy"
          url: str = html_response.url
          title: str = news_article_schema["headline"]
          date_format = "%Y-%m-%dT%H:%M:%S"
          date_published: datetime = datetime.strptime(news_article_schema["datePublished"], date_format)
          author: str = news_article_schema["author"]["name"]
          content: str = get_all_text(soup)
          date_extracted: datetime = datetime.now()

          article = NewsArticle(organization, url, title, date_published, author, content, date_extracted)
          print(article.as_dict())
          return article
        else:
           print("Not a NewsArticle")


def get_all_text(soup: BeautifulSoup) -> str:

  article_div = soup.find("div", class_="wp-article")
  text = article_div.text
  text = text.replace("(CRHoy.com)", "")
  return text

  