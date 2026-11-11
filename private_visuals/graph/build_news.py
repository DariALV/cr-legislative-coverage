"""Builds the data file for the news graph (#69).

Nodes are the news items of the corpus (news_articles, May to October 2026), ordered by date.
The page links them in one of two ways:
  content  each item with its --neighbors most similar items: cosine similarity of the mean of
           its qwen3 chunk embeddings (news_256_all.npz), weighted by the tokens of each chunk.
           Pairs below --min-similarity are left out. The nearest items are searched within each
           subset the page can show (all the news, those that pass Jev's Assembly filter, those
           with substantive coverage of a bill), so a filtered page still links every item to its
           closest ones among those on screen.
  bill     items with substantive coverage of the same bill, one after the other by date. The page
           builds these chains from the bills of each item.

Boilerplate is left out of the means: a chunk counts as boilerplate when a nearly identical one
(cosine >= --boilerplate-sim) turns up in --boilerplate-news other news items or more, like
Delfino's opinion notice or La Nacion's notice on summaries. An item made only of such chunks
keeps them all. Finding them takes a couple of minutes, so the means are cached next to the
embeddings (news_pooled.npz); --refresh computes them again.

Caveat: the chunks were embedded as queries for bill retrieval (the instruction asks for the bills
a news item discusses), so "similar" leans toward "about the same legislative matter".

Bills per item come from the Jev corpus run, with the levels of build_graph.py: substantive bills
(the main one is the bill with the highest centrality) and passing mentions. The page takes bill
names and topics from the bills graph data. Initial positions are the first two principal
components of the means, so that similar items start close together.

Only public fields go in: news id, URL, title, outlet, date, author, section, Jev's genre and the
bills with their scores. No article text.
Writes private_visuals/output/graph/news.js.

Usage: python private_visuals/graph/build_news.py [--neighbors 6] [--min-similarity 0.6] [--refresh]
"""
import argparse
import csv
import json
import sqlite3
import time
from collections import Counter, defaultdict

import numpy as np

from build_graph import DB_PATH, EMBEDDINGS_DIR, GENRES, ROOT, RUN_DIR, load_coverage

CHUNKS_PATH = EMBEDDINGS_DIR / "news_256_all.npz"
POOLED_PATH = EMBEDDINGS_DIR / "news_pooled.npz"
OUT_PATH = ROOT / "private_visuals" / "output" / "graph" / "news.js"
BLOCK = 1024     # rows per block of similarities, about 0.5 GB of floats against all the chunks
SPREAD = 4000    # radius of the starting layout: about where the page's forces settle 30,000 nodes


def find_boilerplate(unit, owner, min_sim, min_news):
  """Whether each chunk has a nearly identical chunk (cosine >= min_sim) in min_news other news items or more."""
  repeated = np.zeros(len(unit), dtype=bool)
  started = time.time()
  for start in range(0, len(unit), BLOCK):
    sims = unit[start:start + BLOCK] @ unit.T
    rows, cols = np.nonzero(sims >= min_sim)
    other = owner[cols] != owner[rows + start]
    pairs = np.unique(np.stack([rows[other], owner[cols[other]]], axis=1), axis=0)   # (chunk, other news item)
    counts = np.bincount(pairs[:, 0], minlength=len(sims)) if len(pairs) else np.zeros(len(sims), dtype=int)
    repeated[start:start + len(sims)] = counts >= min_news
    if start // BLOCK % 25 == 0:
      print(f"  boilerplate: {start + len(sims):,} of {len(unit):,} chunks, {time.time() - started:.0f} s", flush=True)
  return repeated


def pool(unit, owner, tokens, repeated, n_news):
  """Token-weighted mean of the chunks of each news item, without the repeated ones unless that
  leaves none, as unit vectors. Returns them and the items that kept their repeated chunks."""
  weights = np.where(repeated, 0, tokens).astype(np.float32)
  only_repeated = np.bincount(owner, weights=weights, minlength=n_news) == 0
  weights = np.where(only_repeated[owner], tokens, weights).astype(np.float32)
  order = np.argsort(owner, kind="stable")
  starts = np.searchsorted(owner[order], np.arange(n_news))
  sums = np.add.reduceat(unit[order] * weights[order, None], starts, axis=0)
  return sums / np.linalg.norm(sums, axis=1, keepdims=True), only_repeated


