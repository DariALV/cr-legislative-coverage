import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import re
import time

from tools.scraping_tools.rate_limiter import RateLimiter
from tools.file_tools.file_manager import FileManager
from tools.display_tools.progress import ProgressTask, silent_task

# Cached answers worth retrying on the next run: rate limiting and server errors.
TRANSIENT_ERROR_REGEX = re.compile(r"Error (429|5\d\d)")

class HTMLFetcher:
  """
  Not thread-safe (one requests.Session and one RateLimiter): create one fetcher per thread/website.
  name prefixes the log lines so parallel websites can be told apart.
  """

  def __init__(self, user_agent: str, rate_limit: float = 1, retries: int = 5, timeout: int = 10, name: str = ""):
    self.user_agent = user_agent
    self.rate_limiter: RateLimiter = RateLimiter(rate_limit)
    self.retries = retries
    self.timeout = timeout
    self.name = name
    self.file_manager = FileManager()

  def fetch_multiple(self, save_path: str, urls: list[str], task: ProgressTask | None = None):
    """Downloads the urls that are not cached yet. task (optional) advances once per url, cached or not."""
    task = task or silent_task()
    task.set_total(len(urls))
    for url in urls:
      if self.needs_fetch(save_path, url):
        try:
          self.fetch(save_path, url)
        except requests.RequestException as error:
          # Network failure after all retries: nothing is saved, so the url is retried on the next run.
          task.warn(f"Could not fetch {url}: {error}")
          self.rate_limiter.wait()
      task.advance()
    task.finish()

  def needs_fetch(self, save_path: str, url: str) -> bool:
    """
    True if the url is not cached, or was cached as a transient error ("Error 429" or "Error 5xx") that may work now.
    Other cached errors (e.g. "Error 404") are kept. Only tiny files are read, so the check stays cheap.
    """
    if not self.file_manager.html_exists(save_path, url):
      return True
    path = self.file_manager.get_path(save_path, url, ".html", True)
    if path.stat().st_size > len("Error 000"):
      return False
    return TRANSIENT_ERROR_REGEX.fullmatch(path.read_text(encoding = "utf-8")) is not None

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
      self.session = make_retry_session(self.user_agent, self.retries)
    return self.session

def make_retry_session(user_agent: str, retries: int) -> requests.Session:
  """Session that retries connection errors and 429/5xx answers with exponential backoff (1, 2, 4... s)."""
  retry = Retry(
    total = retries,
    backoff_factor = 1,
    status_forcelist = [429, 500, 502, 503, 504],
    respect_retry_after_header = True,
    allowed_methods = ["GET"],
  )
  session = requests.Session()
  session.headers.update({"User-Agent": f"{user_agent}/1.0"})
  session.mount("https://", HTTPAdapter(max_retries = retry))
  return session


  
  # def fetch(self, url: str):
  #   response = requests.get(url, headers = {"User-Agent": f"{self.user_agent}/1.0"}, timeout = self.timeout)


class HTMLResponse:
  def __init__(self, response: requests.Response):
    self.url = response.url
    self.html = response.text
    self.status_code = response.status_code
  
  def is_valid(self) -> bool:
    return self.status_code == 200