// Chapter 5: a small force-directed graph to play with. The forces are those of the local graph pages
// (private_visuals/graph/engine.js), ported to a module on top of d3-force:
//   "own"       springs whose pull stops growing past a few link lengths, a short-range repulsion that fades to
//               zero at its radius, a pull toward the center and a pull toward each node's group;
//   "obsidian"  what Obsidian's graph view does: d3's link, many-body, collide and center forces, in a world
//               three times smaller, with the charge being minus the repulsion slider cubed.
// The node under the pointer (or being dragged) shows one arrow per force acting on it.
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { Force, SimulationNodeDatum } from 'd3-force';
import { alpha as translucent, color, onTheme, reducedMotion, segmented, whenVisible } from './core';
import { dec, int } from '../../lib/process/format';

interface GraphNode extends SimulationNodeDatum { id: number; group: number; degree: number; x: number; y: number; vx: number; vy: number }
interface GraphLink { source: GraphNode; target: GraphNode; base: number; bias: number }
type Mode = 'own' | 'obsidian';
type ForceKey = 'repel' | 'linkStrength' | 'linkDistance' | 'center' | 'group';
interface Slider { min: number; max: number; step: number; value: number; digits: number }

const SLIDERS: Record<Mode, Record<ForceKey, Slider>> = {
  own: {
    repel: { min: 0, max: 3000, step: 10, value: 300, digits: 0 },
    linkStrength: { min: 0, max: 3, step: 0.05, value: 1, digits: 2 },
    linkDistance: { min: 2, max: 250, step: 1, value: 30, digits: 0 },
    center: { min: 0, max: 0.15, step: 0.001, value: 0.008, digits: 3 },
    group: { min: 0, max: 0.3, step: 0.005, value: 0, digits: 3 },
  },
  obsidian: {
    repel: { min: 0, max: 20, step: 0.1, value: 10, digits: 1 },
    linkStrength: { min: 0, max: 1, step: 0.01, value: 1, digits: 2 },
    linkDistance: { min: 30, max: 500, step: 1, value: 250, digits: 0 },
    center: { min: 0, max: 1, step: 0.01, value: 0.1, digits: 2 },
    group: { min: 0, max: 0.3, step: 0.005, value: 0, digits: 3 },
  },
};
const REPEL_RADIUS = 80, COLLIDE = 0.25, COLLIDE_PAD = 2, MAX_STRETCH = 2.5, NODE_RADIUS = 5;
const DAMPING: Record<Mode, number> = { own: 0.4, obsidian: 0.6 };
const OBSIDIAN = { scale: 3, distanceMin: 30, collide: 60, collideStrength: 0.5, reheat: 0.3 };
const ALPHA_DECAY = 1 - Math.pow(0.001, 1 / 300);
const GROUP_ROOM = 1.5, GROUP_PUSH = 2;
const GROUP_COLORS = ['--cat-1', '--cat-2', '--cat-3'];
const ARROWS: { key: 'link' | 'repel' | 'center' | 'group'; color: string }[] = [
  { key: 'link', color: '--accent' }, { key: 'repel', color: '--div-neg' }, { key: 'center', color: '--ink-2' }, { key: 'group', color: '--warn' },
];

// ---------- The graph: three groups, a few links between them ----------
const GROUP_SIZES = [5, 5, 4];
const PAIRS: [number, number][] = [
  [0, 1], [0, 2], [1, 2], [2, 3], [3, 4], [0, 4],
  [5, 6], [5, 7], [6, 7], [7, 8], [8, 9], [6, 9],
  [10, 11], [11, 12], [12, 13], [10, 13],
  [3, 5], [9, 10],
];
const nodes: GraphNode[] = GROUP_SIZES.flatMap((size, group) => Array.from({ length: size }, () => ({ id: 0, group, degree: 0, x: 0, y: 0, vx: 0, vy: 0 })));
nodes.forEach((node, index) => {
  node.id = index;
  const angle = (index / nodes.length) * Math.PI * 2;
  node.x = Math.cos(angle) * 60;
  node.y = Math.sin(angle) * 60;
});
PAIRS.forEach(([a, b]) => { nodes[a].degree += 1; nodes[b].degree += 1; });
const links: GraphLink[] = PAIRS.map(([a, b]) => {
  const source = nodes[a], target = nodes[b];
  return { source, target, base: 1 / Math.min(source.degree, target.degree), bias: source.degree / (source.degree + target.degree) };
});

