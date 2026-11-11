"""Builds the data file for the bills graph (#69).

Nodes are the bills in the embeddings file. Each bill is linked to its --neighbors most similar
bills (cosine similarity of the qwen3 exposition embeddings), and topics are the Louvain
communities of that graph, named after their most characteristic SIL subject descriptors.

The page draws the links itself, so that they can follow its filters (a window of filing dates,
only the covered bills): it gets, for every bill, its --stored nearest bills, best first, and
joins each bill it shows to the first --neighbors of them that are also shown. With every bill
on the page that is the same graph the topics come from. There is one list per kind of link:
  exposition cosine similarity of the embeddings of the exposition (the default)
  name       cosine similarity of the embeddings of the bill names
  subjects   cosine similarity of the embeddings of the SIL subject descriptors
  signers    bills signed by the same people (Jaccard of the signer sets; ties go to the bills
             filed closest in time)
Every bill also carries the party of its first signer on the filing date (or the Executive),
when it is one of the actors Jev is asked about.

Press coverage per bill comes from the Jev corpus run (results/jev/corpus/), with the two levels
of results/jev/corpus_analysis/analysis.py:
  mention       explicit >= 0.5 or implicit >= 0.75
  substantive   mention, and centrality >= 0.25
The stance of a bill is the mean Jev stance score (0 against, 1 in favor) over its substantive pairs.
The position of a party (or the Executive) on a bill is the mean of what its substantive news
attribute to it: in favor +1, against -1, neutral or divided 0; news that don't mention it are skipped.

The press views (co-mentions, outlet -> topic -> stage flow, coverage over time) read the table
of pairs: one row per news item and bill, with the stage of the bill according to the news
(Jev's `stage` question) and whether the coverage is substantive or a passing mention. News items
are numbered, with only their date, outlet, genre and main frame.

Only public fields go in (bill number, name, type, dates, status and counts): no article text,
titles, URLs or news ids.
Writes private_visuals/output/graph/bills.js and, for the bills map only, neighbors.js.

Usage: python private_visuals/graph/build_graph.py [--neighbors 5] [--stored 30] [--resolution 0.6]
"""
import argparse
import csv
import json
import math
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import networkx as nx
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RUN_DIR = ROOT / "results" / "jev" / "corpus"
DB_PATH = ROOT / "databases" / "private_corpus.db"
EMBEDDINGS_DIR = ROOT / "databases" / "embeddings" / "qwen3-0.6b"
EMBEDDINGS_PATH = EMBEDDINGS_DIR / "bills_exposition.npz"
# Texts of a bill whose embeddings give a kind of link each.
TEXT_EMBEDDINGS = {"exposition": "bills_exposition.npz", "name": "bills_name.npz", "subjects": "bills_subjects.npz"}
OUT_PATH = ROOT / "private_visuals" / "output" / "graph" / "bills.js"
NEIGHBORS_PATH = OUT_PATH.with_name("neighbors.js")

SEED = 7
TOPIC_COLORS = 8      # size of the categorical palette on the page
TOPIC_NAME_WORDS = 3  # descriptors in a topic name
# Jev detail questions on what a news item says each actor thinks of the bill.
ACTORS = ["pueblo_soberano", "liberacion_nacional", "frente_amplio", "unidad_social_cristiana",
          "agenda_ciudadana", "executive"]
FAVOR = {"in_favor": 1, "strongly_in_favor": 1, "against": -1, "strongly_against": -1, "neutral_or_divided": 0}
# Options of Jev's `stage` question, in the order of the legislative process.
# Party names as they appear in deputy_factions and bill_proponents -> index in ACTORS.
PARTY_NEEDLES = {"pueblo soberano": 0, "liberacion nacional": 1, "frente amplio": 2, "unidad social cristiana": 3,
                 "agenda ciudadana": 4, "poder ejecutivo": 5}
GENRES = ["news_report", "opinion", "interview", "analysis"]
FRAMES = ["policy", "conflict", "economic", "responsibility", "human_interest", "morality"]
STAGES = ["filing", "committee", "first_debate", "second_debate", "constitutional_court", "veto_or_signing",
          "archived_or_rejected", "not_stated"]


def is_mention(explicit, implicit):
  return explicit >= 0.5 or implicit >= 0.75


