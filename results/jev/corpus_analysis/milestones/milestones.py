"""
How much press coverage each bill gets around the steps of its procedure (SIL steps and plenary votes), May-Oct 2026
(jev 2026-11-11 21:13). Uses the pairs of the Jev corpus run with the same two levels as ../analysis.py.
  near a milestone   news published from BEFORE days before to AFTER days after a milestone of its bill
  baseline           the same news of each bill spread uniformly over the period
  episode            news of a bill with no gap longer than GAP days
Reads the private database read-only and writes CSV tables and report.json in one folder per level.
  python results/jev/corpus_analysis/milestones/milestones.py [substantive|mention]
"""
import collections
import csv
import datetime as dt
import json
import pathlib
import sqlite3
import statistics
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[4]))
from config import Config  # noqa: E402

LEVEL = sys.argv[1] if len(sys.argv) > 1 else "substantive"
RUN = pathlib.Path("results/jev/corpus")
OUT = pathlib.Path(__file__).parent / LEVEL
OUT.mkdir(exist_ok = True)
P0, P1 = dt.date(2026, 5, 1), dt.date(2026, 10, 31)
BEFORE, AFTER = 2, 3       # "near a milestone": from 2 days before to 3 days after
GAP = 7                    # news more than 7 days apart start a new episode
D = lambda s: dt.date.fromisoformat(s[:10])

def read(p):
  with open(p, encoding = "utf-8") as f:
    return list(csv.DictReader(f))

db = sqlite3.connect(f"file:{Config.DATABASE_DIR}/{Config.PRIVATE_DATABASE}.db?mode=ro", uri = True)
q = lambda sql, *a: db.execute(sql, a).fetchall()
news_date = {i: D(d) for i, d in q("SELECT id, date_published FROM news_articles")}
centrality = {}
for r in read(RUN / "details.csv"):
  if r["question"] == "centrality" and r["score"] != "":
    centrality[(r["news_id"], int(r["bill"]))] = float(r["score_01"])
keep = {"mention": lambda e, i, c: e >= 0.5 or i >= 0.75,
        "substantive": lambda e, i, c: (e >= 0.5 or i >= 0.75) and c >= 0.25}[LEVEL]
pairs = sorted({(r["news_id"], int(r["bill"])) for r in read(RUN / "gate.csv") if r["match"] == "1"
                and keep(float(r["explicit"]), float(r["implicit"]), centrality.get((r["news_id"], int(r["bill"])), 0))})
news_by_bill = collections.defaultdict(list)
for n, b in pairs:
  if P0 <= news_date[n] <= P1:
    news_by_bill[b].append(news_date[n])
bills = {n: (name, ftype, date) for n, name, ftype, date in q("SELECT number, name, file_type, date_proposed FROM bills")}

# ---- milestones ----
def step_type(desc):
  d = desc.upper()
  if d.startswith("DICTAMEN") or d.startswith("VOTACIÓN (COMISIÓN)") or d.startswith("VOTACION (C.E.D.)") or d.startswith("VOTACIÓN E INFORME"):
    return "committee_report"
  if d.startswith("INGRESO EN EL ORDEN DEL DÍA Y DEBATE (COMISIÓN)") or d.startswith("INGRESO EN EL ORDEN DEL DIA Y DEBATE (C.E.D.)"):
    return "committee_agenda"
  if "MOCIONES 137" in d and d.startswith("LECTURA"):
    return "motions_137_report"
  if d.startswith("VOTACIÓN (PLENARIO)"):
    return "plenary_other_vote"
  if "CONSULTA DE CONSTITUCIONALIDAD" in d or "OPINIÓN CONSULTIVA" in d:
    return "constitutional_query"
  if d.startswith("VOTACIÓN PRIMER DEBATE") or d.startswith("PRIMER DEBATE"):
    return "first_debate"
  if d.startswith("VOTACIÓN SEGUNDO DEBATE") or d.startswith("SEGUNDO DEBATE"):
    return "second_debate"
  if d.startswith("PUBLICACION DE LA LEY") or d.startswith("REMISION DEL DECRETO LEGISLATIVO"):
    return "law_signed_published"
  if d.startswith("ARCHIVO EXPEDIENTE") or d.startswith("ARCHIVO DEL EXPEDIENTE"):
    return "archived"
  return None

def vote_type(name):
  if name == "Primer debate" or name.startswith("Primer debate"):
    return "first_debate"
  if name == "Segundo debate":
    return "second_debate"
  if name.startswith("Moción de fondo") or name.startswith("Moción de reiteración"):
    return "plenary_motions"
  if name.startswith("Plazo cuatrienal"):
    return "four_year_extension"
  return "plenary_other_vote"