let mode: Mode = 'own';
const settings: Record<ForceKey, number> = { repel: 0, linkStrength: 0, linkDistance: 0, center: 0, group: 0 };

// ---------- Forces of the engine's own mode ----------
function springForce(): Force<GraphNode, undefined> {
  return (alpha) => {
    const limit = MAX_STRETCH * settings.linkDistance;
    for (const link of links) {
      const { source: s, target: t } = link;
      let dx = t.x + t.vx - s.x - s.vx, dy = t.y + t.vy - s.y - s.vy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
      const f = (Math.min(d - settings.linkDistance, limit) / d) * alpha * Math.min(1.5, settings.linkStrength * link.base);
      dx *= f; dy *= f;
      t.vx -= dx * link.bias; t.vy -= dy * link.bias;
      s.vx += dx * (1 - link.bias); s.vy += dy * (1 - link.bias);
    }
  };
}

/** Push between two nodes of the own mode's repulsion, as a factor on (b - a). */
function repelFactor(d2: number, k: number): number {
  let w = k * (1 / d2 - 1 / (REPEL_RADIUS * REPEL_RADIUS));
  const touch = 2 * NODE_RADIUS + COLLIDE_PAD;
  if (d2 < touch * touch) { const d = Math.sqrt(d2); w += (COLLIDE * (touch - d)) / d; }
  return w;
}

function repelForce(): Force<GraphNode, undefined> {
  return (alpha) => {
    if (settings.repel <= 0) return;
    const k = settings.repel * alpha;
    for (let a = 0; a < nodes.length; a += 1) {
      for (let b = a + 1; b < nodes.length; b += 1) {
        let dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y, d2 = dx * dx + dy * dy;
        if (d2 >= REPEL_RADIUS * REPEL_RADIUS) continue;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const w = repelFactor(d2, k);
        nodes[a].vx -= dx * w; nodes[a].vy -= dy * w;
        nodes[b].vx += dx * w; nodes[b].vy += dy * w;
      }
    }
  };
}

interface GroupState { x: number; y: number; n: number; spread: number; px: number; py: number }
function groupStates(): Map<number, GroupState> {
  const groups = new Map<number, GroupState>();
  for (const node of nodes) {
    let g = groups.get(node.group);
    if (!g) groups.set(node.group, g = { x: 0, y: 0, n: 0, spread: 0, px: 0, py: 0 });
    g.x += node.x; g.y += node.y; g.n += 1;
  }
  for (const g of groups.values()) { g.x /= g.n; g.y /= g.n; }
  for (const node of nodes) { const g = groups.get(node.group); if (g) g.spread += (node.x - g.x) ** 2 + (node.y - g.y) ** 2; }
  for (const g of groups.values()) g.spread = Math.sqrt(g.spread / g.n);
  return groups;
}

function groupForce(): Force<GraphNode, undefined> {
  return (alpha) => {
    if (settings.group <= 0) return;
    const groups = groupStates(), list = [...groups.values()];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i], b = list[j];
        let dx = a.x - b.x, dy = a.y - b.y, distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 1e-6) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; distance = Math.sqrt(dx * dx + dy * dy); }
        const overlap = GROUP_ROOM * (a.spread + b.spread) - distance;
        if (overlap <= 0) continue;
        const f = (overlap / distance) * GROUP_PUSH * settings.group * alpha, share = b.n / (a.n + b.n);
        a.px += dx * f * share; a.py += dy * f * share;
        b.px -= dx * f * (1 - share); b.py -= dy * f * (1 - share);
      }
    }
    const k = settings.group * alpha;
    for (const node of nodes) {
      const g = groups.get(node.group);
      if (!g) continue;
      node.vx += (g.x - node.x) * k + g.px;
      node.vy += (g.y - node.y) * k + g.py;
    }
  };
}