def pooled_vectors(news_ids, args):
  """The mean embedding of every news item (in the order of news_ids), from the cache when it was
  made with the same chunks and settings."""
  settings = {"source": CHUNKS_PATH.name, "source_mtime": CHUNKS_PATH.stat().st_mtime,
              "boilerplate_sim": args.boilerplate_sim, "boilerplate_news": args.boilerplate_news}
  if POOLED_PATH.exists() and not args.refresh:
    cached = np.load(POOLED_PATH, allow_pickle=False)
    index = {news_id: i for i, news_id in enumerate(cached["news_ids"].tolist())}
    if json.loads(str(cached["settings"])) == settings and all(n in index for n in news_ids):
      print(f"means from the cache ({POOLED_PATH.name})")
      rows = [index[n] for n in news_ids]
      report = json.loads(str(cached["report"]))
      report["repeated_by_news"] = [report["repeated_by_news"][i] for i in rows]
      return cached["vectors"][rows], report

  chunks = np.load(CHUNKS_PATH, allow_pickle=False)
  unit = chunks["vectors"].astype(np.float32)
  unit /= np.linalg.norm(unit, axis=1, keepdims=True)
  row_of = {news_id: i for i, news_id in enumerate(news_ids)}
  owner = np.array([row_of[n] for n in chunks["news_ids"].tolist()])
  if len(np.unique(owner)) != len(news_ids):
    raise SystemExit(f"{len(news_ids) - len(np.unique(owner))} news items have no chunks in {CHUNKS_PATH.name}: embed them first")
  tokens = chunks["tokens"]
  repeated = find_boilerplate(unit, owner, args.boilerplate_sim, args.boilerplate_news)
  vectors, only_repeated = pool(unit, owner, tokens, repeated, len(news_ids))
  report = {"chunks": len(unit), "repeated": int(repeated.sum()),
            "news_with_repeated": int(len(np.unique(owner[repeated]))),
            "news_only_repeated": int(only_repeated.sum()),
            "repeated_tokens_share": round(float(tokens[repeated].sum() / tokens.sum()), 4),
            "repeated_by_news": np.bincount(owner[repeated], minlength=len(news_ids)).tolist()}
  np.savez(POOLED_PATH, vectors=vectors.astype(np.float32), news_ids=np.array(news_ids),
           settings=json.dumps(settings), repeated=report["repeated"], report=json.dumps(report))
  return vectors.astype(np.float32), report


def nearest(unit, members, k, min_sim):
  """For each member, its k most similar members, best first, as node indices and cosine x 100,
  padded with -1 where fewer than k reach min_sim."""
  sub = unit[members]
  ids = np.full((len(members), k), -1, dtype=np.int64)
  sims = np.full((len(members), k), -1, dtype=np.int64)
  top_sims = []
  for start in range(0, len(members), BLOCK):
    s = sub[start:start + BLOCK] @ sub.T
    s[np.arange(len(s)), np.arange(start, start + len(s))] = -1   # not itself
    top = np.argpartition(-s, k, axis=1)[:, :k]
    values = np.take_along_axis(s, top, axis=1)
    order = np.argsort(-values, axis=1)
    top, values = np.take_along_axis(top, order, axis=1), np.take_along_axis(values, order, axis=1)
    ok = values >= min_sim
    ids[start:start + len(s)] = np.where(ok, members[top], -1)
    sims[start:start + len(s)] = np.where(ok, np.rint(values * 100), -1)
    top_sims.append(values)
  return ids, sims, np.concatenate(top_sims)


def initial_positions(unit):
  """The first two principal components of the means, scaled so that almost all fit in SPREAD."""
  centered = unit - unit.mean(axis=0)
  _, vectors = np.linalg.eigh(centered.T @ centered)
  xy = centered @ vectors[:, [-1, -2]]
  return xy * (SPREAD / np.percentile(np.linalg.norm(xy, axis=1), 98))


