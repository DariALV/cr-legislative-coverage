import requests
import time

class HTMLFetcher:

  def __init__(self, user_agent: str, rate_limit: int = 1, retries: int = 5, timeout: int = 10):
    self.user_agent = user_agent
    self.rate_limit = rate_limit
    self.retries = retries
    self.timeout = timeout

  def fetch_multiple(self, urls: list[str]) -> list[HTMLResponse]:
    session = requests.Session()
    session.headers.update({"User-Agent": f"{self.user_agent}/1.0"})
    htmls: list[HTMLResponse] = []

    for url in urls:
      response = session.get(url, timeout = self.timeout)
      htmls.append(HTMLResponse(response))
      time.sleep(self.rate_limit)
    return htmls
  
  def fetch(self, url: str) -> HTMLResponse:
    response = requests.get(url, headers = {"User-Agent": f"{self.user_agent}/1.0"}, timeout = self.timeout)
    return HTMLResponse(response)

class HTMLResponse:
  def __init__(self, response: requests.Response):
    self.url = response.url
    response.encoding = response.apparent_encoding
    self.html = response.text
    self.status_code = response.status_code
  
  def is_valid(self) -> bool:
    return self.status_code == 200