def similarity_graph(vectors, neighbors):
  """Undirected graph with an edge from every bill to its `neighbors` nearest bills."""
  unit = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
  sim = unit @ unit.T
  np.fill_diagonal(sim, -1)
  nearest = np.argpartition(-sim, neighbors, axis=1)[:, :neighbors]
  graph = nx.Graph()
  graph.add_nodes_from(range(len(vectors)))
  for i, row in enumerate(nearest):
    for j in row:
      graph.add_edge(i, int(j), weight=float(sim[i, j]))
  return graph, unit


def text_neighbors(numbers, stored):
  """For each kind of text, the `stored` nearest bills of every bill (best first) and their
  cosine similarity x 100, as two flat lists in node order."""
  node_of = {number: i for i, number in enumerate(numbers)}
  lists = {}
  for key, filename in TEXT_EMBEDDINGS.items():
    data = np.load(EMBEDDINGS_DIR / filename, allow_pickle=True)
    rows = np.array([node_of[int(n)] for n in data["numbers"]])   # node of each row of this file
    vectors = data["vectors"].astype(np.float32)
    unit = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
    sim = unit @ unit.T
    np.fill_diagonal(sim, -1)
    nearest = np.argpartition(-sim, stored, axis=1)[:, :stored]
    order = np.argsort(-np.take_along_axis(sim, nearest, axis=1), axis=1)
    nearest = np.take_along_axis(nearest, order, axis=1)
    ids = np.empty((len(numbers), stored), dtype=int)
    sims = np.empty((len(numbers), stored), dtype=int)
    ids[rows] = rows[nearest]
    sims[rows] = np.rint(np.take_along_axis(sim, nearest, axis=1) * 100)
    lists[key] = {"ids": ids.ravel().tolist(), "sims": sims.ravel().tolist()}
  return lists


def signer_neighbors(con, numbers, stored):
  """The `stored` bills with the most similar signer sets (Jaccard x 100) of every bill, best
  first, as two flat lists padded with -1. Many bills tie (all the bills of one deputy), so
  ties go to the bills filed closest in time, which have the closest numbers."""
  node_of = {number: i for i, number in enumerate(numbers)}
  signers, signed = defaultdict(set), defaultdict(set)
  for number, name, deputy_id in con.execute("SELECT number, name, deputy_id FROM bill_proponents"):
    if number in node_of:
      who = deputy_id if deputy_id is not None else name
      signers[number].add(who)
      signed[who].add(number)
  ids, sims = [], []
  for number in numbers:
    people = signers.get(number, ())
    shared = Counter(other for who in people for other in signed[who] if other != number)
    jaccard = lambda other: shared[other] / (len(people) + len(signers[other]) - shared[other])
    best = sorted(shared, key=lambda o: (-jaccard(o), abs(o - number)))[:stored]
    pad = [-1] * (stored - len(best))
    ids += [node_of[other] for other in best] + pad
    sims += [round(jaccard(other) * 100) for other in best] + pad
  return {"ids": ids, "sims": sims}, len(signers)


def first_signer_actor(con):
  """bill -> index in ACTORS of the party of its first signer on the filing date (the Executive
  signs as an institution); bills first signed by any other party are left out."""
  def actor(name):
    plain = "".join(ch for ch in unicodedata.normalize("NFKD", (name or "").lower()) if not unicodedata.combining(ch))
    return next((index for needle, index in PARTY_NEEDLES.items() if needle in plain), None)

  factions = defaultdict(list)
  for person_id, faction, date_from, date_to in con.execute(
      "SELECT person_id, faction, date_from, date_to FROM deputy_factions"):
    factions[person_id].append((date_from or "", date_to or "9999", faction))
  person = dict(con.execute("SELECT deputy_id, person_id FROM deputies"))
  proposed = dict(con.execute("SELECT number, date_proposed FROM bills"))
  first = {}
  for number, name, deputy_id in con.execute(
      "SELECT number, name, deputy_id FROM bill_proponents ORDER BY number, signing_order"):
    if number in first:
      continue
    if deputy_id is None:
      first[number] = actor(name)
    else:
      day = proposed.get(number) or ""
      spans = factions.get(person.get(deputy_id), [])
      hit = [f for a, b, f in spans if a <= day <= b] or [f for _, _, f in sorted(spans)[-1:]]
      first[number] = actor(hit[0]) if hit else None
  return {number: index for number, index in first.items() if index is not None}


def clean_descriptor(descriptor):
  """SIL thesaurus stems carry gender suffixes ('PUBLIC,-O/-A'): keep one readable form."""
  stem, _, suffixes = descriptor.partition(",")
  first = suffixes.split("/")[0].strip("- ")
  return stem + ("O" if first == "O" else "")


