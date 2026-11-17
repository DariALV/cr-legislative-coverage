"""Backend of the graph pages' tree tabs (tree.html, #71): the similarity tree of the site's bill and news pages,
built from any root, pool and parameters, with the same algorithm as the site (export_item_graphs.build_tree).

Mounted by private_visuals/server.py under /graph/api/tree/:

  index?kind=bills|news&pool=<pool>
      the items of a pool, {"fields", "items", "pools", "defaults"}. Pools: bills "published" (what the site shows)
      and "all" (the 5,898 bills of the corpus); news "published", "coverage" (substantive coverage of a bill),
      "assembly" (pass Jev's Assembly filter) and "all" (the 29,875 news items of the corpus).
  build?kind=&pool=&root=<id>&k=&floor=&w=&a=&duplicate=&cap=
      the tree: {"rows", "cands", "loops", "skipped", "ms"}. Rows are the nodes in order of entry, the root first:
      [position in the pool, row of the parent (-1 for the root), cosine to the root, cosine to the parent].
      Cands, one flat list per row, are the earlier rows it is linked to and their cosine (row, cos, row, cos...):
      the page chooses parents again with its own depth discount without asking the server (the order of entry
      does not depend on the discount). Loops are row, row, cosine, rank for the pairs of nodes that are each among
      the other's LOOP_MAX most similar items and reach the floor; rank is the larger of the two ranks (1 = each
      is the other's most similar), so the page keeps the pairs up to the rank it wants (the site uses 2).

Each pool's vectors and k nearest neighbors (up to K_MAX) load on the first request that needs them and stay in
memory; the nearest neighbors of all the news take a while the first time. Pools up to FULL_MAX items keep their
whole similarity matrix (as the export does, so the published pools give the site's trees exactly); larger ones
(all the news) read similarities from the links (SparseSimilarity), which is what lets a tree take the whole pool. Only public fields go out (ids, titles, names, outlets, dates, scores).
"""
import heapq
import importlib.util
import json
import sqlite3
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
EMBEDDINGS = ROOT / "databases" / "embeddings" / "qwen3-0.6b"
SITE_DATA = ROOT / "site" / "src" / "data"
NEWS_GRAPH = HERE.parent / "output" / "graph" / "news.js"   # build_news.py: titles, outlets, genres, bills
DATABASE = ROOT / "databases" / "private_corpus.db"

K_MAX = 50        # nearest neighbors kept per item: the page's K goes up to this
LOOP_MAX = 5      # loops are sent up to this rank
CAP_MAX = 30000   # most nodes in a tree, besides the root: the whole of any pool
BLOCK = 1024      # rows per block when finding the nearest neighbors
# Pools up to this size keep their whole similarity matrix, computed as the export does (unit @ unit.T): rows
# computed one by one round differently, and that breaks exact ties (bills with the same text) another way.
FULL_MAX = 8000
STATUS_LABELS = {"in progress": "En trámite", "archived": "Archivado", "law": "Convertido en ley"}


def load_export():
  spec = importlib.util.spec_from_file_location("export_item_graphs", ROOT / "export_item_graphs.py")
  module = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(module)
  return module


export = load_export()
DEFAULTS = {
  kind: {"k": export.K, "floor": export.FLOORS[kind], "w": export.W_EDGE, "a": export.A_DEPTH,
         "duplicate": export.DUPLICATE if kind == "news" else None, "cap": export.MAX_NODES,
         "loop_rank": export.LOOP_RANK, "k_max": K_MAX, "loop_max": LOOP_MAX, "cap_max": CAP_MAX}
  for kind in ("bills", "news")
}
POOLS = {"bills": ["published", "all"], "news": ["published", "coverage", "assembly", "all"]}


