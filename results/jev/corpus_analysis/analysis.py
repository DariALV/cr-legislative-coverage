"""
First exploratory analysis of the Jev corpus run (results/jev/corpus/, jev 2026-11-10): coverage of bills by outlet
and over time, coverage against legislative activity (SIL steps and plenary votes), proponents and parties, the
positions Jev attributes to each party against how the party voted, and how each outlet covers the bills it covers.
Reads the private database read-only and writes CSV tables in one folder per level. Prints the headline numbers.
Two levels of coverage (jev 2026-11-10, «decisión: el análisis cuenta en dos niveles»), from the review of 190 pairs:
  mention       explicit >= 0.5, or implicit >= 0.75                      (~78-85 % precision, keeps ~88 % of the true)
  substantive   mention, and centrality >= 0.25 (not a passing mention)   (~88-91 % precision, keeps ~73 %)
  python results/jev/corpus_analysis/analysis.py
"""
import collections
import csv
import pathlib
import sqlite3
import statistics
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))
from config import Config  # noqa: E402

RUN = pathlib.Path("results/jev/corpus")
OUT = pathlib.Path(__file__).parent
PERIOD = ("2026-05-01", "2026-10-31")
PARTY_QUESTIONS = {"pueblo_soberano": "PUEBLO SOBERANO", "liberacion_nacional": "LIBERACIÓN NACIONAL",
                   "frente_amplio": "FRENTE AMPLIO", "unidad_social_cristiana": "UNIDAD SOCIAL CRISTIANA",
                   "agenda_ciudadana": "COALICION AGENDA CIUDADANA"}
VOTE_PARTY = {"Partido Pueblo Soberano": "pueblo_soberano", "Partido Liberación Nacional": "liberacion_nacional",
              "Partido Frente Amplio": "frente_amplio", "Partido Unidad Social Cristiana": "unidad_social_cristiana",
              "Coalición Agenda Ciudadana": "agenda_ciudadana"}
LEVELS = {
  "mention": lambda explicit, implicit, centrality: explicit >= 0.5 or implicit >= 0.75,
  "substantive": lambda explicit, implicit, centrality: (explicit >= 0.5 or implicit >= 0.75) and centrality >= 0.25,
}
FAVOR = {"in_favor": 1, "strongly_in_favor": 1, "against": -1, "strongly_against": -1, "neutral_or_divided": 0}

def read(path):
  with open(path, encoding = "utf-8") as handle:
    return list(csv.DictReader(handle))

def write(name, rows):
  if not rows:
    return
  with open(OUT / LEVEL / name, "w", encoding = "utf-8", newline = "") as handle:
    writer = csv.DictWriter(handle, fieldnames = list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)

def pct(a, b):
  return round(100 * a / b, 1) if b else 0.0

LEVEL = "mention"

