"""Builds the data file for the deputies co-voting graph (#69).

One graph per legislative term with votes (2018-2022, 2022-2026, 2026-2030). Nodes are the
deputies on Delfino's vote pages; every pair of deputies carries how often they voted alike.

Agreement between two deputies:
  - only contested votes count: the losing side was at least --contested of those who voted
    (unanimous votes say nothing about who votes with whom);
  - inside a bill, the share of its contested votes where both voted and voted the same;
  - the mean of that share over the bills they both voted on, so every bill weighs the same
    (in 2026-2030, 1,700 of the 2,109 votes are motions on one bill, 24290).
Absences and abstentions are skipped. Pairs with fewer than --min-bills bills in common are left out.

The party of a deputy is the one Delfino lists most often in the term. Photos (Delfino's, kept
in raw/, outside git) are copied next to the data file, which is not in git either.
Writes private_visuals/output/graph/deputies.js and private_visuals/output/graph/photos/.

Usage: python private_visuals/graph/build_deputies.py [--contested 0.1] [--min-bills 5]
"""
import argparse
import json
import shutil
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "databases" / "private_corpus.db"
PHOTOS_DIR = ROOT / "raw" / "images" / "delfino" / "deputies"
OUT_DIR = ROOT / "private_visuals" / "output" / "graph"

TERMS = {
  "2018-2022": ("2018-05-01", "2022-04-30"),
  "2022-2026": ("2022-05-01", "2026-04-30"),
  "2026-2030": ("2026-05-01", "2030-04-30"),
}
VOTE_VALUES = {"for": 1, "against": -1}  # anything else (absent, abstention) is 0
PROVINCES = {"SAN JOSE": "San José", "ALAJUELA": "Alajuela", "CARTAGO": "Cartago", "HEREDIA": "Heredia",
             "GUANACASTE": "Guanacaste", "PUNTARENAS": "Puntarenas", "LIMON": "Limón"}


def plain(text):
  return "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c)).lower()


def short_name(display_name, sil):
  """First name and first surname for the label under a node.

  Which words those are comes from the SIL ("JORGE", "RODRÍGUEZ"), but the SIL drops accents,
  so the words are taken from Delfino's display name when they are there.
  """
  if not sil:
    return display_name
  words = {plain(w): w for w in display_name.split()}
  return " ".join(words.get(plain(part), part.title()) for part in sil)


def photo_files():
  """Delfino slug -> photo file, from the explorer's fetch_photos.py index (empty if it was not run)."""
  index = PHOTOS_DIR / "index.json"
  if not index.exists():
    return {}
  entries = json.loads(index.read_text(encoding="utf-8"))["deputies"]
  return {e["slug"]: e["file"] for e in entries if e.get("file") and (PHOTOS_DIR / e["file"]).exists()}


def pair_agreement(matrix, bill_of, min_bills):
  """Mean per-bill agreement for every pair of columns of `matrix` (votes x deputies, 1 / -1 / 0).

  Returns (agreement, shared): agreement is NaN where the pair shares fewer than `min_bills` bills.
  """
  n = matrix.shape[1]
  total = np.zeros((n, n))
  shared = np.zeros((n, n))
  for bill in np.unique(bill_of):
    rows = matrix[bill_of == bill].astype(np.float32)
    yes, no = (rows == 1).astype(np.float32), (rows == -1).astype(np.float32)
    voted = yes + no
    both = voted.T @ voted
    same = yes.T @ yes + no.T @ no
    met = both > 0
    total[met] += same[met] / both[met]
    shared += met
  with np.errstate(invalid="ignore", divide="ignore"):
    agreement = np.where(shared >= min_bills, total / shared, np.nan)
  return agreement, shared


