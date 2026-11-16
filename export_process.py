"""
Exports the data of the site's "Proceso" page (site/src/data/process/) from the private database and results/.

  python export_process.py [--database databases/private_corpus.db] [--results results]
                           [--out site/src/data/process] [--sync-theme]

Writes funnel.json, news.json, bills.json, embeddings.json, ranker.json, jev.json and cost.json. The page is
static: Astro imports these files when it builds, nothing is read at runtime.

What is published: aggregates and public metadata only (counts, shares, metrics, recipes, question wording).
Never the text of a news article, a news id or a raw API response. The ids of the news left out of the ranker's
training (summary.json -> excluded_news) are dropped; only their count is kept.

--sync-theme also copies the look of the local pages (private_visuals/theme/) into the site: theme.css without
its @import and @font-face header (the page's layout provides them) and variants.css to site/src/styles/process/,
and the Poppins files to site/public/fonts/.
"""
import argparse
import csv
import json
import shutil
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

PERIOD_START, PERIOD_END = "2026-05-01", "2026-10-31"
LEGISLATURES = [("2022-2026", "2022-05-01", "2026-04-30"), ("2026-2030", "2026-05-01", "2026-11-05")]
OUTLET_NAMES = {"crhoy": "CRHoy", "delfino": "Delfino", "elmundo": "El Mundo", "nacion": "La Nación",
                "semanario": "Semanario Universidad"}
# Same rule as the ranker's "alive" feature (tools/retrieval_tools/feature_builder.py).
ARCHIVE_PREFIX = "ARCHIVO"
LAW_STEP = "PUBLICACION DE LA LEY"
RANKER_RUN = "evolution/2026-11-07_excl15_seed7"
FEATURES = ["cos_exposition_max", "cos_subjects_max", "cos_name_max", "cos_exposition_mean", "z_exposition",
            "z_subjects", "bm25", "event_distance", "alive", "filed_after_news", "active", "event_count", "age_decay"]
KNOBS = ["window_before_days", "window_after_days", "age_half_life_days"]
# From results/jev/cost_model.md: mean tokens of a news that passes the filter, and of the genre question.
PASSING_NEWS_TOKENS = 1385
GENRE_QUESTION_TOKENS = 97
THEME_HEADER_PREFIXES = ("@import", "@font-face")


# Jev questions that judge the outlet (its headline, its author): published only as an overall number.
OUTLET_JUDGING = {"headline_misleading", "author_judges"}


def strip_accents(text: str) -> str:
  text = unicodedata.normalize("NFKD", text)
  return "".join(ch for ch in text if not unicodedata.combining(ch))


def read_csv(path: Path) -> list[dict]:
  with open(path, encoding = "utf-8") as f:
    return list(csv.DictReader(f))


def export_news(connection: sqlite3.Connection, stats: dict) -> dict:
  totals = dict(connection.execute("SELECT organization, COUNT(*) FROM news_articles GROUP BY 1"))
  monthly: dict[str, dict] = defaultdict(dict)
  for outlet, month, count in connection.execute(
      "SELECT organization, substr(date_published, 1, 7), COUNT(*) FROM news_articles GROUP BY 1, 2"):
    monthly[month][outlet] = count
  outlets = []
  for key in stats["outlets"]:
    general = stats["general"][key]
    outlets.append({
      "key": key, "name": OUTLET_NAMES[key], "total": totals[key], "with_text": general["news_with_text"],
      "pass_filter": general["pass_filter"], "with_match": general["levels"]["match"]["with_bills"],
      "substantive": general["levels"]["substantive"]["with_bills"],
      "mean_match_confidence": general["mean_match_confidence"]})
  return {"period": [PERIOD_START, PERIOD_END], "total": sum(totals.values()), "outlets": outlets,
          "monthly": [{"month": month, **monthly[month]} for month in sorted(monthly)]}


