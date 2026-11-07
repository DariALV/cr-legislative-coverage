// Replay of a run of run_evolution.py (#68). Reads ../output/evolution_replay/data.js (window.EVOLUTION_DATA, all
// parts of the last run), or history.csv + population.csv (+ run.json for the gene ranges) of any run folder.
"use strict";

const SVG = "http://www.w3.org/2000/svg";
const ORIGIN_SHAPES = { random: "circle", offspring: "circle", elite: "square", immigrant: "triangle" };
const NON_GENE_COLUMNS = new Set(["generation", "individual_id", "parent_a", "parent_b", "origin", "fitness"]);

const state = { parts: [], part: null, generation: 0, timer: null };
const $ = (id) => document.getElementById(id);

// ---------- data ----------

function preparePart(raw) {
  const pop = raw.population;
  const n = pop.generation.length;
  const genes = raw.genes && raw.genes.length ? raw.genes : inferGenes(pop);
  const byGeneration = [];
  const rowOf = new Map();
  for (let i = 0; i < n; i++) {
    const g = pop.generation[i];
    (byGeneration[g] ||= []).push(i);
    rowOf.set(`${g}:${pop.individual_id[i]}`, i);
  }
  const normalized = genes.map((gene) => pop[gene.name].map((v) => normalize(gene, v)));
  const part = { ...raw, genes, n, byGeneration, rowOf, normalized };
  part.projection = pca2(part);
  const fitness = pop.fitness;
  part.fitnessRange = [quantile(fitness, 0.05), Math.max(...raw.history.best_fitness)];
  return part;
}

function inferGenes(pop) {
  return Object.keys(pop).filter((c) => !NON_GENE_COLUMNS.has(c)).map((name) => {
    const values = pop[name];
    if (typeof values[0] === "boolean") return { name, kind: "bool", low: 0, high: 1 };
    const low = Math.min(...values), high = Math.max(...values);
    const kind = name.startsWith("w_") ? "float" : (values.every(Number.isInteger) ? "int" : "float");
    return { name, kind, low, high: high > low ? high : low + 1 };
  });
}

function normalize(gene, value) {
  if (gene.kind === "bool") return value ? 1 : 0;
  if (gene.kind === "log") return (Math.log(value) - Math.log(gene.low)) / (Math.log(gene.high) - Math.log(gene.low));
  return (value - gene.low) / ((gene.high - gene.low) || 1);
}

function pca2(part) {
  // Top two principal components of the normalized non-bool genes of every individual of the run (power
  // iteration). On/off genes are left out: as 0/1 jumps they would split the cloud into clusters by switches.
  const used = part.genes.map((g, i) => [g, i]).filter(([g]) => g.kind !== "bool").map(([, i]) => i);
  const X = (used.length ? used : part.genes.map((_, i) => i)).map((i) => part.normalized[i]);
  const d = X.length, n = part.n;
  const mean = X.map((col) => col.reduce((a, b) => a + b, 0) / n);
  const cov = Array.from({ length: d }, () => new Float64Array(d));
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < d; a++) {
      const xa = X[a][i] - mean[a];
      for (let b = a; b < d; b++) cov[a][b] += xa * (X[b][i] - mean[b]);
    }
  }
  for (let a = 0; a < d; a++) for (let b = 0; b < a; b++) cov[a][b] = cov[b][a];
  const vectors = [];
  for (let c = 0; c < 2; c++) {
    let v = Array.from({ length: d }, (_, i) => Math.sin(i + 1 + c));
    for (let it = 0; it < 200; it++) {
      let w = cov.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
      for (const u of vectors) { const dot = w.reduce((s, x, j) => s + x * u[j], 0); w = w.map((x, j) => x - dot * u[j]); }
      const norm = Math.hypot(...w) || 1;
      v = w.map((x) => x / norm);
    }
    vectors.push(v);
  }
  const points = new Array(n);
  for (let i = 0; i < n; i++) {
    points[i] = vectors.map((v) => v.reduce((s, x, a) => s + x * (X[a][i] - mean[a]), 0));
  }
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { points, x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] };
}

function quantile(values, q) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.floor(q * (sorted.length - 1))];
}

// ---------- csv files ----------

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const columns = Object.fromEntries(header.map((h) => [h, []]));
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    header.forEach((h, j) => columns[h].push(parseCell(cells[j])));
  }
  return columns;
}

function parseCell(cell) {
  if (cell === "True") return true;
  if (cell === "False") return false;
  const number = Number(cell);
  return cell !== "" && Number.isFinite(number) ? number : cell;
}

