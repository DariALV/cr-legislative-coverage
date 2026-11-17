// The similarity graph at the end of a bill or news page (#71). The tree is precomputed by
// export_item_graphs.py: one row per node in order of entry, [position in the index, row of the parent
// (-1 for the page's own item), cosine to the page's item x 100, cosine to the parent x 100]. Each node hangs
// from its most similar node among those that entered before it, so the tree grows in chains. The two
// settings only cut that list: nodes below the minimum similarity go away with everything hanging from
// them, and the first N that are left are shown. Settings are kept in the browser, one set per kind, so
// changing them on one page changes them on every page of that kind (open tabs included).
//
// The layout is alive, with the local graph pages' engine as model (private_visuals/graph/engine.js): a
// canvas drawn once per frame and several ticks per frame while they fit in a small time budget. While the
// layout settles the forces do not cool down (d3's alpha stays at ALPHA_ON), so the repulsion always answers the
// box's push and nodes brought back in make room instead of piling up. Once the layout is about still (and at
// least SETTLE.min after the last change), the forces fade out over SETTLE.fade, so the motion dies out softly
// instead of freezing (at full strength a faint tremble never dies out), and the loop stops; any change or drag
// brings them back. The loop also stops while the graph is out of sight. A step costs ~0.5 ms with 150 nodes. Forces, in
// the spirit of Obsidian's graph view: a many-body charge between every pair of nodes (no reach limit, so
// groups push each other apart and the graph takes the room the box gives), collide, and
// links whose length tells how similar their two nodes are (the more similar, the shorter).
// Hovering a node fades everything but the node and its neighbors.
//
// Every node feels a soft gravity toward the middle of the box, Obsidian's center force: without it the
// repulsion between all nodes pushed the groups into the corners and pulled the chains between them taut and
// straight (links up to four times their length). It acts on each node by its own distance (forceX/forceY), not
// on the graph as a whole (d3's forceCenter fought the box's edge and kept the layout flowing for good), and
// nothing pulls the page's item in particular (its color tells it apart). Wider than tall, the box pulls less
// sideways, so the graph spreads to its shape. No node leaves the box: past its edge a node is pulled back,
// harder the farther out it is. The view stays centered on the middle of the box.
//
// Against crossings (a force layout does not see them): every node starts at its place in a radial drawing
// of the tree, which has none (each subtree in a wedge as wide as its share of nodes), and from there the
// forces move it freely (an anchor that kept nodes at those places made the layout rigid: dragged nodes went
// back to the same spot and the free room went unused); a clearance force moves nodes off lines that are not
// theirs, so a line never seems to end in a node it only passes by; and each node has a halo of the
// background color, so a line that passes behind it shows as cut.
//
// "Conexiones entre ellos" ("ellas" for news) adds a few loops: pairs of nodes on screen that are each among
// the other's two most similar items and are not already a tree link (precomputed in the same file).
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { Force, Simulation, SimulationNodeDatum } from 'd3-force';
import { ITEM_GRAPH, ITEM_GRAPH_BANDS, ITEM_GRAPH_MAX_NODES, similarityLabel } from '../lib/itemGraph';
import type { ItemGraphKind } from '../lib/itemGraph';

type Row = [number, number, number, number];
type Point = { x: number; y: number };
interface IndexFile { fields: string[]; items: (string | number)[][]; params: Record<string, unknown> }
interface Node extends SimulationNodeDatum { row: number; parentRow: number; simRoot: number; simParent: number; r: number; x: number; y: number; vx: number; vy: number }
interface Link { source: Node; target: Node; sim: number; loop: boolean; length: number }
interface Settings { nodes: number; minSim: number; loops: boolean }
interface GraphFile { nodes: Row[]; links: number[] }

// Circle size by descendants in the tree on screen, as Obsidian sizes nodes by links: the page's item has
// them all and is the biggest; the area grows with the count (radius with its square root), up to a cap.
const SIZE = { min: 3.5, perRoot: 1.3, max: 20 };
const FORCES = { treeStrength: 1, loopStrength: 0.05, linkIterations: 3, charge: -70, distanceMin: 10,
  gravity: 0.05, clear: 7, clearStrength: 0.5, damping: 0.7 };   // damping 0.6 left some nodes bobbing at full strength