def export_bills(connection: sqlite3.Connection) -> dict:
  bills = list(connection.execute("SELECT number, substr(date_proposed, 1, 10), status, flag FROM bills"))
  ended: dict[int, str] = {}
  for number, start, description in connection.execute(
      "SELECT number, substr(date_start, 1, 10), description FROM bill_steps WHERE date_start IS NOT NULL"):
    text = strip_accents(description or "").upper()
    if text.startswith(ARCHIVE_PREFIX) or text.startswith(LAW_STEP):
      ended[number] = min(start, ended.get(number, start))

  def row(scope: str, label: str, selected: list, start: str, end: str) -> dict:
    status = Counter(b[2] for b in selected)
    flag = Counter(b[3] for b in selected)
    return {"scope": scope, "label": label, "from": start, "to": end, "count": len(selected),
            "first": min(b[0] for b in selected), "last": max(b[0] for b in selected),
            "archived": status["archived"], "in_progress": status["in progress"], "law": status["law"],
            "administrative": flag["administrative"], "honorific": flag["honorific"]}

  dated = [b[1] for b in bills if b[1]]
  rows = [row("all", "Total extraído", bills, min(dated), max(dated))]
  for name, start, end in LEGISLATURES:
    rows.append(row(f"legislature_{name}", f"Legislatura {name}",
                    [b for b in bills if b[1] and start <= b[1] <= end], start, end))
  # Alive during the news period: filed by its end, and neither archived nor published as a law before its start.
  alive = [b for b in bills if b[1] and b[1] <= PERIOD_END and ended.get(b[0], "9999") >= PERIOD_START]
  rows.append(row("alive", "Vivos durante el rango de noticias", alive, PERIOD_START, PERIOD_END))
  votes = connection.execute("SELECT COUNT(*) FROM votes").fetchone()[0]
  return {"rows": rows, "votes": votes}


def export_embeddings(results: Path) -> dict:
  summary = json.loads((results / "embeddings/summary.json").read_text(encoding = "utf-8"))
  configs = [{"model": r["model"], "size": int(r["size"]), "variant": r["variant"], "aggregation": r["aggregation"],
              "recall50": round(float(r["recall@50"]), 4), "low": round(float(r["recall@50_low"]), 4),
              "high": round(float(r["recall@50_high"]), 4)}
             for r in read_csv(results / "embeddings/metrics.csv") if r["candidates"] == "all"]
  configs.sort(key = lambda c: -c["recall50"])
  return {"n_news": summary["n_news"], "n_links": summary["n_links"], "n_bills": summary["n_bills"],
          "bootstrap": summary["bootstrap"], "configs": configs}


def export_ranker(results: Path) -> dict:
  run_dir = results / RANKER_RUN
  run = json.loads((run_dir / "run.json").read_text(encoding = "utf-8"))
  summary = json.loads((run_dir / "summary.json").read_text(encoding = "utf-8"))
  final = summary["final"]["recipe"]
  folds = [fold["recipe"] for fold in summary["folds"]]
  ranges = {gene["name"]: [gene["low"], gene["high"]] for gene in run["genes"]}

  def history(path: Path) -> dict:
    rows = read_csv(path)
    return {"best": [round(float(r["best_fitness"]), 4) for r in rows],
            "mean": [round(float(r["mean_fitness"]), 4) for r in rows]}

  def rounded(metrics: dict) -> dict:
    return {key: (round(value, 4) if isinstance(value, float) else value) for key, value in metrics.items()}

  return {
    "run": run["name"], "k": run["k"], "n_folds": run["folds"], "max_links_per_news": run["max_links_per_news"],
    "excluded_news": summary["excluded_news"]["n_news"], "n_news": run["features"]["n_news"],
    "background_news": run["features"]["background_news"], "settings": run["settings"],
    "n_genes": len(run["genes"]), "weight_range": ranges["w_bm25"],
    "features": [{"name": name, "weight": round(final[f"w_{name}"], 4), "active": bool(final[f"use_{name}"]),
                  "folds": [{"weight": round(fold[f"w_{name}"], 4), "active": bool(fold[f"use_{name}"])}
                            for fold in folds]} for name in FEATURES],
    "knobs": [{"name": name, "value": round(final[name], 2), "range": ranges[name],
               "folds": [round(fold[name], 2) for fold in folds]} for name in KNOBS],
    "cross_validation": {key: rounded(value) for key, value in summary["cross_validation"].items()},
    "final_train": rounded(summary["final"]["train"]),
    "history": {"final": history(run_dir / "final/history.csv"),
                "folds": [history(run_dir / f"fold_{i}/history.csv") for i in range(1, run["folds"] + 1)]},
    "k_sweep": [{"k": int(r["k"]), "bill_coverage": float(r["evolved_bill_coverage"]),
                 "link_recall": float(r["evolved_link_recall"]),
                 "baseline_bill_coverage": float(r["baseline_bill_coverage"]),
                 "baseline_link_recall": float(r["baseline_link_recall"])}
                for r in read_csv(results / "evolution/k_sweep.csv")],
  }


