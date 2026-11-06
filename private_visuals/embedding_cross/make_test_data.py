"""Builds artificial news-bill connections to preview the embedding_cross page.

Reads private_corpus.db read-only and writes private_visuals/output/embedding_cross/data.js.
Scores are NOT embeddings: explicit news_bill_links get 0.80-0.92 and the rest come from
TF-IDF word overlap between the news (title + description) and the bill (name + description),
rescaled to 0.30-0.80. Only meant to see how the page looks with plausible pairs.

Usage: python private_visuals/embedding_cross/make_test_data.py [--news 400] [--top 50]
"""
import argparse
import json
import math
import random
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "databases" / "private_corpus.db"
OUT_PATH = ROOT / "private_visuals" / "output" / "embedding_cross" / "data.js"
BILL_URL = "https://delfino.cr/asamblea/proyecto/{}"

STOPWORDS = set("""
a al ante bajo con contra de del desde durante e el en entre esta este esto hacia hasta la las le les lo los
mas mediante para pero por que se segun sin sobre su sus tras un una unas uno unos y o u ya no si como es son
fue ser ha han hay sera tambien muy mas otro otra otros otras cual cuales cuando donde quien este esa ese eso
ley leyes proyecto reforma articulo articulos numero n costa rica nacional dia anos ano tras dijo
""".split())


def tokens(text):
  text = unicodedata.normalize("NFKD", (text or "").lower())
  text = "".join(ch for ch in text if not unicodedata.combining(ch))
  return [w for w in re.findall(r"[a-z]{4,}", text) if w not in STOPWORDS]


def tfidf(docs):
  """docs: {key: [tokens]} -> {key: {term: weight}} with unit L2 norm."""
  df = Counter()
  for toks in docs.values():
    df.update(set(toks))
  n = len(docs)
  vectors = {}
  for key, toks in docs.items():
    tf = Counter(toks)
    vec = {t: (1 + math.log(c)) * math.log(n / df[t]) for t, c in tf.items() if df[t] < n * 0.2}
    norm = math.sqrt(sum(w * w for w in vec.values())) or 1.0
    vectors[key] = {t: w / norm for t, w in vec.items()}
  return vectors


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--news", type=int, default=400)
  parser.add_argument("--top", type=int, default=50)
  parser.add_argument("--seed", type=int, default=7)
  args = parser.parse_args()
  rng = random.Random(args.seed)

  con = sqlite3.connect(f"file:{DB_PATH.as_posix()}?mode=ro", uri=True)

  bills = {}
  for number, name, desc, status, commission, proposed in con.execute("""
      SELECT number, name, description, status, commission, date_proposed FROM bills"""):
    bills[number] = {"name": "".join(ch if ord(ch) >= 32 else " " for ch in name).strip(), "status": status,
                     "commission": commission, "date_proposed": (proposed or "")[:10] or None,
                     "_text": f"{name} {desc or ''}"}

  links = defaultdict(set)
  for news_id, number in con.execute("SELECT news_id, bill_number FROM news_bill_links"):
    if number in bills:
      links[news_id].add(number)

  # Half the sample from news with explicit links, the rest political-looking news from every outlet.
  linked_ids = sorted(links)
  rng.shuffle(linked_ids)
  picked = linked_ids[: args.news // 2]
  others = [r[0] for r in con.execute("""
      SELECT id FROM news_articles
      WHERE extraction_status = 'Success'
        AND (title LIKE '%proyecto%' OR title LIKE '%diputad%' OR title LIKE '%Asamblea%'
             OR title LIKE '%ley %' OR section IN ('Política', 'Politica', 'País', 'nacionales'))""")
            if r[0] not in links]
  rng.shuffle(others)
  picked += others[: args.news - len(picked)]

  news = {}
  q = "SELECT id, url, organization, title, description, date_published, section FROM news_articles WHERE id = ?"
  for nid in picked:
    i, url, org, title, desc, date, section = con.execute(q, (nid,)).fetchone()
    news[i] = {"id": i, "url": url, "outlet": org, "title": title, "section": section,
               "date": date, "_text": f"{title} {title} {desc or ''}"}
  con.close()

  vectors = tfidf({("b", k): tokens(v["_text"]) for k, v in bills.items()} |
                  {("n", k): tokens(v["_text"]) for k, v in news.items()})
  index = defaultdict(list)
  for (kind, key), vec in vectors.items():
    if kind == "b":
      for term, w in vec.items():
        index[term].append((key, w))

  items = []
  used = set()
  for nid, item in news.items():
    sims = Counter()
    for term, w in vectors[("n", nid)].items():
      for number, bw in index.get(term, ()):
        sims[number] += w * bw
    ranked = [n for n, _ in sims.most_common(args.top * 2)]
    pool = ranked + [n for n in rng.sample(list(bills), args.top) if n not in sims]
    top_sim = max(sims.values(), default=0.0) or 1.0

    matches = []
    for number in links.get(nid, ()):
      matches.append((round(rng.uniform(0.80, 0.92), 4), number, True))
    for number in pool:
      if len(matches) >= args.top:
        break
      if number in links.get(nid, ()):
        continue
      rel = sims.get(number, 0.0) / top_sim
      score = 0.30 + 0.48 * rel ** 0.6 + rng.uniform(-0.02, 0.02)
      matches.append((round(min(score, 0.79), 4), number, False))
    matches = sorted(matches, reverse=True)[: args.top]

    out = {k: v for k, v in item.items() if not k.startswith("_")}
    # Compact rows [bill_number, score, explicit_link]; bill details live once in payload["bills"].
    out["matches"] = [[n, s, int(e)] for s, n, e in matches]
    used.update(n for _, n, _ in matches)
    items.append(out)

  items.sort(key=lambda x: x["matches"][0][1] if x["matches"] else 0, reverse=True)
  payload = {
    "meta": {"test_data": True, "generated_at": datetime.now().isoformat(timespec="seconds"),
             "model": "datos de prueba (TF-IDF + enlaces explícitos)", "top_k": args.top,
             "news_count": len(items), "bills_in_corpus": len(bills)},
    "news": items,
    "bills": {n: {k: v for k, v in bills[n].items() if not k.startswith("_")} for n in sorted(used)},
  }
  OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
  OUT_PATH.write_text("window.EMBEDDING_CROSS = " + json.dumps(payload, ensure_ascii=False) + ";\n", encoding="utf-8")
  print(f"{len(items)} news x top {args.top} -> {OUT_PATH} ({OUT_PATH.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
  main()
