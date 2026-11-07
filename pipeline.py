import json
import logging
import os
import re
import threading
import zipfile
import requests
from datetime import date, datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from config import Config, DataPeriod
from tools.scraping_tools.html_fetcher import HTMLFetcher
from tools.scraping_tools.asamblea import AsambleaData, Deputy, Organ
from tools.scraping_tools.asamblea_fetcher import AsambleaError, AsambleaFetcher
from tools.scraping_tools.asamblea_parser import AsambleaParser, DeputyMatcher, make_deputy_index
from tools.scraping_tools.crhoy_parser import CRHoyParser
from tools.scraping_tools.delfino_parser import DelfinoParser
from tools.scraping_tools.elmundo_parser import ElMundoParser
from tools.scraping_tools.semanario_parser import SemanarioParser
from tools.scraping_tools.wordpress_parser import WordPressParser
from tools.scraping_tools.nacion_parser import NacionParser
from tools.scraping_tools.delfino_votes import DelfinoVotesParser, VOTES_LIST_URL
from tools.scraping_tools.news_article import NewsArticle
from tools.scraping_tools.bill import Bill, DeputyVote, Law, Vote
from tools.scraping_tools.bill_flags import flag_bill
from tools.scraping_tools.url_collector import UrlCollector
from tools.scraping_tools.section_filter import is_relevant_url, is_relevant_categories, is_relevant_delfino_section
from tools.file_tools.file_manager import FileManager
from tools.database_tools.database import Database
from tools.display_tools.progress import ProgressBoard, ProgressTask

logger = logging.getLogger("cr")

# Delfino vote pages cached without deputies are read again while the vote is this recent (see add_deputy_votes).
RECENT_VOTE_DAYS = 30
# Delfino vote kinds stored in votes; elections are voted by candidate, not for / against (#22).
KEPT_VOTE_KINDS = {"plenary", "full_committee"}

