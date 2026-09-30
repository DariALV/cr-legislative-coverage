import requests
import time

class HTMLFetcher:

  def __init__(self, user_agent: str, rate_limit: int = 1, retries: int = 5):
    self.user_agent = user_agent
    self.rate_limit = rate_limit
    self.retries = retries

  def fetch(self, url: str) -> str:
    response = requests.get(url, headers = {"User-Agent": f"{self.user_agent}/1.0"}, timeout = 10)
    response.encoding = response.apparent_encoding
    return response.text