// ---------- Simulation ----------
const simulation = forceSimulation<GraphNode>(nodes).stop().alphaDecay(ALPHA_DECAY);
const obsidianLinks = links.map((link) => ({ source: link.source, target: link.target, base: link.base }));
const obsidianDistance = () => settings.linkDistance / OBSIDIAN.scale;
const obsidianCharge = () => -Math.max(1, settings.repel ** 3) / (OBSIDIAN.scale * OBSIDIAN.scale);

function applyForces(): void {
  if (mode === 'own') {
    simulation.force('link', springForce()).force('charge', repelForce()).force('collide', null);
  } else {
    simulation
      .force('link', forceLink<GraphNode, (typeof obsidianLinks)[number]>(obsidianLinks).distance(obsidianDistance()).strength((link) => settings.linkStrength * link.base))
      .force('charge', forceManyBody<GraphNode>().strength(obsidianCharge()).distanceMin(OBSIDIAN.distanceMin / OBSIDIAN.scale))
      .force('collide', forceCollide<GraphNode>(OBSIDIAN.collide / OBSIDIAN.scale).strength(OBSIDIAN.collideStrength));
  }
  simulation.force('x', forceX<GraphNode>(0).strength(settings.center)).force('y', forceY<GraphNode>(0).strength(settings.center))
    .force('group', groupForce()).velocityDecay(DAMPING[mode]);
}

/** What each force does to one node right now (alpha = 1), for the arrows. */
function forcesOn(node: GraphNode): Record<'link' | 'repel' | 'center' | 'group', [number, number]> {
  const result = { link: [0, 0], repel: [0, 0], center: [-node.x * settings.center, -node.y * settings.center], group: [0, 0] } as Record<'link' | 'repel' | 'center' | 'group', [number, number]>;
  for (const link of links) {
    if (link.source !== node && link.target !== node) continue;
    const dx = link.target.x - link.source.x, dy = link.target.y - link.source.y, d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
    const f = mode === 'own'
      ? (Math.min(d - settings.linkDistance, MAX_STRETCH * settings.linkDistance) / d) * Math.min(1.5, settings.linkStrength * link.base)
      : ((d - obsidianDistance()) / d) * settings.linkStrength * link.base;
    const share = link.target === node ? -link.bias : 1 - link.bias;
    result.link[0] += dx * f * share; result.link[1] += dy * f * share;
  }
  for (const other of nodes) {
    if (other === node) continue;
    const dx = other.x - node.x, dy = other.y - node.y;
    let d2 = Math.max(1, dx * dx + dy * dy);
    if (mode === 'own') {
      if (d2 >= REPEL_RADIUS * REPEL_RADIUS || settings.repel <= 0) continue;
      const w = repelFactor(d2, settings.repel);
      result.repel[0] -= dx * w; result.repel[1] -= dy * w;
    } else {
      const minimum = (OBSIDIAN.distanceMin / OBSIDIAN.scale) ** 2;
      if (d2 < minimum) d2 = Math.sqrt(minimum * d2);
      const w = obsidianCharge() / d2;
      result.repel[0] += dx * w; result.repel[1] += dy * w;
    }
  }
  if (settings.group > 0) {
    const g = groupStates().get(node.group);
    if (g) result.group = [(g.x - node.x) * settings.group, (g.y - node.y) * settings.group];
  }
  return result;
}

// ---------- Canvas ----------
const lab = document.getElementById('force-lab');
const canvas = lab?.querySelector('canvas') ?? null;
const context = canvas?.getContext('2d') ?? null;
const view = { x: 0, y: 0, zoom: 2, width: 0, height: 0 };
let dragged: GraphNode | null = null, hovered: GraphNode | null = null, running = false, started = false;