// Free length of a link (between the two circles) by the similarity of its two nodes: cosines x 100 mapped from
// `range` (clamped) to `gap`, then spread CONTRAST times around the middle of the gap (3, chosen with the user).
const LINK_BY_SIMILARITY = { bills: { range: [55, 95] }, news: { range: [65, 97] }, gap: [6, 80] } as const;
const CONTRAST = 3, GAP_MIN = 2;
const SIBLING_PAD = 6;                        // children of a parent with three or more fit on a ring around it
const RADIAL_SPACING = 26;                    // room per node on a level's ring in the starting radial drawing
const RADIAL_MAX_STRETCH = 1.7;               // widest sideways stretch of that drawing in a wide box
// The box, in layout units, is what the canvas shows at zoom BOX_ZOOM: past its edge a node is pulled back by
// BOUND.pull times how far out it is, growing with that distance over BOUND.soft.
const ALPHA_ON = 0.3;                         // the forces' constant strength factor (d3's alpha, never decayed)
// At rest when, for REST_FRAMES frames in a row, the nodes' mean speed on screen is under REST.mean px per tick
// and none goes faster than REST.max (a straggler sliding slowly along the box's edge would otherwise keep the
// loop alive for long); the loop also gives up MAX_RUN_MS after the last change, whatever happens.
const REST = { mean: 0.012, max: 0.12 }, REST_FRAMES = 30, MAX_RUN_MS = 20000;   // the fade-out does the rest, softly
// Settling: at least `min` ms of full forces after a change, then `fade` ms of forces easing out to zero.
const SETTLE = { min: 3000, fade: 1500 };
const BOX_ZOOM = 0.4;
const BOUND = { pull: 0.1, soft: 20, margin: 0.94 };   // margin: the box is this share of the visible area
const HALO = 2.5;                             // px of background color around each circle
const DIM_NODES = 0.18, DIM_LINKS = 0.06;     // opacity of what is outside the hovered node's neighborhood
const TICK_BUDGET_MS = 8, MAX_TICKS_PER_FRAME = 8;   // ~0.5 ms a step with 150 nodes: up to 8 fit in the budget
const ZOOM_MAX = 1.5, FIT_PAD = 18, FIT_EASE = 0.12;
const DRAG_THRESHOLD = 5;                     // px of movement before a press on a node becomes a drag
const indexCache = new Map<string, Promise<IndexFile>>();

