"""
Exports the per-item similarity graph of every bill and news page of the site (#71) to site/public/grafos/.

  python export_item_graphs.py [--data site/src/data] [--embeddings databases/embeddings/qwen3-0.6b]
                               [--out site/public/grafos]

Run it after export_public.py: the pool is what that export published (bills.json and news.json), so every
node of a graph has a page to open. Bills are compared with bills and news with news.

How a page's tree is built, from its own item A (parameters chosen in results/item_graph/, see its README):
  edges     each item's K most similar items of the pool, in both directions, kept only when the cosine
            reaches the floor of its kind
  entry     the candidate with the best  w * sim(edge) + (1 - w) * sim(Y, A)  joins next, where sim(edge) is
            its best edge to a node already in the tree, until MAX_NODES nodes or no candidate is left
  parent    Y hangs from the node P already in the tree, linked to Y, that maximizes  a^depth(P) * sim(Y, P)
  copies    a news candidate with cosine >= DUPLICATE to a node already in the tree is skipped (the same
            story told twice); bills with the same text are different bills and stay
The order of entry does not depend on the cap, so a page that shows N nodes takes the first N rows.

Embeddings: bills with their whole exposition (bills_exposition.npz; the name when there is none), news with
the mean of their chunks without boilerplate (news_pooled.npz, made by private_visuals/graph/build_news.py).

Writes, after emptying the output folder:
  expedientes.json      index of the bills: {"fields", "items", "params"}, one item per published bill
                        (number, name cut at NAME_MAX_CHARS, status)
  noticias.json         index of the news items (id, title, outlet, date)
  expediente/<n>.json   the graph of a page: {"nodes": rows, "links": flat list}. Rows are
  noticia/<id>.json     the tree, one per node in order of entry, the page's own item first: [position in the
                        index, position of the parent row (-1 for A), cosine to A x 100, cosine to the parent
                        x 100 (0 for A)].
                        Links are the pairs of nodes of the tree that are each among the other's LOOP_RANK most
                        similar items (tree edges included), as row, row, cosine x 100, row, row, cosine...: the
                        page shows those that are not tree edges as loops. Asking both sides to agree keeps
                        them sparse (all the k nearest made a mesh of about ten links per node, too cluttered).
Pages whose item has no neighbor above the floor get no file. Only public fields and scores go in.
"""
import argparse
import json
import shutil
from pathlib import Path

import numpy as np

K = 10                 # neighbors listed per item
A_DEPTH = 1.0          # discount per level of the parent: 1 hangs each node from its most similar node (chains);
                       # lower keeps nodes closer to A (stars). The analysis chose 0.9; the user chose 1 on the site
W_EDGE = 0.5           # weight of the edge against the similarity to A in the entry score
FLOORS = {"bills": 0.55, "news": 0.65}
DUPLICATE = 0.97       # news only
MAX_NODES = 150        # besides A
LOOP_RANK = 2          # loops: both nodes among each other's this many most similar items
NAME_MAX_CHARS = 140


def neighbor_lists(sim, k):
  """Each row's k most similar other rows, best first."""
  s = sim.copy()
  np.fill_diagonal(s, -np.inf)
  top = np.argpartition(-s, k, axis = 1)[:, :k]
  order = np.argsort(-np.take_along_axis(s, top, axis = 1), axis = 1)
  return np.take_along_axis(top, order, axis = 1)


def adjacency(sim, top, floor):
  """Undirected k-nearest links that reach the floor, as one array of neighbors per item."""
  links = [set() for _ in range(len(sim))]
  for i, row in enumerate(top):
    for j in row:
      if sim[i, j] >= floor:
        links[i].add(int(j))
        links[int(j)].add(i)
  return [np.array(sorted(l), dtype = np.int64) for l in links]


def build_tree(root, sim, links, a, w, cap, duplicate):
  """Best-first tree from root. Returns the nodes in order of entry with their parent and depth, and
  how many candidates were skipped as copies."""
  n = len(sim)
  in_tree = np.zeros(n, dtype = bool)
  blocked = np.zeros(n, dtype = bool)
  best_edge = np.full(n, -np.inf)
  to_root = sim[root]
  nodes, parents, depths = [root], [-1], [0]
  depth_of = {root: 0}
  in_tree[root] = True
  skipped = 0

  def reach(node):
    nb = links[node]
    nb = nb[~in_tree[nb]]
    best_edge[nb] = np.maximum(best_edge[nb], sim[node, nb])

  reach(root)
  while len(nodes) <= cap:   # the root plus cap nodes
    score = w * best_edge + (1 - w) * to_root
    score[in_tree | blocked] = -np.inf
    y = int(np.argmax(score))
    if not np.isfinite(score[y]):
      break
    if duplicate is not None and sim[y, nodes].max() >= duplicate:
      blocked[y] = True
      skipped += 1
      continue
    present = links[y][in_tree[links[y]]]
    weights = np.array([a ** depth_of[int(p)] for p in present]) * sim[y, present]
    parent = int(present[np.argmax(weights)])
    in_tree[y] = True
    depth_of[y] = depth_of[parent] + 1
    nodes.append(y)
    parents.append(parent)
    depths.append(depth_of[y])
    reach(y)
  return np.array(nodes), np.array(parents), np.array(depths), skipped


def unit_rows(vectors):
  vectors = vectors.astype(np.float32)
  return vectors / np.linalg.norm(vectors, axis = 1, keepdims = True)


def short(text, limit):
  """Whitespace collapsed and cut at a word before limit characters, with an ellipsis."""
  text = " ".join(text.split())
  if len(text) <= limit:
    return text
  return text[:limit].rsplit(" ", 1)[0].rstrip(",;:.") + "…"


