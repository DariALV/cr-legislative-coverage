"""
Descriptive statistics of the Jev corpus run (results/jev/corpus/), May-Oct 2026 (jev 2026-11-11):
  1. how many bills have 0, 1, 2, ... news, over several bases of bills, at both levels of coverage;
  2. how concentrated the coverage is (mean, median, percentiles, Gini, top shares);
  3. for each Jev question, how many pairs and how many bills fall in each option or level;
  4. other figures: bills per news, outlets per bill, span of coverage, coverage by file type, filing year and
     status, and how coverage relates to SIL activity.
Same two levels as ../analysis.py. Questions with a score are put in the nearest level (round of the expected
value); noul questions count as yes when p(true) >= 0.5; choice questions use Jev's choice.
Reads the private database read-only and writes CSV tables and report.json in this folder.
  python results/jev/corpus_analysis/stats/stats.py
"""
import collections
import csv
import json
import pathlib
import sqlite3
import statistics
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[4]))
from config import Config  # noqa: E402

RUN = pathlib.Path("results/jev/corpus")
OUT = pathlib.Path(__file__).parent
PERIOD = ("2026-05-01", "2026-10-31")
LEVELS = {
  "mention": lambda explicit, implicit, centrality: explicit >= 0.5 or implicit >= 0.75,
  "substantive": lambda explicit, implicit, centrality: (explicit >= 0.5 or implicit >= 0.75) and centrality >= 0.25,
}
BINS = [(0, 0), (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 9), (10, 19), (20, 49), (50, 99), (100, 10**9)]
SHORT_TYPE = {
  "PROCEDIMIENTO PROYECTO DE LEY ORDINARIO": "ordinary bill",
  "PROCEDIMIENTO COMISIONES ESPECIALES INVESTIGADORAS": "investigative committee",
  "PROCEDIMIENTO PROYECTOS DE COMISION DE HONORES": "honors committee",
  "PROCEDIMIENTO REFORMAS AL REGLAMENTO DE LA ASAMBLEA LEGISLATIVA": "rules reform",
  "PROCEDIMIENTO REFS PARS CONSTITUCION POLITICA, PROVINCIAS Y MAGISTRADOS": "constitutional reform / justices",
  "PROCEDIMIENTO DE NOMBRAMIENTOS / RATIFICACIONES / REELECCIONES": "appointments",
  "PROCEDIMIENTO SOLICITUDES DE ATRAQUE Y DESEMBARQUE": "ship docking permits",
  "PROCEDIMIENTO PRESUPUESTOS (ORDINARIOS, EXTRAORDINARIOS Y MODIFICACIONES)": "budgets",
}


def read(path):
  with open(path, encoding = "utf-8") as f:
    return list(csv.DictReader(f))


def write(name, rows):
  with open(OUT / name, "w", newline = "", encoding = "utf-8") as f:
    fields = list(dict.fromkeys(k for r in rows for k in r))
    w = csv.DictWriter(f, fieldnames = fields)
    w.writeheader()
    w.writerows(rows)


def pct(a, b):
  return round(100 * a / b, 1) if b else 0.0


def gini(values):
  v = sorted(values)
  n, s = len(v), sum(v)
  if not n or not s:
    return 0.0
  return round(sum((2 * i - n + 1) * x for i, x in enumerate(v)) / (n * s), 3)


def quantile(values, q):
  v = sorted(values)
  return v[min(len(v) - 1, int(q * len(v)))] if v else 0


def spearman(x, y):
  def ranks(a):
    order = sorted(range(len(a)), key = lambda i: a[i])
    r = [0.0] * len(a)
    i = 0
    while i < len(a):
      j = i
      while j + 1 < len(a) and a[order[j + 1]] == a[order[i]]:
        j += 1
      for k in range(i, j + 1):
        r[order[k]] = (i + j) / 2
      i = j + 1
    return r
  rx, ry = ranks(x), ranks(y)
  mx, my = statistics.mean(rx), statistics.mean(ry)
  num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
  den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
  return round(num / den, 3) if den else 0.0


