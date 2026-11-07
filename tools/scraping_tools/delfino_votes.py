import logging
import re
from datetime import date, datetime

from bs4 import BeautifulSoup, Tag

from tools.scraping_tools.bill import DeputyVote, Vote

logger = logging.getLogger("cr")

# Plenario and comisión plena votes are the only bill data taken from Delfino: the SIL has no per-deputy votes (#22, #66).
DELFINO_URL = "https://delfino.cr"
VOTES_LIST_URL = DELFINO_URL + "/asamblea/votaciones?pagina={page}"
# The list links each vote by kind: proyecto (Plenario), plena (comisiones plenas), eleccion (appointments),
# mocion (procedural motions, with no bill)... Any kind is recognized; unknown ones keep Delfino's word.
VOTE_LINK_REGEX = re.compile(r"^/asamblea/votaciones/([a-z-]+)/(\d+)/?$")
VOTE_KINDS = {"proyecto": "plenary", "plena": "full_committee", "eleccion": "election", "mocion": "motion"}
BILL_HEADING_REGEX = re.compile(r"Expediente\s+([\d.]+)", re.IGNORECASE)
# Deputies link to /asamblea/congresistas/<slug>; other profiles to /asamblea/perfiles-especiales/<slug>.
PERSON_LINK_REGEX = re.compile(r"/asamblea/(congresistas|perfiles-especiales)/([^/?#]+)")
ZERO_WIDTH_REGEX = re.compile(r"[​‌‍⁠﻿]")
# Group headings of a vote page, e.g. "A favor - 25"
VOTE_GROUP_REGEX = re.compile(r"(.+?)\s*-\s*(\d+)")
VOTE_LABELS = {"a favor": "for", "en contra": "against", "ausente": "absent"}
MONTHS = {
  "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
  "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9,
  "octubre": 10, "noviembre": 11, "diciembre": 12,
}

class DelfinoVotesParser:

  def parse_votes_list(self, html: str) -> list[Vote]:
    """
    The votes of one page of Delfino's votes list (/asamblea/votaciones?pagina=N, 10 per page, newest first).
    Each card holds the bill ("Expediente 25754"), the kind of vote, what was voted, the date and the result.
    Every kind is returned (Vote.kind: plenary, full_committee or election); the caller decides which to keep.
    Cards without a bill number are skipped (reported in the log).
    """
    soup = BeautifulSoup(html, "lxml")
    votes: list[Vote] = []
    for link in soup.find_all("a", href = VOTE_LINK_REGEX):
      path_kind, vote_id = VOTE_LINK_REGEX.match(link["href"]).groups()
      heading = link.find("h3")
      bill_match = BILL_HEADING_REGEX.search(clean_text(heading.get_text())) if heading else None
      if bill_match is None:
        logger.info(f"[delfino] Vote {vote_id} ({path_kind}) has no bill number, skipped")
        continue
      paragraphs: list[str] = [clean_text(p.get_text()) for p in link.find_all("p")]
      leaves: list[str] = [clean_text(div.get_text()) for div in link.find_all("div") if not div.find(True)]
      vote_date: date | None = None
      result: str | None = None
      for leaf in filter(None, leaves):
        parsed: datetime | None = parse_spanish_date(leaf)
        if parsed is not None:
          vote_date = parsed.date()
        else:
          result = leaf
      votes.append(Vote(vote_id, int(bill_match.group(1).replace(".", "")), vote_date,
                        paragraphs[0] if paragraphs else "", paragraphs[1] if len(paragraphs) > 1 and paragraphs[1] else None,
                        result, f"{DELFINO_URL}/asamblea/votaciones/{path_kind}/{vote_id}", VOTE_KINDS.get(path_kind, path_kind)))
    return votes

  def has_vote_cards(self, html: str) -> bool:
    """Whether a votes list page links any vote, of any kind (a page past the last one links none)."""
    return re.search(r'href="/asamblea/votaciones/[a-z-]+/\d+', html) is not None

  def parse_vote_page(self, html: str) -> list[DeputyVote]:
    """
    How each deputy voted, from a Delfino vote page (/asamblea/votaciones/proyecto/<id>). The page lists the deputies
    under one h3 per option ("A favor - 25", "En contra - 29", "Ausente - 3"). A group whose card count differs from
    the number in its heading is reported, not dropped.
    """
    soup = BeautifulSoup(html, "lxml")
    votes: list[DeputyVote] = []
    for heading in soup.find_all("h3"):
      heading_match = VOTE_GROUP_REGEX.fullmatch(clean_text(heading.get_text(" ")))
      if heading_match is None:
        continue
      label, expected = heading_match.group(1), int(heading_match.group(2))
      vote: str = VOTE_LABELS.get(label.lower(), label)
      # The group is the smallest block around the heading that holds deputy cards
      cards: list[Tag] = []
      for parent in heading.parents:
        cards = parent.find_all("a", href = PERSON_LINK_REGEX)
        if cards:
          break
      if len(cards) != expected:
        logger.warning(f"[delfino] Vote group '{label}' shows {expected} deputies but has {len(cards)} cards")
      for card in cards:
        slug, name, party, seat = parse_person_card(card)
        votes.append(DeputyVote(slug, name, vote, party, seat))
    return votes

def parse_person_card(card: Tag) -> tuple[str, str, str | None, int | None]:
  """(slug, name, party, seat) of a deputy card on a vote page."""
  slug: str = PERSON_LINK_REGEX.search(card["href"]).group(2)
  name_tag = card.find("h3")
  name: str = clean_text(name_tag.get_text()) if name_tag else slug
  # The first image is the deputy's photo, the second (bottom right of the photo) the party logo
  images = card.find_all("img")
  party: str | None = (clean_text(images[1].get("alt", "")) or None) if len(images) > 1 else None
  seat_tag = card.find("div", string = lambda s: s is not None and s.strip().isdigit())
  seat: int | None = int(seat_tag.get_text(strip = True)) if seat_tag else None
  return slug, name, party, seat

def clean_text(text: str) -> str:
  """Collapses whitespace and drops zero-width characters."""
  return " ".join(ZERO_WIDTH_REGEX.sub("", text).split())

def parse_spanish_date(text: str) -> datetime | None:
  """'14 de abril de 2026' as a datetime, or None if the text is not such a date."""
  parts = clean_text(text).lower().split(" de ")
  if len(parts) != 3 or parts[1] not in MONTHS or not parts[0].isdigit() or not parts[2].isdigit():
    return None
  return datetime(int(parts[2]), MONTHS[parts[1]], int(parts[0]))
