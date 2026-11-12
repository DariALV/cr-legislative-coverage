"""
Position the press attributes to each party (and to the Executive) on bills, split by who proposed the bill
(jev 2026-11-11). Proponent = party of the first signer in the term they signed, or the Executive (split at the
change of government on 2026-05-08). The attributed position of a party on a bill adds up its news with substantive
coverage: in favor (+1), against (-1), neutral or divided (0); the bill counts as in favor, against or mixed by the sign.
As a check, the same table with how each party voted in first and second debate (May-Oct).
Reads the private database read-only and writes CSV tables and report.json in this folder.
  python results/jev/corpus_analysis/proponents/party_vs_proponent.py
"""
import collections
import csv
import json
import pathlib
import sqlite3
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[4]))
from config import Config  # noqa: E402

RUN = pathlib.Path("results/jev/corpus")
OUT = pathlib.Path(__file__).parent
PERIOD = ("2026-05-01", "2026-10-31")
NEW_GOVERNMENT = "2026-05-08"
FAVOR = {"in_favor": 1, "strongly_in_favor": 1, "against": -1, "strongly_against": -1, "neutral_or_divided": 0}
HOLDERS = {"pueblo_soberano": "PPSO", "liberacion_nacional": "PLN", "frente_amplio": "FA",
           "unidad_social_cristiana": "PUSC", "agenda_ciudadana": "CAC", "executive": "Executive"}
VOTE_PARTY = {"Partido Pueblo Soberano": "PPSO", "Partido Liberación Nacional": "PLN", "Partido Frente Amplio": "FA",
              "Partido Unidad Social Cristiana": "PUSC", "Coalición Agenda Ciudadana": "CAC"}
FACTION_GROUP = {"PUEBLO SOBERANO": "PPSO", "LIBERACIÓN NACIONAL": "PLN", "FRENTE AMPLIO": "FA",
                 "UNIDAD SOCIAL CRISTIANA": "PUSC", "COALICION AGENDA CIUDADANA": "CAC",
                 "PROGRESO SOCIAL DEMOCRÁTICO": "PPSD (2022-26)"}
GROUPS = ["PPSO", "Executive (2026-)", "PPSD (2022-26)", "Executive (before 2026-05-08)", "PLN", "FA", "PUSC", "CAC",
          "other parties", "no proponent"]
OFFICIALISM = {"PPSO", "Executive (2026-)"}
OPPOSITION = {"PLN", "FA", "PUSC", "CAC"}


def read(path):
  with open(path, encoding = "utf-8") as f:
    return list(csv.DictReader(f))


def write(name, rows):
  with open(OUT / name, "w", newline = "", encoding = "utf-8") as f:
    w = csv.DictWriter(f, fieldnames = list(dict.fromkeys(k for r in rows for k in r)))
    w.writeheader()
    w.writerows(rows)


def pct(a, b):
  return round(100 * a / b, 1) if b else None


