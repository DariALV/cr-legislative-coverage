// The similarity graph at the end of a bill or news page (#71). The tree is precomputed by
// export_item_graphs.py: one row per node in order of entry, [position in the index, row of the parent
// (-1 for the page's own item), cosine to the page's item x 100, cosine to the parent x 100]. The two
// settings only cut that list: nodes below the minimum similarity go away with everything hanging from
// them, and the first N that are left are shown. Settings are kept in the browser, one pair per kind,
// so changing them on one page changes them on every page of that kind (open tabs included).
//
// The layout is alive, with the local graph pages' engine as model (private_visuals/graph/engine.js):
// a canvas drawn once per frame, several ticks per frame while they fit in a small time budget, a
// short-range repulsion that fades to zero at its radius and pushes overlapping circles apart, the loop
// stopped once the layout is cold or the graph is out of sight, and dragging that reheats it. Links are
// stiff springs, so the tree keeps its shape while the repulsion spreads the branches apart.
import { forceLink, forceSimulation, forceX, forceY } from 'd3-force';
import type { Force, Simulation, SimulationNodeDatum } from 'd3-force';
import { ITEM_GRAPH, ITEM_GRAPH_MAX_NODES, similarityLabel } from '../lib/itemGraph';
import type { ItemGraphKind } from '../lib/itemGraph';

type Row = [number, number, number, number];
interface IndexFile { fields: string[]; items: (string | number)[][]; params: Record<string, unknown> }
interface Node extends SimulationNodeDatum { row: number; parentRow: number; simRoot: number; simParent: number; r: number; x: number; y: number; vx: number; vy: number }
interface Link { source: Node; target: Node; sim: number }
interface Settings { nodes: number; minSim: number }

const ROOT_RADIUS = 11, MIN_RADIUS = 3.5, MAX_RADIUS = 11;
const LINK_GAP = 16;                         // free length of a link between the two circles
const REPEL = { strength: 320, radius: 120 };
const COLLIDE = 0.25, COLLIDE_PAD = 4;       // share of an overlap undone per tick; gap kept between circles
const CENTER = 0.03;
const TICK_BUDGET_MS = 8, MAX_TICKS_PER_FRAME = 4;
const ZOOM = { min: 0.3, max: 1.5 }, FIT_PAD = 18, FIT_EASE = 0.12;
const DRAG_THRESHOLD = 5;                     // px of movement before a press on a node becomes a drag
const indexCache = new Map<string, Promise<IndexFile>>();

const storageKey = (kind: ItemGraphKind) => `item-graph:${kind}`;
function readSettings(kind: ItemGraphKind): Settings {
  const config = ITEM_GRAPH[kind], fallback = { nodes: config.nodes, minSim: config.minSim.value };
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(kind)) ?? 'null') as Partial<Settings> | null;
    if (!stored) return fallback;
    const nodes = Number(stored.nodes), minSim = Number(stored.minSim);
    return {
      nodes: Number.isFinite(nodes) ? Math.min(ITEM_GRAPH_MAX_NODES, Math.max(5, Math.round(nodes))) : fallback.nodes,
      minSim: Number.isFinite(minSim) ? Math.min(config.minSim.max, Math.max(config.minSim.min, Math.round(minSim))) : fallback.minSim,
    };
  } catch {
    return fallback;
  }
}
function writeSettings(kind: ItemGraphKind, settings: Settings) {
  try { localStorage.setItem(storageKey(kind), JSON.stringify(settings)); } catch { /* private mode or blocked storage */ }
}

function loadIndex(url: string): Promise<IndexFile> {
  if (!indexCache.has(url)) {
    indexCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<IndexFile>;
    }));
  }
  return indexCache.get(url)!;
}

/** Short-range repulsion (engine.js's forceRepel without its grid: a page shows at most 150 nodes). */
function forceRepel(): Force<Node, undefined> {
  let nodes: Node[] = [];
  const force = (alpha: number) => {
    const k = REPEL.strength * alpha, r2 = REPEL.radius * REPEL.radius, inverse = 1 / r2;
    for (let a = 0; a < nodes.length; a++) {
      const na = nodes[a];
      for (let b = a + 1; b < nodes.length; b++) {
        const nb = nodes[b];
        let dx = nb.x - na.x, dy = nb.y - na.y, d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        let w = k * (1 / d2 - inverse);
        const touch = na.r + nb.r + COLLIDE_PAD;
        if (d2 < touch * touch) { const d = Math.sqrt(d2); w += (COLLIDE * (touch - d)) / d; }   // overlap: push whatever the alpha
        dx *= w; dy *= w;
        na.vx -= dx; na.vy -= dy;
        nb.vx += dx; nb.vy += dy;
      }
    }
  };
  force.initialize = (list: Node[]) => { nodes = list; };
  return force as Force<Node, undefined>;
}