class Pipeline:
  def __init__(self, board: ProgressBoard | None = None):
    """board shows the progress of each website and phase; without one nothing is shown (logs still go to "cr")."""
    self.board: ProgressBoard = board or ProgressBoard(enabled = False)

  def scrap_and_save(self, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                     period: DataPeriod = Config.DATA_PERIOD, first_bill: int = Config.FIRST_BILL) -> dict[str, Any]:
    """
    Scrapes every news website (and Delfino's Plenario votes of bills from first_bill on) in parallel and saves the
    results into the private corpus database. Bills come from the SIL instead: see scrap_and_save_asamblea (#66).
    """
    results: dict[str, Any] = self.scrap_websites(scrap_urls, scrap_new_htmls, period, first_bill)
    database: Database = Database(Config.DATABASE_DIR, Config.PRIVATE_DATABASE)
    database.create_private_corpus_tables()
    self.save_results(results, database)
    return results

  def save_results(self, results: dict[str, Any], database: Database):
    """Inserts what scrap_websites returned. Runs in the calling thread (SQLite connections are per thread)."""
    if "crhoy" in results:
      database.insert_news_articles(results["crhoy"])
      logger.info(f"[crhoy] saved {len(results['crhoy'])} news")
    if "delfino" in results:
      delfino: dict[str, Any] = results["delfino"]
      database.insert_news_articles(delfino["news"])
      database.insert_news_bill_links_map(delfino["bill_links"], "link")
      counts: dict[str, int] = database.replace_vote_tables(delfino["votes"])
      self.link_vote_deputies(database)
      linked: int = sum(len(numbers) for numbers in delfino["bill_links"].values())
      logger.info(f"[delfino] saved {len(delfino['news'])} news, {linked} bill links, {counts}")
    if "elmundo" in results:
      database.insert_news_articles(results["elmundo"])
      logger.info(f"[elmundo] saved {len(results['elmundo'])} news")
    if "semanario" in results:
      database.insert_news_articles(results["semanario"])
      logger.info(f"[semanario] saved {len(results['semanario'])} news")
    if "nacion" in results:
      database.insert_news_articles(results["nacion"])
      logger.info(f"[nacion] saved {len(results['nacion'])} news")

  def scrap_websites(self, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                     period: DataPeriod = Config.DATA_PERIOD, first_bill: int = Config.FIRST_BILL) -> dict[str, Any]:
    """
    Scrapes every website in parallel, one thread per website, each with its own fetcher and rate limit.
    Delfino's news and votes share a thread because they are the same website. Votes are kept for bills from
    first_bill on, independent of the period.
    Results are returned (not inserted): SQLite connections can't be shared across threads, so insert
    them from the calling thread. A website that fails is reported and left out; the others continue.
    """
    jobs: dict[str, Callable[[], Any]] = {
      "crhoy": lambda: self.scrap_crhoy(self.make_fetcher("crhoy"), scrap_urls, scrap_new_htmls, period),
      "delfino": lambda: self.scrap_delfino_website(self.make_fetcher("delfino"), scrap_urls, scrap_new_htmls, period,
                                                    first_bill),
      "elmundo": lambda: self.scrap_elmundo(self.make_fetcher("elmundo"), scrap_urls, scrap_new_htmls, period),
      "nacion": lambda: self.scrap_nacion(self.make_fetcher("nacion"), scrap_urls, scrap_new_htmls, period),
      "semanario": lambda: self.scrap_semanario(self.make_fetcher("semanario"), scrap_urls, scrap_new_htmls, period),
    }
    return run_in_parallel(jobs)

  def make_fetcher(self, website: str) -> HTMLFetcher:
    return HTMLFetcher(Config.USER_AGENT, Config.rate_limit_for(website), Config.RETRIES, Config.TIMEOUT, website)

  def news_tasks(self, site: str, scrap_urls: bool, scrap_new_htmls: bool) -> tuple[ProgressTask | None, ProgressTask | None, ProgressTask]:
    """The site's rows for collecting urls (sitemaps), downloading and parsing news; a phase that won't run gets no row."""
    sitemaps_task: ProgressTask | None = self.board.task(site, "sitemaps") if scrap_urls else None
    download_task: ProgressTask | None = self.board.task(site, "download") if scrap_new_htmls else None
    return sitemaps_task, download_task, self.board.task(site, "parse")

  def scrap_delfino_website(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                            period: DataPeriod = Config.DATA_PERIOD, first_bill: int = Config.FIRST_BILL) -> dict[str, Any]:
    news_tasks = self.news_tasks(fetcher.name, scrap_urls, scrap_new_htmls)
    # Every row is created now, so the votes show as waiting while the news run (same thread).
    list_task: ProgressTask = self.board.task(fetcher.name, "vote list")
    votes_task: ProgressTask = self.board.task(fetcher.name, "votes")
    news_articles, bill_links = self.scrap_delfino_news(fetcher, scrap_urls, scrap_new_htmls, period, news_tasks)
    votes: list[Vote] = self.scrap_delfino_votes(fetcher, first_bill, list_task, votes_task)
    return {"news": news_articles, "bill_links": bill_links, "votes": votes}

  def scrap_crhoy(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                  period: DataPeriod = Config.DATA_PERIOD) -> list[NewsArticle]:
    save_folder_path: str = f"{Config.RAW_HTML_DIR}/crhoy/news"
    links_folder_path: str = f"{Config.RAW_LINKS_DIR}/crhoy"
    sitemaps_task, download_task, parse_task = self.news_tasks(fetcher.name, scrap_urls, scrap_new_htmls)
    url_collector: UrlCollector = UrlCollector(sitemaps_task)
    file_manager: FileManager = FileManager()
    parser: CRHoyParser = CRHoyParser()

    crhoy_urls: list[str] = []
    if scrap_urls:
      crhoy_urls = url_collector.get_crhoy_links(period)
      url_collector.report_failed_sitemaps(fetcher.name)
      file_manager.save_dict_as_json(links_folder_path, "crhoy_links", {"links": crhoy_urls})
    else:
      crhoy_urls = file_manager.load_json_as_dict(links_folder_path, "crhoy_links")["links"]

    if scrap_new_htmls:
      fetcher.fetch_multiple(save_folder_path, crhoy_urls, download_task)

    filtered_urls: list[str] = []
    for url in crhoy_urls:
      if is_relevant_url("crhoy", url) and file_manager.html_exists(save_folder_path, url):
        filtered_urls.append(url)

    news_articles: list[NewsArticle] = []
    parse_task.set_total(len(filtered_urls))
    for url in filtered_urls:
      parse_task.advance()
      html = file_manager.load_html(save_folder_path, url)
      if is_error_html(html):
        parse_task.warn(f"Url {url} found {html.lower()}")
        continue
      news_article: NewsArticle | None = parser.parse(html, url)
      if news_article and period.contains(news_article.date_published):
        news_articles.append(news_article)
    parse_task.finish()
    logger.info(f"[{fetcher.name}] CRHoy: {len(news_articles)} news inside the period out of {len(filtered_urls)} downloaded")
    return news_articles

  def scrap_nacion(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                   period: DataPeriod = Config.DATA_PERIOD) -> list[NewsArticle]:
    save_folder_path: str = f"{Config.RAW_HTML_DIR}/nacion/news"
    links_folder_path: str = f"{Config.RAW_LINKS_DIR}/nacion"
    sitemaps_task, download_task, parse_task = self.news_tasks(fetcher.name, scrap_urls, scrap_new_htmls)
    url_collector: UrlCollector = UrlCollector(sitemaps_task)
    file_manager: FileManager = FileManager()
    parser: NacionParser = NacionParser()

    nacion_urls: list[str] = []
    if scrap_urls:
      nacion_urls = url_collector.get_nacion_links(period)
      url_collector.report_failed_sitemaps(fetcher.name)
      file_manager.save_dict_as_json(links_folder_path, "nacion_links", {"links": nacion_urls})
    else:
      nacion_urls = file_manager.load_json_as_dict(links_folder_path, "nacion_links")["links"]

    if scrap_new_htmls:
      fetcher.fetch_multiple(save_folder_path, nacion_urls, download_task)

    filtered_urls: list[str] = []
    for url in nacion_urls:
      if is_relevant_url("nacion", url) and file_manager.html_exists(save_folder_path, url):
        filtered_urls.append(url)

    news_articles: list[NewsArticle] = []
    parse_task.set_total(len(filtered_urls))
    for url in filtered_urls:
      parse_task.advance()
      html = file_manager.load_html(save_folder_path, url)
      if is_error_html(html):
        parse_task.warn(f"Url {url} found {html.lower()}")
        continue
      news_article: NewsArticle | None = parser.parse(html, url)
      if news_article and period.contains(news_article.date_published):
        news_articles.append(news_article)
    parse_task.finish()
    logger.info(f"[{fetcher.name}] La Nación: {len(news_articles)} news inside the period out of {len(filtered_urls)} downloaded")
    return news_articles

  def scrap_elmundo(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                    period: DataPeriod = Config.DATA_PERIOD) -> list[NewsArticle]:
    return self.scrap_wordpress(fetcher, ElMundoParser(), "https://elmundo.cr", True, scrap_urls, scrap_new_htmls, period)

  def scrap_semanario(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                      period: DataPeriod = Config.DATA_PERIOD) -> list[NewsArticle]:
    # Semanario's /users answers an HTML page and its bylines are not public in the API (see SemanarioParser).
    return self.scrap_wordpress(fetcher, SemanarioParser(), "https://semanariouniversidad.com", False, scrap_urls, scrap_new_htmls, period)

  def scrap_wordpress(self, fetcher: HTMLFetcher, parser: WordPressParser, site_url: str, with_users: bool,
                      scrap_urls: bool = False, scrap_new_htmls: bool = False,
                      period: DataPeriod = Config.DATA_PERIOD) -> list[NewsArticle]:
    """
    A WordPress outlet (El Mundo, Semanario) through its REST API: each response page (100 posts of one
    month) is the raw file and already has the full body, so collecting urls and downloading news are the
    same requests. Missing pages are fetched when scrap_urls or scrap_new_htmls is set; otherwise only
    the cache is read. with_users maps the post's WordPress user to its name (only where it's the byline).
    """
    outlet: str = parser.ORGANIZATION
    api_folder_path: str = f"{Config.RAW_HTML_DIR}/{outlet}/api"
    links_folder_path: str = f"{Config.RAW_LINKS_DIR}/{outlet}"
    url_collector: UrlCollector = UrlCollector()
    file_manager: FileManager = FileManager()
    fetch_missing: bool = scrap_urls or scrap_new_htmls
    api_task: ProgressTask = self.board.task(outlet, "api", total = len(period.months()))
    parse_task: ProgressTask = self.board.task(outlet, "parse")

    # Categories and authors change rarely and are a handful of requests: refreshed on every fetching run.
    category_items: list[dict] = self.fetch_wordpress_pages(
      fetcher, file_manager, parser, api_folder_path,
      lambda page: url_collector.get_wordpress_categories_link(site_url, page), fetch_missing, fetch_missing)
    categories: dict[int, str] = parser.parse_categories(category_items)
    category_slugs: dict[int, str] = {category["id"]: category.get("slug", "") for category in category_items}
    authors: dict[int, str] = {}
    if with_users:
      authors = parser.parse_authors(self.fetch_wordpress_pages(
        fetcher, file_manager, parser, api_folder_path,
        lambda page: url_collector.get_wordpress_users_link(site_url, page), fetch_missing, fetch_missing))

    posts: list[dict] = []
    for year, month in period.months():
      next_month: datetime = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
      page_link = lambda page, year = year, month = month: url_collector.get_wordpress_posts_link(site_url, year, month, page)
      # A month cached before it ended (plus a day for late edits) is incomplete: refresh its pages.
      refresh_before: datetime = next_month + timedelta(days = 1)
      month_posts: list[dict] = self.fetch_wordpress_pages(fetcher, file_manager, parser, api_folder_path, page_link,
                                                           fetch_missing, False, refresh_before)
      logger.info(f"[{fetcher.name}] {year}-{month:02d}: {len(month_posts)} posts")
      posts += month_posts
      api_task.advance()
    api_task.finish()

    news_articles: list[NewsArticle] = []
    links: list[str] = []
    parse_task.set_total(len(posts))
    for i in range(len(posts)):
      parse_task.advance()
      news_article: NewsArticle | None = parser.parse(posts[i], categories, authors)
      if news_article and period.contains(news_article.date_published):
        links.append(news_article.url)
        slugs: list[str] = [category_slugs.get(category_id, "") for category_id in posts[i].get("categories", [])]
        if is_relevant_url(outlet, news_article.url) and is_relevant_categories(outlet, slugs):
          news_articles.append(news_article)
    parse_task.finish()
    file_manager.save_dict_as_json(links_folder_path, f"{outlet}_links", {"links": list(dict.fromkeys(links))})
    logger.info(f"[{fetcher.name}] {len(news_articles)} relevant news inside the period out of {len(links)}")
    return news_articles

  def fetch_wordpress_pages(self, fetcher: HTMLFetcher, file_manager: FileManager, parser: WordPressParser, folder_path: str,
                            page_link: Callable[[int], str], fetch_missing: bool, refresh: bool = False,
                            refresh_before: datetime | None = None) -> list[dict]:
    """
    Items of every page of a REST collection, page 1 upwards, until a page has fewer than 100 items or
    an error (WordPress answers 400 past the last page). Cached pages are reused unless refresh is set
    or they were saved before refresh_before. Without fetch_missing nothing is downloaded.
    """
    items: list[dict] = []
    page: int = 1
    while True:
      url: str = page_link(page)
      raw: str | None = None
      if file_manager.html_exists(folder_path, url):
        stale: bool = (refresh or (refresh_before is not None and saved_before(file_manager, folder_path, url, refresh_before))
                       or fetcher.needs_fetch(folder_path, url))   # a cached 429/5xx is retried
        if not (fetch_missing and stale):
          raw = file_manager.load_html(folder_path, url)
      if raw is None:
        if not fetch_missing:
          break
        try:
          raw = fetcher.fetch(folder_path, url)
        except requests.RequestException as error:
          # Nothing is saved, so the page is fetched again on the next run.
          logger.warning(f"[{fetcher.name}] Could not fetch {url}: {error}")
          break

      if is_error_html(raw):
        if not (page > 1 and raw == "Error 400"):
          logger.warning(f"[{fetcher.name}] Url {url} found {raw.lower()}")
        break
      page_items: list[dict] = parser.parse_page(raw)
      items += page_items
      if len(page_items) < 100:
        break
      page += 1
    return items

  def scrap_delfino_news(self, fetcher: HTMLFetcher, scrap_urls: bool = False, scrap_new_htmls: bool = False,
                         period: DataPeriod = Config.DATA_PERIOD,
                         tasks: tuple[ProgressTask | None, ProgressTask | None, ProgressTask] | None = None
                         ) -> tuple[list[NewsArticle], dict[str, list[int]]]:
    """
    Returns the news inside the period (excluded sections dropped) and, per news id, the bill
    numbers its body links to (store them with Database.insert_news_bill_links, source "link").
    tasks: the (sitemaps, download, parse) rows, see news_tasks; created here when not given.
    """
    save_folder_path: str = f"{Config.RAW_HTML_DIR}/delfino/news"
    links_folder_path: str = f"{Config.RAW_LINKS_DIR}/delfino"
    sitemaps_task, download_task, parse_task = tasks or self.news_tasks(fetcher.name, scrap_urls, scrap_new_htmls)
    url_collector: UrlCollector = UrlCollector(sitemaps_task)
    file_manager: FileManager = FileManager()
    parser: DelfinoParser = DelfinoParser()

    delfino_urls: list[str] = []
    if scrap_urls:
      delfino_urls = url_collector.get_delfino_news_links(period)
      url_collector.report_failed_sitemaps(fetcher.name)
      file_manager.save_dict_as_json(links_folder_path, "delfino_news_links", {"links": delfino_urls})
    else:
      delfino_urls = file_manager.load_json_as_dict(links_folder_path, "delfino_news_links")["links"]

    if scrap_new_htmls:
      fetcher.fetch_multiple(save_folder_path, delfino_urls, download_task)

    downloaded_urls: list[str] = [url for url in delfino_urls if file_manager.html_exists(save_folder_path, url)]

    news_articles: list[NewsArticle] = []
    bill_links: dict[str, list[int]] = {}
    parse_task.set_total(len(downloaded_urls))
    for url in downloaded_urls:
      parse_task.advance()
      html = file_manager.load_html(save_folder_path, url)
      if is_error_html(html):
        parse_task.warn(f"Url {url} found {html.lower()}")
        continue
      news_article: NewsArticle | None = parser.parse(html, url)
      # Delfino urls carry no section, so the section filter runs here, on the page's articleSection
      if news_article and period.contains(news_article.date_published) and is_relevant_delfino_section(news_article.section):
        news_articles.append(news_article)
        links: list[int] = parser.parse_bill_links(html)
        if links:
          bill_links[news_article.id] = links
    parse_task.finish()
    logger.info(f"[{fetcher.name}] Delfino: {len(news_articles)} news inside the period out of {len(downloaded_urls)} downloaded")
    return news_articles, bill_links

  def scrap_delfino_votes(self, fetcher: HTMLFetcher, first_bill: int = Config.FIRST_BILL,
                          list_task: ProgressTask | None = None, votes_task: ProgressTask | None = None) -> list[Vote]:
    """
    Plenario and comisión plena votes of bills from first_bill on, with how each deputy voted (the only bill data still
    taken from Delfino, #22 #66). Elections (appointments, voted by candidate) are listed but not kept. The votes come
    from Delfino's votes list (/asamblea/votaciones?pagina=N, 10 per page, newest first), saved as it is read in
    raw/links/delfino/votes_list.json:
    - until the whole list has been read once, each run continues from the last page read (newer votes only push the
      older ones to later pages, so none is missed);
    - after that, each run reads from page 1 until a page brings no new vote.
    Then every vote page is read (cached: a vote doesn't change once published). A page that fails is retried next run.
    """
    list_task = list_task or self.board.task(fetcher.name, "vote list")
    votes_task = votes_task or self.board.task(fetcher.name, "votes")
    state_path: str = f"{Config.RAW_LINKS_DIR}/delfino/votes_list.json"
    state: dict[str, Any] = load_json(state_path) or {"complete": False, "last_page": 0, "votes": {}}
    parser: DelfinoVotesParser = DelfinoVotesParser()

    was_complete: bool = state["complete"]
    page: int = 1 if was_complete else max(1, state["last_page"])
    while True:
      try:
        response = fetcher.get_session().get(VOTES_LIST_URL.format(page = page), timeout = fetcher.timeout)
        fetcher.rate_limiter.wait()
      except requests.RequestException as error:
        list_task.warn(f"Could not fetch the votes list page {page}: {error}")
        break
      if response.status_code != 200:
        list_task.warn(f"Votes list page {page} answered {response.status_code}")
        break
      list_task.advance()
      page_votes: list[Vote] = parser.parse_votes_list(response.text)
      new_votes: int = sum(1 for v in page_votes if v.vote_id not in state["votes"])
      for vote in page_votes:
        state["votes"][vote.vote_id] = vote_to_json(vote)
      # Past the last page no vote of any kind is linked (a page may hold only elections or comisión plena votes).
      if not parser.has_vote_cards(response.text):
        state["complete"] = True
        save_json(state_path, state)
        break
      if not was_complete:
        state["last_page"] = page
      save_json(state_path, state)
      if was_complete and new_votes == 0:
        break   # reached votes already known
      page += 1
    list_task.finish()
    if not state["complete"]:
      logger.warning(f"[{fetcher.name}] The votes list was read up to page {state['last_page']}; run again to read the rest")

    listed: list[Vote] = [vote_from_json(v) for v in state["votes"].values()]
    votes: list[Vote] = sorted((v for v in listed if v.number >= first_bill and v.kind in KEPT_VOTE_KINDS),
                               key = lambda v: v.vote_id)
    self.add_deputy_votes(fetcher, parser, votes, votes_task)
    kinds: dict[str, int] = {}
    for vote in votes:
      kinds[vote.kind] = kinds.get(vote.kind, 0) + 1
    elections: int = sum(1 for v in listed if v.kind == "election")
    logger.info(f"[{fetcher.name}] {len(votes)} votes of bills from {first_bill} on {kinds}, out of {len(listed)} listed "
                f"({elections} elections left out)")
    return votes

  def add_deputy_votes(self, fetcher: HTMLFetcher, parser: DelfinoVotesParser, votes: list[Vote], votes_task: ProgressTask):
    """
    Fills each vote with how every deputy voted, from its Delfino vote page. A cached page is never downloaded again;
    a page that fails leaves that vote without deputies (a cached error is retried on the next run).
    """
    save_folder_path: str = f"{Config.RAW_HTML_DIR}/delfino/asamblea/votes"
    file_manager: FileManager = FileManager()
    recent: date = date.today() - timedelta(days = RECENT_VOTE_DAYS)
    votes_task.set_total(len(votes))
    for vote in votes:
      votes_task.advance()
      html: str | None = None
      if file_manager.html_exists(save_folder_path, vote.url):
        html = file_manager.load_html(save_folder_path, vote.url)
        # A recent vote cached without deputies may have been read before Delfino loaded them: read it again.
        if not is_error_html(html) and vote.date and vote.date >= recent and not parser.parse_vote_page(html):
          html = None
      if html is None or is_error_html(html):
        try:
          html = fetcher.fetch(save_folder_path, vote.url)
        except requests.RequestException as error:
          votes_task.warn(f"Could not fetch vote {vote.url}: {error}")
          continue
      if is_error_html(html):
        votes_task.warn(f"Vote {vote.url} found {html.lower()}")
        continue
      try:
        vote.deputy_votes = parser.parse_vote_page(html)
      except Exception as error:
        votes_task.warn(f"Could not parse vote {vote.url} of bill {vote.number}: {error!r}")
      if not vote.deputy_votes:
        votes_task.warn(f"Vote {vote.url} of bill {vote.number} lists no deputies")
    votes_task.finish()

  def link_vote_deputies(self, database: Database):
    """
    Sets vote_deputies.deputy_id from the stored deputies (SIL, #65), matching Delfino's name to a deputy in office
    on the vote date. Runs after saving votes and after saving deputies, so either order works.
    """
    matcher: DeputyMatcher = DeputyMatcher(database.get_deputies_for_matching())
    rows = database.get_vote_deputies_for_matching()
    matches: list[tuple[int | None, str, str]] = [(matcher.match(name, date.fromisoformat(day) if day else None), vote_id, slug)
                                                  for vote_id, slug, name, day in rows]
    database.update_vote_deputy_ids(matches)
    unmatched: set[str] = {f"{name}" for (deputy_id, _, _), (_, _, name, _) in zip(matches, rows) if deputy_id is None}
    if rows:
      logger.info(f"[delfino] {len(rows) - sum(1 for m in matches if m[0] is None)} of {len(rows)} deputy votes matched "
                  f"to SIL deputies; {len(unmatched)} names unmatched: {sorted(unmatched)[:20]}")

  def scrap_and_save_asamblea(self, refresh_before: datetime | None = None,
                              deputies_since: datetime = Config.DEPUTIES_SINCE, first_bill: int = Config.FIRST_BILL,
                              sessions: int = Config.ASAMBLEA_SESSIONS) -> dict[str, int]:
    """
    Deputies, legislative organs (#65) and bills (#66) from the Asamblea's SIL into the private corpus database.
    Downloads what is not cached yet, then rebuilds the SIL tables from the cache. Ctrl+C (or a network failure)
    stops the downloads but still builds the tables with what was cached, so nothing downloaded is lost and the next
    run continues where this one stopped. refresh_before re-downloads the files cached before that moment.
    Bills are downloaded by several sessions in parallel (sessions), each at Config.RATE_LIMIT.
    Returns the number of rows per table.
    """
    fetcher: AsambleaFetcher = AsambleaFetcher(refresh_before = refresh_before)
    parser: AsambleaParser = AsambleaParser()
    try:
      self.fetch_asamblea(fetcher, parser, deputies_since, first_bill, sessions, refresh_before)
    except KeyboardInterrupt:
      logger.warning("[asamblea] Stopped (Ctrl+C): building the tables with what is cached. Run again to continue.")
    except (requests.RequestException, AsambleaError) as error:
      logger.error(f"[asamblea] Download stopped: {error!r}. Building the tables with what is cached.")
    data: AsambleaData = self.build_asamblea_data(fetcher, parser, deputies_since, first_bill)
    database: Database = Database(Config.DATABASE_DIR, Config.PRIVATE_DATABASE)
    database.create_private_corpus_tables()
    counts: dict[str, int] = database.replace_asamblea_tables(data, datetime.now())
    counts.update(database.replace_bill_tables(data.bills, data.laws))
    self.link_vote_deputies(database)
    logger.info(f"[asamblea] saved {counts}")
    return counts

  def fetch_asamblea(self, fetcher: AsambleaFetcher, parser: AsambleaParser, deputies_since: datetime,
                     first_bill: int = Config.FIRST_BILL, sessions: int = Config.ASAMBLEA_SESSIONS,
                     refresh_before: datetime | None = None):
    """
    Block 1: every tab of each deputy term still running on or after deputies_since.
    Block 2: the bills each active organ holds today.
    Block 3: the tabs of every bill from first_bill on (several sessions in parallel), plus the laws list.
    Block 4: the base text of every bill (#32), the same way. It needs the bill's General tab from block 3.
    Cached items are skipped. One that fails is warned about and retried on the next run; the others go on.
    """
    deputies_task: ProgressTask = self.board.task("asamblea", "deputies")
    organs_task: ProgressTask = self.board.task("asamblea", "organs")
    bills_task: ProgressTask = self.board.task("asamblea", "bills")
    texts_task: ProgressTask = self.board.task("asamblea", "bill texts")

    deputies: list[Deputy] = parser.select_deputies(parser.parse_deputies_list(fetcher.fetch_deputies_list()), deputies_since)
    deputies_task.set_total(len(deputies))
    missing: list[Deputy] = [d for d in deputies if not fetcher.deputy_is_cached(d.deputy_id)]
    contexts: dict[int, list[dict]] = fetcher.deputy_contexts() if missing else {}
    missing_ids: set[int] = {d.deputy_id for d in missing}
    for deputy in deputies:
      if deputy.deputy_id in missing_ids:
        context: list[dict] | None = contexts.get(deputy.deputy_id)
        if context is None:
          deputies_task.warn(f"Deputy {deputy.deputy_id} ({deputy.surnames}) is not in the SIL list anymore")
        else:
          try:
            fetcher.fetch_deputy(deputy.deputy_id, context)
          except (requests.RequestException, AsambleaError) as error:
            deputies_task.warn(f"Could not fetch deputy {deputy.deputy_id} ({deputy.surnames}): {error!r}")
      deputies_task.advance()
    deputies_task.finish()

    organs: list[Organ] = [o for o in parser.parse_organs_list(fetcher.fetch_organs_list()) if o.status == "ACTIVO"]
    organs_task.set_total(len(organs))
    for organ in organs:
      if not fetcher.organ_is_cached(organ.organ_code):
        try:
          fetcher.fetch_organ(organ.organ_code)
        except (requests.RequestException, AsambleaError) as error:
          organs_task.warn(f"Could not fetch organ {organ.organ_code} ({organ.name}): {error!r}")
      organs_task.advance()
    organs_task.finish()

    fetcher.fetch_laws_list()
    numbers: list[int] = sorted(parser.parse_bills_list(fetcher.fetch_bills_list(), first_bill))
    self.fetch_sil_bills(numbers, sessions, refresh_before, bills_task)
    self.fetch_sil_bill_texts(numbers, sessions, texts_task)

  def fetch_sil_bills(self, numbers: list[int], sessions: int, refresh_before: datetime | None, task: ProgressTask):
    """Downloads the tabs of the bills not cached yet (see fetch_in_sessions)."""
    self.fetch_in_sessions(numbers, sessions, refresh_before, task, "bill",
                           AsambleaFetcher.bill_is_cached, AsambleaFetcher.fetch_bill)

  def fetch_sil_bill_texts(self, numbers: list[int], sessions: int, task: ProgressTask):
    """
    Downloads the base text of the bills not cached yet (#32), after their tabs: it needs the General tab.
    Texts are never refreshed (see AsambleaFetcher.fetch_bill_text).
    """
    self.fetch_in_sessions(numbers, sessions, None, task, "bill text",
                           AsambleaFetcher.bill_text_is_cached, AsambleaFetcher.fetch_bill_text)

  def fetch_in_sessions(self, numbers: list[int], sessions: int, refresh_before: datetime | None, task: ProgressTask,
                        what: str, is_cached: Callable[[AsambleaFetcher, int], bool],
                        fetch: Callable[[AsambleaFetcher, int], Any]):
    """
    Downloads what is not cached yet for each bill number, with `sessions` SIL sessions in parallel (one thread and
    one rate limit each; bills are dealt round-robin). A bill that fails is warned about and retried on the next run.
    Ctrl+C asks the threads to stop after their current bill, waits for them and is raised again, so the caller still
    builds the tables from the cache.
    """
    task.set_total(len(numbers))
    probe: AsambleaFetcher = AsambleaFetcher(refresh_before = refresh_before)
    missing: list[int] = []
    for number in numbers:
      if is_cached(probe, number):
        task.advance()
      else:
        missing.append(number)
    stop: threading.Event = threading.Event()

    def work(chunk: list[int]):
      fetcher: AsambleaFetcher = AsambleaFetcher(refresh_before = refresh_before)
      for number in chunk:
        if stop.is_set():
          return
        try:
          fetch(fetcher, number)
        except (requests.RequestException, AsambleaError, zipfile.BadZipFile, KeyError) as error:
          task.warn(f"Could not fetch {what} {number}: {error!r}")
        task.advance()

    threads: list[threading.Thread] = [threading.Thread(target = work, args = (missing[i::sessions],), name = f"sil-{i}", daemon = True)
                                       for i in range(max(1, sessions))]
    for thread in threads:
      thread.start()
    try:
      while any(thread.is_alive() for thread in threads):
        for thread in threads:
          thread.join(timeout = 0.5)
    except KeyboardInterrupt:
      stop.set()
      logger.warning(f"[asamblea] Ctrl+C: waiting for the {what} sessions to finish their current bill...")
      for thread in threads:
        thread.join()
      raise
    task.finish()

  def build_asamblea_data(self, fetcher: AsambleaFetcher, parser: AsambleaParser, deputies_since: datetime,
                          first_bill: int = Config.FIRST_BILL) -> AsambleaData:
    """
    Every SIL record from the cached CSVs only (no downloads). Deputies and bills whose tabs aren't cached keep
    empty fields (a bill without its tabs keeps only its number and title, and no status).
    """
    data: AsambleaData = AsambleaData()
    deputies_list: str | None = fetcher.load("deputies", "list")
    if deputies_list:
      for deputy in parser.select_deputies(parser.parse_deputies_list(deputies_list), deputies_since):
        parser.parse_deputy(deputy, fetcher.load_deputy(deputy.deputy_id), data)
        data.deputies.append(deputy)
    organs_list: str | None = fetcher.load("organs", "list")
    if organs_list:
      data.organs = parser.parse_organs_list(organs_list)
      for organ in data.organs:
        if organ.status == "ACTIVO":
          parser.parse_organ(organ, fetcher.load_organ(organ.organ_code), data)

    laws_list: str | None = fetcher.load("laws", "list")
    data.laws = parser.parse_laws_list(laws_list) if laws_list else []
    law_numbers: dict[int, list[int]] = {}
    for law in data.laws:
      if law.bill_number is not None:
        law_numbers.setdefault(law.bill_number, []).append(law.law_number)
    bills_list: str | None = fetcher.load("bills", "list")
    if bills_list:
      deputy_index: dict[tuple[str, str], int] = make_deputy_index(data.deputies)
      extracted: datetime = datetime.now()
      for number, title in sorted(parser.parse_bills_list(bills_list, first_bill).items()):
        bill: Bill = parser.parse_bill(number, title, fetcher.load_bill(number), law_numbers.get(number, []),
                                       deputy_index, extracted)
        bill.flag = flag_bill(bill)
        parser.parse_bill_text(bill, fetcher.load_bill_text(number))
        data.bills.append(bill)
      matched: int = sum(1 for b in data.bills for p in b.proponents if p.deputy_id is not None)
      total: int = sum(len(b.proponents) for b in data.bills)
      logger.info(f"[asamblea] {matched} of {total} bill proponents matched to SIL deputies (the rest: the executive, "
                  f"other signers, or terms before {deputies_since.date()})")
    return data

  def apply_embeddings(self):
    pass

