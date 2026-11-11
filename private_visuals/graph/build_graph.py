"""Builds the data file for the bills graph (#69).

Nodes are the bills in the embeddings file. Each bill is linked to its --neighbors most similar
bills (cosine similarity of the qwen3 exposition embeddings), and topics are the Louvain
communities of that graph, named after their most characteristic SIL subject descriptors.

Press coverage per bill comes from the Jev corpus run (results/jev/corpus/), with the two levels
of results/jev/corpus_analysis/analysis.py:
  mention       explicit >= 0.5 or implicit >= 0.75
  substantive   mention, and centrality >= 0.25
The stance of a bill is the mean Jev stance score (0 against, 1 in favor) over its substantive pairs.
The position of a party (or the Executive) on a bill is the mean of what its substantive news
attribute to it: in favor +1, against -1, neutral or divided 0; news that don't mention it are skipped.

Only public fields go in (bill number, name, type, dates, status and counts): no article text.
Writes private_visuals/output/graph/bills.js.

Usage: python private_visuals/graph/build_graph.py [--neighbors 5] [--resolution 0.6]
"""
import argparse
import csv
import json
import math
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

import networkx as nx
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RUN_DIR = ROOT / "results" / "jev" / "corpus"
DB_PATH = ROOT / "databases" / "private_corpus.db"
EMBEDDINGS_PATH = ROOT / "databases" / "embeddings" / "qwen3-0.6b" / "bills_exposition.npz"
OUT_PATH = ROOT / "private_visuals" / "output" / "graph" / "bills.js"

SEED = 7
TOPIC_COLORS = 8      # size of the categorical palette on the page
TOPIC_NAME_WORDS = 3  # descriptors in a topic name
# Jev detail questions on what a news item says each actor thinks of the bill.
ACTORS = ["pueblo_soberano", "liberacion_nacional", "frente_amplio", "unidad_social_cristiana",
          "agenda_ciudadana", "executive"]
FAVOR = {"in_favor": 1, "strongly_in_favor": 1, "against": -1, "strongly_against": -1, "neutral_or_divided": 0}


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
  """bill -> coverage counts and mean stance, from the gate and detail stages of the corpus run."""
  centrality, stance, attributed = {}, {}, defaultdict(dict)
  with open(RUN_DIR / "details.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
      if not row["bill"]:
        continue
      key = (row["news_id"], int(row["bill"]))
      if row["question"] in ACTORS:
        if row["choice"] in FAVOR:
          attributed[key][row["question"]] = FAVOR[row["choice"]]
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
  with open(RUN_DIR / "gate.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
      if row["match"] != "1" or not is_mention(float(row["explicit"]), float(row["implicit"])):
        continue
      key = (row["news_id"], int(row["bill"]))
      bill = coverage[key[1]]
      bill["mention"] += 1
      pairs["mention"] += 1
      if centrality.get(key, 0) < 0.25:
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
  return coverage, pairs


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--neighbors", type=int, default=5, help="similar bills each bill is linked to")
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

  coverage, pairs = load_coverage(con)
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
    ])
  links = [[i, j, round(d["weight"] * 100)] for i, j, d in graph.edges(data=True)]

  data = {
    "meta": {"as_of": as_of, "neighbors": args.neighbors, "resolution": args.resolution,
             "embeddings": "qwen3-0.6b / exposition",
             "modularity": round(nx.community.modularity(graph, communities, weight="weight"), 3)},
    "fields": ["number", "name", "type", "date", "status", "law", "topic", "mention", "substantive",
               "main", "outlets", "stance", "x", "y", "positions"],
    "actors": ACTORS,
    "types": types,
    "statuses": statuses,
    "topics": topics,
    "nodes": nodes,
    "links": links,
  }
  OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
  payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
  OUT_PATH.write_text(f"window.GRAPH_BILLS = {payload};\n", encoding="utf-8")

  covered = [n for n in nodes if n[8]]
  stance_values = sorted(n[11] for n in covered if n[11] is not None)
  quantile = lambda q: stance_values[int(q * (len(stance_values) - 1))]
  print(f"bills {len(nodes)}, links {len(links)}, topics {len(topics)} (modularity {data['meta']['modularity']})")
  print(f"pairs: mention {pairs['mention']}, substantive {pairs['substantive']}; "
        f"bills: mention {sum(1 for n in nodes if n[7])}, substantive {len(covered)}")
  print(f"stance (0-100) over {len(stance_values)} bills: min {stance_values[0]}, p10 {quantile(0.1)}, "
        f"p25 {quantile(0.25)}, median {quantile(0.5)}, p75 {quantile(0.75)}, p90 {quantile(0.9)}, max {stance_values[-1]}")
  for a, actor in enumerate(ACTORS):
    print(f"  position of {actor}: {sum(1 for n in nodes if any(p[0] == a for p in n[14]))} bills")
  for t in topics:
    print(f"  {t['size']:>4}  color {t['color']}  {t['name']}")
  print(f"{OUT_PATH.stat().st_size / 1e6:.1f} MB -> {OUT_PATH}")


if __name__ == "__main__":
  main()