def main():
  db = sqlite3.connect(f"file:{Config.DATABASE_DIR}/{Config.PRIVATE_DATABASE}.db?mode=ro", uri = True)
  q = lambda sql, *args: db.execute(sql, args).fetchall()

  # ---- substantive pairs and attributed positions ----
  centrality, choice = {}, collections.defaultdict(dict)
  for r in read(RUN / "details.csv"):
    if not r["bill"]:
      continue
    key = (r["news_id"], int(r["bill"]))
    if r["question"] == "centrality" and r["score"] != "":
      centrality[key] = float(r["score_01"])
    elif r["question"] in HOLDERS and r["choice"]:
      choice[key][HOLDERS[r["question"]]] = r["choice"]
  pairs = {(r["news_id"], int(r["bill"])) for r in read(RUN / "gate.csv") if r["match"] == "1"
           and (float(r["explicit"]) >= 0.5 or float(r["implicit"]) >= 0.75)
           and centrality.get((r["news_id"], int(r["bill"])), 0) >= 0.25}

  # ---- proponent group of each bill ----
  faction = {(pid, term): f for pid, f, term in q("SELECT person_id, faction, term FROM deputy_factions")}
  filed = {n: (d or "")[:10] for n, d in q("SELECT number, date_proposed FROM bills")}
  group = {}
  for n, name, term, pid in q("SELECT p.number, p.name, p.term, d.person_id FROM bill_proponents p "
                              "LEFT JOIN deputies d ON d.deputy_id = p.deputy_id ORDER BY p.number, p.signing_order"):
    if n in group:
      continue
    if name == "PODER EJECUTIVO":
      group[n] = "Executive (2026-)" if filed[n] >= NEW_GOVERNMENT else "Executive (before 2026-05-08)"
    else:
      f = faction.get((pid, term))
      group[n] = FACTION_GROUP.get(f, "other parties") if f else "no proponent"

  # ---- position of each holder on each bill, from the press ----
  pos = collections.defaultdict(collections.Counter)   # (bill, holder) -> option counts
  for p in pairs:
    for h, c in choice.get(p, {}).items():
      if c != "not_mentioned":
        pos[(p[1], h)][c] += 1
  def side(counts):
    s = sum(FAVOR[k] * v for k, v in counts.items())
    return "favor" if s > 0 else ("against" if s < 0 else "mixed")
  press = {k: side(v) for k, v in pos.items()}

  # ---- how each party voted in first and second debate ----
  tally = collections.defaultdict(collections.Counter)
  for n, party, vote in q("SELECT w.number, v.party, v.vote FROM vote_deputies v JOIN votes w USING(vote_id) "
                          "WHERE w.kind = 'plenary' AND w.name IN ('Primer debate', 'Segundo debate') "
                          "AND v.vote IN ('for', 'against') AND w.date BETWEEN ? AND ?", *PERIOD):
    if party in VOTE_PARTY:
      tally[(n, VOTE_PARTY[party])][vote] += 1
  voted = {k: ("favor" if c["for"] > c["against"] else ("against" if c["against"] > c["for"] else "mixed"))
           for k, c in tally.items()}

  # ---- matrices ----
  def matrix(source, holders, label):
    rows = []
    for h in holders:
      own_groups = OFFICIALISM if h in ("PPSO", "Executive") else {h}
      for g in GROUPS + ["OFFICIALISM (PPSO + Executive 2026-)", "OPPOSITION (PLN, FA, PUSC, CAC)", "ALL",
                         "ALL PROPOSED BY OTHERS"]:
        if g == "ALL":
          sel = [(b, s) for (b, hh), s in source.items() if hh == h]
        elif g.startswith("OFFICIALISM") or g.startswith("OPPOSITION"):
          members = OFFICIALISM if g.startswith("OFFICIALISM") else OPPOSITION
          sel = [(b, s) for (b, hh), s in source.items() if hh == h and group.get(b, "no proponent") in members]
        elif g == "ALL PROPOSED BY OTHERS":
          sel = [(b, s) for (b, hh), s in source.items() if hh == h
                 and group.get(b, "no proponent") not in own_groups | {"no proponent"}]
        else:
          sel = [(b, s) for (b, hh), s in source.items() if hh == h and group.get(b, "no proponent") == g]
        c = collections.Counter(s for _, s in sel)
        rows.append({"source": label, "holder": h, "proponent": g, "bills": len(sel), "favor": c["favor"],
                     "against": c["against"], "mixed": c["mixed"], "pct_favor": pct(c["favor"], len(sel)),
                     "pct_against": pct(c["against"], len(sel))})
    return rows
  press_rows = matrix(press, list(HOLDERS.values()), "press")
  vote_rows = matrix(voted, list(VOTE_PARTY.values()), "votes")
  write("press_by_proponent.csv", press_rows)
  write("votes_by_proponent.csv", vote_rows)

  # ---- bill list for review ----
  names = {n: name for n, name in q("SELECT number, name FROM bills")}
  per_bill = collections.Counter(b for _, b in pairs)
  rows = []
  for (b, h), s in sorted(press.items(), key = lambda x: (-per_bill[x[0][0]], x[0])):
    rows.append({"bill": b, "name": names.get(b, "")[:90], "proponent": group.get(b, "no proponent"), "news": per_bill[b],
                 "holder": h, "press": s, **{k: pos[(b, h)][k] for k in FAVOR}, "vote": voted.get((b, h), "")})
  write("bill_positions.csv", rows)

  # ---- agreement between press and votes, by own / other proponent ----
  agree = collections.Counter()
  for (b, h), v in voted.items():
    s = press.get((b, h))
    if s in ("favor", "against") and v in ("favor", "against"):
      own = group.get(b) in (OFFICIALISM if h == "PPSO" else {h})
      agree[(own, s == v)] += 1
  report = {
    "pairs": len(pairs),
    "bills_by_proponent_covered": dict(collections.Counter(group.get(b, "no proponent") for b in per_bill).most_common()),
    "press_vs_vote_own_bills": {"agree": agree[(True, True)], "disagree": agree[(True, False)]},
    "press_vs_vote_other_bills": {"agree": agree[(False, True)], "disagree": agree[(False, False)]},
  }
  (OUT / "report.json").write_text(json.dumps(report, indent = 1, ensure_ascii = False), encoding = "utf-8")
  print(json.dumps(report, indent = 1, ensure_ascii = False))
  for rows in (press_rows, vote_rows):
    for r in rows:
      if r["bills"]:
        print(r["source"], r["holder"], "|", r["proponent"], "|", r["bills"], r["favor"], r["against"], r["mixed"], r["pct_favor"])


if __name__ == "__main__":
  main()
