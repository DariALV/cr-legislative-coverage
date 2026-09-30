from bs4 import BeautifulSoup
import json

from tools.scraping_tools.html_fetcher import HTMLResponse
from tools.scraping_tools.news_article import NewsArticle

class CRHoyParser:
  
  def parse(self, html_response: HTMLResponse) -> NewsArticle:
    soup = BeautifulSoup(html_response.html, "lxml")
    test = soup.find("div", class_="wp-article")
    scripts = soup.find_all("script", type="application/ld+json")

    for script in scripts:
        datos = json.loads(script.string)
        if datos["@type"] == "NewsArticle":
          print(datos)
        else:
           print("Not a NewsArticle")
    print("-----------------------------------")