W0, W1 = P0 - dt.timedelta(days = 30), P1 + dt.timedelta(days = 30)
milestones = collections.defaultdict(set)   # bill -> {(date, type)}
for b, (_, _, d) in bills.items():
  if d and W0 <= D(d) <= W1:
    milestones[b].add((D(d), "filed"))
for b, d, desc in q("SELECT number, date_start, description FROM bill_steps WHERE date_start BETWEEN ? AND ?", str(W0), str(W1)):
  t = step_type(desc or "")
  if t:
    milestones[b].add((D(d), t))
for b, d, name in q("SELECT number, date, name FROM votes WHERE kind = 'plenary' AND date BETWEEN ? AND ?", str(W0), str(W1)):
  t = vote_type(name)
  if t:
    milestones[b].add((D(d), t))
# first/second debate: the vote and the SIL step can differ by a day; keep the earliest of each cluster of 3 days
for b in milestones:
  out, last = set(), {}
  for d, t in sorted(milestones[b]):
    if t in last and (d - last[t]).days <= 3 and t != "plenary_motions":
      continue
    if t == "plenary_motions" and t in last and (d - last[t]).days == 0:
      continue
    out.add((d, t)); last[t] = d
  milestones[b] = out
TYPES = ["filed", "committee_agenda", "committee_report", "motions_137_report", "plenary_other_vote", "constitutional_query", "plenary_motions", "first_debate", "second_debate",
         "law_signed_published", "four_year_extension", "archived"]
TYPE_ORDER = {t: i for i, t in enumerate(TYPES)}

def near(day, ms):
  """Milestones of a bill that a news published on `day` is near: milestone in [day - AFTER, day + BEFORE]."""
  return [(d, t) for d, t in ms if -BEFORE <= (day - d).days <= AFTER]

period_days = [P0 + dt.timedelta(days = i) for i in range((P1 - P0).days + 1)]
def covered_days(ms):
  return sum(1 for day in period_days if near(day, ms))

report = {}
# ---- A: share of news near a milestone of its bill, against a uniform baseline ----
rows, tot_near, tot, tot_exp = [], 0, 0, 0.0
type_near = collections.Counter()
for b, days in news_by_bill.items():
  ms = milestones.get(b, set())
  k = sum(1 for day in days if near(day, ms))
  exp = len(days) * covered_days(ms) / len(period_days)
  for day in days:
    nm = near(day, ms)
    if nm:  # attribute to the most advanced milestone type nearby
      type_near[max(nm, key = lambda x: TYPE_ORDER[x[1]])[1]] += 1
  tot_near += k; tot += len(days); tot_exp += exp
  rows.append({"bill": b, "name": bills[b][0][:90], "news": len(days), "near_milestone": k,
               "share_near": round(k / len(days), 3), "baseline_share": round(exp / len(days), 3),
               "milestones_in_period": sum(1 for d, _ in ms if P0 <= d <= P1)})
rows.sort(key = lambda r: -r["news"])
with open(OUT / "bills_share_near.csv", "w", newline = "", encoding = "utf-8") as f:
  w = csv.DictWriter(f, fieldnames = list(rows[0])); w.writeheader(); w.writerows(rows)
report["A_news_pairs"] = tot
report["A_near_milestone"] = tot_near
report["A_share_near"] = round(tot_near / tot, 3)
report["A_baseline_share"] = round(tot_exp / tot, 3)
report["A_near_by_type"] = dict(type_near.most_common())
report["A_bills_with_no_milestone_in_window"] = sum(1 for b in news_by_bill if not any(P0 - dt.timedelta(days = 5) <= d <= P1 for d, _ in milestones.get(b, ())))
report["A_news_of_bills_without_milestone"] = sum(len(v) for b, v in news_by_bill.items() if not any(P0 - dt.timedelta(days = 5) <= d <= P1 for d, _ in milestones.get(b, ())))
# by bill size
for lo, hi in ((1, 1), (2, 4), (5, 19), (20, 10**6)):
  sel = [r for r in rows if lo <= r["news"] <= hi]
  n = sum(r["news"] for r in sel)
  report[f"A_bills_{lo}-{hi}_news"] = {"bills": len(sel), "news": n,
    "share_near": round(sum(r["near_milestone"] for r in sel) / n, 3) if n else None,
    "baseline": round(sum(r["baseline_share"] * r["news"] for r in sel) / n, 3) if n else None}

# ---- B: per milestone, does it get coverage? ----
mrows = []
for b, ms in milestones.items():
  days = news_by_bill.get(b, [])
  for d, t in ms:
    if not (P0 + dt.timedelta(days = BEFORE) <= d <= P1 - dt.timedelta(days = AFTER)):
      continue
    k = sum(1 for day in days if -BEFORE <= (day - d).days <= AFTER)
    mrows.append({"bill": b, "type": t, "date": str(d), "news_near": k, "bill_news_total": len(days)})
