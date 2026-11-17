"""Draws bill pairs by cosine band for a blind relatedness test (#71). Writes pairs.md (for the
raters, no similarities) and key.json (band and cosine of each pair) into OUT_DIR.

pairs.md carries the start of each exposition, so OUT_DIR goes outside the repository. The raters
see only pairs.md; their answers and the key end up, without texts, in relatedness_test.csv.
Usage: python results/item_graph/relatedness_pairs.py <repo root> <OUT_DIR>"""
import json, sqlite3, sys
from pathlib import Path
import numpy as np

ROOT = Path(sys.argv[1])
OUT = Path(sys.argv[2])
sys.path.insert(0, str(ROOT / "results" / "item_graph"))
import analyze_params as ap

EXCERPT = 2500
BANDS = [("A", 0.75, 0.97), ("B", 0.65, 0.75), ("C", 0.55, 0.65), ("D", 0.45, 0.55), ("E", None, None)]
PER_BAND = 8

items, vectors = ap.load_bills()
data = np.load(ROOT / "databases/embeddings/qwen3-0.6b/bills_exposition.npz", allow_pickle=True)
fallback = dict(zip(map(int, data["numbers"]), data["fallback"]))
unit = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
sim = unit @ unit.T
top = ap.neighbor_lists(sim, ap.K)
ok = np.array([not fallback[it["id"]] for it in items])
rng = np.random.default_rng(11)

listed = {(min(i, int(j)), max(i, int(j))) for i, row in enumerate(top) for j in row}
listed = [p for p in listed if ok[p[0]] and ok[p[1]]]
chosen, used = [], set()
for band, lo, hi in BANDS:
  if lo is None:   # random pairs of the pool
    pool = []
    while len(pool) < 200:
      i, j = rng.choice(len(items), 2, replace=False)
      if ok[i] and ok[j]:
        pool.append((min(i, j), max(i, j)))
  else:
    pool = [p for p in listed if lo <= sim[p] < hi]
  order = rng.permutation(len(pool))
  n = 0
  for k in order:
    i, j = pool[k]
    if i in used or j in used:
      continue
    chosen.append((band, int(i), int(j), float(sim[i, j])))
    used |= {i, j}
    n += 1
    if n == PER_BAND:
      break

con = sqlite3.connect(f"file:{ROOT / 'databases/private_corpus.db'}?mode=ro", uri=True)
def text(number):
  e = con.execute("SELECT exposition FROM bill_texts WHERE number = ?", (number,)).fetchone()[0]
  e = " ".join(e.split())
  return e[:EXCERPT] + (" […]" if len(e) > EXCERPT else "")

shuffle = rng.permutation(len(chosen))
lines, key = [], {}
for pos, k in enumerate(shuffle, 1):
  band, i, j, s = chosen[k]
  a, b = (i, j) if rng.random() < 0.5 else (j, i)
  pid = f"P{pos:02d}"
  key[pid] = {"band": band, "cos": round(s, 3), "a": items[a]["id"], "b": items[b]["id"]}
  lines += [f"## {pid}", "", f"**Expediente X:** {items[a]['label']}", "", text(items[a]["id"]), "",
            f"**Expediente Y:** {items[b]['label']}", "", text(items[b]["id"]), "", "---", ""]
(OUT / "pairs.md").write_text("\n".join(lines), encoding="utf-8")
(OUT / "key.json").write_text(json.dumps(key, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(key), "pairs;", {b: sum(1 for v in key.values() if v["band"] == b) for b, *_ in BANDS})
print("random band cos:", sorted(round(v["cos"], 2) for v in key.values() if v["band"] == "E"))
print(f"{(OUT / 'pairs.md').stat().st_size / 1e3:.0f} kB")
