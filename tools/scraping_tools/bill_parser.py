from bs4 import BeautifulSoup, Tag
import json
import re
from datetime import datetime

from tools.scraping_tools.bill import Bill, BillEvent, BillProponent, DeputyVote
from tools.scraping_tools.bill_flags import flag_bill

DELFINO_URL = "https://delfino.cr"
# Deputies link to /asamblea/congresistas/<slug>; the executive and other non-deputy signers ("Gobierno Chaves Robles")
# link to /asamblea/perfiles-especiales/<slug>.
PROPONENT_LINK_REGEX = re.compile(r"/asamblea/(congresistas|perfiles-especiales)/([^/?#]+)")
ZERO_WIDTH_REGEX = re.compile(r"[​‌‍⁠﻿]")
# Group headings of a vote page, e.g. "A favor - 25"
VOTE_GROUP_REGEX = re.compile(r"(.+?)\s*-\s*(\d+)")
VOTE_LABELS = {"a favor": "for", "en contra": "against", "ausente": "absent"}

class BillParser:

  def parse(self, html: str, url: str) -> Bill:
    soup = BeautifulSoup(html, "lxml")
    # print(self.get_title(soup))
    metadata_list: list[Metadata] = self.get_metadata(soup)
    number = int(url.replace("https://delfino.cr/asamblea/proyecto/", ""))
    title = self.get_title(soup)
    description = self.get_description(soup)
    file_type = self.get_metadata_file_type(metadata_list)
    status = self.get_metadata_status(metadata_list)
    law_number = self.get_metadata_law_number(metadata_list, number)
    date_proposed = self.get_metadata_date_proposed(metadata_list)
    commission = self.get_metadata_commission(metadata_list)
    categories = self.get_metadata_categories(metadata_list)
    bill: Bill = Bill(number, title, description, datetime.now(), file_type, status, commission, date_proposed, law_number, categories)
    bill.proponents = self.get_proponents(soup, "Firma Principal", "main") + self.get_proponents(soup, "Co-proponentes", "co")
    bill.events = self.get_text_events(soup) + self.get_vote_events(soup)
    bill.flag = flag_bill(bill)
    return bill

  def get_section(self, soup: BeautifulSoup, heading: str) -> Tag | None:
    """The block under an h2 heading of the bill page (the heading's wrapper plus its list), or None."""
    h2 = soup.find("h2", string = lambda s: s is not None and clean_text(s) == heading)
    if h2 is None:
      # Headings with a tooltip button have more than one child, so .string is None
      h2 = next((tag for tag in soup.find_all("h2") if clean_text(tag.get_text()) == heading), None)
    if h2 is None:
      return None
    # The h2 sits in one or two wrappers; the section is the first ancestor that also holds the list of links.
    # Stops before reaching a block that holds another section's heading.
    for parent in h2.parents:
      if parent.name != "div":
        continue
      if len(parent.find_all("h2")) > 1:
        return None
      if parent.find("a", href = True) is not None:
        return parent
    return None

  def get_proponents(self, soup: BeautifulSoup, heading: str, role: str) -> list[BillProponent]:
    """Proponent cards (deputies or special profiles such as the executive) under Firma Principal or Co-proponentes."""
    section = self.get_section(soup, heading)
    if section is None:
      return []
    return [parse_person_card(card, role) for card in section.find_all("a", href = PROPONENT_LINK_REGEX)]

  def parse_vote_page(self, html: str) -> list[DeputyVote]:
    """
    How each deputy voted, from a Delfino vote page (/asamblea/votaciones/...). The page lists the deputies under
    one h3 per option ("A favor - 25", "En contra - 29", "Ausente - 3"). A group whose card count differs from the
    number in its heading is reported, not dropped.
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
        cards = parent.find_all("a", href = PROPONENT_LINK_REGEX)
        if cards:
          break
      if len(cards) != expected:
        print(f"[delfino] Vote group '{label}' shows {expected} deputies but has {len(cards)} cards")
      for card in cards:
        person: BillProponent = parse_person_card(card, "")
        votes.append(DeputyVote(person.slug, person.name, vote, person.party, person.seat))
    return votes

  def get_text_events(self, soup: BeautifulSoup) -> list[BillEvent]:
    """Histórico de Textos: each entry is a link to a PDF with a date and the kind of text."""
    section = self.get_section(soup, "Histórico de Textos")
    if section is None:
      return []
    events: list[BillEvent] = []
    for link in section.find_all("a", href = True):
      lines: list[str] = [clean_text(div.get_text()) for div in link.find_all("div") if not div.find("div")]
      lines = [line for line in lines if line]
      if not lines:
        continue
      date: datetime | None = parse_spanish_date(lines[0])
      name: str = lines[1] if len(lines) > 1 else lines[0]
      events.append(BillEvent("text", date, name, None, None, link["href"]))
    return events

  def get_vote_events(self, soup: BeautifulSoup) -> list[BillEvent]:
    """Histórico de Votaciones: vote type, what was voted, date and result, linking to the vote page."""
    section = self.get_section(soup, "Histórico de Votaciones")
    if section is None:
      return []
    events: list[BillEvent] = []
    for link in section.find_all("a", href = re.compile(r"/asamblea/votaciones/")):
      paragraphs: list[str] = [clean_text(p.get_text()) for p in link.find_all("p")]
      leaves: list[str] = [clean_text(div.get_text()) for div in link.find_all("div") if not div.find(True)]
      leaves = [leaf for leaf in leaves if leaf]
      name: str = paragraphs[0] if paragraphs else ""
      description: str | None = paragraphs[1] if len(paragraphs) > 1 else None
      date: datetime | None = None
      result: str | None = None
      for leaf in leaves:
        parsed: datetime | None = parse_spanish_date(leaf)
        if parsed is not None:
          date = parsed
        else:
          result = leaf
      href: str = link["href"]
      url: str = DELFINO_URL + href if href.startswith("/") else href
      vote_id: str = href.rstrip("/").split("/")[-1]
      events.append(BillEvent("vote", date, name, description, result, url, vote_id))
    return events


  def get_title(self, soup: BeautifulSoup) -> str:
    title_tag = soup.find("meta", property="og:title")
    title = title_tag.get("content")
    title = title.split(" - ")[1]
    return title
  
  def get_description(self, soup: BeautifulSoup) -> str:
    base = soup.find(string=lambda s: s.strip() == "Propósito del Proyecto")
    description_root = base.parent.parent.parent
    return description_root.find_all(True, recursive = False)[1].text
  
  def get_metadata(self, soup: BeautifulSoup) -> list[Metadata]:

    metadata_list: list[Metadata] = []

    base = soup.find(string=lambda s: s.strip() == "Tipo")
    metadata_list_parent = base.parent.parent.parent
    metadata_list_div = metadata_list_parent.find_all(True, recursive = False)
    for metadata in metadata_list_div:
      metadata_parts = metadata.find_all(True, recursive = False)
      metadata_name = metadata_parts[0].text
      metadata_value = metadata_parts[1].text
      metadata_list.append(Metadata(metadata_name, metadata_value))
    
    return metadata_list
  
  def get_metadata_file_type(self, metadata_list: list[Metadata]):
    for metadata in metadata_list:
      if metadata.name == "Tipo":
        return metadata.value
    return None
  
  def get_metadata_status(self, metadata_list: list[Metadata]):
    for metadata in metadata_list:
      if metadata.name == "Estado":
        return metadata.value
    return None
      
  def get_metadata_law_number(self, metadata_list: list[Metadata], exp_num: int):
    for metadata in metadata_list:
      if metadata.name == "Número de Ley":
        if "6933-22-23" in metadata.value:
          return None
        
        number = int(metadata.value.replace(".", "").replace(" (VETADO)", ""))
        return number
    return None
      
  def get_metadata_date_proposed(self, metadata_list: list[Metadata]):
    for metadata in metadata_list:
      if metadata.name == "Presentado":
        date_parts = metadata.value.strip().lower().split(" de ")
        return datetime(int(date_parts[2]), MONTHS[date_parts[1]], int(date_parts[0]))
    return None
      
  def get_metadata_commission(self, metadata_list: list[Metadata]):
    for metadata in metadata_list:
      if metadata.name == "Comisión":
        return metadata.value
    return None
  
  def get_metadata_categories(self, metadata_list: list[Metadata]):
    for metadata in metadata_list:
      if metadata.name == "Categorías":
        return metadata.value.split("|")
    return []
      

class Metadata:
  def __init__(self, name: str, value: str):
    self.name = name
    self.value = value

MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9,
    "octubre": 10, "noviembre": 11, "diciembre": 12,
}

def parse_person_card(card: Tag, role: str) -> BillProponent:
  """
  A deputy or special-profile card (link to /asamblea/congresistas/ or /asamblea/perfiles-especiales/). Bill pages
  (proponents) and vote pages use the same card.
  """
  link_match = PROPONENT_LINK_REGEX.search(card["href"])
  kind: str = "deputy" if link_match.group(1) == "congresistas" else "special"
  slug: str = link_match.group(2)
  name_tag = card.find("h3")
  name: str = clean_text(name_tag.get_text()) if name_tag else slug
  # The first image is the deputy's photo, the second (bottom right of the photo) the party logo
  images = card.find_all("img")
  party: str | None = (clean_text(images[1].get("alt", "")) or None) if len(images) > 1 else None
  seat: int | None = None
  seat_tag = card.find("div", string = lambda s: s is not None and s.strip().isdigit())
  if seat_tag:
    seat = int(seat_tag.get_text(strip = True))
  position: str | None = None
  province: str | None = None
  for paragraph in card.find_all("p"):
    text: str = clean_text(paragraph.get_text())
    if not text:
      continue
    if "uppercase" in (paragraph.get("class") or []):
      position = text
    else:
      province = text
  return BillProponent(slug, name, role, kind, party, position, province, seat)

def clean_text(text: str) -> str:
  """Collapses whitespace and drops zero-width characters (Delfino puts them in deputy positions)."""
  return " ".join(ZERO_WIDTH_REGEX.sub("", text).split())

def parse_spanish_date(text: str) -> datetime | None:
  """'14 de abril de 2026' as a datetime, or None if the text is not such a date."""
  parts = clean_text(text).lower().split(" de ")
  if len(parts) != 3 or parts[1] not in MONTHS or not parts[0].isdigit() or not parts[2].isdigit():
    return None
  return datetime(int(parts[2]), MONTHS[parts[1]], int(parts[0]))