by_type = {}
for t in TYPES:
  sel = [r for r in mrows if r["type"] == t]
  if not sel: continue
  cov = [r for r in sel if r["bill_news_total"] > 0]
  by_type[t] = {"milestones": len(sel), "pct_with_news": round(100 * sum(r["news_near"] > 0 for r in sel) / len(sel), 1),
                "mean_news": round(statistics.mean(r["news_near"] for r in sel), 2),
                "of_covered_bills": len(cov),
                "pct_with_news_covered_bills": round(100 * sum(r["news_near"] > 0 for r in cov) / len(cov), 1) if cov else None,
                "median_news_when_any": statistics.median([r["news_near"] for r in sel if r["news_near"]] or [0])}
report["B_by_type"] = by_type
with open(OUT / "milestones.csv", "w", newline = "", encoding = "utf-8") as f:
  w = csv.DictWriter(f, fieldnames = list(mrows[0])); w.writeheader(); w.writerows(mrows)

# ---- C: episodes (bursts) ----
erows = []
for b, days in news_by_bill.items():
  days = sorted(days)
  eps, cur = [], [days[0]]
  for d in days[1:]:
    if (d - cur[-1]).days > GAP:
      eps.append(cur); cur = [d]
    else:
      cur.append(d)
  eps.append(cur)
  ms = milestones.get(b, set())
  for e in eps:
    anchor = sorted({t for d, t in ms if e[0] - dt.timedelta(days = AFTER) <= d <= e[-1] + dt.timedelta(days = BEFORE)},
                    key = TYPE_ORDER.get)
    erows.append({"bill": b, "start": str(e[0]), "end": str(e[-1]), "news": len(e), "episodes_of_bill": len(eps),
                  "anchored": int(bool(anchor)), "anchor_types": "|".join(anchor)})
with open(OUT / "episodes.csv", "w", newline = "", encoding = "utf-8") as f:
  w = csv.DictWriter(f, fieldnames = list(erows[0])); w.writeheader(); w.writerows(erows)
eps_per_bill = collections.Counter(r["episodes_of_bill"] for r in erows if r["start"] == min(x["start"] for x in erows if x["bill"] == r["bill"]))
report["C_episodes"] = len(erows)
report["C_episodes_per_bill"] = {k: v for k, v in sorted(eps_per_bill.items())}
for lo in (1, 3):
  sel = [r for r in erows if r["news"] >= lo]
  report[f"C_anchored_share_episodes_with_{lo}+_news"] = {"episodes": len(sel), "anchored": round(sum(r["anchored"] for r in sel) / len(sel), 3),
    "news_in_anchored": round(sum(r["news"] for r in sel if r["anchored"]) / sum(r["news"] for r in sel), 3)}
first_type = collections.Counter()
for r in erows:
  if r["news"] >= 3:
    for t in (r["anchor_types"].split("|") if r["anchor_types"] else ["(none)"]):
      first_type[t] += 1
report["C_anchor_types_episodes_3+"] = dict(first_type.most_common())
multi = [b for b in news_by_bill if sum(1 for r in erows if r["bill"] == b and r["news"] >= 2) >= 2]
report["C_bills_with_2+_episodes_of_2+_news"] = len(multi)
pattern = 0
for b in multi:
  types = [set(r["anchor_types"].split("|")) for r in erows if r["bill"] == b and r["news"] >= 2]
  if any("filed" in t for t in types) and any(t & {"plenary_motions", "first_debate", "second_debate"} for t in types):
    pattern += 1
report["C_bills_filed_burst_and_debate_burst"] = pattern
report["C_bills_with_filed_in_period_and_news"] = sum(1 for b in news_by_bill if any(t == "filed" and P0 <= d <= P1 for d, t in milestones.get(b, ())))

# ---- D: event study, news per day relative to the milestone (bills with any news) ----
curve = {}
for t in TYPES:
  sel = [(b, d) for b, ms in milestones.items() for d, tt in ms if tt == t and b in news_by_bill
         and P0 + dt.timedelta(days = 14) <= d <= P1 - dt.timedelta(days = 14)]
  if len(sel) < 5: continue
  c = collections.Counter()
  for b, d in sel:
    for day in news_by_bill[b]:
      off = (day - d).days
      if -14 <= off <= 14: c[off] += 1
  curve[t] = {"n": len(sel), "per_day": [round(c[o] / len(sel), 3) for o in range(-14, 15)]}
report["D_event_study_offsets_-14..14"] = curve
(OUT / "report.json").write_text(json.dumps(report, indent = 1, ensure_ascii = False), encoding = "utf-8")
print(json.dumps({k: v for k, v in report.items() if not k.startswith("D_")}, indent = 1, ensure_ascii = False))
for t, v in curve.items():
  print(t, v["n"], " ".join(f"{x:.2f}" for x in v["per_day"]))