def load_bills(data_dir, embeddings_dir):
  bills = json.loads((data_dir / "bills.json").read_text(encoding = "utf-8"))
  data = np.load(embeddings_dir / "bills_exposition.npz", allow_pickle = True)
  row_of = {int(n): i for i, n in enumerate(data["numbers"])}
  missing = [b["number"] for b in bills if b["number"] not in row_of]
  if missing:
    raise SystemExit(f"{len(missing)} published bills have no embedding, e.g. {missing[:5]}: embed them first")
  ids = [str(b["number"]) for b in bills]
  index = [[b["number"], short(b["name"], NAME_MAX_CHARS), b["status"]] for b in bills]
  return ids, index, unit_rows(data["vectors"][[row_of[b["number"]] for b in bills]])


def load_news(data_dir, embeddings_dir):
  news = json.loads((data_dir / "news.json").read_text(encoding = "utf-8"))
  path = embeddings_dir / "news_pooled.npz"
  if not path.exists():
    raise SystemExit(f"{path} not found: run private_visuals/graph/build_news.py once to build it")
  data = np.load(path, allow_pickle = False)
  row_of = {news_id: i for i, news_id in enumerate(data["news_ids"].tolist())}
  missing = [n["id"] for n in news if n["id"] not in row_of]
  if missing:
    raise SystemExit(f"{len(missing)} published news items are not in {path.name}: run build_news.py --refresh")
  ids = [n["id"] for n in news]
  index = [[n["id"], " ".join(n["title"].split()), n["organization"], n["date_published"][:10]] for n in news]
  return ids, index, unit_rows(data["vectors"][[row_of[n["id"]] for n in news]])


def write_json(path, data):
  path.write_text(json.dumps(data, ensure_ascii = False, separators = (",", ":")), encoding = "utf-8")


def export_kind(kind, ids, index, unit, out, index_name, page_dir, fields):
  sim = unit @ unit.T
  top = neighbor_lists(sim, K)
  links = adjacency(sim, top, FLOORS[kind])
  close = {(i, int(j)) for i, row in enumerate(top) for j in row[:LOOP_RANK] if sim[i, j] >= FLOORS[kind]}
  mutual = {pair for pair in close if pair[::-1] in close}
  duplicate = DUPLICATE if kind == "news" else None
  params = {"k": K, "a": A_DEPTH, "w": W_EDGE, "floor": FLOORS[kind], "max_nodes": MAX_NODES,
            "duplicate": duplicate, "loop_rank": LOOP_RANK}
  write_json(out / index_name, {"fields": fields, "items": index, "params": params})
  (out / page_dir).mkdir()
  sizes, skipped_total, loops_total = [], 0, 0
  for root, item_id in enumerate(ids):
    nodes, parents, _, skipped = build_tree(root, sim, links, A_DEPTH, W_EDGE, MAX_NODES, duplicate)
    skipped_total += skipped
    sizes.append(len(nodes) - 1)
    if len(nodes) == 1:
      continue
    row_of = {int(node): pos for pos, node in enumerate(nodes)}
    rows = [[int(nodes[0]), -1, 100, 0]]
    for node, parent in zip(nodes[1:].tolist(), parents[1:].tolist()):
      rows.append([node, row_of[parent], round(float(sim[root, node]) * 100), round(float(sim[node, parent]) * 100)])
    tree_edges = {(min(a, b), max(a, b)) for a, b in zip(nodes[1:].tolist(), parents[1:].tolist())}
    loops = []
    for a, b in sorted(mutual):
      if a < b and a in row_of and b in row_of:
        loops += [row_of[a], row_of[b], round(float(sim[a, b]) * 100)]
        loops_total += (a, b) not in tree_edges
    write_json(out / page_dir / f"{item_id}.json", {"nodes": rows, "links": loops})
  sizes = np.array(sizes)
  folder_bytes = sum(p.stat().st_size for p in (out / page_dir).iterdir())
  print(f"{kind}: {len(ids):,} pages, {int((sizes > 0).sum()):,} with a tree, {int((sizes == 0).sum())} without; "
        f"{np.mean(sizes >= 50):.0%} reach 50 nodes, {np.mean(sizes >= MAX_NODES):.0%} reach {MAX_NODES}; "
        f"{skipped_total:,} copies skipped; {loops_total / max(1, int((sizes > 0).sum())):.0f} loops per graph; "
        f"index {(out / index_name).stat().st_size / 1e3:.0f} kB, "
        f"trees {folder_bytes / 1e6:.1f} MB")


def export(data_dir, embeddings_dir, out):
  if out.exists():
    shutil.rmtree(out)
  out.mkdir(parents = True)
  ids, index, unit = load_bills(data_dir, embeddings_dir)
  export_kind("bills", ids, index, unit, out, "expedientes.json", "expediente", ["number", "name", "status"])
  ids, index, unit = load_news(data_dir, embeddings_dir)
  export_kind("news", ids, index, unit, out, "noticias.json", "noticia", ["id", "title", "outlet", "date"])


if __name__ == "__main__":
  parser = argparse.ArgumentParser(description = "Export the per-item similarity graph of every page of the site.")
  parser.add_argument("--data", type = Path, default = Path("site/src/data"),
                      help = "folder with the published bills.json and news.json (from export_public.py)")
  parser.add_argument("--embeddings", type = Path, default = Path("databases/embeddings/qwen3-0.6b"),
                      help = "folder with bills_exposition.npz and news_pooled.npz")
  parser.add_argument("--out", type = Path, default = Path("site/public/grafos"), help = "output folder (emptied first)")
  arguments = parser.parse_args()
  export(arguments.data, arguments.embeddings, arguments.out)