def pair_scores():
  """(news id, bill) -> Jev's centrality and stance, from 0 to 1."""
  centrality, stance = {}, {}
  with open(RUN_DIR / "details.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
      if row["bill"] and row["score"] != "" and row["question"] in ("centrality", "stance"):
        (centrality if row["question"] == "centrality" else stance)[(row["news_id"], int(row["bill"]))] = float(row["score_01"])
  return centrality, stance


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--neighbors", type=int, default=6, help="most similar news items each item is linked to")
  parser.add_argument("--min-similarity", type=float, default=0.6, help="cosine below which two items are not linked")
  parser.add_argument("--boilerplate-sim", type=float, default=0.95, help="cosine from which two chunks count as the same text")
  parser.add_argument("--boilerplate-news", type=int, default=5,
                      help="other news items with the same chunk from which it counts as boilerplate")
  parser.add_argument("--refresh", action="store_true", help="find the boilerplate again instead of using the cache")
  args = parser.parse_args()

  con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
  rows = sorted(con.execute("SELECT id, url, title, organization, date_published, author, section FROM news_articles"),
                key=lambda r: (r[4], r[0]))
  news_ids = [r[0] for r in rows]
  node_of = {news_id: i for i, news_id in enumerate(news_ids)}

  started = time.time()
  unit, report = pooled_vectors(news_ids, args)
  print(f"means of {len(unit):,} news items in {time.time() - started:.0f} s; "
        f"{report['repeated']:,} of {report['chunks']:,} chunks repeated ({report['repeated_tokens_share']:.1%} of the tokens) "
        f"in {report['news_with_repeated']:,} items; {report['news_only_repeated']} items made only of them")

  # Jev: the Assembly filter (with the genre) and the bills of each item.
  with open(RUN_DIR / "news.csv", encoding="utf-8") as f:
    genre = {row["news_id"]: row["genre"] for row in csv.DictReader(f)}
  _, _, matched, _ = load_coverage(con)
  centrality, stance = pair_scores()
  bills, mentions = defaultdict(list), defaultdict(list)
  for news_id, bill, _stage, substantive in matched:
    if news_id not in node_of:
      continue
    if substantive:
      score = stance.get((news_id, bill))
      bills[news_id].append([bill, round(centrality[(news_id, bill)] * 100), None if score is None else round(score * 100)])
    else:
      mentions[news_id].append(bill)
  for listed in bills.values():
    listed.sort(key=lambda b: -b[1])   # the main bill first

  subsets = {
    "all": np.arange(len(rows)),
    "assembly": np.array([i for i, news_id in enumerate(news_ids) if news_id in genre]),
    "bill": np.array([i for i, news_id in enumerate(news_ids) if news_id in bills]),
  }
  neighbor_lists = {}
  for key, members in subsets.items():
    ids, sims, top = nearest(unit, members, args.neighbors, args.min_similarity)
    entry = {"ids": ids.ravel().tolist(), "sims": sims.ravel().tolist()}
    if key != "all":
      entry["members"] = members.tolist()
    neighbor_lists[key] = entry
    q = lambda column, p: round(float(np.percentile(top[:, column], p)), 3)
    kept = int((ids >= 0).sum())
    print(f"{key}: {len(members):,} items; nearest cosine p5/p50/p95 {q(0, 5)} / {q(0, 50)} / {q(0, 95)}, "
          f"{args.neighbors}th {q(-1, 5)} / {q(-1, 50)} / {q(-1, 95)}; {kept:,} of {ids.size:,} kept, "
          f"{int((ids[:, 0] < 0).sum())} items with none")

  # How much the content links stay inside one outlet, against what chance would give.
  outlet_of = np.array([r[3] for r in rows])
  ids = np.array(neighbor_lists["all"]["ids"]).reshape(-1, args.neighbors)
  source = np.repeat(np.arange(len(rows)), args.neighbors)[ids.ravel() >= 0]
  target = ids.ravel()[ids.ravel() >= 0]
  shares = Counter(r[3] for r in rows)
  chance = sum((c / len(rows)) ** 2 for c in shares.values())
  print(f"content links inside one outlet: {np.mean(outlet_of[source] == outlet_of[target]):.1%} (chance {chance:.1%})")

  outlets = [o for o, _ in shares.most_common()]
  authors = [a for a, _ in Counter(" ".join(r[5].split()) for r in rows if r[5] and r[5].strip()).most_common()]
  sections = [s for s, _ in Counter(r[6].strip() for r in rows if r[6] and r[6].strip()).most_common()]
  author_index = {a: i for i, a in enumerate(authors)}
  section_index = {s: i for i, s in enumerate(sections)}
  positions = initial_positions(unit)
  repeated_by_news = report["repeated_by_news"]
  nodes = []
  for i, (news_id, url, title, outlet, date, author, section) in enumerate(rows):
    nodes.append([
      news_id, url, " ".join(title.split()), outlets.index(outlet), date[:10],
      author_index.get(" ".join(author.split()), -1) if author else -1,
      section_index.get(section.strip(), -1) if section else -1,
      GENRES.index(genre[news_id]) if genre.get(news_id) in GENRES else -1,
      int(news_id in genre),
      bills.get(news_id, []),
      mentions.get(news_id, []),
      round(float(positions[i, 0])), round(float(positions[i, 1])),
      repeated_by_news[i],
    ])

  chains = Counter(b[0] for listed in bills.values() for b in listed)
  data = {
    "meta": {"as_of": max(r[4] for r in rows)[:10], "neighbors": args.neighbors, "min_similarity": args.min_similarity,
             "boilerplate_sim": args.boilerplate_sim, "boilerplate_news": args.boilerplate_news,
             "embeddings": "qwen3-0.6b, 256-token chunks, embedded as bill-retrieval queries",
             "repeated_chunks": report["repeated"], "chunks": report["chunks"]},
    "fields": ["id", "url", "title", "outlet", "date", "author", "section", "genre", "assembly", "bills", "mentions",
               "x", "y", "repeated"],
    "outlets": outlets,
    "authors": authors,
    "sections": sections,
    "genres": GENRES,
    "nodes": nodes,
    "neighbors": neighbor_lists,
  }
  OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
  payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
  OUT_PATH.write_text(f"window.GRAPH_NEWS = {payload};\n", encoding="utf-8")

  print(f"news {len(nodes):,}: assembly filter {len(subsets['assembly']):,}, substantive bill {len(subsets['bill']):,} "
        f"({sum(1 for b in bills.values() if len(b) > 1)} with two or more), only passing mentions "
        f"{sum(1 for n in mentions if n not in bills):,}")
  print(f"bill chains: {sum(1 for c in chains.values() if c > 1)} bills with two or more items, "
        f"{sum(c - 1 for c in chains.values())} links")
  print("outlets:", dict(shares.most_common()), "| authors", len(authors), "| sections", len(sections))
  print(f"{OUT_PATH.stat().st_size / 1e6:.1f} MB -> {OUT_PATH}")


if __name__ == "__main__":
  main()
