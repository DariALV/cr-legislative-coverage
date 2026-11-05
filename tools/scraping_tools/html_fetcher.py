import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import time

from tools.scraping_tools.rate_limiter import RateLimiter
from tools.file_tools.file_manager import FileManager

class HTMLFetcher:

  def __init__(self, user_agent: str, rate_limit: int = 1, retries: int = 5, timeout: int = 10):
    self.user_agent = user_agent
    self.rate_limiter: RateLimiter = RateLimiter(rate_limit)
    self.retries = retries
    self.timeout = timeout
    self.file_manager = FileManager()

  def fetch_multiple(self, save_path: str, urls: list[str]):
    for i in range(len(urls)):
      url: str = urls[i]
      print(f"{i + 1} out of {len(urls)} websites scraped. ({100.0 * (i + 1.0)/len(urls):.2f}% completed)")
      if not self.file_manager.html_exists(save_path, url):
        self.fetch(save_path, url)

  def fetch(self, save_path: str, url: str) -> str:
    """Downloads a single url, saves it (or "Error <code>") and returns the saved text."""
    response = self.get_session().get(url, timeout = self.timeout)
    html_response = HTMLResponse(response)
    if html_response.status_code == 200:
      content = html_response.html
    else:
      content = f"Error {html_response.status_code}"
    self.file_manager.save_html(save_path, url, content)
    self.rate_limiter.wait()
    return content

  def get_session(self) -> requests.Session:
    if getattr(self, "session", None) is None:
      retry = Retry(
      total = self.retries,
      backoff_factor = 1,
      status_forcelist = [429, 500, 502, 503, 504],
      respect_retry_after_header = True,
      allowed_methods = ["GET"],
      )
      self.session = requests.Session()
      self.session.headers.update({"User-Agent": f"{self.user_agent}/1.0"})
      self.session.mount("https://", HTTPAdapter(max_retries=retry))
    return self.session
    

  
  # def fetch(self, url: str):
  #   response = requests.get(url, headers = {"User-Agent": f"{self.user_agent}/1.0"}, timeout = self.timeout)


class HTMLResponse:
  def __init__(self, response: requests.Response):
    self.url = response.url
    self.html = response.text
    self.status_code = response.status_code
  
  def is_valid(self) -> bool:
    return self.status_code == 200