class FullSimilarity:
  """The pool's whole similarity matrix, as build_tree indexes it (sim[i], sim[i, js], len(sim))."""

  def __init__(self, full):
    self.full = full

  def __len__(self):
    return len(self.full)

  def __getitem__(self, key):
    if isinstance(key, tuple):
      i, j = key
      return self.full[int(i)][j]
    return self.full[int(key)]


class SparseSimilarity:
  """For pools too big for their matrix: the root's row, computed, and every other similarity read from the
  links (the k nearest above the floor, the only pairs build_tree looks at besides the copies check); pairs
  that are not linked read as -inf. So the copies check only sees linked copies: a copy of a node of the tree
  that is not among either one's k nearest would get in (unlikely: a copy is about the nearest there is)."""

  def __init__(self, unit, root, links, link_cos):
    self.n, self.root, self.links, self.link_cos = len(unit), root, links, link_cos
    self.root_row = unit @ unit[root]

  def __len__(self):
    return self.n

  def __getitem__(self, key):
    if not isinstance(key, tuple):
      assert int(key) == self.root
      return self.root_row
    i, js = key
    i = int(i)
    if i == self.root:
      return self.root_row[js]
    scalar = np.ndim(js) == 0
    js = np.atleast_1d(np.asarray(js, dtype = np.int64))
    neighbors = self.links[i]
    out = np.full(len(js), -np.inf, dtype = np.float32)
    if len(neighbors):
      at = np.minimum(np.searchsorted(neighbors, js), len(neighbors) - 1)
      hit = neighbors[at] == js
      out[hit] = self.link_cos[i][at[hit]]
    out[js == self.root] = self.root_row[i]
    return out[0] if scalar else out


def build_tree_heap(root, sim, links, a, w, cap, duplicate):
  """export_item_graphs.build_tree for a SparseSimilarity, with a priority queue instead of a full argmax per
  step, so a tree of the 29,875 news takes seconds instead of half a minute. Same result: the same scores in the
  same float arithmetic, ties to the lowest index as argmax does, and the copies check over the linked nodes of
  the tree, which is all a SparseSimilarity knows. Checked against build_tree in check_heap() below."""
  n = len(sim)
  in_tree = np.zeros(n, dtype = bool)
  blocked = np.zeros(n, dtype = bool)
  best_edge = np.full(n, -np.inf)
  to_root = sim[root]
  root_term = (1 - w) * to_root   # the same arithmetic as build_tree's score
  nodes, parents, depths = [root], [-1], [0]
  depth_of = {root: 0}
  in_tree[root] = True
  skipped = 0
  queue = []

  def score(j):
    return w * best_edge[j] + root_term[j]

  def reach(node):
    nb = links[node]
    nb = nb[~in_tree[nb]]
    if not len(nb):
      return
    new = np.maximum(best_edge[nb], sim[node, nb])
    grew = new > best_edge[nb]
    best_edge[nb] = new
    for j in nb[grew].tolist():
      heapq.heappush(queue, (-score(j), j))

  reach(root)
  while len(nodes) <= cap:
    y = None
    while queue:
      negative, j = heapq.heappop(queue)
      if not in_tree[j] and not blocked[j] and -negative == score(j):
        y = j
        break
    if y is None:
      break
    present = links[y][in_tree[links[y]]]
    if duplicate is not None:
      closest = max(float(to_root[y]), float(sim[y, present].max()) if len(present) else -np.inf)
      if closest >= duplicate:
        blocked[y] = True
        skipped += 1
        continue
    weights = np.array([a ** depth_of[int(p)] for p in present]) * sim[y, present]
    parent = int(present[np.argmax(weights)])
    in_tree[y] = True
    depth_of[y] = depth_of[parent] + 1
    nodes.append(y)
    parents.append(parent)
    depths.append(depth_of[y])
    reach(y)
  return np.array(nodes), np.array(parents), np.array(depths), skipped


