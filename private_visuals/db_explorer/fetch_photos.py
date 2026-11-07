"""
Deputy photos for the explorer, from Delfino.

Delfino has no deputy directory, but every deputy card on its vote pages holds the deputy's photo. This script reads
the vote pages already cached by the pipeline (raw/html/delfino/asamblea/votes/, no page is requested), matches each
card to a SIL deputy by name and vote date (the same DeputyMatcher as the votes) and downloads each photo once into
raw/images/delfino/deputies/, with an index.json that maps every Delfino deputy to its file and person_id.
raw/ is in .gitignore, so the photos stay out of the repository. Photos already downloaded are not requested again.

    python private_visuals/db_explorer/fetch_photos.py
"""
import argparse
import json
import re
import sqlite3
import sys
import time
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT))

from config import Config  # noqa: E402
from tools.scraping_tools.asamblea_parser import DeputyMatcher  # noqa: E402
from tools.scraping_tools.delfino_votes import PERSON_LINK_REGEX, parse_person_card, parse_spanish_date  # noqa: E402

VOTES_DIR = ROOT / "raw" / "html" / "delfino" / "asamblea" / "votes"
PHOTOS_DIR = ROOT / "raw" / "images" / "delfino" / "deputies"
DEFAULT_DB = ROOT / "databases" / "private_corpus.db"
# The vote date as the page writes it, e.g. ">3 de diciembre de 2025<"
DATE_REGEX = re.compile(r">\s*(\d{1,2} de [a-záéíóú]+ de \d{4})\s*<", re.IGNORECASE)


def read_cards(votes_dir: Path) -> tuple[dict[str, dict], int]:
    """{slug: {name, url, dates}} from every cached vote page, plus how many pages had no date."""
    people: dict[str, dict] = {}
    no_date = 0
    files = sorted(votes_dir.glob("*.html"))
    for i, file in enumerate(files, 1):
        html = file.read_text(encoding="utf-8")
        found = DATE_REGEX.search(html)
        parsed = parse_spanish_date(found.group(1)) if found else None
        day: date | None = parsed.date() if parsed else None
        no_date += day is None
        for card in BeautifulSoup(html, "lxml").find_all("a", href=PERSON_LINK_REGEX):
            slug, name, _, _ = parse_person_card(card)
            image = card.find("img")
            person = people.setdefault(slug, {"name": name, "urls": set(), "dates": set()})
            if image is not None and image.get("src"):
                person["urls"].add(image["src"])
            if day:
                person["dates"].add(day)
        if i % 500 == 0:
            print(f"  {i} de {len(files)} páginas", flush=True)
    return people, no_date


def match_people(people: dict[str, dict], db_path: Path) -> dict[str, int | None]:
    """{slug: person_id}; None when no deputy (or more than one person) matches the name on the vote dates."""
    conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    matcher = DeputyMatcher(conn.execute("SELECT deputy_id, surnames, names, date_from, date_to FROM deputies").fetchall())
    person_of = dict(conn.execute("SELECT deputy_id, person_id FROM deputies").fetchall())
    conn.close()
    out: dict[str, int | None] = {}
    for slug, p in people.items():
        found = {person_of[d] for d in (matcher.match(p["name"], day) for day in p["dates"]) if d is not None}
        out[slug] = found.pop() if len(found) == 1 else None
        if len(found) > 1:
            print(f"  {p['name']} ({slug}) cruza con varias personas, se deja sin cruce")
    return out


def download(url: str, target: Path, session: requests.Session) -> bool:
    response = session.get(url, timeout=30)
    if response.status_code != 200 or not response.headers.get("Content-Type", "").startswith("image/"):
        print(f"  no se pudo bajar {url}: {response.status_code} {response.headers.get('Content-Type')}")
        return False
    target.write_bytes(response.content)
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = ap.parse_args()
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Leyendo tarjetas de {VOTES_DIR}")
    people, no_date = read_cards(VOTES_DIR)
    matches = match_people(people, args.db.resolve())

    session = requests.Session()
    session.headers["User-Agent"] = Config.USER_AGENT
    entries, downloaded, failed = [], 0, 0
    for slug, p in sorted(people.items()):
        url = sorted(p["urls"])[0] if p["urls"] else None  # one photo per deputy in practice
        file = Path(urlparse(url).path).name if url else None
        if url and not (PHOTOS_DIR / file).exists():
            if download(url, PHOTOS_DIR / file, session):
                downloaded += 1
            else:
                failed += 1
                file = None
            time.sleep(Config.RATE_LIMIT)
        entries.append({"slug": slug, "name": p["name"], "person_id": matches[slug], "url": url, "file": file,
                        "first_vote": min(p["dates"]).isoformat() if p["dates"] else None,
                        "last_vote": max(p["dates"]).isoformat() if p["dates"] else None})

    index = {"generated": datetime.now().isoformat(timespec="seconds"),
             "source": "photos on Delfino vote pages (raw/html/delfino/asamblea/votes/)", "deputies": entries}
    (PHOTOS_DIR / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    matched = [e for e in entries if e["person_id"] is not None]
    print(f"Personas de Delfino: {len(entries)}; con foto: {sum(1 for e in entries if e['file'])}; "
          f"cruzadas con el SIL: {len(matched)}; fotos bajadas ahora: {downloaded}; fallidas: {failed}; "
          f"páginas sin fecha: {no_date}")
    unmatched = sorted(e["name"] for e in entries if e["person_id"] is None)
    if unmatched:
        print("Sin cruce:", ", ".join(unmatched))


if __name__ == "__main__":
    main()