def topic_name(members, subjects, document_frequency, total):
  """Top descriptors by share inside the topic times rarity in the whole set (c-TF-IDF)."""
  counts = Counter(s for number in members for s in set(subjects.get(number, ())))
  ranked = sorted(counts, key=lambda s: (counts[s] / len(members)) * math.log(total / document_frequency[s]),
                  reverse=True)
  words = []
  for descriptor in ranked:
    word = clean_descriptor(descriptor)
    if any(word[:5] == other[:5] for other in words):
      continue  # AMBIENTE / AMBIENTAL say the same thing
    words.append(word)
    if len(words) == TOPIC_NAME_WORDS:
      break
  return " · ".join(words)


def assign_topic_colors(graph, topic_of, n_topics):
  """Palette slot per topic. The palette is shorter than the topic list, so slots repeat:
  each topic takes the slot that shares the fewest edges with the topics already painted,
  which keeps neighboring topics in different colors."""
  between = defaultdict(float)
  for i, j in graph.edges():
    a, b = topic_of[i], topic_of[j]
    if a != b:
      between[(a, b)] += 1
      between[(b, a)] += 1
  slots, usage = {}, Counter()
  for topic in range(n_topics):  # topics are sorted by size, largest first
    def cost(slot):
      clash = sum(between[(topic, other)] for other, s in slots.items() if s == slot)
      return (clash, usage[slot], slot)
    slots[topic] = min(range(TOPIC_COLORS), key=cost)
    usage[slots[topic]] += 1
  return slots


def initial_positions(unit, topic_of, n_topics):
  """Starting layout: topics ordered along the first two principal axes of their centroids and
  spread evenly (by rank, so an odd topic doesn't land far from the rest), bills scattered
  around their topic. The simulation on the page does the rest."""
  rng = np.random.default_rng(SEED)
  topics = np.array(topic_of)
  centroids = np.stack([unit[topics == t].mean(axis=0) for t in range(n_topics)])
  centered = centroids - centroids.mean(axis=0)
  _, _, axes = np.linalg.svd(centered, full_matrices=False)
  flat = centered @ axes[:2].T
  ranks = flat.argsort(axis=0).argsort(axis=0) / (n_topics - 1)  # 0..1 on each axis
  centers = (ranks - 0.5) * 2 * 1000
  sizes = np.bincount(topics, minlength=n_topics)
  spread = 8 * np.sqrt(sizes[topics])[:, None]
  return centers[topics] + rng.normal(size=(len(topics), 2)) * spread


