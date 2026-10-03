from bs4 import BeautifulSoup
import json
from datetime import datetime

from tools.scraping_tools.html_fetcher import HTMLResponse
from tools.scraping_tools.expediente import Expediente

class DelfinoParser:
  
  def parse(self, html: str) -> Expediente:
    soup = BeautifulSoup(html, "lxml")
    print(self.get_title(soup))
    self.get_metadata(soup)

  def get_title(self, soup: BeautifulSoup) -> str:
    title_tag = soup.find("meta", property="og:title")
    title = title_tag.get("content")
    title = title.split(" - ")[1]
    return title
  
  def get_metadata(self, soup: BeautifulSoup) -> str:
    base = soup.find(string=lambda s: s.strip() == "Tipo")
    metadata_list_parent = base.parent.parent.parent
    metadata_list = metadata_list_parent.find_all(True, recursive = False)
    for metadata in metadata_list:
      metadata_parts = metadata.find_all(True, recursive = False)
      metadata_name = metadata_parts[0].text
      metadata_value = metadata_parts[1].text
      print(metadata_name)
      print(metadata_value)
      print("-------------------------")

  