def build_term(con, term, start, end, args, photos):
  votes = con.execute("SELECT vote_id, number FROM votes WHERE date BETWEEN ? AND ? ORDER BY vote_id",
                      (start, end)).fetchall()
  vote_index = {vote_id: i for i, (vote_id, _) in enumerate(votes)}
  rows = con.execute(
    "SELECT vd.vote_id, vd.slug, vd.name, vd.party, vd.vote, vd.deputy_id FROM vote_deputies vd "
    "JOIN votes v USING (vote_id) WHERE v.date BETWEEN ? AND ?", (start, end)).fetchall()

  slugs = sorted({r[1] for r in rows})
  column = {slug: i for i, slug in enumerate(slugs)}
  matrix = np.zeros((len(votes), len(slugs)), dtype=np.int8)
  names, parties, deputy_ids = {}, defaultdict(Counter), {}
  for vote_id, slug, name, party, vote, deputy_id in rows:
    matrix[vote_index[vote_id], column[slug]] = VOTE_VALUES.get(vote, 0)
    names[slug] = name
    parties[slug][party or "Independiente"] += 1
    if deputy_id is not None:
      deputy_ids[slug] = deputy_id

  yes, no = (matrix == 1).sum(axis=1), (matrix == -1).sum(axis=1)
  voted = yes + no
  contested = np.minimum(yes, no) >= args.contested * np.maximum(voted, 1)
  bill_of = np.array([number for _, number in votes])
  agreement, shared = pair_agreement(matrix[contested], bill_of[contested], args.min_bills)

  provinces = dict(con.execute("SELECT deputy_id, province FROM deputies"))
  sil_names = {deputy_id: (names_.split()[0], surnames.split()[0])
               for deputy_id, names_, surnames in con.execute("SELECT deputy_id, names, surnames FROM deputies")}
  signed = dict(con.execute("SELECT deputy_id, count(*) FROM deputy_bills GROUP BY deputy_id"))
  nodes = []
  for slug in slugs:
    i = column[slug]
    deputy_id = deputy_ids.get(slug)
    nodes.append({
      "slug": slug,
      "name": names[slug],
      "short": short_name(names[slug], sil_names.get(deputy_id)),
      "party": parties[slug].most_common(1)[0][0],
      "province": PROVINCES.get(provinces.get(deputy_id), ""),
      "deputy_id": deputy_id,
      "bills": signed.get(deputy_id, 0),
      "voted": int((matrix[:, i] != 0).sum()),
      "photo": photos.get(slug),
    })
  pairs = [[i, j, round(float(agreement[i, j]) * 100), int(shared[i, j])]
           for i in range(len(slugs)) for j in range(i + 1, len(slugs)) if not np.isnan(agreement[i, j])]

  within = [p[2] for p in pairs if nodes[p[0]]["party"] == nodes[p[1]]["party"]]
  between = [p[2] for p in pairs if nodes[p[0]]["party"] != nodes[p[1]]["party"]]
  median = lambda values: int(np.median(values)) if values else None
  print(f"{term}: {len(nodes)} deputies ({sum(1 for n in nodes if n['photo'])} with photo), "
        f"{len(votes)} votes, {int(contested.sum())} contested on {len(set(bill_of[contested]))} bills, "
        f"{len(pairs)} pairs; median agreement {median(within)} within a party, {median(between)} between parties")
  print("   ", ", ".join(f"{party} {count}" for party, count in Counter(n["party"] for n in nodes).most_common()))
  return {
    "term": term,
    "votes": len(votes),
    "contested": int(contested.sum()),
    "bills": len(set(bill_of[contested])),
    "nodes": nodes,
    "pairs": pairs,
  }


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--contested", type=float, default=0.1,
                      help="min share of the losing side, among those who voted, for a vote to count")
  parser.add_argument("--min-bills", type=int, default=5, help="min bills in common for a pair to get an agreement")
  args = parser.parse_args()

  con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
  photos = photo_files()
  terms = [build_term(con, term, start, end, args, photos) for term, (start, end) in TERMS.items()]
  last_vote = con.execute("SELECT max(date) FROM votes").fetchone()[0]

  OUT_DIR.mkdir(parents=True, exist_ok=True)
  photos_out = OUT_DIR / "photos"
  photos_out.mkdir(exist_ok=True)
  used = {n["photo"] for t in terms for n in t["nodes"] if n["photo"]}
  for file in used:
    if not (photos_out / file).exists():
      shutil.copyfile(PHOTOS_DIR / file, photos_out / file)

  data = {"meta": {"contested": args.contested, "min_bills": args.min_bills, "last_vote": last_vote}, "terms": terms}
  out_path = OUT_DIR / "deputies.js"
  payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
  out_path.write_text(f"window.GRAPH_DEPUTIES = {payload};\n", encoding="utf-8")
  print(f"{len(used)} photos in {photos_out}; {out_path.stat().st_size / 1e3:.0f} KB -> {out_path}")


if __name__ == "__main__":
  main()
