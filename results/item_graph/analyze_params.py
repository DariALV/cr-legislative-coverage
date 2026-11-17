"""Analysis to pick the parameters of the per-item similarity graph on the site's pages (#71).

Every published bill page and news page (site/src/data/bills.json and news.json) gets a small tree of
the most related items of its own kind, built best-first from the page's item A:

  edges     each item's k most similar items of the pool (k = 10), both directions, kept only when the
            cosine reaches the floor. The pool is the published items, so every node has a page to open.
  entry     at each step the candidate with the best  w * sim(edge) + (1 - w) * sim(Y, A)  joins, where
            sim(edge) is its best edge to a node already in the tree. Nothing else joins once the cap
            is reached or no candidate is left above the floor.
  parent    Y hangs from the node P already in the tree, linked to Y, that maximizes  a^depth(P) * sim(Y, P).
  copies    a news candidate with cosine >= --duplicate to a node already in the tree (A included) is
            skipped as the same story told twice.

Because the order of entry does not depend on the cap, the tree with cap N is the first N entries of the
tree with any larger cap.

For each a and w it reports, averaged over the pages: nodes reached, mean and max depth, nodes hanging
from A, leaves, and the drift (mean and minimum sim(node, A)). It also prints the cosine distribution
used to set the floor and the duplicate threshold, and saves example trees.

Embeddings: bills with qwen3-0.6b exposition vectors (bills_exposition.npz, the name when there is no
exposition), news with the token-weighted mean of their qwen3 chunks without boilerplate
(news_pooled.npz, made by private_visuals/graph/build_news.py).

Writes results/item_graph/: similarity.json, params.csv, examples.json.
Usage: python results/item_graph/analyze_params.py [--floors-bills 0.55 0.6] [--floors-news 0.65 0.7] [--cap 50]
"""
import argparse
import csv
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from export_item_graphs import adjacency, build_tree, neighbor_lists   # the algorithm the site uses
DATA_DIR = ROOT / "site" / "src" / "data"
EMBEDDINGS_DIR = ROOT / "databases" / "embeddings" / "qwen3-0.6b"
OUT_DIR = Path(__file__).resolve().parent

A_VALUES = [0.85, 0.9, 0.95, 1.0]
W_VALUES = [0.5, 0.7, 0.9, 1.0]   # 1.0 is plain best-edge growth, as a reference for the drift
K = 10
QUANTILES = [1, 5, 10, 25, 50, 75, 90, 95, 99]


def load_bills():
  bills = json.loads((DATA_DIR / "bills.json").read_text(encoding="utf-8"))
  data = np.load(EMBEDDINGS_DIR / "bills_exposition.npz", allow_pickle=True)
  row_of = {int(n): i for i, n in enumerate(data["numbers"])}
  vectors = data["vectors"][[row_of[b["number"]] for b in bills]].astype(np.float32)
  items = [{"id": b["number"], "label": " ".join(b["name"].split()),
            "group": "with_news" if b["news_count"] else "activity_only"} for b in bills]
  return items, vectors


def load_news():
  news = json.loads((DATA_DIR / "news.json").read_text(encoding="utf-8"))
  data = np.load(EMBEDDINGS_DIR / "news_pooled.npz", allow_pickle=False)
  row_of = {news_id: i for i, news_id in enumerate(data["news_ids"].tolist())}
  vectors = data["vectors"][[row_of[n["id"]] for n in news]].astype(np.float32)
  items = [{"id": n["id"], "label": " ".join(n["title"].split()), "group": n["organization"],
            "date": n["date_published"][:10]} for n in news]
  return items, vectors


def quantiles(values):
  return {f"p{q}": round(float(np.percentile(values, q)), 3) for q in QUANTILES}