def load_coverage(con):
  """bill -> coverage counts and mean stance, from the gate and detail stages of the corpus run.
  Also returns the substantive pairs as (news id, bill, stage according to the news)."""
  centrality, stance, stage, attributed, frame = {}, {}, {}, defaultdict(dict), {}
  with open(RUN_DIR / "details.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
      if not row["bill"]:
        if row["question"] == "main_frame":
          frame[row["news_id"]] = row["choice"]
        continue
      key = (row["news_id"], int(row["bill"]))
      if row["question"] in ACTORS:
        if row["choice"] in FAVOR:
          attributed[key][row["question"]] = FAVOR[row["choice"]]
      elif row["question"] == "stage":
        stage[key] = row["choice"]
      elif row["score"] == "":
        continue
      elif row["question"] == "centrality":
        centrality[key] = float(row["score_01"])
      elif row["question"] == "stance":
        stance[key] = float(row["score_01"])
  outlet = dict(con.execute("SELECT id, organization FROM news_articles"))
  coverage = defaultdict(lambda: {"mention": 0, "substantive": 0, "main": 0, "outlets": set(), "stances": [],
                                  "positions": defaultdict(list)})
  pairs = Counter()
  matched = []   # (news id, bill, stage according to the news, substantive or just a mention)
  with open(RUN_DIR / "gate.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
      if row["match"] != "1" or not is_mention(float(row["explicit"]), float(row["implicit"])):
        continue
      key = (row["news_id"], int(row["bill"]))
      bill = coverage[key[1]]
      bill["mention"] += 1
      pairs["mention"] += 1
      substantive = centrality.get(key, 0) >= 0.25
      matched.append((key[0], key[1], stage.get(key, "not_stated"), int(substantive)))
      if not substantive:
        continue
      bill["substantive"] += 1
      pairs["substantive"] += 1
      bill["outlets"].add(outlet.get(key[0]))
      if centrality[key] >= 0.75:
        bill["main"] += 1
      if key in stance:
        bill["stances"].append(stance[key])
      for actor, value in attributed.get(key, {}).items():
        bill["positions"][actor].append(value)
  return coverage, pairs, matched, frame


def press_table(con, matched, frame, node_of):
  """The pairs for the press views: news items numbered by date (only date, outlet, genre and
  main frame are kept), and one row per pair with the node of the bill, the stage it is in
  according to the news and whether the coverage is substantive (1) or a passing mention (0)."""
  published = {news_id: (date[:10], outlet) for news_id, date, outlet in con.execute(
    "SELECT id, date_published, organization FROM news_articles") if date}
  with open(RUN_DIR / "news.csv", encoding="utf-8") as f:
    genre = {row["news_id"]: row["genre"] for row in csv.DictReader(f)}
  rows = [(news_id, node_of[bill], stage, level) for news_id, bill, stage, level in matched
          if news_id in published and bill in node_of]
  outlets = sorted({published[news_id][1] for news_id, *_ in rows})
  ordered = sorted({news_id for news_id, *_ in rows}, key=lambda news_id: (published[news_id], news_id))
  index = {news_id: i for i, news_id in enumerate(ordered)}
  code = lambda options, value: options.index(value) if value in options else -1
  return {
    "outlets": outlets,
    "stages": STAGES,
    "genres": GENRES,
    "frames": FRAMES,
    "news": [[published[n][0], outlets.index(published[n][1]), code(GENRES, genre.get(n)), code(FRAMES, frame.get(n))]
             for n in ordered],
    "pairs": sorted([index[news_id], node, STAGES.index(stage), level] for news_id, node, stage, level in rows),
    "skipped": len(matched) - len(rows),
  }


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--neighbors", type=int, default=5, help="similar bills each bill is linked to")
  parser.add_argument("--stored", type=int, default=30,
                      help="nearest bills kept per bill, for the page to link the ones it shows")
  parser.add_argument("--resolution", type=float, default=0.6,
                      help="Louvain resolution: lower gives fewer, larger topics")
  args = parser.parse_args()

  embeddings = np.load(EMBEDDINGS_PATH, allow_pickle=True)
  numbers = [int(n) for n in embeddings["numbers"]]
  graph, unit = similarity_graph(embeddings["vectors"].astype(np.float32), args.neighbors)

  communities = nx.community.louvain_communities(graph, weight="weight", resolution=args.resolution, seed=SEED)
  communities = sorted(communities, key=len, reverse=True)
  topic_of = [0] * len(numbers)
  for topic, members in enumerate(communities):
    for i in members:
      topic_of[i] = topic

  con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
  subjects = defaultdict(list)
  for number, subject in con.execute("SELECT number, subject FROM bill_subjects"):
    subjects[number].append(subject)
  document_frequency = Counter(s for ss in subjects.values() for s in set(ss))
  slots = assign_topic_colors(graph, topic_of, len(communities))
  topics = [{"name": topic_name([numbers[i] for i in members], subjects, document_frequency, len(numbers)),
             "size": len(members), "color": slots[topic]}
            for topic, members in enumerate(communities)]

  coverage, pairs, matched, frame = load_coverage(con)
  press = press_table(con, matched, frame, {number: i for i, number in enumerate(numbers)})
  neighbor_lists = text_neighbors(numbers, args.stored)
  neighbor_lists["signers"], with_signers = signer_neighbors(con, numbers, args.stored)
  proponent = first_signer_actor(con)
  bills = {row[0]: row[1:] for row in con.execute(
    "SELECT number, name, file_type, date_proposed, status, law_number FROM bills")}
  as_of = con.execute("SELECT max(date_extracted) FROM bills").fetchone()[0][:10]
  types = sorted({b[1] for b in bills.values() if b[1]})
  statuses = sorted({b[3] for b in bills.values() if b[3]})
  positions = initial_positions(unit, topic_of, len(communities))

  nodes = []
  for i, number in enumerate(numbers):
    name, file_type, date_proposed, status, law_number = bills[number]
    c = coverage.get(number)
    stances = c["stances"] if c else []
    nodes.append([
      number, name,
      types.index(file_type) if file_type else -1,
      (date_proposed or "")[:10],
      statuses.index(status) if status else -1,
      law_number,
      topic_of[i],
      c["mention"] if c else 0,
      c["substantive"] if c else 0,
      c["main"] if c else 0,
      len(c["outlets"]) if c else 0,
      round(sum(stances) / len(stances) * 100) if stances else None,
      round(float(positions[i, 0])), round(float(positions[i, 1])),
      # [actor index, mean position -100..100, news that attribute one] for the actors with any
      [[a, round(sum(v) / len(v) * 100), len(v)] for a, actor in enumerate(ACTORS)
       if (v := c["positions"].get(actor))] if c else [],
      proponent.get(number, -1),
    ])
  links = graph.number_of_edges()

  data = {
    "meta": {"as_of": as_of, "neighbors": args.neighbors, "stored": args.stored, "resolution": args.resolution,
             "embeddings": "qwen3-0.6b / exposition",
             "modularity": round(nx.community.modularity(graph, communities, weight="weight"), 3)},
    "fields": ["number", "name", "type", "date", "status", "law", "topic", "mention", "substantive",
               "main", "outlets", "stance", "x", "y", "positions", "proponent"],
    "actors": ACTORS,
    "types": types,
    "statuses": statuses,
    "topics": topics,
    "nodes": nodes,
    "press": press,
  }
  OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
  payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
  OUT_PATH.write_text(f"window.GRAPH_BILLS = {payload};\n", encoding="utf-8")
  payload = json.dumps({"stored": args.stored, "lists": neighbor_lists}, separators=(",", ":"))
  NEIGHBORS_PATH.write_text(f"window.GRAPH_NEIGHBORS = {payload};\n", encoding="utf-8")

  covered = [n for n in nodes if n[8]]
  stance_values = sorted(n[11] for n in covered if n[11] is not None)
  quantile = lambda q: stance_values[int(q * (len(stance_values) - 1))]
  print(f"bills {len(nodes)}, links {links}, topics {len(topics)} (modularity {data['meta']['modularity']})")
  print(f"pairs: mention {pairs['mention']}, substantive {pairs['substantive']}; "
        f"bills: mention {sum(1 for n in nodes if n[7])}, substantive {len(covered)}")
  print(f"stance (0-100) over {len(stance_values)} bills: min {stance_values[0]}, p10 {quantile(0.1)}, "
        f"p25 {quantile(0.25)}, median {quantile(0.5)}, p75 {quantile(0.75)}, p90 {quantile(0.9)}, max {stance_values[-1]}")
  for a, actor in enumerate(ACTORS):
    print(f"  position of {actor}: {sum(1 for n in nodes if any(p[0] == a for p in n[14]))} bills")
  for key, lists in neighbor_lists.items():
    filled = sum(1 for i in lists["ids"] if i >= 0)
    print(f"neighbors by {key}: {filled} stored" + (f" ({with_signers} bills with signers)" if key == "signers" else ""))
  # The first --neighbors of the exposition lists must be the graph the topics were found on.
  ids = neighbor_lists["exposition"]["ids"]
  listed = {tuple(sorted((i, ids[i * args.stored + k]))) for i in range(len(nodes)) for k in range(args.neighbors)}
  print(f"exposition lists vs topic graph: {len(listed)} links, {len(listed ^ {tuple(sorted(e)) for e in graph.edges()})} different")
  print("first signer:", {actor: sum(1 for n in nodes if n[15] == a) for a, actor in enumerate(ACTORS)},
        "other or none:", sum(1 for n in nodes if n[15] == -1))
  per_news = Counter(p[0] for p in press["pairs"] if p[3])
  print(f"press table: {len(press['pairs'])} pairs, {sum(p[3] for p in press['pairs'])} substantive in {len(per_news)} news "
        f"({sum(1 for n in per_news.values() if n > 1)} with two or more bills), "
        f"{press['news'][0][0]} to {press['news'][-1][0]}, skipped {press['skipped']}")
  for options, column, label in ((GENRES, 2, "genre"), (FRAMES, 3, "frame")):
    print(f"  {label}:", dict(Counter(options[n[column]] if n[column] >= 0 else "?" for n in press["news"])))
  print(f"{OUT_PATH.stat().st_size / 1e6:.1f} MB -> {OUT_PATH}")
  print(f"{NEIGHBORS_PATH.stat().st_size / 1e6:.1f} MB -> {NEIGHBORS_PATH}")


if __name__ == "__main__":
  main()
