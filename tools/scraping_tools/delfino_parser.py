from bs4 import BeautifulSoup
import json
from datetime import datetime

from tools.scraping_tools.html_fetcher import HTMLResponse
from tools.scraping_tools.expediente import Expediente

class DelfinoParser:
  
  def parse(self, html_response: HTMLResponse) -> Expediente:
    soup = BeautifulSoup(html_response.html, "lxml")

  