def check_heap(api, kind = "news", pool = "published", roots = 100):
  """build_tree_heap gives build_tree's trees on a SparseSimilarity (run by hand when either changes)."""
  p = api.pool(kind, pool)
  d = DEFAULTS[kind]
  links, link_cos = p.adjacency(d["k"], d["floor"])
  same = 0
  for root in range(0, len(p.ids), max(1, len(p.ids) // roots))[:roots]:
    sim = SparseSimilarity(p.unit, root, links, link_cos)
    one = export.build_tree(root, sim, links, d["a"], d["w"], 500, d["duplicate"])
    two = build_tree_heap(root, sim, links, d["a"], d["w"], 500, d["duplicate"])
    same += all(np.array_equal(x, y) for x, y in zip(one[:3], two[:3])) and one[3] == two[3]
  return same, roots


def nearest(unit, k, full = None):
  """Each row's k most similar other rows, best first, with their cosines."""
  n = len(unit)
  index = np.empty((n, k), dtype = np.int32)
  value = np.empty((n, k), dtype = np.float32)
  for start in range(0, n, BLOCK):
    block = full[start:start + BLOCK].copy() if full is not None else unit[start:start + BLOCK] @ unit.T
    block[np.arange(len(block)), np.arange(start, start + len(block))] = -np.inf
    top = np.argpartition(-block, k, axis = 1)[:, :k]
    cos = np.take_along_axis(block, top, axis = 1)
    order = np.argsort(-cos, axis = 1)
    index[start:start + BLOCK] = np.take_along_axis(top, order, axis = 1)
    value[start:start + BLOCK] = np.take_along_axis(cos, order, axis = 1)
  return index, value


class Pool:
  def __init__(self, kind, name, ids, fields, items, unit):
    self.kind, self.name, self.ids, self.fields, self.items = kind, name, ids, fields, items
    self.position = {item_id: i for i, item_id in enumerate(ids)}
    self.unit = unit
    started = time.time()
    self.full = unit @ unit.T if len(ids) <= FULL_MAX else None   # 8,000 items: 256 MB
    self.top, self.top_cos = nearest(unit, min(K_MAX, len(ids) - 1), self.full)
    self.adjacency_cache = {}
    self.index_bytes = None
    print(f"Árbol: {kind}/{name}, {len(ids):,} elementos, vecinos en {time.time() - started:.1f} s", flush = True)

  def adjacency(self, k, floor):
    """export_item_graphs.adjacency for this pool, from the stored nearest neighbors: the undirected k-nearest
    links that reach the floor, one sorted array of neighbors per item, and their cosines alongside."""
    key = (k, round(floor, 4))
    if key not in self.adjacency_cache:
      n = len(self.ids)
      keep = self.top_cos[:, :k] >= floor
      source = np.repeat(np.arange(n), k).reshape(n, k)[keep]
      target = self.top[:, :k][keep].astype(np.int64)
      cos = self.top_cos[:, :k][keep]
      pairs, first = np.unique(np.concatenate([source * n + target, target * n + source]), return_index = True)
      pair_cos = np.concatenate([cos, cos])[first]
      starts = np.searchsorted(pairs // n, np.arange(n + 1))
      neighbors = pairs % n
      if len(self.adjacency_cache) > 12:
        self.adjacency_cache.clear()
      self.adjacency_cache[key] = ([neighbors[starts[i]:starts[i + 1]] for i in range(n)],
                                   [pair_cos[starts[i]:starts[i + 1]] for i in range(n)])
    return self.adjacency_cache[key]

  def index_json(self):
    if self.index_bytes is None:
      body = {"kind": self.kind, "pool": self.name, "fields": self.fields, "items": self.items,
              "pools": POOLS[self.kind], "defaults": DEFAULTS[self.kind]}
      self.index_bytes = json.dumps(body, ensure_ascii = False, separators = (",", ":")).encode("utf-8")
    return self.index_bytes

  def build(self, root_id, k, floor, w, a, duplicate, cap):
    started = time.time()
    root = self.position[root_id]
    links, link_cos = self.adjacency(k, floor)
    sim = FullSimilarity(self.full) if self.full is not None else SparseSimilarity(self.unit, root, links, link_cos)
    build = export.build_tree if self.full is not None else build_tree_heap
    nodes, parents, _, skipped = build(root, sim, links, a, w, cap, duplicate)
    built = time.time()
    nodes, parents = nodes.tolist(), parents.tolist()
    row_of = {node: pos for pos, node in enumerate(nodes)}
    to_root = sim[root]
    rows = [[root, -1, 1.0, 0.0]]
    cands = [[]]
    for pos in range(1, len(nodes)):
      node, parent = nodes[pos], parents[pos]
      neighbors = links[node]
      cos = sim[node, neighbors]
      rows.append([node, row_of[parent], round(float(to_root[node]), 4), round(float(sim[node, parent]), 4)])
      flat = []
      for other, c in zip(neighbors.tolist(), cos.tolist()):
        earlier = row_of.get(other)
        if earlier is not None and earlier < pos:
          flat += [earlier, round(c, 4)]
      cands.append(flat)
    # Loops: pairs of the tree that are each among the other's LOOP_MAX most similar and reach the floor.
    rank = {}
    for node in nodes:
      for r, (other, cos) in enumerate(zip(self.top[node, :LOOP_MAX].tolist(), self.top_cos[node, :LOOP_MAX].tolist())):
        if other in row_of and cos >= floor:
          rank[(node, other)] = (r + 1, cos)
    loops = []
    for (x, y), (r, cos) in rank.items():
      if x < y and (y, x) in rank:
        loops += [row_of[x], row_of[y], round(cos, 4), max(r, rank[(y, x)][0])]
    return {"rows": rows, "cands": cands, "loops": loops, "skipped": int(skipped), "exact": self.full is not None,
            "ms": round((time.time() - started) * 1000), "tree_ms": round((built - started) * 1000)}


# ---------- pools ----------

def unit_rows(vectors):
  vectors = vectors.astype(np.float32)
  return vectors / np.linalg.norm(vectors, axis = 1, keepdims = True)


def read_news_graph():
  text = NEWS_GRAPH.read_text(encoding = "utf-8")
  data = json.loads(text[text.index("{"):text.rindex("}") + 1])
  at = {f: i for i, f in enumerate(data["fields"])}
  return data, at


def news_count_by_bill():
  """Substantive news per bill in the whole corpus, from build_news.py's data."""
  if not NEWS_GRAPH.exists():
    return {}
  data, at = read_news_graph()
  counts = {}
  for row in data["nodes"]:
    for number, *_ in row[at["bills"]]:
      counts[number] = counts.get(number, 0) + 1
  return counts


def load_bills(name):
  published = {b["number"]: b for b in json.loads((SITE_DATA / "bills.json").read_text(encoding = "utf-8"))}
  data = np.load(EMBEDDINGS / "bills_exposition.npz", allow_pickle = True)
  row_of = {int(n): i for i, n in enumerate(data["numbers"])}
  news = news_count_by_bill()
  if name == "published":
    numbers = list(published)
    meta = {n: (b["name"], b["status"], b["file_type"], b["date_proposed"]) for n, b in published.items()}
  else:
    numbers = sorted(row_of)
    with sqlite3.connect(f"file:{DATABASE}?mode=ro", uri = True) as db:
      meta = {n: (nm, STATUS_LABELS.get(st, st or ""), ft or "", dp or "")
              for n, nm, st, ft, dp in db.execute("SELECT number, name, status, file_type, date_proposed FROM bills")}
  fields = ["id", "name", "status", "type", "date", "news", "votes", "published"]
  items = []
  for n in numbers:
    nm, status, file_type, date = meta.get(n, ("", "", "", ""))
    site = published.get(n)
    items.append([n, " ".join((nm or "").split())[:240], status, (file_type or "").replace("PROCEDIMIENTO ", "").capitalize(),
                  (date or "")[:10], news.get(n, 0), site["votes_count"] if site else None, int(site is not None)])
  unit = unit_rows(data["vectors"][[row_of[n] for n in numbers]])
  return Pool("bills", name, [str(n) for n in numbers], fields, items, unit)


def load_news(name):
  data, at = read_news_graph()
  # The site's order for its own pool, so that ties fall as in the export.
  site_order = [n["id"] for n in json.loads((SITE_DATA / "news.json").read_text(encoding = "utf-8"))]
  published = set(site_order)
  vectors = np.load(EMBEDDINGS / "news_pooled.npz", allow_pickle = False)
  row_of = {news_id: i for i, news_id in enumerate(vectors["news_ids"].tolist())}
  keep = {
    "published": lambda row: row[at["id"]] in published,
    "coverage": lambda row: len(row[at["bills"]]) > 0,
    "assembly": lambda row: bool(row[at["assembly"]]),
    "all": lambda row: True,
  }[name]
  rows = [row for row in data["nodes"] if keep(row) and row[at["id"]] in row_of]
  if name == "published":
    rank = {news_id: i for i, news_id in enumerate(site_order)}
    rows.sort(key = lambda row: rank[row[at["id"]]])
  fields = ["id", "title", "outlet", "date", "genre", "author", "bill", "stance", "assembly", "published", "url"]
  items = []
  for row in rows:
    bills = row[at["bills"]]
    genre = row[at["genre"]]
    author = row[at["author"]]
    items.append([row[at["id"]], " ".join(row[at["title"]].split()), data["outlets"][row[at["outlet"]]], row[at["date"]],
                  data["genres"][genre] if genre >= 0 else "", data["authors"][author] if author >= 0 else "",
                  bills[0][0] if bills else None, bills[0][2] if bills else None, int(row[at["assembly"]]),
                  int(row[at["id"]] in published), row[at["url"]]])
  unit = unit_rows(vectors["vectors"][[row_of[row[at["id"]]] for row in rows]])
  return Pool("news", name, [row[at["id"]] for row in rows], fields, items, unit)


class TreeApi:
  def __init__(self):
    self.pools = {}
    self.lock = threading.Lock()

  def pool(self, kind, name):
    if kind not in POOLS or name not in POOLS[kind]:
      raise ValueError(f"no such pool: {kind}/{name}")
    with self.lock:   # one load at a time; the others wait for it
      if (kind, name) not in self.pools:
        self.pools[(kind, name)] = (load_bills if kind == "bills" else load_news)(name)
      return self.pools[(kind, name)]

  def get(self, path, query):
    """(status, body) for /index and /build; body is bytes or a dict."""
    q = {key: values[-1] for key, values in parse_qs(query).items()}
    try:
      kind = q.get("kind", "bills")
      pool = self.pool(kind, q.get("pool", "published"))
      if path == "/index":
        return 200, pool.index_json()
      if path == "/build":
        root = q.get("root", "")
        if root not in pool.position:
          return 404, {"error": f"{root} no está en el conjunto «{pool.name}»"}
        d = DEFAULTS[kind]
        k = max(1, min(pool.top.shape[1], int(q.get("k", d["k"]))))
        floor = float(q.get("floor", d["floor"]))
        w = min(1.0, max(0.0, float(q.get("w", d["w"]))))
        a = min(1.0, max(0.01, float(q.get("a", d["a"]))))
        duplicate = q.get("duplicate", d["duplicate"])
        duplicate = float(duplicate) if duplicate not in (None, "", "none") else None
        cap = max(1, min(CAP_MAX, len(pool.ids) - 1, int(q.get("cap", d["cap"]))))
        return 200, pool.build(root, k, floor, w, a, duplicate, cap)
      return 404, {"error": "not found"}
    except (ValueError, FileNotFoundError, KeyError) as error:
      return 400, {"error": f"{type(error).__name__}: {error}"}