def main(level: str):
  global LEVEL
  LEVEL = level
  (OUT / level).mkdir(exist_ok = True)
  print(f"\n######## level: {level}")
  db = sqlite3.connect(f"file:{Config.DATABASE_DIR}/{Config.PRIVATE_DATABASE}.db?mode=ro", uri = True)
  q = lambda sql, *args: db.execute(sql, args).fetchall()
  news_meta = {i: (o, (d or "")[:10]) for i, o, d in q("SELECT id, organization, date_published FROM news_articles")}
  filt = read("results/jev/corpus_filter/filter.csv")
  genre = {r["news_id"]: r["genre"] for r in read(RUN / "news.csv")}
  gate_rows = [r for r in read(RUN / "gate.csv") if r["match"] == "1"]

  # ---- answers per pair and per news ----
  noul, choice, score = collections.defaultdict(dict), collections.defaultdict(dict), collections.defaultdict(dict)
  for r in read(RUN / "details.csv"):
    key = (r["news_id"], int(r["bill"]) if r["bill"] else None)
    if r["option"] == "true":
      noul[key][r["question"]] = float(r["probability"])
    elif r["score"] != "":
      score[key][r["question"]] = float(r["score_01"])
    elif r["choice"]:
      choice[key][r["question"]] = r["choice"]
  keep = LEVELS[level]
  pairs = [(r["news_id"], int(r["bill"])) for r in gate_rows
           if keep(float(r["explicit"]), float(r["implicit"]), score[(r["news_id"], int(r["bill"]))].get("centrality", 0))]
  covered_news = {n for n, _ in pairs}
  pair_set = set(pairs)

  bills = {n: (name, ftype, (date or "")[:10], status) for n, name, ftype, date, status in
           q("SELECT number, name, file_type, date_proposed, status FROM bills")}
  print("== corpus")
  outlets = sorted({o for o, _ in news_meta.values()})
  rows = []
  for o in outlets:
    total = sum(1 for r in filt if r["outlet"] == o)
    passed = sum(1 for r in filt if r["outlet"] == o and r["passes"] == "1")
    cov = sum(1 for n in covered_news if news_meta[n][0] == o)
    npairs = sum(1 for n, _ in pairs if news_meta[n][0] == o)
    rows.append({"outlet": o, "news": total, "pass_filter": passed, "cover_a_bill": cov,
                 "pct_cover": pct(cov, total), "pairs": npairs, "bills_per_covering_news": round(npairs / cov, 2)})
  rows.append({"outlet": "ALL", "news": len(filt), "pass_filter": sum(r["passes"] == "1" for r in filt),
               "cover_a_bill": len(covered_news), "pct_cover": pct(len(covered_news), len(filt)),
               "pairs": len(pairs), "bills_per_covering_news": round(len(pairs) / len(covered_news), 2)})
  write("outlets_volume.csv", rows)
  for r in rows: print(r)

  # ---- bills covered and concentration ----
  print("== bills")
  per_bill = collections.Counter(b for _, b in pairs)
  main_bill = collections.Counter(b for (n, b) in pairs if score[(n, b)].get("centrality", 0) >= 0.75)
  outlets_per_bill = collections.defaultdict(set)
  for n, b in pairs:
    outlets_per_bill[b].add(news_meta[n][0])
  ranked = per_bill.most_common()
  total_pairs = len(pairs)
  print("distinct bills covered", len(per_bill), "| covered by 5 outlets", sum(len(s) == 5 for s in outlets_per_bill.values()))
  for k in (1, 5, 10, 20, 50):
    print(f"top {k} bills hold {pct(sum(c for _, c in ranked[:k]), total_pairs)} % of pairs")
  print("bills with a single news:", sum(1 for c in per_bill.values() if c == 1))
  top = []
  for b, c in ranked[:40]:
    by_outlet = collections.Counter(news_meta[n][0] for n, bb in pairs if bb == b)
    top.append({"bill": b, "name": bills[b][0][:110], "type": bills[b][1], "news": c, "main_subject": main_bill[b],
                "outlets": len(outlets_per_bill[b]), **{o: by_outlet[o] for o in outlets}})
  write("top_bills.csv", top)
  for t in top[:15]: print(t["bill"], t["news"], t["main_subject"], t["name"][:70])
  by_type = collections.Counter(bills[b][1] for b in per_bill)
  print("covered bills by type:", by_type.most_common(6))

  # ---- coverage vs legislative activity ----
  print("== activity")
  steps = collections.defaultdict(list)
  for n, d, desc in q("SELECT number, date_start, description FROM bill_steps WHERE date_start BETWEEN ? AND ?", *PERIOD):
    steps[n].append(desc or "")
  active = set(steps)
  votes = collections.defaultdict(list)
  for n, name, result in q("SELECT number, name, result FROM votes WHERE date BETWEEN ? AND ?", *PERIOD):
    votes[n].append((name, result))
  def debate(n, which):
    return any(name == which and result == "Aprobado" for name, result in votes.get(n, []))
  groups = {
    "active in SIL (May–Oct)": active,
    "filed May–Oct": {n for n, v in bills.items() if PERIOD[0] <= v[2] <= PERIOD[1]},
    "plenary votes (May–Oct)": set(votes),
    "approved 1st debate": {n for n in votes if debate(n, "Primer debate")},
    "approved 2nd debate": {n for n in votes if debate(n, "Segundo debate")},
    "4+ motions voted": {n for n, v in votes.items() if sum(name.startswith("Moción") for name, _ in v) >= 4},
  }
  rows = []
  for label, group in groups.items():
    cov = [b for b in group if b in per_bill]
    counts = [per_bill.get(b, 0) for b in group]
    rows.append({"group": label, "bills": len(group), "covered": len(cov), "pct_covered": pct(len(cov), len(group)),
                 "median_news": statistics.median(counts) if counts else 0, "news_total": sum(counts)})
  inactive_cov = [b for b in per_bill if b not in active and b not in votes]
  rows.append({"group": "covered without SIL activity or votes", "bills": len(inactive_cov), "covered": len(inactive_cov),
               "pct_covered": "", "median_news": statistics.median([per_bill[b] for b in inactive_cov]),
               "news_total": sum(per_bill[b] for b in inactive_cov)})
  write("activity_vs_coverage.csv", rows)
  for r in rows: print(r)
  uncovered_2nd = [(b, bills[b][0][:90]) for b in groups["approved 2nd debate"] if b not in per_bill]
  print("approved in 2nd debate with no coverage:", uncovered_2nd)

  # ---- proponents: party of the first signer, or the Executive ----
  print("== proponents")
  faction = {}
  for pid, f, term in q("SELECT person_id, faction, term FROM deputy_factions"):
    faction[(pid, term)] = f
  first = {}
  for n, name, term, dep in q("SELECT p.number, p.name, p.term, d.person_id FROM bill_proponents p "
                               "LEFT JOIN deputies d ON d.deputy_id = p.deputy_id ORDER BY p.number, p.signing_order"):
    if n in first:
      continue
    first[n] = "PODER EJECUTIVO" if name == "PODER EJECUTIVO" else faction.get((dep, term), "OTHER/UNKNOWN")
  rows = []
  filed = groups["filed May–Oct"]
  for who in sorted({first.get(n, "UNKNOWN") for n in filed}):
    group = [n for n in filed if first.get(n, "UNKNOWN") == who]
    cov = [n for n in group if n in per_bill]
    rows.append({"proponent": who, "bills_filed_may_oct": len(group), "covered": len(cov),
                 "pct_covered": pct(len(cov), len(group)), "news": sum(per_bill.get(n, 0) for n in group)})
  write("proponents_coverage.csv", rows)
  for r in rows: print(r)

  # ---- deputies: first signers whose bills got the most news ----
  dep_news = collections.Counter()
  dep_name = {}
  for n, name, did in q("SELECT number, name, deputy_id FROM bill_proponents WHERE signing_order = 1 AND term = '2026-2030'"):
    if n in per_bill:
      dep_news[name] += per_bill[n]
  write("deputies_first_signer.csv", [{"deputy": d, "news_on_their_bills": c} for d, c in dep_news.most_common(30)])
  print("top first signers:", dep_news.most_common(8))

  # ---- party positions attributed by Jev vs how the party voted ----
  print("== positions vs votes")
  attributed = collections.defaultdict(collections.Counter)   # (bill, party) -> position counts
  for (n, b), ch in choice.items():
    if (n, b) not in pair_set:
      continue
    for p in PARTY_QUESTIONS:
      if p in ch:
        attributed[(b, p)][ch[p]] += 1
  voted = collections.defaultdict(collections.Counter)
  for n, party, vote in q("SELECT w.number, v.party, v.vote FROM vote_deputies v JOIN votes w USING(vote_id) "
                          "WHERE w.name IN ('Primer debate', 'Segundo debate') AND v.vote IN ('for', 'against') "
                          "AND w.date BETWEEN ? AND ?", *PERIOD):
    if party in VOTE_PARTY:
      voted[(n, VOTE_PARTY[party])][vote] += 1
  rows = []
  agree = disagree = 0
  for (b, p), counts in voted.items():
    if counts["for"] + counts["against"] == 0:
      continue
    party_vote = 1 if counts["for"] >= counts["against"] else -1
    att = attributed.get((b, p), collections.Counter())
    signal = sum(FAVOR.get(k, 0) * v for k, v in att.items())
    mentioned = sum(v for k, v in att.items() if k != "not_mentioned")
    if mentioned and signal:
      ok = (signal > 0) == (party_vote > 0)
      agree += ok
      disagree += not ok
    rows.append({"bill": b, "party": p, "votes_for": counts["for"], "votes_against": counts["against"],
                 "news_attributing_position": mentioned, "position_signal": signal})
  write("positions_vs_votes.csv", rows)
  print(f"party-bill pairs with a final vote: {len(rows)}; with a clear attributed position: {agree + disagree}; "
        f"same direction as the vote: {agree} ({pct(agree, agree + disagree)} %)")
  mention_rate = []
  for p in PARTY_QUESTIONS:
    vals = [ch[p] for (n, b), ch in choice.items() if (n, b) in pair_set and p in ch]
    c = collections.Counter(vals)
    mention_rate.append({"party": p, "pairs": len(vals), "pct_mentioned": pct(len(vals) - c["not_mentioned"], len(vals)),
                         **{k: c[k] for k in ["strongly_against", "against", "neutral_or_divided", "in_favor", "strongly_in_favor"]}})
  ex = collections.Counter(ch["executive"] for (n, b), ch in choice.items() if (n, b) in pair_set and "executive" in ch)
  mention_rate.append({"party": "executive", "pairs": sum(ex.values()), "pct_mentioned": pct(sum(ex.values()) - ex["not_mentioned"], sum(ex.values())),
                       **{k: ex[k] for k in ["strongly_against", "against", "neutral_or_divided", "in_favor", "strongly_in_favor"]}})
  write("party_positions.csv", mention_rate)
  for r in mention_rate: print(r)

  # ---- how each outlet covers: per pair and per news ----
  print("== outlet style")
  rows = []
  pair_q = ["explains_content", "explains_impact", "gives_figures", "conflict_frame", "in_headline", "names_proponent",
            "deputy_quoted", "background", "explains_procedure", "vote_reported", "next_step", "new_development",
            "voice_experts", "voice_civil_society", "voice_institutions", "voice_affected", "voice_business",
            "voice_labor", "constitutionality", "international", "human_story", "author_judges"]
  for o in outlets + ["ALL"]:
    ps = [(n, b) for n, b in pairs if o == "ALL" or news_meta[n][0] == o]
    ns = [n for n in covered_news if o == "ALL" or news_meta[n][0] == o]
    row = {"outlet": o, "pairs": len(ps), "news": len(ns)}
    row |= {f"{k}_pct": pct(sum(noul[p].get(k, 0) >= 0.5 for p in ps), len(ps)) for k in pair_q}
    row["centrality_mean"] = round(statistics.mean(score[p].get("centrality", 0) for p in ps), 3)
    row["stance_mean"] = round(statistics.mean(score[p].get("stance", 0.5) for p in ps), 3)
    voices = [sum(noul[p].get(v, 0) >= 0.5 for v in ["voice_experts", "voice_civil_society", "voice_institutions",
                                                       "voice_affected", "voice_business", "voice_labor"]) for p in ps]
    row["pairs_with_no_outside_voice_pct"] = pct(sum(v == 0 for v in voices), len(ps))
    row["press_release_pct"] = pct(sum(noul[(n, None)].get("press_release", 0) >= 0.6 and genre.get(n) == "news_report"
                                       for n in ns), len(ns))
    row["assembly_image_mean"] = round(statistics.mean(score[(n, None)].get("assembly_image", 0.5) for n in ns), 3)
    frames = collections.Counter(choice[(n, None)].get("main_frame") for n in ns)
    row |= {f"frame_{f}_pct": pct(frames[f], len(ns)) for f in ["policy", "conflict", "responsibility", "economic", "human_interest", "morality"]}
    g = collections.Counter(genre.get(n) for n in ns)
    row |= {f"genre_{k}_pct": pct(g[k], len(ns)) for k in ["news_report", "opinion", "analysis", "interview"]}
    stages = collections.Counter(choice[p].get("stage") for p in ps)
    row |= {f"stage_{k}_pct": pct(stages[k], len(ps)) for k in ["not_stated", "filing", "committee", "first_debate", "second_debate", "veto_or_signing", "constitutional_court", "archived_or_rejected"]}
    rows.append(row)
  write("outlet_style.csv", rows)
  keys = ["outlet", "pairs", "explains_content_pct", "explains_impact_pct", "gives_figures_pct", "conflict_frame_pct",
          "deputy_quoted_pct", "vote_reported_pct", "next_step_pct", "pairs_with_no_outside_voice_pct",
          "press_release_pct", "centrality_mean", "stance_mean", "assembly_image_mean", "frame_policy_pct",
          "frame_conflict_pct", "genre_opinion_pct", "stage_not_stated_pct"]
  for r in rows: print({k: r[k] for k in keys})

  # ---- weekly: news that cover a bill vs plenary votes ----
  weekly = collections.Counter()
  for n in covered_news:
    d = news_meta[n][1]
    if d:
      weekly[d[:4] + "-W" + f"{__import__('datetime').date.fromisoformat(d).isocalendar()[1]:02d}"] += 1
  wv = collections.Counter()
  for (d,) in q("SELECT date FROM votes WHERE date BETWEEN ? AND ?", *PERIOD):
    wv[d[:4] + "-W" + f"{__import__('datetime').date.fromisoformat(d[:10]).isocalendar()[1]:02d}"] += 1
  write("weekly.csv", [{"week": w, "news_covering_bills": weekly[w], "plenary_votes": wv[w]} for w in sorted(set(weekly) | set(wv))])

if __name__ == "__main__":
  for name in LEVELS:
    main(name)
