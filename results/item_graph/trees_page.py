"""Writes results/item_graph/trees.html: the example trees of analyze_params.py drawn with d3-force,
to compare the depth discount a, the entry weight w, the floor and the cap by eye (#71).

The page is self-contained (data embedded, d3 from cdnjs). Only public fields go in: bill numbers and
names, news ids and titles, and cosine similarities.
Usage: python results/item_graph/trees_page.py   (after analyze_params.py)
"""
import json
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent

TEMPLATE = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Grafo propio por ficha</title>
<style>
:root { --bg: #fbfaf7; --fg: #1f1e1b; --muted: #6b6963; --line: #d8d5cc; --card: #ffffff; --accent: #2f6db5; }
@media (prefers-color-scheme: dark) { :root { --bg: #1b1a18; --fg: #ebe8e1; --muted: #a29f97; --line: #3a3833; --card: #24231f; --accent: #7fb0ea; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 16px; }
h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
p.note { color: var(--muted); margin: 0 0 12px; max-width: 900px; }
.controls { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; margin-bottom: 12px; }
.controls label { color: var(--muted); }
.seg button { font: inherit; border: 1px solid var(--line); background: var(--card); color: var(--fg); padding: 3px 9px; cursor: pointer; }
.seg button + button { border-left: none; }
.seg button.on { background: var(--accent); color: var(--bg); border-color: var(--accent); }
select { font: inherit; max-width: 520px; background: var(--card); color: var(--fg); border: 1px solid var(--line); padding: 3px; }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
@media (max-width: 800px) { .grid { grid-template-columns: minmax(0, 1fr); } }
.panel { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
.panel h2 { font-size: 14px; font-weight: 600; margin: 0 0 2px; }
.stats { color: var(--muted); font-size: 12px; min-height: 18px; }
svg { width: 100%; height: 460px; display: block; }
.tip { position: absolute; pointer-events: none; background: var(--card); border: 1px solid var(--line); padding: 4px 8px;
       border-radius: 6px; font-size: 12px; max-width: 360px; display: none; }
.legend { color: var(--muted); font-size: 12px; margin-top: 8px; }
</style>
</head>
<body>
<main>
<h1>Grafo propio por ficha: a y w</h1>
<p class="note">Cada panel es el árbol que mostraría la ficha del ítem en naranja (A). Los nodos entran por el mejor
w·sim(arista) + (1−w)·sim(Y, A) y cuelgan del nodo P que maximiza a<sup>prof(P)</sup>·sim(Y, P). Color: parecido con A
(oscuro = más parecido). Tamaño: descendientes en el árbol. El panel de la derecha compara contra otros a y w.</p>
<div class="controls">
  <label>Ficha <select id="page"></select></label>
  <label>Piso <span class="seg" id="floor"></span></label>
  <label>Nodos <input type="range" id="cap" min="5" max="50" step="1" value="50"> <span id="capv">50</span></label>
</div>
<div class="grid">
  <div class="panel"><div class="controls"><label>a <span class="seg" id="a1"></span></label><label>w <span class="seg" id="w1"></span></label></div>
    <div class="stats" id="s1"></div><svg id="g1"></svg></div>
  <div class="panel"><div class="controls"><label>a <span class="seg" id="a2"></span></label><label>w <span class="seg" id="w2"></span></label></div>
    <div class="stats" id="s2"></div><svg id="g2"></svg></div>
</div>
<p class="legend">Pasá el puntero por un nodo para ver su título, su parecido con A y con el nodo del que cuelga.</p>
<div class="tip" id="tip"></div>
</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script>
const DATA = __DATA__;
const A = DATA.a, W = DATA.w;
const state = { page: Object.keys(DATA.pages)[0], floor: null, cap: 50, p: [{ a: 0.9, w: 0.5 }, { a: 1.0, w: 1.0 }] };
const pageSel = document.getElementById('page');
for (const [id, pg] of Object.entries(DATA.pages)) {
  const o = document.createElement('option');
  o.value = id;
  o.textContent = (pg.kind === 'bills' ? 'Expediente ' + id + ' (' + (pg.group === 'with_news' ? 'con noticias' : 'solo actividad') + ')' : 'Noticia de ' + pg.group) + ': ' + pg.label.slice(0, 70);
  pageSel.appendChild(o);
}
function seg(el, values, get, set) {
  el.innerHTML = '';
  for (const v of values) {
    const b = document.createElement('button');
    b.textContent = String(v).replace('.', ',');
    b.className = get() === v ? 'on' : '';
    b.onclick = () => { set(v); render(); };
    el.appendChild(b);
  }
}
const tip = document.getElementById('tip');
const sims = {};
function draw(svgId, statsId, tree, labels) {
  const svg = d3.select('#' + svgId);
  svg.selectAll('*').remove();
  const box = svg.node().getBoundingClientRect();
  const width = box.width, height = box.height;
  if (sims[svgId]) sims[svgId].stop();
  const rows = tree.slice(0, state.cap + 1);
  const nodes = rows.map(r => ({ id: String(r[0]), parent: r[1] === null ? null : String(r[1]), depth: r[2], simA: r[3], simP: r[4] }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const n of nodes) n.desc = 0;
  for (const n of nodes.slice().reverse()) if (n.parent) byId.get(n.parent).desc += n.desc + 1;
  const links = nodes.filter(n => n.parent).map(n => ({ source: n.parent, target: n.id }));
  const root = nodes[0];
  root.fx = width / 2; root.fy = height / 2;
  const depths = nodes.slice(1).map(n => n.depth), simsA = nodes.slice(1).map(n => n.simA);
  const fromA = nodes.filter(n => n.parent === root.id).length;
  const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
  document.getElementById(statsId).textContent = nodes.length > 1
    ? `${nodes.length - 1} nodos · profundidad media ${mean(depths).toFixed(1).replace('.', ',')}, máx ${Math.max(...depths)} · ${fromA} cuelgan de A · parecido con A medio ${mean(simsA).toFixed(2).replace('.', ',')}, mín ${Math.min(...simsA).toFixed(2).replace('.', ',')}`
    : 'Sin vecinos sobre el piso';
  const lo = DATA.pages[state.page].kind === 'bills' ? 0.3 : 0.45, hi = DATA.pages[state.page].kind === 'bills' ? 0.85 : 0.95;
  const color = d3.scaleSequential(t => d3.interpolateBlues(0.25 + 0.75 * t)).domain([lo, hi]).clamp(true);
  const r = n => n === root ? 9 : 3 + 2.2 * Math.sqrt(n.desc);
  const g = svg.append('g');
  const link = g.append('g').attr('stroke', 'var(--muted)').attr('stroke-opacity', 0.55).selectAll('line').data(links).join('line')
    .attr('stroke-width', d => 0.6 + 2.5 * Math.max(0, byId.get(d.target).simP - 0.5));
  const node = g.append('g').selectAll('circle').data(nodes).join('circle')
    .attr('r', r).attr('fill', d => d === root ? '#d85a30' : color(d.simA)).attr('stroke', 'var(--card)').attr('stroke-width', 1)
    .on('mousemove', (ev, d) => {
      tip.style.display = 'block';
      tip.style.left = (ev.pageX + 12) + 'px'; tip.style.top = (ev.pageY + 12) + 'px';
      tip.innerHTML = `<b>${labels[d.id] || d.id}</b><br>` + (d === root ? 'A, la ficha' :
        `parecido con A ${d.simA.toFixed(2)} · con su padre ${d.simP.toFixed(2)} · profundidad ${d.depth} · ${d.desc} descendientes`);
    })
    .on('mouseleave', () => { tip.style.display = 'none'; });
  // Each node starts next to its parent (nodes come in order of entry), and the layout is settled
  // before drawing, so that switching pages or parameters shows the final shape at once.
  let seed = 1;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const n of nodes) {
    const p = n.parent ? byId.get(n.parent) : null;
    const angle = 2 * Math.PI * rand();
    n.x = (p ? p.x : width / 2) + (p ? 25 * Math.cos(angle) : 0);
    n.y = (p ? p.y : height / 2) + (p ? 25 * Math.sin(angle) : 0);
  }
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(d => 18 + r(byId.get(d.target.id || d.target)) * 2).strength(0.9))
    .force('charge', d3.forceManyBody().strength(-60))
    .force('collide', d3.forceCollide(d => r(d) + 2))
    .force('x', d3.forceX(width / 2).strength(0.03)).force('y', d3.forceY(height / 2).strength(0.03))
    .stop();
  for (let i = 0; i < 400; i++) sim.tick();
  link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  node.attr('cx', d => d.x).attr('cy', d => d.y);
  const pad = 14;
  const x0 = d3.min(nodes, d => d.x - r(d)) - pad, x1 = d3.max(nodes, d => d.x + r(d)) + pad;
  const y0 = d3.min(nodes, d => d.y - r(d)) - pad, y1 = d3.max(nodes, d => d.y + r(d)) + pad;
  const side = Math.max(x1 - x0, (y1 - y0) * width / height);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, h = side * height / width;
  svg.attr('viewBox', `${cx - side / 2} ${cy - h / 2} ${Math.max(side, width)} ${Math.max(h, height)}`);
  if (side < width) svg.attr('viewBox', `${cx - width / 2} ${cy - height / 2} ${width} ${height}`);
}
function render() {
  const pg = DATA.pages[state.page];
  const floors = Object.keys(pg.trees).map(k => k.split(' ')[0].slice(6)).filter((v, i, xs) => xs.indexOf(v) === i);
  if (!floors.includes(state.floor)) state.floor = floors[0];
  seg(document.getElementById('floor'), floors, () => state.floor, v => { state.floor = v; });
  for (const i of [0, 1]) {
    seg(document.getElementById('a' + (i + 1)), A, () => state.p[i].a, v => { state.p[i].a = v; });
    seg(document.getElementById('w' + (i + 1)), W, () => state.p[i].w, v => { state.p[i].w = v; });
    const py = v => Number.isInteger(v) ? v.toFixed(1) : String(v);   // Python's str() of the float in the key
    const tree = pg.trees[`floor=${state.floor} a=${py(state.p[i].a)} w=${py(state.p[i].w)}`];
    draw('g' + (i + 1), 's' + (i + 1), tree, pg.labels);
  }
}
pageSel.onchange = () => { state.page = pageSel.value; render(); };
const cap = document.getElementById('cap');
cap.oninput = () => { state.cap = +cap.value; document.getElementById('capv').textContent = cap.value; render(); };
render();
</script>
</body>
</html>
"""


def main():
  examples = json.loads((OUT_DIR / "examples.json").read_text(encoding="utf-8"))
  settings = json.loads((OUT_DIR / "similarity.json").read_text(encoding="utf-8"))["settings"]
  order = sorted(examples.items(), key=lambda kv: (kv[1]["kind"], kv[1]["root"]["group"] != "with_news", kv[0]))
  pages = {}
  for key, ex in order:
    # Long news ids become small per-page indices, to keep the file light.
    index = {}
    trees = {combo: [[index.setdefault(str(n), len(index)), None if p is None else index.setdefault(str(p), len(index)),
                      d, sa, sp] for n, p, d, sa, sp in tree]
             for combo, tree in ex["trees"].items()}
    labels = {str(i): (f"{k} · {ex['labels'][k]}" if ex["kind"] == "bills" else ex["labels"][k]) for k, i in index.items()}
    pages[key] = {"kind": ex["kind"], "group": ex["root"]["group"], "label": ex["root"]["label"],
                  "labels": labels, "trees": trees}
  data = {"a": settings["a"], "w": settings["w"], "pages": pages}
  payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
  out = OUT_DIR / "trees.html"
  out.write_text(TEMPLATE.replace("__DATA__", payload), encoding="utf-8")
  print(f"{len(pages)} pages, {out.stat().st_size / 1e3:.0f} kB -> {out}")


if __name__ == "__main__":
  main()