async function openFiles(files) {
  const byName = Object.fromEntries([...files].map((f) => [f.name, f]));
  if (!byName["history.csv"] || !byName["population.csv"]) {
    alert("Pick at least history.csv and population.csv from one run folder.");
    return;
  }
  const history = parseCsv(await byName["history.csv"].text());
  const population = parseCsv(await byName["population.csv"].text());
  const run = byName["run.json"] ? JSON.parse(await byName["run.json"].text()) : null;
  const label = run ? `${run.name} (files)` : "opened files";
  setParts({ name: label, k: run?.k, parts: [{ label, genes: run?.genes || [], settings: run?.settings || {}, history, population }] });
}

// ---------- rendering helpers ----------

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function scale([d0, d1], [r0, r1]) {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

function fitnessColor(part, value) {
  // Sequential ramp from a light to a dark blue, over the run's fitness range.
  const t = Math.max(0, Math.min(1, (value - part.fitnessRange[0]) / ((part.fitnessRange[1] - part.fitnessRange[0]) || 1)));
  const light = [205, 220, 245], dark = [20, 60, 150];
  const c = light.map((l, i) => Math.round(l + t * (dark[i] - l)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function shape(parent, kind, x, y, r, attrs) {
  if (kind === "square") return el("rect", { x: x - r, y: y - r, width: 2 * r, height: 2 * r, ...attrs }, parent);
  if (kind === "triangle") {
    return el("path", { d: `M${x},${y - r * 1.2}L${x + r * 1.1},${y + r * 0.8}L${x - r * 1.1},${y + r * 0.8}Z`, ...attrs }, parent);
  }
  return el("circle", { cx: x, cy: y, r, ...attrs }, parent);
}

const fmt = (v, digits = 3) => (typeof v === "number" ? v.toFixed(digits) : String(v));

// ---------- panels ----------

function drawFitness() {
  const part = state.part, h = part.history, box = $("fitness-chart");
  box.innerHTML = "";
  const W = 800, H = 220, m = { l: 48, r: 12, t: 10, b: 26 };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Fitness per generation" }, box);
  const gens = h.generation;
  const low = Math.min(...h.median_fitness), high = Math.max(...h.best_fitness);
  const x = scale([gens[0], gens[gens.length - 1]], [m.l, W - m.r]);
  const y = scale([low - (high - low) * 0.05, high + (high - low) * 0.05], [H - m.b, m.t]);
  const axis = el("g", { class: "axis" }, svg);
  for (let i = 0; i <= 4; i++) {
    const v = low + ((high - low) * i) / 4;
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: css("--grid") }, axis);
    el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, axis).textContent = v.toFixed(3);
  }
  const step = Math.max(1, Math.ceil(gens.length / 8));
  for (let i = 0; i < gens.length; i += step) {
    el("text", { x: x(gens[i]), y: H - 8, "text-anchor": "middle" }, axis).textContent = gens[i];
  }
  const line = (values, color, width) => el("path", {
    d: values.map((v, i) => `${i ? "L" : "M"}${x(gens[i]).toFixed(1)},${y(v).toFixed(1)}`).join(""),
    fill: "none", stroke: color, "stroke-width": width, "stroke-linejoin": "round",
  }, svg);
  line(h.median_fitness, css("--median"), 1.5);
  line(h.mean_fitness, css("--mean"), 1.5);
  line(h.best_fitness, css("--best"), 2);
  state.cursor = el("line", { y1: m.t, y2: H - m.b, stroke: css("--accent"), "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);
  state.cursorX = x;
  const legend = el("g", {}, svg);
  [["best", "--best"], ["mean", "--mean"], ["median", "--median"]].forEach(([name, color], i) => {
    el("line", { x1: W - 210 + i * 70, x2: W - 194 + i * 70, y1: H - m.b - 10, y2: H - m.b - 10, stroke: css(color), "stroke-width": 2 }, legend);
    el("text", { x: W - 190 + i * 70, y: H - m.b - 6 }, legend).textContent = name;
  });
}

function drawScatter(rows) {
  const part = state.part, box = $("scatter");
  box.innerHTML = "";
  const S = 400, m = 16;
  const svg = el("svg", { viewBox: `0 0 ${S} ${S}`, role: "img", "aria-label": "Population by genes" }, box);
  el("rect", { x: 0.5, y: 0.5, width: S - 1, height: S - 1, fill: "none", stroke: css("--grid") }, svg);
  const x = scale(part.projection.x, [m, S - m]), y = scale(part.projection.y, [S - m, m]);
  const pop = part.population;
  const best = bestRow(rows);
  const ordered = [...rows].sort((a, b) => pop.fitness[a] - pop.fitness[b]);
  for (const i of ordered) {
    const [px, py] = part.projection.points[i];
    const origin = pop.origin[i];
    shape(svg, ORIGIN_SHAPES[origin] || "circle", x(px), y(py), i === best ? 7 : 4.5, {
      fill: fitnessColor(part, pop.fitness[i]),
      stroke: css(`--origin-${origin}`) || css("--muted"),
      "stroke-width": i === best ? 2.5 : 1.2,
      opacity: 0.9,
    });
  }
  const legend = $("scatter-legend");
  legend.innerHTML = "";
  for (const origin of ["offspring", "elite", "immigrant", "random"]) {
    const item = document.createElement("span");
    const icon = el("svg", { width: 14, height: 14, viewBox: "0 0 14 14" });
    shape(icon, ORIGIN_SHAPES[origin], 7, 7, 4.5, { fill: "none", stroke: css(`--origin-${origin}`), "stroke-width": 1.5 });
    item.appendChild(icon);
    item.append(origin);
    legend.appendChild(item);
  }
}

function drawRecipe(rows) {
  const part = state.part, pop = part.population, best = bestRow(rows), box = $("recipe");
  box.innerHTML = "";
  const table = document.createElement("table");
  const weights = part.genes.filter((g) => g.name.startsWith("w_"));
  const range = Math.max(...weights.map((g) => Math.max(Math.abs(g.low), Math.abs(g.high)))) || 1;
  for (const gene of weights) {
    const feature = gene.name.slice(2);
    const used = pop[`use_${feature}`] ? pop[`use_${feature}`][best] : true;
    const value = pop[gene.name][best];
    const tr = table.insertRow();
    const name = tr.insertCell();
    name.textContent = feature;
    if (!used) name.className = "off";
    const barCell = tr.insertCell();
    barCell.className = "bar-cell";
    const svg = el("svg", { viewBox: "0 0 200 14", width: "100%", height: 14 }, barCell);
    el("line", { x1: 100, x2: 100, y1: 0, y2: 14, stroke: css("--grid") }, svg);
    const w = (Math.abs(value) / range) * 100;
    el("rect", { x: value >= 0 ? 100 : 100 - w, y: 3, width: w, height: 8, rx: 2,
                 fill: !used ? css("--off") : value >= 0 ? css("--accent") : css("--negative") }, svg);
    const cell = tr.insertCell();
    cell.className = "value" + (used ? "" : " off");
    cell.textContent = used ? fmt(value, 2) : "off";
  }
  box.appendChild(table);
  const extra = document.createElement("div");
  extra.className = "extra";
  const others = part.genes.filter((g) => !g.name.startsWith("w_") && !g.name.startsWith("use_"));
  const items = [["fitness", fmt(pop.fitness[best], 4)], ["id", pop.individual_id[best]], ["origin", pop.origin[best]],
                 ...others.map((g) => [g.name, fmt(pop[g.name][best], g.kind === "int" ? 0 : 1)])];
  for (const [k, v] of items) {
    const a = document.createElement("span"); a.className = "muted"; a.textContent = k;
    const b = document.createElement("span"); b.className = "tabular"; b.textContent = v;
    extra.append(a, b);
  }
  box.appendChild(extra);
}

function drawGenes(rows) {
  const part = state.part, best = bestRow(rows), box = $("genes");
  box.innerHTML = "";
  part.genes.forEach((gene, g) => {
    const name = document.createElement("div");
    name.className = "name";
    name.title = gene.name;
    name.textContent = `${gene.name} = ${fmt(part.population[gene.name][best], gene.kind === "int" ? 0 : 2)}`;
    const holder = document.createElement("div");
    const svg = el("svg", { viewBox: "0 0 400 18", preserveAspectRatio: "none" }, holder);
    el("line", { x1: 0, x2: 400, y1: 9, y2: 9, stroke: css("--grid"), "stroke-width": 2 }, svg);
    for (const i of rows) {
      el("rect", { x: 3 + part.normalized[g][i] * 392, y: 4, width: 2, height: 10, fill: css("--mean"), opacity: 0.35 }, svg);
    }
    el("rect", { x: 2 + part.normalized[g][best] * 392, y: 1, width: 4, height: 16, fill: css("--best"), rx: 1 }, svg);
    box.append(name, holder);
  });
}

function drawLineage(rows) {
  const part = state.part, pop = part.population, box = $("lineage");
  box.innerHTML = "";
  let row = bestRow(rows);
  let generation = state.generation;
  for (let steps = 0; steps < 16 && row !== undefined; steps++) {
    const div = document.createElement("div");
    div.className = "step";
    div.innerHTML = `<b>gen ${generation} · ${pop.origin[row]}</b>#${pop.individual_id[row]} · ${fmt(pop.fitness[row], 4)}`;
    box.appendChild(div);
    if (generation === 0) break;
    const id = pop.individual_id[row];
    const candidates = pop.origin[row] === "elite"
      ? [part.rowOf.get(`${generation - 1}:${id}`)]
      : [pop.parent_a[row], pop.parent_b[row]].filter((p) => p >= 0).map((p) => part.rowOf.get(`${generation - 1}:${p}`));
    const parents = candidates.filter((r) => r !== undefined);
    if (!parents.length) break;
    row = parents.reduce((a, b) => (pop.fitness[b] > pop.fitness[a] ? b : a));
    generation -= 1;
  }
}

function drawStats() {
  const h = state.part.history, i = h.generation.indexOf(state.generation);
  const items = [["best", fmt(h.best_fitness[i], 4)], ["mean", fmt(h.mean_fitness[i], 4)],
                 ["diversity", fmt(h.diversity[i], 3)], ["immigrants", h.immigrants[i]],
                 ["elapsed", `${fmt(h.elapsed_seconds[i], 1)} s`]];
  $("stats").innerHTML = items.map(([k, v]) => `<span class="muted">${k} <b>${v}</b></span>`).join("");
}

function bestRow(rows) {
  const fitness = state.part.population.fitness;
  return rows.reduce((a, b) => (fitness[b] > fitness[a] ? b : a));
}

// ---------- state ----------

function setParts(data) {
  state.parts = data.parts.map(preparePart);
  $("run-name").textContent = `${data.name}${data.k ? ` · K = ${data.k}` : ""}`;
  const select = $("part");
  select.innerHTML = "";
  state.parts.forEach((p, i) => select.add(new Option(p.label, i)));
  selectPart(0);
}

function selectPart(index) {
  stop();
  state.part = state.parts[index];
  const last = state.part.byGeneration.length - 1;
  $("slider").max = last;
  drawFitness();
  show(last);
}

function show(generation) {
  const part = state.part;
  const last = part.byGeneration.length - 1;
  state.generation = Math.max(0, Math.min(last, generation));
  $("slider").value = state.generation;
  $("generation-label").textContent = `gen ${state.generation} / ${last}`;
  const rows = part.byGeneration[state.generation];
  const cx = state.cursorX(state.generation);
  state.cursor.setAttribute("x1", cx);
  state.cursor.setAttribute("x2", cx);
  drawStats();
  drawScatter(rows);
  drawRecipe(rows);
  drawGenes(rows);
  drawLineage(rows);
}

function play() {
  if (state.timer) return stop();
  if (state.generation >= state.part.byGeneration.length - 1) show(0);
  $("play").textContent = "⏸";
  state.timer = setInterval(() => {
    if (state.generation >= state.part.byGeneration.length - 1) return stop();
    show(state.generation + 1);
  }, Number($("speed").value));
}

function stop() {
  clearInterval(state.timer);
  state.timer = null;
  $("play").textContent = "▶";
}

$("play").addEventListener("click", play);
$("first").addEventListener("click", () => { stop(); show(0); });
$("last").addEventListener("click", () => { stop(); show(Infinity); });
$("back").addEventListener("click", () => { stop(); show(state.generation - 1); });
$("forward").addEventListener("click", () => { stop(); show(state.generation + 1); });
$("slider").addEventListener("input", (e) => { stop(); show(Number(e.target.value)); });
$("speed").addEventListener("change", () => { if (state.timer) { stop(); play(); } });
$("part").addEventListener("change", (e) => selectPart(Number(e.target.value)));
$("files").addEventListener("change", (e) => openFiles(e.target.files));
document.addEventListener("keydown", (e) => {
  if (!state.part || e.target.tagName === "SELECT") return;
  if (e.key === " ") { e.preventDefault(); play(); }
  if (e.key === "ArrowLeft") { stop(); show(state.generation - 1); }
  if (e.key === "ArrowRight") { stop(); show(state.generation + 1); }
});

if (window.EVOLUTION_DATA) {
  setParts(window.EVOLUTION_DATA);
} else {
  document.querySelector("main").insertAdjacentHTML("afterbegin",
    '<p class="empty wide">No data.js yet: run python run_evolution.py, or open history.csv and population.csv of a run folder.</p>');
}