def main():
  db = sqlite3.connect(f"file:{Config.DATABASE_DIR}/{Config.PRIVATE_DATABASE}.db?mode=ro", uri = True)
  q = lambda sql, *args: db.execute(sql, args).fetchall()
  questions = json.loads((RUN / "questions.json").read_text(encoding = "utf-8"))
  news_meta = {i: (o, (d or "")[:10]) for i, o, d in q("SELECT id, organization, date_published FROM news_articles")}
  bills = {n: {"type": SHORT_TYPE.get(t, "other"), "year": (d or "")[:4], "filed": (d or "")[:10], "status": s}
           for n, t, d, s in q("SELECT number, file_type, date_proposed, status FROM bills")}

  # ---- answers per pair and per news ----
  noul, choice, score = collections.defaultdict(dict), collections.defaultdict(dict), collections.defaultdict(dict)
  for r in read(RUN / "details.csv"):
    key = (r["news_id"], int(r["bill"]) if r["bill"] else None)
    if r["option"] == "true":
      noul[key][r["question"]] = float(r["probability"])
    elif r["score"] != "":
      score[key][r["question"]] = (float(r["score"]), float(r["score_01"]))
    elif r["choice"]:
      choice[key][r["question"]] = r["choice"]
  gate = [r for r in read(RUN / "gate.csv") if r["match"] == "1"]
  genre = {r["news_id"]: r["genre"] for r in read(RUN / "news.csv")}
  pairs = {}
  for level, keep in LEVELS.items():
    pairs[level] = sorted({(r["news_id"], int(r["bill"])) for r in gate
                           if keep(float(r["explicit"]), float(r["implicit"]),
                                   score[(r["news_id"], int(r["bill"]))].get("centrality", (0, 0))[1])})

  # ---- bases of bills ----
  sil_steps = collections.Counter(n for (n,) in q("SELECT number FROM bill_steps WHERE date_start BETWEEN ? AND ?", *PERIOD))
  votes = collections.Counter(n for (n,) in q("SELECT number FROM votes WHERE kind = 'plenary' AND date BETWEEN ? AND ?", *PERIOD))
  bases = {
    "all bills (20000-25897)": set(bills),
    "alive in the period (in progress now, or SIL step May-Oct)": {n for n, b in bills.items() if b["status"] == "in progress"} | set(sil_steps),
    "in progress now": {n for n, b in bills.items() if b["status"] == "in progress"},
    "SIL step May-Oct": set(sil_steps),
    "filed May-Oct": {n for n, b in bills.items() if PERIOD[0] <= b["filed"] <= PERIOD[1]},
    "plenary vote May-Oct": set(votes),
  }

  report = {"bases": {k: len(v) for k, v in bases.items()}}
  hist_rows, exact_rows, conc = [], [], {}
  for level, ps in pairs.items():
    per_bill = collections.Counter(b for _, b in ps)
    for base, members in bases.items():
      counts = [per_bill.get(b, 0) for b in members]
      row = {"level": level, "base": base, "bills": len(members)}
      for lo, hi in BINS:
        label = str(lo) if lo == hi else (f"{lo}+" if hi > 10**8 else f"{lo}-{hi}")
        row[label] = sum(1 for c in counts if lo <= c <= hi)
      row["covered"] = sum(1 for c in counts if c)
      row["pct_covered"] = pct(row["covered"], len(members))
      hist_rows.append(row)
      cov = [c for c in counts if c]
      conc[f"{level} | {base}"] = {
        "mean_all": round(statistics.mean(counts), 2) if counts else 0, "gini_all": gini(counts),
        "covered": len(cov), "mean_covered": round(statistics.mean(cov), 2) if cov else 0,
        "median_covered": statistics.median(cov) if cov else 0,
        "p75_covered": quantile(cov, 0.75), "p90_covered": quantile(cov, 0.90), "p99_covered": quantile(cov, 0.99),
        "max": max(cov) if cov else 0, "gini_covered": gini(cov)}
    for k in range(0, max(per_bill.values()) + 1):
      n = sum(1 for c in per_bill.values() if c == k) if k else len(bills) - len(per_bill)
      if n:
        exact_rows.append({"level": level, "news": k, "bills (of all 5,898)": n})
    ranked = sorted(per_bill.values(), reverse = True)
    total = sum(ranked)
    conc[f"{level} | top shares"] = {f"top_{k}": pct(sum(ranked[:k]), total) for k in (1, 5, 10, 20, 50, 100)}
    half = next(i for i in range(1, len(ranked) + 1) if sum(ranked[:i]) >= total / 2)
    conc[f"{level} | top shares"]["bills_for_half_of_pairs"] = half
  write("news_per_bill.csv", hist_rows)
  write("news_per_bill_exact.csv", exact_rows)
  report["concentration"] = conc

  # ---- everything below: substantive pairs ----
  ps = pairs["substantive"]
  per_bill = collections.Counter(b for _, b in ps)
  covered_news = sorted({n for n, _ in ps})

  # ---- Jev questions: pairs and bills per option ----
  qrows = []
  for name, spec in questions["details"].items():
    kind = spec["type"]
    if kind == "noul":
      vals = {p: noul[p].get(name) for p in ps if name in noul[p]}
      options = ["yes", "no"]
      level_of = {p: ("yes" if v >= 0.5 else "no") for p, v in vals.items()}
    elif kind == "choice":
      level_of = {p: choice[p][name] for p in ps if name in choice[p]}
      options = list(spec["criteria"])
    else:
      labels = list(spec["criteria"])
      level_of = {p: str(min(len(labels) - 1, max(0, round(score[p][name][0])))) for p in ps if name in score[p]}
      options = [str(i) for i in range(len(labels))]
    by_bill = collections.defaultdict(list)
    for (n, b), lv in level_of.items():
      by_bill[b].append(lv)
    majority = collections.Counter()
    for b, lvs in by_bill.items():
      c = collections.Counter(lvs).most_common()
      if len(c) == 1 or c[0][1] > c[1][1]:
        majority[c[0][0]] += 1
      else:
        majority["(tie)"] += 1
    mean_level = collections.Counter()
    if kind == "score":
      for b in by_bill:
        m = statistics.mean(score[(n, bb)][name][0] for (n, bb) in level_of if bb == b)
        mean_level[str(min(len(options) - 1, max(0, round(m))))] += 1
    for o in options + (["(tie)"] if majority["(tie)"] else []):
      label = o
      if kind == "score" and o != "(tie)":
        label = f"{o}: {spec['criteria'][int(o)][:70]}"
      qrows.append({"question": name, "type": kind, "option": label,
                    "pairs": sum(1 for v in level_of.values() if v == o),
                    "pct_pairs": pct(sum(1 for v in level_of.values() if v == o), len(level_of)),
                    "bills_with_any": sum(1 for lvs in by_bill.values() if o in lvs),
                    "bills_majority": majority[o],
                    "bills_by_mean": mean_level[o] if kind == "score" else ""})
  write("questions_by_bill.csv", qrows)

  # news-level questions over the news with substantive coverage
  nrows = []
  for name, spec in questions["details_news"].items():
    kind = spec["type"]
    keys = [(n, None) for n in covered_news]
    if kind == "noul":
      lv = {k: ("yes" if noul[k][name] >= 0.5 else "no") for k in keys if name in noul[k]}
    elif kind == "choice":
      lv = {k: choice[k][name] for k in keys if name in choice[k]}
    else:
      labels = list(spec["criteria"])
      lv = {k: f"{round(score[k][name][0])}: {labels[min(len(labels) - 1, round(score[k][name][0]))][:60]}"
            for k in keys if name in score[k]}
    c = collections.Counter(lv.values())
    for o, k in sorted(c.items()):
      nrows.append({"question": name, "option": o, "news": k, "pct": pct(k, len(lv))})
  c = collections.Counter(genre.get(n, "") for n in covered_news)
  for o, k in sorted(c.items()):
    nrows.append({"question": "genre", "option": o, "news": k, "pct": pct(k, len(covered_news))})
  write("questions_by_news.csv", nrows)

  # ---- other figures ----
  other = {}
  bills_per_news = collections.Counter(collections.Counter(n for n, _ in ps).values())
  other["bills_per_news"] = {str(k): v for k, v in sorted(bills_per_news.items())}
  other["news_with_substantive_coverage"] = len(covered_news)
  outlets = collections.defaultdict(set)
  dates = collections.defaultdict(list)
  for n, b in ps:
    outlets[b].add(news_meta[n][0])
    dates[b].append(news_meta[n][1])
  other["outlets_per_bill"] = {str(k): v for k, v in sorted(collections.Counter(len(s) for s in outlets.values()).items())}
  import datetime as dt
  spans = {b: (dt.date.fromisoformat(max(d)) - dt.date.fromisoformat(min(d))).days for b, d in dates.items()}
  days_with_news = {b: len(set(d)) for b, d in dates.items()}
  multi = [b for b in per_bill if per_bill[b] >= 2]
  other["span_days_bills_2+"] = {"bills": len(multi), "median": statistics.median(spans[b] for b in multi),
                                 "p75": quantile([spans[b] for b in multi], 0.75),
                                 "same_day_only": sum(1 for b in multi if spans[b] == 0)}
  other["distinct_days_with_news"] = {"median": statistics.median(days_with_news.values()),
                                      "bills_1_day": sum(1 for v in days_with_news.values() if v == 1)}
  # one-outlet bills: which outlet
  other["single_outlet_bills_by_outlet"] = dict(collections.Counter(next(iter(s)) for s in outlets.values() if len(s) == 1).most_common())
  # coverage by type, filing year and status (alive base)
  alive = bases["alive in the period (in progress now, or SIL step May-Oct)"]
  for field in ("type", "year", "status"):
    rows = []
    for v in sorted({bills[b][field] for b in bills}):
      members = [b for b in bills if bills[b][field] == v]
      members_alive = [b for b in members if b in alive]
      cov = [per_bill[b] for b in members if per_bill.get(b)]
      rows.append({field: v, "bills": len(members), "alive": len(members_alive),
                   "covered": len(cov), "pct_covered_all": pct(len(cov), len(members)),
                   "pct_covered_alive": pct(sum(1 for b in members_alive if per_bill.get(b)), len(members_alive)),
                   "news": sum(cov), "median_news_covered": statistics.median(cov) if cov else 0})
    write(f"coverage_by_{field}.csv", rows)
  # activity against coverage (alive bills)
  al = sorted(alive)
  other["spearman_alive"] = {"sil_steps_vs_news": spearman([sil_steps.get(b, 0) for b in al], [per_bill.get(b, 0) for b in al]),
                             "plenary_votes_vs_news": spearman([votes.get(b, 0) for b in al], [per_bill.get(b, 0) for b in al])}
  covered_alive = [b for b in al if per_bill.get(b)]
  other["spearman_covered_alive"] = {"sil_steps_vs_news": spearman([sil_steps.get(b, 0) for b in covered_alive], [per_bill[b] for b in covered_alive]),
                                     "plenary_votes_vs_news": spearman([votes.get(b, 0) for b in covered_alive], [per_bill[b] for b in covered_alive])}
  # mention-only bills (named, never substantive)
  mention_bills = {b for _, b in pairs["mention"]}
  other["bills_mentioned_never_substantive"] = len(mention_bills - set(per_bill))
  # main subject (centrality level 2) per bill
  main = collections.Counter(b for p in ps for b in [p[1]] if score[p]["centrality"][0] >= 1.5)
  other["bills_main_subject_of_any_news"] = len(main)
  other["bills_main_subject_of_5+_news"] = sum(1 for v in main.values() if v >= 5)
  report["other"] = other
  (OUT / "report.json").write_text(json.dumps(report, indent = 1, ensure_ascii = False), encoding = "utf-8")
  print(json.dumps(report, indent = 1, ensure_ascii = False))


if __name__ == "__main__":
  main()