def tree_metrics(nodes, parents, depths, sim, cap):
  """Metrics of the first cap nodes after the root (a prefix is the tree with that cap)."""
  nodes, parents, depths = nodes[:cap + 1], parents[:cap + 1], depths[:cap + 1]
  if len(nodes) == 1:
    return {"nodes": 0, "depth_mean": 0, "depth_max": 0, "from_root": 0, "leaves": 0,
            "sim_root_mean": np.nan, "sim_root_min": np.nan, "edge_mean": np.nan}
  root = nodes[0]
  children = set(parents[1:].tolist())
  rest = nodes[1:]
  return {
    "nodes": len(rest),
    "depth_mean": float(depths[1:].mean()),
    "depth_max": int(depths.max()),
    "from_root": int((parents[1:] == root).sum()),
    "leaves": int(sum(1 for x in rest.tolist() if x not in children)),
    "sim_root_mean": float(sim[root, rest].mean()),
    "sim_root_min": float(sim[root, rest].min()),
    "edge_mean": float(sim[rest, parents[1:]].mean()),
  }


def describe(kind, items, sim, top):
  """Cosine distribution of the pool: all pairs, the 1st and k-th neighbor, and near copies."""
  upper = sim[np.triu_indices(len(sim), 1)]
  first = sim[np.arange(len(sim)), top[:, 0]]
  kth = sim[np.arange(len(sim)), top[:, -1]]
  listed = sim[np.arange(len(sim))[:, None], top].ravel()
  copies = {str(t): int((upper >= t).sum()) for t in (0.95, 0.97, 0.98, 0.99)}
  report = {"items": len(items), "all_pairs": quantiles(upper), "nearest": quantiles(first),
            f"neighbor_{K}": quantiles(kth), f"top_{K}_links": quantiles(listed), "pairs_at_or_above": copies}
  print(f"\n{kind}: {len(items):,} items")
  for key in ("all_pairs", "nearest", f"neighbor_{K}"):
    print(f"  {key:12s} " + "  ".join(f"{k} {v:.3f}" for k, v in report[key].items()))
  print(f"  pairs at or above: {copies}")
  # The closest pairs, to see whether they are copies of one story.
  i, j = np.triu_indices(len(sim), 1)
  best = np.argsort(-upper)[:8]
  report["closest_pairs"] = [[items[i[b]]["id"], items[j[b]]["id"], round(float(upper[b]), 4),
                              items[i[b]]["label"][:90], items[j[b]]["label"][:90]] for b in best]
  for p in report["closest_pairs"]:
    print(f"    {p[2]:.4f}  {p[3][:60]} | {p[4][:60]}")
  return report


