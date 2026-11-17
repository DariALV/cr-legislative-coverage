// The similarity graph at the end of a bill or news page (#71). The tree is precomputed by
// export_item_graphs.py: one row per node in order of entry, [position in the index, row of the parent
// (-1 for the page's own item), cosine to the page's item x 100, cosine to the parent x 100]. Showing N nodes
// means taking the first N + 1 rows, so the slider only cuts the list. Data is fetched when the section
// comes into view; the index of a kind is shared by every page and stays in the browser cache.
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { SimulationNodeDatum } from 'd3-force';

type Kind = 'bills' | 'news';
type Row = [number, number, number, number];
interface IndexFile { fields: string[]; items: (string | number)[][]; params: Record<string, unknown> }
interface Node extends SimulationNodeDatum { row: number; parent: number; simRoot: number; simParent: number; size: number; x: number; y: number }
interface Link { source: Node; target: Node; sim: number }

const SVG = 'http://www.w3.org/2000/svg';
// Cosines mapped from the palest to the darkest color (below and above are clamped).
const COLOR_RANGE: Record<Kind, [number, number]> = { bills: [40, 80], news: [55, 90] };
const ROOT_RADIUS = 9, PAD = 14, TICKS = 300;
const MAX_ZOOM = 2.5;   // a small tree is spread out to fill the box; the circles keep their size
const indexCache = new Map<string, Promise<IndexFile>>();

const decimal = (cosine100: number) => (cosine100 / 100).toFixed(2).replace('.', ',');

function loadIndex(url: string): Promise<IndexFile> {
  if (!indexCache.has(url)) {
    indexCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<IndexFile>;
    }));
  }
  return indexCache.get(url)!;
}