function setup(section: HTMLElement) {
  const kind = section.dataset.kind as ItemGraphKind;
  const config = ITEM_GRAPH[kind];
  const base = section.dataset.base!.replace(/\/+$/, '');
  const outlets: Record<string, string> = JSON.parse(section.dataset.outlets ?? '{}');
  const box = section.querySelector<HTMLElement>('.item-graph__canvas')!;
  const canvas = box.querySelector('canvas')!;
  const context = canvas.getContext('2d')!;
  const tip = section.querySelector<HTMLElement>('.item-graph__tip')!;
  const nodesInput = section.querySelector<HTMLInputElement>('input[data-setting=nodes]')!;
  const minInput = section.querySelector<HTMLInputElement>('input[data-setting=minSim]')!;
  const nodesOutput = section.querySelector<HTMLOutputElement>('output[data-setting=nodes]')!;
  const minOutput = section.querySelector<HTMLOutputElement>('output[data-setting=minSim]')!;
  const note = section.querySelector<HTMLElement>('.item-graph__note')!;
  const status = section.querySelector<HTMLElement>('.item-graph__status')!;
  const list = section.querySelector<HTMLOListElement>('.item-graph__list ol')!;
  const noun = kind === 'bills' ? ['expediente', 'expedientes'] : ['noticia', 'noticias'];

  let rows: Row[] = [], index: IndexFile | null = null;
  let settings = readSettings(kind);
  let nodes: Node[] = [], links: Link[] = [];
  const placed = new Map<number, { x: number; y: number }>();   // positions kept when the settings change
  const view = { x: 0, y: 0, zoom: 1, width: 0, height: 0 };
  let hovered: Node | null = null, pressed: Node | null = null, dragging = false, armed: Node | null = null;
  let pressX = 0, pressY = 0, running = false, visible = false, loaded = false;
  let palette: Record<string, string> = {};

  const linkForce = forceLink<Node, Link>([]).distance((l) => LINK_GAP + l.source.r + l.target.r).strength(1).iterations(2);
  const centerX = forceX<Node>(0).strength(CENTER), centerY = forceY<Node>(0).strength(CENTER);
  const simulation: Simulation<Node, undefined> = forceSimulation<Node>([]).stop()
    .velocityDecay(0.4)
    .force('link', linkForce)
    .force('repel', forceRepel())
    .force('x', centerX)
    .force('y', centerY);
  /** A wide box pulls less sideways than up and down, so the tree spreads to the box's shape. */
  const shapeCenter = () => {
    const aspect = view.width && view.height ? view.height / view.width : 1;
    centerX.strength(CENTER * Math.min(1, Math.max(0.3, aspect)));
    centerY.strength(CENTER * Math.min(1, Math.max(0.3, 1 / aspect)));
  };

  // ---------- Data and settings ----------
  const item = (row: number) => index!.items[rows[row][0]];
  const pageHref = (row: number) => `${base}/${kind === 'bills' ? 'expediente' : 'noticia'}/${item(row)[0]}/`;
  const label = (row: number) => String(item(row)[1]);
  const band = (sim: number) => sim >= config.bands[1] ? 'muy parecido' : sim >= config.bands[0] ? 'parecido' : 'misma área';
  function detail(row: number): string {
    if (row === 0) return kind === 'bills' ? 'Este expediente' : 'Esta noticia';
    const it = item(row), sim = rows[row][2];
    const where = kind === 'bills' ? `Expediente ${it[0]} · ${it[2]}` : `${outlets[String(it[2])] ?? it[2]} · ${String(it[3]).split('-').reverse().join('/')}`;
    return `${where} · ${band(sim)} (${similarityLabel(sim)})`;
  }
  function radius(sim: number): number {
    const [lo, hi] = config.size, t = Math.min(1, Math.max(0, (sim - lo) / (hi - lo)));
    return MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS);
  }

  /** Rows to show: above the minimum, with every ancestor above it too, the first `settings.nodes` of them. */
  function visibleRows(): { shown: number[]; passing: number } {
    const kept = new Array<boolean>(rows.length).fill(false);
    kept[0] = true;
    let passing = 0;
    const shown = [0];
    for (let i = 1; i < rows.length; i++) {
      kept[i] = rows[i][2] >= settings.minSim && kept[rows[i][1]];
      if (!kept[i]) continue;
      passing++;
      if (shown.length <= settings.nodes) shown.push(i);
    }
    return { shown, passing };
  }

  function showSettings() {
    nodesInput.value = String(settings.nodes);
    minInput.value = String(settings.minSim);
    nodesOutput.value = String(settings.nodes);
    minOutput.value = similarityLabel(settings.minSim);
  }

  function rebuild(reheat: number) {
    if (!index) return;
    showSettings();
    const { shown, passing } = visibleRows();
    const byRow = new Map<number, Node>();
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    nodes = shown.map((row) => {
      const [, parentRow, simRoot, simParent] = rows[row];
      const node: Node = { row, parentRow, simRoot, simParent, r: row === 0 ? ROOT_RADIUS : radius(simRoot), x: 0, y: 0, vx: 0, vy: 0 };
      const known = placed.get(row), parent = byRow.get(parentRow);
      if (known) { node.x = known.x; node.y = known.y; }
      else if (parent) { const angle = random() * Math.PI * 2; node.x = parent.x + Math.cos(angle) * 25; node.y = parent.y + Math.sin(angle) * 25; }
      byRow.set(row, node);
      return node;
    });
    nodes[0].fx = 0; nodes[0].fy = 0;
    links = nodes.slice(1).map((n) => ({ source: byRow.get(n.parentRow)!, target: n, sim: n.simParent }));
    simulation.nodes(nodes);
    linkForce.links(links);
    hovered = hovered ? byRow.get(hovered.row) ?? null : null;   // the same rows as new node objects
    armed = armed ? byRow.get(armed.row) ?? null : null;
    if (!hovered && !armed) { tip.hidden = true; canvas.classList.remove('is-over'); }

    const count = nodes.length - 1;
    if (count === 0) {
      note.textContent = `Ningún ${noun[0]} tiene un parecido de ${similarityLabel(settings.minSim)} o más con ${kind === 'bills' ? 'este' : 'esta'}. Bajá el parecido mínimo para ver más.`;
    } else if (count < settings.nodes && passing === count) {
      note.textContent = `Se ${count === 1 ? 've' : 'ven'} ${count} de ${settings.nodes}: ${passing === rows.length - 1 ? 'no hay más en el grafo.' : `los demás tienen un parecido menor a ${similarityLabel(settings.minSim)}.`}`;
    } else {
      note.textContent = '';
    }
    canvas.setAttribute('aria-label', `Grafo con ${count} ${count === 1 ? noun[0] : noun[1]} parecidos. La lista de abajo tiene los mismos enlaces.`);
    list.replaceChildren(...nodes.slice(1).map((n) => {
      const li = document.createElement('li');
      li.append(
        Object.assign(document.createElement('a'), { href: pageHref(n.row), textContent: label(n.row) }),
        Object.assign(document.createElement('span'), { className: 'small muted', textContent: ` · ${detail(n.row)}` }),
      );
      return li;
    }));
    start(reheat);
  }

  // ---------- View and drawing ----------
  function readPalette() {
    const css = getComputedStyle(section);
    palette = Object.fromEntries(['--conf-high', '--conf-medium', '--conf-low', '--notice-border', '--muted', '--surface', '--text', '--accent']
      .map((name) => [name, css.getPropertyValue(name).trim()]));
  }
  const fill = (n: Node) => n.row === 0 ? palette['--notice-border']
    : n.simRoot >= config.bands[1] ? palette['--conf-high'] : n.simRoot >= config.bands[0] ? palette['--conf-medium'] : palette['--conf-low'];

  function resize() {
    const rect = box.getBoundingClientRect(), ratio = Math.min(2, window.devicePixelRatio || 1);
    view.width = rect.width; view.height = rect.height;
    canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    shapeCenter();
  }

  /** Moves the view toward the one that fits every circle; returns whether it is still moving. */
  function fit(instant: boolean): boolean {
    if (!nodes.length || !view.width) return false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); }
    const zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, Math.min((view.width - 2 * FIT_PAD) / Math.max(1, x1 - x0), (view.height - 2 * FIT_PAD) / Math.max(1, y1 - y0))));
    const target = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom };
    const ease = instant ? 1 : FIT_EASE;
    const dx = target.x - view.x, dy = target.y - view.y, dz = target.zoom - view.zoom;
    view.x += dx * ease; view.y += dy * ease; view.zoom += dz * ease;
    return Math.abs(dx * view.zoom) > 0.5 || Math.abs(dy * view.zoom) > 0.5 || Math.abs(dz) > 0.002;
  }
  const toScreen = (n: Node): [number, number] => [view.width / 2 + (n.x - view.x) * view.zoom, view.height / 2 + (n.y - view.y) * view.zoom];

  function draw() {
    context.clearRect(0, 0, view.width, view.height);
    const focus = hovered ?? armed;
    context.lineCap = 'round';
    for (const l of links) {
      const [x1, y1] = toScreen(l.source), [x2, y2] = toScreen(l.target);
      const lit = focus && (l.source === focus || l.target === focus);
      context.strokeStyle = lit ? palette['--accent'] : palette['--muted'];
      context.globalAlpha = lit ? 1 : 0.5;
      context.lineWidth = (0.6 + 2.2 * Math.max(0, (l.sim - 55) / 40)) * Math.min(1.2, Math.max(0.6, view.zoom));
      context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
    }
    context.globalAlpha = 1;
    // Least similar first, so the closest ones and the page's item end up on top.
    const order = nodes.slice(1).sort((a, b) => a.simRoot - b.simRoot);
    order.push(nodes[0]);
    for (const n of order) {
      const [x, y] = toScreen(n), r = Math.max(1.5, n.r * view.zoom);
      context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2);
      context.fillStyle = fill(n); context.fill();
      context.lineWidth = n === focus ? 2.5 : n.row === 0 ? 2 : 1;
      context.strokeStyle = n === focus ? palette['--text'] : palette['--surface'];
      context.stroke();
    }
    if (focus) placeTip(focus);
  }

  function frame() {
    const started = performance.now();
    let ticks = 0;
    do { simulation.tick(); ticks++; }
    while (ticks < MAX_TICKS_PER_FRAME && simulation.alpha() > simulation.alphaMin() && performance.now() - started < TICK_BUDGET_MS);
    const moving = dragging ? false : fit(false);
    for (const n of nodes) placed.set(n.row, { x: n.x, y: n.y });
    draw();
    if (visible && (dragging || moving || simulation.alpha() > simulation.alphaMin())) requestAnimationFrame(frame);
    else running = false;
  }

  function start(alpha: number) {
    simulation.alpha(Math.max(simulation.alpha(), alpha));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches && !dragging) {   // no animation: settle and draw once
      for (let i = 0; i < 300 && simulation.alpha() > simulation.alphaMin(); i++) simulation.tick();
      for (const n of nodes) placed.set(n.row, { x: n.x, y: n.y });
      fit(true); draw();
      return;
    }
    if (!running && visible) { running = true; requestAnimationFrame(frame); }
  }

  // ---------- Pointer ----------
  function placeTip(n: Node) {
    if (tip.hidden || tip.dataset.row !== String(n.row)) {   // the content only changes with the node
      tip.replaceChildren(
        Object.assign(document.createElement('strong'), { textContent: label(n.row) }),
        Object.assign(document.createElement('span'), { textContent: detail(n.row) }),
      );
      tip.dataset.row = String(n.row);
      tip.hidden = false;
    }
    const [x, y] = toScreen(n), r = n.r * view.zoom;
    const left = Math.min(Math.max(x + r + 6, 4), view.width - tip.offsetWidth - 4);
    const top = y + r + 8 + tip.offsetHeight > view.height ? y - r - tip.offsetHeight - 8 : y + r + 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(top, 4)}px`;
  }
  function hideTip() { tip.hidden = true; hovered = null; armed = null; canvas.classList.remove('is-over'); }

  function nodeAt(event: PointerEvent): Node | null {
    const rect = canvas.getBoundingClientRect(), px = event.clientX - rect.left, py = event.clientY - rect.top;
    let best: Node | null = null, bestDistance = Infinity;
    for (const n of nodes) {
      const [x, y] = toScreen(n), d = Math.hypot(x - px, y - py), reach = Math.max(n.r * view.zoom, 6) + (event.pointerType === 'touch' ? 10 : 3);
      if (d < reach && d < bestDistance) { best = n; bestDistance = d; }
    }
    return best;
  }
  const open = (n: Node) => { window.location.href = pageHref(n.row); };

  canvas.addEventListener('pointerdown', (event) => {
    const n = nodeAt(event);
    if (!n) { hideTip(); if (!running) draw(); return; }
    pressed = n; pressX = event.clientX; pressY = event.clientY;
    if (event.pointerType !== 'touch') canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (pressed && event.pointerType !== 'touch' && pressed.row !== 0) {
      if (!dragging && Math.hypot(event.clientX - pressX, event.clientY - pressY) > DRAG_THRESHOLD) {
        dragging = true; canvas.classList.add('is-dragging');
        simulation.alphaTarget(0.3); start(0.3);
      }
      if (dragging) {
        const rect = canvas.getBoundingClientRect();
        pressed.fx = view.x + (event.clientX - rect.left - view.width / 2) / view.zoom;
        pressed.fy = view.y + (event.clientY - rect.top - view.height / 2) / view.zoom;
        hovered = pressed;
        return;
      }
    }
    if (event.pointerType === 'touch') return;
    const n = nodeAt(event);
    if (n !== hovered) {
      hovered = n; canvas.classList.toggle('is-over', !!n);
      if (!n) tip.hidden = true;
      if (!running) draw();
    }
  });
  const release = (event: PointerEvent, cancelled: boolean) => {
    const n = pressed;
    pressed = null;
    if (dragging && n) {
      n.fx = null; n.fy = null;
      dragging = false; canvas.classList.remove('is-dragging');
      simulation.alphaTarget(0);
      return;
    }
    if (cancelled || !n || Math.hypot(event.clientX - pressX, event.clientY - pressY) > DRAG_THRESHOLD) return;
    if (event.pointerType === 'touch') {   // first tap shows the title, a second tap on the same node opens it
      if (armed === n && n.row !== 0) { open(n); return; }
      armed = n; hovered = null;
      if (!running) draw();
      return;
    }
    if (n.row !== 0) open(n);
  };
  canvas.addEventListener('pointerup', (e) => release(e, false));
  canvas.addEventListener('pointercancel', (e) => release(e, true));
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'touch' || dragging) return;
    if (hovered) { hovered = null; tip.hidden = true; canvas.classList.remove('is-over'); if (!running) draw(); }
  });

  // ---------- Settings, shared by every page of this kind ----------
  const changeSetting = () => {
    settings = { nodes: Number(nodesInput.value), minSim: Number(minInput.value) };
    writeSettings(kind, settings);
    rebuild(0.5);
  };
  nodesInput.addEventListener('input', changeSetting);
  minInput.addEventListener('input', changeSetting);
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey(kind)) return;
    settings = readSettings(kind);
    if (loaded) rebuild(0.5); else showSettings();
  });
  showSettings();

  // ---------- Loading and lifecycle ----------
  async function load() {
    status.textContent = 'Cargando el grafo…';
    status.hidden = false;
    try {
      const [indexFile, treeResponse] = await Promise.all([loadIndex(section.dataset.index!), fetch(section.dataset.tree!)]);
      if (!treeResponse.ok) throw new Error(String(treeResponse.status));
      index = indexFile;
      rows = await treeResponse.json() as Row[];
      nodesInput.max = String(Math.min(ITEM_GRAPH_MAX_NODES, Math.max(5, rows.length - 1)));
      status.hidden = true;
      loaded = true;
      readPalette();
      resize();
      rebuild(1);
      for (let i = 0; i < 60; i++) simulation.tick();   // start already untangled, then settle in view
      fit(true);
      draw();
    } catch {
      status.textContent = 'No se pudo cargar el grafo. Recargá la página para reintentar.';
    }
  }

  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (!visible) return;
    if (!loaded && status.textContent === '') { load(); return; }
    if (loaded) start(0);
  }, { rootMargin: '300px' }).observe(section);
  new ResizeObserver(() => {
    if (!loaded || box.clientWidth === view.width) return;
    resize(); fit(true); draw();
  }).observe(box);
  const refreshTheme = () => { if (loaded) { readPalette(); draw(); } };
  new MutationObserver(refreshTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshTheme);
}

document.querySelectorAll<HTMLElement>('.item-graph').forEach(setup);