const toScreen = (x: number, y: number): [number, number] => [view.width / 2 + (x - view.x) * view.zoom, view.height / 2 + (y - view.y) * view.zoom];
const toWorld = (sx: number, sy: number): [number, number] => [view.x + (sx - view.width / 2) / view.zoom, view.y + (sy - view.height / 2) / view.zoom];

function fit(instant: boolean): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const node of nodes) { x0 = Math.min(x0, node.x); y0 = Math.min(y0, node.y); x1 = Math.max(x1, node.x); y1 = Math.max(y1, node.y); }
  const zoom = Math.max(0.35, Math.min(4.5, Math.min((view.width - 110) / Math.max(1, x1 - x0), (view.height - 110) / Math.max(1, y1 - y0))));
  const ease = instant ? 1 : 0.08;
  view.zoom += (zoom - view.zoom) * ease;
  view.x += ((x0 + x1) / 2 - view.x) * ease;
  view.y += ((y0 + y1) / 2 - view.y) * ease;
}

function resize(): void {
  if (!canvas || !context) return;
  const box = canvas.getBoundingClientRect(), ratio = Math.min(2, devicePixelRatio || 1);
  view.width = box.width; view.height = box.height;
  canvas.width = Math.round(box.width * ratio); canvas.height = Math.round(box.height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function arrow(from: [number, number], vector: [number, number], length: number, stroke: string): void {
  if (!context) return;
  const size = Math.hypot(vector[0], vector[1]);
  if (size < 1e-9 || length < 4) return;
  const ux = vector[0] / size, uy = vector[1] / size;
  const start: [number, number] = [from[0] + ux * 13, from[1] + uy * 13], end: [number, number] = [start[0] + ux * length, start[1] + uy * length];
  context.strokeStyle = stroke; context.fillStyle = stroke; context.lineWidth = 3; context.lineCap = 'round';
  context.beginPath(); context.moveTo(start[0], start[1]); context.lineTo(end[0], end[1]); context.stroke();
  context.beginPath();
  context.moveTo(end[0] + ux * 8, end[1] + uy * 8);
  context.lineTo(end[0] - uy * 5.5, end[1] + ux * 5.5);
  context.lineTo(end[0] + uy * 5.5, end[1] - ux * 5.5);
  context.closePath(); context.fill();
}

function draw(): void {
  if (!context) return;
  context.clearRect(0, 0, view.width, view.height);
  const focus = dragged ?? hovered;
  context.lineCap = 'round';
  for (const link of links) {
    const [x1, y1] = toScreen(link.source.x, link.source.y), [x2, y2] = toScreen(link.target.x, link.target.y);
    const lit = focus && (link.source === focus || link.target === focus);
    context.strokeStyle = lit ? color('--accent') : translucent('--ink-3', 0.45);
    context.lineWidth = lit ? 2.5 : 1.5;
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
  }
  const radius = Math.max(6, Math.min(11, NODE_RADIUS * view.zoom * 0.75));
  for (const node of nodes) {
    const [x, y] = toScreen(node.x, node.y);
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = color(GROUP_COLORS[node.group]); context.fill();
    context.lineWidth = node === focus ? 3 : 2;
    context.strokeStyle = node === focus ? color('--ink') : color('--surface');
    context.stroke();
  }
  if (focus) {
    const forces = forcesOn(focus), origin = toScreen(focus.x, focus.y);
    const peak = Math.max(...ARROWS.map((item) => Math.hypot(...forces[item.key])));
    if (peak > 1e-9) {
      for (const item of ARROWS) arrow(origin, forces[item.key], 16 + 58 * (Math.hypot(...forces[item.key]) / peak), color(item.color));
    }
    ARROWS.forEach((item) => {
      const output = lab?.querySelector<HTMLElement>(`[data-arrow="${item.key}"]`);
      if (output) output.textContent = peak > 1e-9 ? `${int((100 * Math.hypot(...forces[item.key])) / peak)} %` : '-';
    });
  } else {
    lab?.querySelectorAll<HTMLElement>('[data-arrow]').forEach((output) => { output.textContent = '-'; });
  }
}

function frame(): void {
  simulation.tick();
  if (!dragged) fit(false);
  draw();
  if (dragged || simulation.alpha() > simulation.alphaMin()) requestAnimationFrame(frame); else running = false;
}

function reheat(amount: number): void {
  if (!started) return;
  simulation.alpha(Math.max(simulation.alpha(), amount));
  if (reducedMotion() && !dragged) {   // no animation: settle at once and draw the result
    for (let tick = 0; tick < 300 && simulation.alpha() > simulation.alphaMin(); tick += 1) simulation.tick();
    fit(true); draw();
    return;
  }
  if (!running) { running = true; requestAnimationFrame(frame); }
}

// ---------- Controls ----------
const inputs = new Map<ForceKey, HTMLInputElement>();
lab?.querySelectorAll<HTMLInputElement>('input[data-force]').forEach((input) => inputs.set(input.dataset.force as ForceKey, input));

function showValue(key: ForceKey): void {
  const output = lab?.querySelector<HTMLElement>(`output[data-force-value="${key}"]`);
  if (output) output.textContent = dec(settings[key], SLIDERS[mode][key].digits);
}

function loadSliders(): void {
  inputs.forEach((input, key) => {
    const slider = SLIDERS[mode][key];
    input.min = String(slider.min); input.max = String(slider.max); input.step = String(slider.step); input.value = String(slider.value);
    settings[key] = slider.value;
    showValue(key);
  });
  applyForces();
}

function nodeAt(event: PointerEvent): GraphNode | null {
  if (!canvas) return null;
  const box = canvas.getBoundingClientRect(), px = event.clientX - box.left, py = event.clientY - box.top;
  let best: GraphNode | null = null, bestDistance = 22;
  for (const node of nodes) {
    const [x, y] = toScreen(node.x, node.y), distance = Math.hypot(x - px, y - py);
    if (distance < bestDistance) { best = node; bestDistance = distance; }
  }
  return best;
}

function moveDragged(event: PointerEvent): void {
  if (!canvas || !dragged) return;
  const box = canvas.getBoundingClientRect();
  [dragged.fx, dragged.fy] = toWorld(event.clientX - box.left, event.clientY - box.top);
}

if (lab && canvas && context) {
  const modeGroup = lab.querySelector('.segmented');
  if (modeGroup) segmented(modeGroup, (value) => { mode = value as Mode; loadSliders(); reheat(0.6); });
  inputs.forEach((input, key) => input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    showValue(key);
    applyForces();
    reheat(mode === 'own' ? 0.5 : OBSIDIAN.reheat);
  }));
  lab.querySelector('[data-lab="shake"]')?.addEventListener('click', () => {
    nodes.forEach((node) => { node.x += (Math.random() - 0.5) * 60; node.y += (Math.random() - 0.5) * 60; });
    reheat(0.8);
  });
  lab.querySelector('[data-lab="reset"]')?.addEventListener('click', () => { loadSliders(); reheat(0.6); });

  canvas.addEventListener('pointerdown', (event) => {
    const node = nodeAt(event);
    if (!node) return;
    dragged = node;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-dragging');
    moveDragged(event);
    simulation.alphaTarget(0.3);
    reheat(0.3);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (dragged) { moveDragged(event); return; }
    const node = nodeAt(event);
    if (node !== hovered) { hovered = node; canvas.classList.toggle('is-over', !!node); if (!running) draw(); }
  });
  const release = () => {
    if (!dragged) return;
    dragged.fx = null; dragged.fy = null;
    hovered = dragged; dragged = null;
    canvas.classList.remove('is-dragging');
    simulation.alphaTarget(0);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { if (!dragged && hovered) { hovered = null; if (!running) draw(); } });

  loadSliders();
  whenVisible(lab, () => {
    started = true;
    resize();
    new ResizeObserver(() => { resize(); fit(true); draw(); }).observe(canvas);
    if (reducedMotion()) { reheat(1); return; }
    for (let tick = 0; tick < 40; tick += 1) simulation.tick();   // start already untangled, then settle in view
    fit(true);
    reheat(0.5);
  });
  onTheme(draw);
}