function setup(section: HTMLElement) {
  const kind = section.dataset.kind as Kind;
  const base = section.dataset.base!.replace(/\/+$/, '');
  const outlets: Record<string, string> = JSON.parse(section.dataset.outlets ?? '{}');
  const canvas = section.querySelector<HTMLElement>('.item-graph__canvas')!;
  const svg = section.querySelector<SVGSVGElement>('svg')!;
  const tip = section.querySelector<HTMLElement>('.item-graph__tip')!;
  const slider = section.querySelector<HTMLInputElement>('input[type=range]')!;
  const output = section.querySelector<HTMLOutputElement>('output')!;
  const list = section.querySelector<HTMLOListElement>('.item-graph__list ol')!;
  const status = section.querySelector<HTMLElement>('.item-graph__status')!;
  let rows: Row[] = [], index: IndexFile | null = null;
  const placed = new Map<number, { x: number; y: number }>();   // positions kept when the slider moves
  let armed: number | null = null, lastPointer = 'mouse';

  const item = (row: number) => index!.items[rows[row][0]];
  const pageHref = (row: number) => kind === 'bills' ? `${base}/expediente/${item(row)[0]}/` : `${base}/noticia/${item(row)[0]}/`;
  const label = (row: number) => String(item(row)[1]);
  function detail(row: number): string {
    const it = item(row);
    if (row === 0) return kind === 'bills' ? 'Este expediente' : 'Esta noticia';
    const where = kind === 'bills' ? `Expediente ${it[0]} · ${it[2]}` : `${outlets[String(it[2])] ?? it[2]} · ${String(it[3]).split('-').reverse().join('/')}`;
    return `${where} · parecido ${decimal(rows[row][2])}`;
  }

  function showTip(row: number, x: number, y: number) {
    tip.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: label(row) }),
      Object.assign(document.createElement('span'), { textContent: detail(row) }),
    );
    tip.hidden = false;
    const box = canvas.getBoundingClientRect();
    const left = Math.min(Math.max(x + 12, 4), box.width - tip.offsetWidth - 4);
    const top = y + 14 + tip.offsetHeight > box.height ? y - tip.offsetHeight - 10 : y + 14;
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(top, 4)}px`;
  }
  const hideTip = () => { tip.hidden = true; armed = null; };

  function layout(count: number): { nodes: Node[]; links: Link[] } {
    const nodes: Node[] = rows.slice(0, count + 1).map((r, i) => ({
      row: i, parent: r[1], simRoot: r[2], simParent: r[3], size: 0, x: 0, y: 0,
    }));
    for (let i = nodes.length - 1; i > 0; i--) nodes[nodes[i].parent].size += nodes[i].size + 1;
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const n of nodes) {
      const known = placed.get(n.row);
      if (known) { n.x = known.x; n.y = known.y; continue; }
      if (n.row === 0) continue;
      const p = nodes[n.parent], angle = random() * Math.PI * 2;
      n.x = p.x + Math.cos(angle) * 20;
      n.y = p.y + Math.sin(angle) * 20;
    }
    nodes[0].fx = 0; nodes[0].fy = 0;
    const links: Link[] = nodes.slice(1).map((n) => ({ source: nodes[n.parent], target: n, sim: n.simParent }));
    const simulation = forceSimulation(nodes)
      .force('link', forceLink<Node, Link>(links).distance((l) => 14 + radius(l.source) + radius(l.target)).strength(0.9))
      .force('charge', forceManyBody<Node>().strength(-45).distanceMax(220))
      .force('collide', forceCollide<Node>((n) => radius(n) + 2))
      .force('x', forceX<Node>(0).strength(0.04))
      .force('y', forceY<Node>(0).strength(0.04))
      .stop();
    for (let i = 0; i < TICKS; i++) simulation.tick();
    for (const n of nodes) placed.set(n.row, { x: n.x, y: n.y });
    return { nodes, links };
  }

  function radius(n: Node) { return n.row === 0 ? ROOT_RADIUS : 3.5 + 1.8 * Math.sqrt(n.size); }

  function color(n: Node): string {
    const [lo, hi] = COLOR_RANGE[kind];
    const t = Math.round(100 * Math.min(1, Math.max(0, (n.simRoot - lo) / (hi - lo))));
    return `color-mix(in srgb, var(--conf-high) ${t}%, var(--conf-low))`;
  }

  function draw() {
    if (!index || !rows.length) return;
    const count = Math.min(Number(slider.value), rows.length - 1);
    output.value = String(count);
    const { nodes, links } = layout(count);
    const width = canvas.clientWidth, height = canvas.clientHeight;
    // Fit the positions (not the radii) into the box, with the page's item at the center.
    const reach = (axis: 'x' | 'y') => Math.max(1, ...nodes.map((n) => Math.abs(n[axis]) + radius(n)));
    const scale = Math.min(MAX_ZOOM, (width / 2 - PAD) / reach('x'), (height / 2 - PAD) / reach('y'));
    const X = (n: Node) => width / 2 + n.x * scale, Y = (n: Node) => height / 2 + n.y * scale;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const edges = document.createElementNS(SVG, 'g');
    edges.setAttribute('class', 'item-graph__edges');
    for (const l of links) {
      const line = document.createElementNS(SVG, 'line');
      line.setAttribute('x1', String(X(l.source))); line.setAttribute('y1', String(Y(l.source)));
      line.setAttribute('x2', String(X(l.target))); line.setAttribute('y2', String(Y(l.target)));
      line.setAttribute('stroke-width', (0.6 + 2.2 * Math.max(0, (l.sim - 55) / 40)).toFixed(2));
      edges.append(line);
    }
    const points = document.createElementNS(SVG, 'g');
    for (const n of nodes.slice().reverse()) {   // the page's item drawn last, on top
      const circle = document.createElementNS(SVG, 'circle');
      circle.setAttribute('cx', String(X(n))); circle.setAttribute('cy', String(Y(n)));
      circle.setAttribute('r', String(radius(n)));
      let target: SVGElement = circle;
      if (n.row === 0) {
        circle.setAttribute('class', 'item-graph__root');
        target = document.createElementNS(SVG, 'g');
        target.setAttribute('tabindex', '0');
        target.append(circle);
      } else {
        circle.style.fill = color(n);
        const link = document.createElementNS(SVG, 'a');
        link.setAttribute('href', pageHref(n.row));
        link.setAttribute('aria-label', `${label(n.row)}. ${detail(n.row)}`);
        link.append(circle);
        link.addEventListener('click', (event) => {
          if (lastPointer !== 'touch' || armed === n.row) return;
          event.preventDefault();   // first tap on a touch screen shows the title; the second opens the page
          showTip(n.row, X(n), Y(n));
          armed = n.row;
        });
        target = link;
      }
      target.addEventListener('pointerenter', (e) => { if ((e as PointerEvent).pointerType !== 'touch') showTip(n.row, X(n), Y(n)); });
      target.addEventListener('pointerleave', (e) => { if ((e as PointerEvent).pointerType !== 'touch') hideTip(); });
      target.addEventListener('focus', () => showTip(n.row, X(n), Y(n)));
      target.addEventListener('blur', hideTip);
      points.append(target);
    }
    svg.replaceChildren(edges, points);
    svg.setAttribute('aria-label', `Grafo con ${count} ${kind === 'bills' ? 'expedientes parecidos' : 'noticias parecidas'}`);

    list.replaceChildren(...nodes.slice(1).map((n) => {
      const li = document.createElement('li');
      const a = Object.assign(document.createElement('a'), { href: pageHref(n.row), textContent: label(n.row) });
      li.append(a, Object.assign(document.createElement('span'), { className: 'small muted', textContent: ` · ${detail(n.row)}` }));
      return li;
    }));
  }

  async function load() {
    status.textContent = 'Cargando el grafo…';
    try {
      const [indexFile, treeResponse] = await Promise.all([loadIndex(section.dataset.index!), fetch(section.dataset.tree!)]);
      if (!treeResponse.ok) throw new Error(String(treeResponse.status));
      index = indexFile;
      rows = await treeResponse.json() as Row[];
      slider.max = String(rows.length - 1);
      status.textContent = '';
      status.hidden = true;
      draw();
    } catch {
      status.textContent = 'No se pudo cargar el grafo. Recargá la página para reintentar.';
    }
  }

  section.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; });
  svg.addEventListener('pointerdown', (e) => { if (e.target === svg) hideTip(); });
  slider.addEventListener('input', () => { hideTip(); draw(); });
  let width = canvas.clientWidth;
  new ResizeObserver(() => {
    if (canvas.clientWidth === width) return;
    width = canvas.clientWidth;
    hideTip();
    draw();
  }).observe(canvas);
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    observer.disconnect();
    load();
  }, { rootMargin: '300px' });
  observer.observe(section);
}

document.querySelectorAll<HTMLElement>('.item-graph').forEach(setup);