const storageKey = (kind: ItemGraphKind) => `item-graph:${kind}`;
function readSettings(kind: ItemGraphKind): Settings {
  const config = ITEM_GRAPH[kind], fallback = { nodes: config.nodes, minSim: config.minSim.value, loops: false };
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(kind)) ?? 'null') as Partial<Settings> | null;
    if (!stored) return fallback;
    const nodes = Number(stored.nodes), minSim = Number(stored.minSim);
    return {
      nodes: Number.isFinite(nodes) ? Math.min(ITEM_GRAPH_MAX_NODES, Math.max(5, Math.round(nodes))) : fallback.nodes,
      minSim: Number.isFinite(minSim) ? Math.min(config.minSim.max, Math.max(config.minSim.min, Math.round(minSim))) : fallback.minSim,
      loops: stored.loops === true,
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

/** Moves nodes off the links they are not part of (and the link a little the other way). */
function forceClearance(links: () => { source: Node; target: Node }[]): Force<Node, undefined> {
  let nodes: Node[] = [];
  const force = (alpha: number) => {
    for (const l of links()) {
      const a = l.source, b = l.target, dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
      if (length2 < 1) continue;
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      for (const n of nodes) {
        if (n === a || n === b) continue;
        const room = n.r + FORCES.clear;
        if (n.x < x0 - room || n.x > x1 + room || n.y < y0 - room || n.y > y1 + room) continue;
        const t = ((n.x - a.x) * dx + (n.y - a.y) * dy) / length2;
        if (t <= 0 || t >= 1) continue;
        let ox = n.x - (a.x + t * dx), oy = n.y - (a.y + t * dy), d = Math.sqrt(ox * ox + oy * oy);
        if (d >= room) continue;
        if (d < 1e-3) { ox = -dy; oy = dx; d = Math.sqrt(length2); }   // right on the line: push sideways
        // 4t(1 - t) fades the push toward the line's ends, so it does not switch on and off there (that, at
        // full strength, kept some nodes bobbing up and down).
        const push = ((room - d) / d) * FORCES.clearStrength * alpha * 4 * t * (1 - t);
        n.vx += ox * push; n.vy += oy * push;
        // The line takes the opposite push, split by where the node is along it, so the pushes add up to zero
        // (unbalanced, they kept the whole graph turning).
        a.vx -= ox * push * (1 - t); a.vy -= oy * push * (1 - t);
        b.vx -= ox * push * t; b.vy -= oy * push * t;
      }
    }
  };
  force.initialize = (list: Node[]) => { nodes = list; };
  return force as Force<Node, undefined>;
}

/** Every node back inside the box (does not fade with alpha). */
function forceHome(box: () => Point): Force<Node, undefined> {
  let nodes: Node[] = [];
  const force = () => {
    const { x: bx, y: by } = box();
    for (const n of nodes) {
      const ex = Math.abs(n.x) + n.r - bx, ey = Math.abs(n.y) + n.r - by;
      if (ex > 0) n.vx -= Math.sign(n.x) * BOUND.pull * ex * (1 + ex / BOUND.soft);
      if (ey > 0) n.vy -= Math.sign(n.y) * BOUND.pull * ey * (1 + ey / BOUND.soft);
    }
  };
  force.initialize = (list: Node[]) => { nodes = list; };
  return force as Force<Node, undefined>;
}

/** Whether segment (ax, ay)-(bx, by) touches the box [x0, x1] x [y0, y1] (Liang-Barsky clipping). */
function segmentHitsBox(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]] as [number, number][]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
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
  const loopsInput = section.querySelector<HTMLInputElement>('input[data-setting=loops]')!;
  const nodesOutput = section.querySelector<HTMLOutputElement>('output[data-setting=nodes]')!;
  const minOutput = section.querySelector<HTMLOutputElement>('output[data-setting=minSim]')!;
  const note = section.querySelector<HTMLElement>('.item-graph__note')!;
  const status = section.querySelector<HTMLElement>('.item-graph__status')!;
  const list = section.querySelector<HTMLOListElement>('.item-graph__list ol')!;
  const noun = kind === 'bills' ? ['expediente', 'expedientes'] : ['noticia', 'noticias'];

  let rows: Row[] = [], loopLinks: number[] = [], index: IndexFile | null = null;
  let settings = readSettings(kind);
  let nodes: Node[] = [], links: Link[] = [];
  let targets = new Map<Node, Point>();
  const placed = new Map<number, Point>();     // positions kept when the settings change
  const view = { x: 0, y: 0, zoom: 1, width: 0, height: 0 };
  let hovered: Node | null = null, pressed: Node | null = null, dragging = false, armed: Node | null = null;
  let pressX = 0, pressY = 0, running = false, visible = false, loaded = false;
  let stillFrames = 0, runUntil = 0, settleFrom = 0, fadeFrom = 0;
  let palette: Record<string, string> = {};

  // ---------- Lengths and forces ----------
  const [simLow, simHigh] = LINK_BY_SIMILARITY[kind].range, [gapNear, gapFar] = LINK_BY_SIMILARITY.gap;
  const gapFor = (sim: number) => {
    const t = Math.min(1, Math.max(0, (simHigh - sim) / (simHigh - simLow))), middle = (gapNear + gapFar) / 2;
    return Math.max(GAP_MIN, middle + CONTRAST * (t - 0.5) * (gapFar - gapNear));
  };
  /** Length of every link: radii plus the gap for its similarity; a tree link is raised so that all the
   *  children of a parent fit on a ring around it. */
  function setLengths() {
    const kids = new Map<Node, Node[]>();
    for (const l of links) if (!l.loop) { const list = kids.get(l.source) ?? []; list.push(l.target); kids.set(l.source, list); }
    const ring = new Map<Node, number>();
    for (const [parent, list] of kids) {
      if (list.length < 3) continue;
      ring.set(parent, list.reduce((sum, c) => sum + 2 * c.r + SIBLING_PAD, 0) / (2 * Math.PI));
    }
    for (const l of links) {
      const own = gapFor(l.sim) + l.source.r + l.target.r;
      l.length = l.loop ? own : Math.max(own, ring.get(l.source) ?? 0);
    }
  }
  /** Half the box's width and height in layout units. */
  const boxHalf = (): Point => ({ x: Math.max(50, ((view.width / 2 - FIT_PAD) / BOX_ZOOM) * BOUND.margin), y: Math.max(50, ((view.height / 2 - FIT_PAD) / BOX_ZOOM) * BOUND.margin) });
  const gravityX = forceX<Node>(0).strength(FORCES.gravity), gravityY = forceY<Node>(0).strength(FORCES.gravity);
  const linkForce = forceLink<Node, Link>([]).distance((l) => l.length)
    .strength((l) => l.loop ? FORCES.loopStrength : FORCES.treeStrength).iterations(FORCES.linkIterations);
  const simulation: Simulation<Node, undefined> = forceSimulation<Node>([]).stop()
    .alpha(ALPHA_ON).alphaDecay(0).alphaMin(0)
    .velocityDecay(FORCES.damping)
    .force('link', linkForce)
    .force('charge', forceManyBody<Node>().strength(FORCES.charge).distanceMin(FORCES.distanceMin))
    .force('collide', forceCollide<Node>((n) => n.r + 3).strength(0.8))
    .force('clearance', forceClearance(() => links))
    .force('x', gravityX)
    .force('y', gravityY)
    .force('home', forceHome(boxHalf));
  /** Gravity toward the middle, weaker sideways in a wide box (and up and down in a tall one). */
  function shapeGravity() {
    const aspect = view.width && view.height ? view.height / view.width : 1;
    gravityX.strength(FORCES.gravity * Math.min(1, Math.max(0.3, aspect)));
    gravityY.strength(FORCES.gravity * Math.min(1, Math.max(0.3, 1 / aspect)));
  }

  /** Places of the tree's nodes in a radial drawing without crossings, relative to the page's item: each node
   *  one link length farther out than its parent (never on a ring too small for its level), each subtree in a
   *  wedge as wide as its share of nodes, stretched sideways in a wide box. */
  function radialPlaces(): Map<Node, Point> {
    const byRow = new Map(nodes.map((n) => [n.row, n]));
    const children = new Map<Node, Node[]>(nodes.map((n) => [n, []]));
    for (const n of nodes.slice(1)) children.get(byRow.get(n.parentRow)!)!.push(n);
    const size = new Map<Node, number>(), depth = new Map<Node, number>([[nodes[0], 0]]);
    for (const n of nodes.slice(1)) depth.set(n, depth.get(byRow.get(n.parentRow)!)! + 1);
    for (const n of nodes.slice().reverse()) size.set(n, 1 + children.get(n)!.reduce((sum, c) => sum + size.get(c)!, 0));
    const perLevel: number[] = [];
    for (const d of depth.values()) perLevel[d] = (perLevel[d] ?? 0) + 1;
    const roomy = perLevel.map((count) => (count * RADIAL_SPACING) / (2 * Math.PI));
    const distance = new Map<Node, number>([[nodes[0], 0]]);
    for (const n of nodes.slice(1)) {
      const p = byRow.get(n.parentRow)!;
      distance.set(n, Math.max(distance.get(p)! + gapFor(n.simParent) + p.r + n.r, roomy[depth.get(n)!]));
    }
    const stretch = view.width && view.height ? Math.min(RADIAL_MAX_STRETCH, Math.max(1, Math.sqrt(view.width / view.height))) : 1;
    const places = new Map<Node, Point>([[nodes[0], { x: 0, y: 0 }]]);
    const share = (parent: Node, from: number, to: number) => {
      const kids = children.get(parent)!, total = kids.reduce((sum, c) => sum + size.get(c)!, 0);
      let angle = from;
      for (const c of kids) {
        const width = ((to - from) * size.get(c)!) / total, middle = angle + width / 2, r = distance.get(c)!;
        places.set(c, { x: r * Math.cos(middle) * stretch, y: r * Math.sin(middle) });
        share(c, angle, angle + width);
        angle += width;
      }
    };
    share(nodes[0], -Math.PI / 2, (3 * Math.PI) / 2);
    return places;
  }

  // ---------- Data and settings ----------
  const item = (row: number) => index!.items[rows[row][0]];
  const pageHref = (row: number) => `${base}/${kind === 'bills' ? 'expediente' : 'noticia'}/${item(row)[0]}/`;
  const label = (row: number) => String(item(row)[1]);
  /** 0 for the closest band ("muy parecido") to 4 for the farthest. */
  const bandOf = (sim: number) => { const i = config.bands.findIndex((cut) => sim >= cut); return i < 0 ? config.bands.length : i; };
  function detail(row: number): string {
    if (row === 0) return kind === 'bills' ? 'Este expediente' : 'Esta noticia';
    const it = item(row), sim = rows[row][2];
    const where = kind === 'bills' ? `Expediente ${it[0]} · ${it[2]}` : `${outlets[String(it[2])] ?? it[2]} · ${String(it[3]).split('-').reverse().join('/')}`;
    return `${where} · ${ITEM_GRAPH_BANDS[bandOf(sim)]} (${similarityLabel(sim)})`;
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
    loopsInput.checked = settings.loops;
  }

  function rebuild() {
    if (!index) return;
    showSettings();
    const { shown, passing } = visibleRows();
    const byRow = new Map<number, Node>();
    nodes = shown.map((row) => {
      const [, parentRow, simRoot, simParent] = rows[row];
      const node: Node = { row, parentRow, simRoot, simParent, r: SIZE.min, x: 0, y: 0, vx: 0, vy: 0 };
      byRow.set(row, node);
      return node;
    });
    const below = new Map<Node, number>(nodes.map((n) => [n, 0]));   // descendants: children come after parents
    for (const n of nodes.slice(1).reverse()) { const p = byRow.get(n.parentRow)!; below.set(p, below.get(p)! + below.get(n)! + 1); }
    for (const n of nodes) n.r = Math.min(SIZE.max, SIZE.min + SIZE.perRoot * Math.sqrt(below.get(n)!));
    // Known nodes stay where they are; a new one starts where the radial drawing puts it, measured from its
    // parent's actual position, so a new branch grows outward on its own side.
    targets = radialPlaces();
    for (const n of nodes) {
      const known = placed.get(n.row), parent = byRow.get(n.parentRow), place = targets.get(n)!;
      if (known) { n.x = known.x; n.y = known.y; }
      else if (parent) { const from = targets.get(parent)!; n.x = parent.x + place.x - from.x; n.y = parent.y + place.y - from.y; }
      else { n.x = place.x; n.y = place.y; }
    }
    links = nodes.slice(1).map((n) => ({ source: byRow.get(n.parentRow)!, target: n, sim: n.simParent, loop: false, length: 0 }));
    let loopCount = 0;
    if (settings.loops) {
      for (let i = 0; i < loopLinks.length; i += 3) {
        const a = byRow.get(loopLinks[i]), b = byRow.get(loopLinks[i + 1]);
        if (!a || !b || a.parentRow === b.row || b.parentRow === a.row) continue;   // already a tree link
        links.push({ source: a, target: b, sim: loopLinks[i + 2], loop: true, length: 0 }); loopCount++;
      }
    }
    setLengths();
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
    const [similar, them, same] = kind === 'bills' ? ['parecidos', 'ellos', 'los mismos'] : ['parecidas', 'ellas', 'las mismas'];
    const loopText = settings.loops ? ` y ${loopCount} ${loopCount === 1 ? 'conexión' : 'conexiones'} entre ${them}` : '';
    canvas.setAttribute('aria-label', `Grafo con ${count} ${count === 1 ? noun[0] : noun[1]} ${similar}${loopText}. La lista de abajo tiene ${same} ${noun[1]}.`);
    list.replaceChildren(...nodes.slice(1).map((n) => {
      const li = document.createElement('li');
      li.append(
        Object.assign(document.createElement('a'), { href: pageHref(n.row), textContent: label(n.row) }),
        Object.assign(document.createElement('span'), { className: 'small muted', textContent: ` · ${detail(n.row)}` }),
      );
      return li;
    }));
    start();
  }

  // ---------- View and drawing ----------
  function readPalette() {
    const css = getComputedStyle(section);
    palette = Object.fromEntries(['--sim-1', '--sim-2', '--sim-3', '--sim-4', '--sim-5', '--notice-border', '--muted', '--surface', '--text', '--accent']
      .map((name) => [name, css.getPropertyValue(name).trim()]));
  }
  const fill = (n: Node) => n.row === 0 ? palette['--notice-border'] : palette[`--sim-${bandOf(n.simRoot) + 1}`];

  function resize() {
    const rect = box.getBoundingClientRect(), ratio = Math.min(2, window.devicePixelRatio || 1);
    view.width = rect.width; view.height = rect.height;
    canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    shapeGravity();
    if (nodes.length) targets = radialPlaces();
  }

  /** Moves the view toward the one centered on the middle of the box that shows every circle; returns
   *  whether it is still moving. */
  function fit(instant: boolean): boolean {
    if (!nodes.length || !view.width) return false;
    let reachX = 1, reachY = 1;
    for (const n of nodes) { reachX = Math.max(reachX, Math.abs(n.x) + n.r); reachY = Math.max(reachY, Math.abs(n.y) + n.r); }
    const zoom = Math.min(ZOOM_MAX, Math.max(BOX_ZOOM, Math.min((view.width / 2 - FIT_PAD) / reachX, (view.height / 2 - FIT_PAD) / reachY)));
    const ease = instant ? 1 : FIT_EASE;
    const dx = -view.x, dy = -view.y, dz = zoom - view.zoom;
    view.x += dx * ease; view.y += dy * ease; view.zoom += dz * ease;
    return Math.abs(dx * view.zoom) > 0.5 || Math.abs(dy * view.zoom) > 0.5 || Math.abs(dz) > 0.002;
  }
  const toScreen = (n: Point): [number, number] => [view.width / 2 + (n.x - view.x) * view.zoom, view.height / 2 + (n.y - view.y) * view.zoom];

  function draw() {
    context.clearRect(0, 0, view.width, view.height);
    const focus = hovered ?? armed ?? (dragging ? pressed : null);
    // As in Obsidian, a focused node keeps its neighbors and their links; the rest fades.
    const near = new Set<Node>();
    if (focus) {
      near.add(focus);
      for (const l of links) if (l.source === focus || l.target === focus) { near.add(l.source); near.add(l.target); }
    }
    const scale = Math.min(1.2, Math.max(0.6, view.zoom));
    context.lineCap = 'round';
    for (const l of links) {
      const [x1, y1] = toScreen(l.source), [x2, y2] = toScreen(l.target);
      const lit = focus !== null && (l.source === focus || l.target === focus);
      context.strokeStyle = lit ? palette['--accent'] : palette['--muted'];
      context.globalAlpha = lit ? 0.9 : focus ? DIM_LINKS : l.loop ? 0.25 : 0.45;   // loops are long (they barely pull): fainter
      context.lineWidth = (lit ? 1.6 : 0.5 + 1.2 * Math.max(0, (l.sim - 55) / 40)) * scale;
      context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
    }
    // Least similar first, so the closest ones and the page's item end up on top.
    const order = nodes.slice(1).sort((a, b) => a.simRoot - b.simRoot);
    order.push(nodes[0]);
    for (const n of order) {
      const [x, y] = toScreen(n), r = Math.max(1.5, n.r * view.zoom);
      context.globalAlpha = 1;   // the halo hides the lines behind the circle, even when the circle is faded
      context.beginPath(); context.arc(x, y, r + HALO, 0, Math.PI * 2);
      context.fillStyle = palette['--surface']; context.fill();
      context.globalAlpha = focus && !near.has(n) ? DIM_NODES : 1;
      context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2);
      context.fillStyle = fill(n); context.fill();
      if (n === focus) { context.lineWidth = 2.5; context.strokeStyle = palette['--text']; context.stroke(); }
    }
    context.globalAlpha = 1;
    if (focus) placeTip(focus);
  }

  /** Whether the nodes are about still: their mean and top speed on screen, in px per tick, under REST. */
  function still(): boolean {
    let top = 0, sum = 0;
    for (const n of nodes) { const v = Math.max(Math.abs(n.vx), Math.abs(n.vy)) * view.zoom; sum += v; if (v > top) top = v; }
    return top < REST.max && sum / Math.max(1, nodes.length) < REST.mean;
  }

  function frame() {
    const started = performance.now();
    let ticks = 0;
    do { simulation.tick(); ticks++; }
    while (ticks < MAX_TICKS_PER_FRAME && performance.now() - started < TICK_BUDGET_MS);
    const moving = dragging ? false : fit(false);
    for (const n of nodes) placed.set(n.row, { x: n.x, y: n.y });
    draw();
    const now = performance.now();
    if (!fadeFrom) {   // settling at full strength until about still (or too long), then fading out
      stillFrames = !dragging && !moving && still() ? stillFrames + 1 : 0;
      if (!dragging && ((stillFrames >= REST_FRAMES && now > settleFrom + SETTLE.min) || now > runUntil)) fadeFrom = now;
    }
    let done = false;
    if (fadeFrom) {
      const t = Math.min(1, (now - fadeFrom) / SETTLE.fade);
      simulation.alpha(ALPHA_ON * (1 - t) * (1 - t));   // eases out
      done = t >= 1 && !moving;
    }
    if (visible && !done) requestAnimationFrame(frame);
    else running = false;
  }

  /** Runs the layout until it rests again (after a change, a drag or the graph coming into view). */
  function start() {
    stillFrames = 0; fadeFrom = 0;
    settleFrom = performance.now();
    runUntil = settleFrom + MAX_RUN_MS;
    simulation.alpha(ALPHA_ON);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches && !dragging) {   // no animation: settle and draw once
      for (let i = 0, calm = 0; i < 600 && calm < REST_FRAMES; i++) { simulation.tick(); calm = still() ? calm + 1 : 0; }
      for (const n of nodes) placed.set(n.row, { x: n.x, y: n.y });
      fit(true); draw();
      return;
    }
    if (!running && visible) { running = true; requestAnimationFrame(frame); }
  }

  // ---------- Pointer ----------
  /** The title box goes at one of the node's four corners: the one that covers none (or the fewest) of the
   *  node's lines and neighbors and fits in the box, preferring the side that faces the middle of the box;
   *  while the node stays the same, the corner it had if it is still as good. */
  function placeTip(n: Node) {
    if (tip.hidden || tip.dataset.row !== String(n.row)) {   // the content only changes with the node
      tip.replaceChildren(
        Object.assign(document.createElement('strong'), { textContent: label(n.row) }),
        Object.assign(document.createElement('span'), { textContent: detail(n.row) }),
      );
      tip.dataset.row = String(n.row);
      delete tip.dataset.side;
      tip.hidden = false;
    }
    const [x, y] = toScreen(n), r = n.r * view.zoom, w = tip.offsetWidth, h = tip.offsetHeight, gap = r + 6, edge = 4, pad = 3;
    const segments: [number, number, number, number][] = [], circles: [number, number, number][] = [[x, y, r]];
    for (const l of links) {
      if (l.source !== n && l.target !== n) continue;
      const [x1, y1] = toScreen(l.source), [x2, y2] = toScreen(l.target), other = l.source === n ? l.target : l.source;
      segments.push([x1, y1, x2, y2]);
      circles.push([...toScreen(other), other.r * view.zoom]);
    }
    const toLeft = x > view.width / 2, toTop = y > view.height / 2;   // the side that faces the middle
    const corners: [string, number, number, number][] = [
      ['above-right', x + gap, y - gap - h, (toLeft ? 1 : 0) + (toTop ? 0 : 1)],
      ['above-left', x - gap - w, y - gap - h, (toLeft ? 0 : 1) + (toTop ? 0 : 1)],
      ['below-right', x + gap, y + gap, (toLeft ? 1 : 0) + (toTop ? 1 : 0)],
      ['below-left', x - gap - w, y + gap, (toLeft ? 0 : 1) + (toTop ? 1 : 0)],
    ];
    let best: [string, number, number] = ['below-right', x + gap, y + gap], bestScore = Infinity;
    for (const [side, left0, top0, away] of corners) {
      const left = Math.min(Math.max(left0, edge), view.width - w - edge), top = Math.min(Math.max(top0, edge), view.height - h - edge);
      const x0 = left - pad, y0 = top - pad, x1 = left + w + pad, y1 = top + h + pad;
      let covered = 0;
      for (const [cx, cy, cr] of circles) {
        const nx = Math.min(Math.max(cx, x0), x1), ny = Math.min(Math.max(cy, y0), y1);
        if ((nx - cx) ** 2 + (ny - cy) ** 2 < cr * cr) covered++;
      }
      for (const [ax, ay, bx, by] of segments) if (segmentHitsBox(ax, ay, bx, by, x0, y0, x1, y1)) covered++;
      const shifted = Math.abs(left - left0) + Math.abs(top - top0) > 0 ? 1 : 0;   // had to be pushed into the box
      const score = covered * 10 + shifted * 3 + away - (side === tip.dataset.side ? 0.5 : 0);
      if (score < bestScore) { bestScore = score; best = [side, left, top]; }
    }
    tip.dataset.side = best[0];
    tip.style.left = `${best[1]}px`;
    tip.style.top = `${best[2]}px`;
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

  // Mouse and pen drag any node, the page's item too (it comes back to the middle when let go). On a touch
  // screen a drag would fight the page's scrolling, so a tap shows the title and a second tap opens the page.
  canvas.addEventListener('pointerdown', (event) => {
    const n = nodeAt(event);
    if (!n) { hideTip(); if (!running) draw(); return; }
    pressed = n; pressX = event.clientX; pressY = event.clientY;
    if (event.pointerType !== 'touch') { canvas.setPointerCapture(event.pointerId); event.preventDefault(); }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (pressed && event.pointerType !== 'touch') {
      if (!dragging && Math.hypot(event.clientX - pressX, event.clientY - pressY) > DRAG_THRESHOLD) {
        dragging = true; canvas.classList.add('is-dragging');
        start();
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
      start();
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
    settings = { nodes: Number(nodesInput.value), minSim: Number(minInput.value), loops: loopsInput.checked };
    writeSettings(kind, settings);
    rebuild();
  };
  nodesInput.addEventListener('input', changeSetting);
  minInput.addEventListener('input', changeSetting);
  loopsInput.addEventListener('change', changeSetting);
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey(kind)) return;
    settings = readSettings(kind);
    if (loaded) rebuild(); else showSettings();
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
      const graph = await treeResponse.json() as GraphFile | Row[];   // the first exports were the bare list of rows
      rows = Array.isArray(graph) ? graph : graph.nodes;
      loopLinks = Array.isArray(graph) ? [] : graph.links ?? [];
      nodesInput.max = String(Math.min(ITEM_GRAPH_MAX_NODES, Math.max(5, rows.length - 1)));
      status.hidden = true;
      loaded = true;
      readPalette();
      resize();
      rebuild();
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
    if (loaded) start();
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