def run_in_parallel(jobs: dict[str, Callable[[], Any]]) -> dict[str, Any]:
  """Runs each job in its own thread. Returns {name: result} for the jobs that finished without errors."""
  results: dict[str, Any] = {}
  if not jobs:
    return results
  with ThreadPoolExecutor(max_workers = len(jobs), thread_name_prefix = "scraper") as executor:
    futures = {name: executor.submit(job) for name, job in jobs.items()}
    for name, future in futures.items():
      try:
        results[name] = future.result()
        logger.info(f"[{name}] finished")
      except Exception:
        logger.exception(f"[{name}] failed, the other websites were not affected")
  return results

def saved_before(file_manager: FileManager, folder_path: str, name: str, moment: datetime) -> bool:
  """True if the cached file was written before moment (local machine time)."""
  return datetime.fromtimestamp(os.path.getmtime(file_manager.get_path(folder_path, name, ".html", True))) < moment

def vote_to_json(vote: Vote) -> dict[str, Any]:
  return {"vote_id": vote.vote_id, "number": vote.number, "date": vote.date.isoformat() if vote.date else None,
          "name": vote.name, "description": vote.description, "result": vote.result, "url": vote.url, "kind": vote.kind}

def vote_from_json(data: dict[str, Any]) -> Vote:
  # Entries saved before kind existed are Plenario votes (the list was read for /votaciones/proyecto/ links only).
  return Vote(data["vote_id"], data["number"], date.fromisoformat(data["date"]) if data["date"] else None,
              data["name"], data["description"], data["result"], data["url"], data.get("kind", "plenary"))

def load_json(path: str) -> dict[str, Any] | None:
  return json.loads(open(path, encoding = "utf-8").read()) if os.path.exists(path) else None

def save_json(path: str, data: dict[str, Any]):
  """Atomic (temp file + rename), so a Ctrl+C while writing keeps the previous file."""
  os.makedirs(os.path.dirname(path), exist_ok = True)
  temp: str = path + ".tmp"
  with open(temp, "w", encoding = "utf-8") as file:
    json.dump(data, file, ensure_ascii = False)
  os.replace(temp, path)

def is_error_html(html: str) -> bool:
  return re.fullmatch(r"Error (\d{3})", html) is not None