def export_cost(stats: dict, k: int) -> dict:
  """The form of results/jev/cost_model.md, with its constants measured again on the corpus run, so that the
  model gives what was paid: tokens = n * (filter + pass * (gate_base + K * candidate + match * details))."""
  general = stats["general"]["all"]
  requests, tokens = general["requests"], general["tokens"]
  gate_base = PASSING_NEWS_TOKENS + GENRE_QUESTION_TOKENS
  return {
    "price_per_million_tokens": stats["price_per_million_input_tokens"],
    "news": requests["filter"], "outlets": len(stats["outlets"]), "months": 6, "k": k,
    "filter_tokens": round(tokens["filter"] / requests["filter"], 1),
    "pass_rate": round(requests["gate"] / requests["filter"], 4),
    "gate_base_tokens": gate_base,
    "candidate_tokens": round((tokens["gate"] / requests["gate"] - gate_base) / k, 1),
    "match_rate": round(requests["details"] / requests["gate"], 4),
    "details_tokens": round(tokens["details"] / requests["details"], 1),
    "paid": general["cost_usd"], "paid_total": general["cost_usd_total"],
  }


def export_funnel(news: dict, bills: dict, stats: dict, k: int) -> dict:
  general = stats["general"]["all"]
  levels = general["levels"]
  return {
    "news": news["total"], "news_with_text": general["news_with_text"], "outlets": len(news["outlets"]),
    "pass_filter": general["pass_filter"], "candidates_per_news": k,
    "pairs_judged": stats["questions"]["explicit"]["by_outlet"]["all"]["answers"],
    "match_pairs": levels["match"]["pairs"], "match_news": levels["match"]["with_bills"],
    "mention_pairs": levels["mention"]["pairs"], "mention_news": levels["mention"]["with_bills"],
    "substantive_pairs": levels["substantive"]["pairs"], "substantive_news": levels["substantive"]["with_bills"],
    "bills": bills["rows"][0]["count"], "votes": bills["votes"],
  }


def sync_theme(site: Path):
  theme = Path("private_visuals/theme")
  styles = site / "src/styles/process"
  styles.mkdir(parents = True, exist_ok = True)
  lines = (theme / "theme.css").read_text(encoding = "utf-8").splitlines(keepends = True)
  kept = [line for line in lines if not line.lstrip().startswith(THEME_HEADER_PREFIXES)]
  (styles / "theme.css").write_text("".join(kept), encoding = "utf-8")
  shutil.copyfile(theme / "variants.css", styles / "variants.css")
  fonts = site / "public/fonts"
  fonts.mkdir(parents = True, exist_ok = True)
  for font in sorted((theme / "fonts").iterdir()):
    shutil.copyfile(font, fonts / font.name)
  # The style list (id, name, description and preview colors) that build_styles.py writes into theme.js.
  script = (theme / "theme.js").read_text(encoding = "utf-8")
  start = script.index("[", script.index("window.LC.STYLES ="))
  style_list = json.loads(script[start:script.index("// END STYLES")].rstrip().rstrip(";"))
  (site / "src/data/process/styles.json").write_text(
    json.dumps(style_list, ensure_ascii = False, indent = 1), encoding = "utf-8")
  print(f"theme copied to {styles} and {fonts}; {len(style_list)} styles")


def public_questions(questions: dict) -> dict:
  """The questions that judge the outlet's work keep only their overall numbers: the project does not compare
  outlets on them (they are also left out of the public corpus)."""
  return {name: ({**spec, "by_outlet": {"all": spec["by_outlet"]["all"]}} if name in OUTLET_JUDGING else spec)
          for name, spec in questions.items()}


def main():
  parser = argparse.ArgumentParser(description = "Export the data of the site's process page.")
  parser.add_argument("--database", default = "databases/private_corpus.db")
  parser.add_argument("--results", default = "results")
  parser.add_argument("--out", default = "site/src/data/process")
  parser.add_argument("--k", type = int, default = 50, help = "candidates per news of the corpus run")
  parser.add_argument("--sync-theme", action = "store_true", help = "also copy private_visuals/theme into the site")
  args = parser.parse_args()

  results, out = Path(args.results), Path(args.out)
  out.mkdir(parents = True, exist_ok = True)
  stats = json.loads((results / "jev/question_stats/question_stats.json").read_text(encoding = "utf-8"))
  connection = sqlite3.connect(f"file:{args.database}?mode=ro", uri = True)
  news = export_news(connection, stats)
  bills = export_bills(connection)
  files = {
    "funnel": export_funnel(news, bills, stats, args.k),
    "news": news,
    "bills": bills,
    "embeddings": export_embeddings(results),
    "ranker": export_ranker(results),
    "jev": {"price_per_million_tokens": stats["price_per_million_input_tokens"], "outlets": stats["outlets"],
            "general": stats["general"], "questions": public_questions(stats["questions"])},
    "cost": export_cost(stats, args.k),
  }
  for name, data in files.items():
    path = out / f"{name}.json"
    path.write_text(json.dumps(data, ensure_ascii = False, separators = (",", ":")), encoding = "utf-8")
    print(f"{path}: {path.stat().st_size:,} bytes")
  if args.sync_theme:
    sync_theme(out.parents[2])


if __name__ == "__main__":
  main()