def sweep(kind, items, sim, links, floor, cap, duplicate, writer, examples, example_ids):
  started = time.time()
  groups = sorted({it["group"] for it in items})
  for a in A_VALUES:
    for w in W_VALUES:
      rows = []
      for root in range(len(items)):
        nodes, parents, depths, skipped = build_tree(root, sim, links, a, w, cap, duplicate)
        m = tree_metrics(nodes, parents, depths, sim, cap)
        m["skipped"] = skipped
        m["full_cap"] = int(len(nodes) - 1 >= cap)
        m["reach_max"] = len(nodes) - 1
        rows.append((items[root]["group"], m))
        if items[root]["id"] in example_ids:
          examples.setdefault(str(items[root]["id"]), {"kind": kind, "root": items[root], "trees": {}})
          examples[str(items[root]["id"])]["trees"][f"floor={floor} a={a} w={w}"] = [
            [items[x]["id"], items[p]["id"] if p >= 0 else None, int(d), round(float(sim[nodes[0], x]), 3),
             round(float(sim[x, p]), 3) if p >= 0 else None]
            for x, p, d in zip(nodes.tolist(), parents.tolist(), depths.tolist())]
      for group in ["all"] + groups:
        chosen = [m for g, m in rows if group == "all" or g == group]
        out = {"kind": kind, "group": group, "pages": len(chosen), "floor": floor, "a": a, "w": w, "cap": cap}
        for key in ("nodes", "full_cap", "depth_mean", "depth_max", "from_root", "leaves",
                    "sim_root_mean", "sim_root_min", "edge_mean", "skipped", "reach_max"):
          out[key] = round(float(np.nanmean([m[key] for m in chosen])), 3)
        writer.writerow(out)
      allm = [m for _, m in rows]
      print(f"  floor {floor} a={a:<4} w={w:<3}  nodes {np.mean([m['nodes'] for m in allm]):5.1f}  "
            f"full {np.mean([m['full_cap'] for m in allm]):.2f}  depth {np.mean([m['depth_mean'] for m in allm]):4.2f} "
            f"(max {np.mean([m['depth_max'] for m in allm]):4.1f})  from A {np.mean([m['from_root'] for m in allm]):5.1f}  "
            f"sim A {np.nanmean([m['sim_root_mean'] for m in allm]):.3f} (min {np.nanmean([m['sim_root_min'] for m in allm]):.3f})  "
            f"skipped {np.mean([m['skipped'] for m in allm]):.1f}", flush=True)
  print(f"  {time.time() - started:.0f} s")


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--floors-bills", type=float, nargs="+", default=[0.55, 0.6],
                      help="cosines below which two bills are not linked (one sweep each)")
  parser.add_argument("--floors-news", type=float, nargs="+", default=[0.65, 0.7],
                      help="cosines below which two news items are not linked (one sweep each)")
  parser.add_argument("--duplicate", type=float, default=0.97, help="cosine from which two news items count as one story")
  parser.add_argument("--cap", type=int, default=50, help="nodes besides the page's item")
  parser.add_argument("--examples", type=int, default=4, help="example pages per kind and group")
  parser.add_argument("--describe-only", action="store_true", help="print the cosine distributions and stop")
  args = parser.parse_args()

  rng = np.random.default_rng(7)
  report, examples = {}, {}
  with open(OUT_DIR / "params.csv", "w", newline="", encoding="utf-8") as f:
    writer = None
    for kind, loader, floors, duplicate in (("bills", load_bills, args.floors_bills, None),
                                            ("news", load_news, args.floors_news, args.duplicate)):
      items, vectors = loader()
      unit = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
      sim = unit @ unit.T
      top = neighbor_lists(sim, K)
      report[kind] = describe(kind, items, sim, top)
      if args.describe_only:
        continue
      # Example pages: drawn among those with a link at the highest floor, so they have a tree at every floor.
      top_links = adjacency(sim, top, max(floors))
      groups = sorted({it["group"] for it in items})
      example_ids = set()
      for group in groups:
        members = [i for i, it in enumerate(items) if it["group"] == group and len(top_links[i]) > 0]
        n = args.examples if kind == "bills" else 1
        example_ids |= {items[i]["id"] for i in rng.choice(members, size=min(n, len(members)), replace=False)}
      if writer is None:
        writer = csv.DictWriter(f, fieldnames=["kind", "group", "pages", "floor", "a", "w", "cap", "nodes",
                                               "full_cap", "depth_mean", "depth_max", "from_root", "leaves",
                                               "sim_root_mean", "sim_root_min", "edge_mean", "skipped", "reach_max"])
        writer.writeheader()
      report[kind]["floors"] = {}
      for floor in floors:
        links = adjacency(sim, top, floor)
        degree = np.array([len(l) for l in links])
        report[kind]["floors"][str(floor)] = {"links": int(degree.sum() // 2), "isolated": int((degree == 0).sum()),
                                              "degree_p50": float(np.median(degree))}
        print(f"  floor {floor}: {degree.sum() // 2:,} links, {int((degree == 0).sum())} items without any, "
              f"degree p50 {np.median(degree):.0f}, p90 {np.percentile(degree, 90):.0f}")
        sweep(kind, items, sim, links, floor, args.cap, duplicate, writer, examples, example_ids)
      for key, ex in examples.items():
        if ex["kind"] == kind:
          ids = {node[0] for tree in ex["trees"].values() for node in tree}
          ex["labels"] = {str(it["id"]): it["label"][:120] for it in items if it["id"] in ids}

  report["settings"] = {"k": K, "cap": args.cap, "duplicate": args.duplicate,
                        "a": A_VALUES, "w": W_VALUES}
  (OUT_DIR / "similarity.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
  if not args.describe_only:
    (OUT_DIR / "examples.json").write_text(json.dumps(examples, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
  main()
