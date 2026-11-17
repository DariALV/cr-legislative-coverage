// Chapter 2: explorer of the 78 embedding combinations (segmented controls + heat map) and the diagram of how a
// news is split, embedded and compared with a bill. The diagram follows the chosen combination; its similarity
// values are illustrative (the real ones are per news and per bill), only the structure is real.
import { h, onTheme, readData, s, segmented, sequential, whenVisible } from './core';
import { dec } from '../../lib/process/format';

interface Config { model: string; size: number; variant: string; aggregation: string; recall50: number; low: number; high: number }
interface Item { key: string; label: string }
interface Data { configs: Config[]; labels: { models: Item[]; sizes: Item[]; aggregations: Item[]; variants: Item[] } }
type Dimension = 'model' | 'size' | 'aggregation' | 'variant';

const data = readData<Data>('data-embeddings');
const { models, sizes, aggregations, variants } = data.labels;
const WHOLE = '8000';
const keyOf = (model: string, size: string, variant: string, aggregation: string) => `${model}|${size}|${variant}|${aggregation}`;
const configs = new Map(data.configs.map((config) => [keyOf(config.model, String(config.size), config.variant, config.aggregation), config]));
const rankOf = new Map(data.configs.map((config, index) => [config, index + 1]));
const best = data.configs[0];
const lowest = Math.min(...data.configs.map((config) => config.recall50));
const state: Record<Dimension, string> = { model: best.model, size: String(best.size), aggregation: best.aggregation, variant: best.variant };
const label = (list: Item[], key: string) => list.find((item) => item.key === key)?.label ?? key;
const current = (): Config => configs.get(keyOf(state.model, state.size, state.variant, state.aggregation)) ?? best;

// ---------- Controls ----------
const explorer = document.getElementById('embedding-explorer');
const setters = new Map<Dimension, (value: string) => void>();
explorer?.querySelectorAll<HTMLElement>('[data-dimension]').forEach((group) => {
  const dimension = group.dataset.dimension as Dimension;
  setters.set(dimension, segmented(group, (value) => choose({ [dimension]: value })));
});

function choose(change: Partial<Record<Dimension, string>>): void {
  Object.assign(state, change);
  if (state.size === WHOLE) state.aggregation = 'mean';   // a whole news is a single vector
  update();
}

// ---------- Result panel ----------
const SCALE_MIN = 0.4, SCALE_MAX = 0.9;
const position = (value: number) => `${(100 * (value - SCALE_MIN)) / (SCALE_MAX - SCALE_MIN)}%`;
const part = (name: string) => explorer?.querySelector<HTMLElement>(`[data-result="${name}"]`);
const axisElement = explorer?.querySelector<HTMLElement>('.ci-axis');
axisElement?.replaceChildren(...[0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((tick) => h('span', { style: `left:${position(tick)}` }, dec(tick, 1))));

function showResult(): void {
  const config = current();
  const set = (name: string, text: string) => { const element = part(name); if (element) element.textContent = text; };
  set('value', dec(config.recall50, 3));
  set('ci', `IC 95 %: ${dec(config.low, 3)}-${dec(config.high, 3)}`);
  set('rank', `n.º ${rankOf.get(config)} de ${data.configs.length}`);
  set('gap', config === best ? 'la mejor combinación' : `${dec(config.recall50 - best.recall50, 3)} frente a la mejor`);
  part('range')?.setAttribute('style', `left:${position(config.low)}; width:calc(${position(config.high)} - ${position(config.low)})`);
  part('point')?.setAttribute('style', `left:${position(config.recall50)}`);
  part('best')?.setAttribute('style', `left:${position(best.recall50)}`);
}

// ---------- Heat map: rows = model x bill text, columns = chunk size x comparison ----------
const heatmap = document.getElementById('embedding-heatmap');
const cells = new Map<Config, HTMLButtonElement>();

function buildHeatmap(): void {
  if (!heatmap) return;
  const chunked = sizes.filter((size) => size.key !== WHOLE);
  const short: Record<string, string> = { max: 'Máx', top3: 'T3', mean: 'Prom' };
  const head = [h('span', { class: 'heat-corner' })];
  chunked.forEach((size) => head.push(h('span', { class: 'heat-size', style: 'grid-column: span 3' }, `${size.label} tokens`)));
  head.push(h('span', { class: 'heat-size' }, 'Entera'));
  const sub = [h('span', { class: 'heat-corner' })];
  chunked.forEach(() => aggregations.forEach((aggregation) => sub.push(h('span', { class: 'heat-agg' }, short[aggregation.key]))));
  sub.push(h('span', { class: 'heat-agg' }, short.mean));
  const rows: HTMLElement[] = [];
  for (const model of models) {
    for (const variant of variants) {
      rows.push(h('span', { class: 'heat-row' }, h('b', {}, model.label), variant.label.replace('Título + ', '+ ')));
      const columns = [...chunked.flatMap((size) => aggregations.map((aggregation) => [size.key, aggregation.key])), [WHOLE, 'mean']];
      for (const [size, aggregation] of columns) {
        const config = configs.get(keyOf(model.key, size, variant.key, aggregation));
        if (!config) { rows.push(h('span', {})); continue; }
        const text = `${model.label}, ${size === WHOLE ? 'noticia entera' : `${size} tokens`}, ${variant.label.toLowerCase()}, ${label(aggregations, aggregation).toLowerCase()}: recall@50 ${dec(config.recall50, 3)}`;
        const cell = h('button', { type: 'button', class: 'heat-cell', title: text, 'aria-label': text });
        cell.addEventListener('click', () => choose({ model: model.key, size, variant: variant.key, aggregation }));
        cells.set(config, cell);
        rows.push(cell);
      }
    }
  }
  heatmap.replaceChildren(...head, ...sub, ...rows);
  paintHeatmap();
  const scale = (name: string) => explorer?.querySelector<HTMLElement>(`[data-scale="${name}"]`);
  const minimum = scale('min'), maximum = scale('max');
  if (minimum) minimum.textContent = dec(lowest, 2);
  if (maximum) maximum.textContent = dec(best.recall50, 2);
}

function paintHeatmap(): void {
  cells.forEach((cell, config) => {
    cell.style.background = sequential((config.recall50 - lowest) / (best.recall50 - lowest));
  });
}

// ---------- Diagram ----------
const diagram = document.getElementById('chunk-diagram');
const CHUNKS: Record<string, number> = { '256': 8, '512': 4, '1024': 2, '2048': 1, [WHOLE]: 1 };
const SIMILARITY: Record<string, number[]> = {
  '256': [0.41, 0.38, 0.66, 0.35, 0.52, 0.33, 0.47, 0.36],
  '512': [0.42, 0.58, 0.46, 0.43],
  '1024': [0.52, 0.46],
  '2048': [0.5],
  [WHOLE]: [0.47],
};
const SUMMARY: Record<string, string> = { max: 'Máximo', top3: 'Promedio de los 3 mejores', mean: 'Promedio de todos' };
let diagramReady = false;

function drawDiagram(): void {
  if (!diagram || !diagramReady) return;
  const count = CHUNKS[state.size], values = SIMILARITY[state.size];
  const order = values.map((value, index) => [value, index]).sort((a, b) => b[0] - a[0]).map(([, index]) => index);
  const taken = state.aggregation === 'max' ? 1 : state.aggregation === 'top3' ? Math.min(3, count) : count;
  const chosen = new Set(order.slice(0, taken));
  const score = [...chosen].reduce((sum, index) => sum + values[index], 0) / chosen.size;

  const DOC = { x: 16, y: 50, w: 132, h: 232 }, GAP = 5;
  const band = (DOC.h - GAP * (count - 1)) / count;
  const centers = values.map((_, index) => DOC.y + index * (band + GAP) + band / 2);
  const svg = s('svg', { class: 'viz', viewBox: '0 0 760 316' });
  let step = 0;
  const enter = <T extends SVGElement>(element: T): T => { element.classList.add('dg-in'); element.style.animationDelay = `${step++ * 35}ms`; return element; };
  const text =(x: number, y: number, content: string, cls: string, anchor = 'start') => s('text', { x, y, class: cls, 'text-anchor': anchor }, content);

  // The news, split into chunks
  svg.append(text(DOC.x, 22, 'Noticia', 'dg-title'),
    text(DOC.x, 38, state.size === WHOLE ? 'entera, hasta 8000 tokens' : `${count} ${count === 1 ? 'fragmento' : 'fragmentos'} de ${state.size} tokens`, 'dg-sub'));
  centers.forEach((center, index) => {
    const group = enter(s('g', {}));
    const top = center - band / 2;
    group.append(s('rect', { x: DOC.x, y: top, width: DOC.w, height: band, rx: 7, class: chosen.has(index) ? 'dg-chunk on' : 'dg-chunk' }));
    const lines = Math.max(1, Math.min(7, Math.floor((band - 10) / 9)));
    for (let line = 0; line < lines; line += 1) {
      const y = top + band / 2 + (line - (lines - 1) / 2) * 9;
      group.append(s('line', { x1: DOC.x + 12, x2: DOC.x + DOC.w - 12 - ((index * 31 + line * 17) % 46), y1: y, y2: y, class: 'dg-textline' }));
    }
    svg.append(group);
  });

  // One vector per chunk
  svg.append(text(190, 22, 'Embedding', 'dg-title'), text(190, 38, label(models, state.model), 'dg-sub'));
  centers.forEach((center, index) => {
    const group = enter(s('g', {}));
    group.append(s('line', { x1: DOC.x + DOC.w + 5, x2: 184, y1: center, y2: center, class: 'dg-wire' }));
    for (let cell = 0; cell < 5; cell += 1) {
      const strength = 0.25 + (((index + 3) * (cell + 2) * 37) % 70) / 100;
      group.append(s('rect', { x: 190 + cell * 12, y: center - 5, width: 10, height: 10, rx: 2.5, class: 'dg-cell', style: `opacity:${strength.toFixed(2)}` }));
    }
    svg.append(group);
  });

  // Similarity of each chunk with the bill: the bill's vector runs down a bus that meets every chunk
  const BUS = 280, BAR = { x: 300, w: 170 };
  svg.append(text(BAR.x, 22, 'Similitud coseno', 'dg-title'), text(BAR.x, 38, 'de cada fragmento con el expediente', 'dg-sub'));
  svg.append(enter(s('path', { d: `M 560 86 H ${BUS} V ${centers[centers.length - 1]}`, class: 'dg-bus' })));
  const height = Math.min(18, band - 4);
  centers.forEach((center, index) => {
    const group = enter(s('g', {}));
    const on = chosen.has(index), width = (values[index] / 0.8) * BAR.w;
    group.append(
      s('line', { x1: 252, x2: BUS, y1: center, y2: center, class: 'dg-wire' }),
      s('circle', { cx: BUS, cy: center, r: 3.5, class: 'dg-node' }),
      s('rect', { x: BAR.x, y: center - height / 2, width: BAR.w, height, rx: height / 2, class: 'dg-track' }),
      s('rect', { x: BAR.x, y: center - height / 2, width, height, rx: height / 2, class: on ? 'dg-bar on' : 'dg-bar' }),
      text(BAR.x + BAR.w + 8, center + 4.5, dec(values[index]), on ? 'dg-num on' : 'dg-num'));
    svg.append(group);
  });

  // The bill and the text it is embedded with
  const bill = enter(s('g', {}));
  bill.append(s('rect', { x: 560, y: 50, width: 184, height: 72, rx: 10, class: 'dg-card' }),
    text(574, 70, 'Expediente', 'dg-title'), text(574, 86, label(variants, state.variant), 'dg-sub'));
  for (let cell = 0; cell < 5; cell += 1) {
    bill.append(s('rect', { x: 574 + cell * 12, y: 98, width: 10, height: 10, rx: 2.5, class: 'dg-cell bill', style: `opacity:${(0.35 + ((cell * 53) % 60) / 100).toFixed(2)}` }));
  }
  svg.append(bill);

  // Summary of the similarities into one score
  const summary = enter(s('g', {}));
  const BOX = { x: 560, y: 158, w: 184, h: 46 };
  chosen.forEach((index) => summary.append(s('path', {
    d: `M ${BAR.x + BAR.w + 44} ${centers[index]} C ${BOX.x - 24} ${centers[index]}, ${BOX.x - 30} ${BOX.y + BOX.h / 2}, ${BOX.x} ${BOX.y + BOX.h / 2}`, class: 'dg-pick' })));
  summary.append(s('rect', { x: BOX.x, y: BOX.y, width: BOX.w, height: BOX.h, rx: 10, class: 'dg-box' }),
    text(BOX.x + BOX.w / 2, BOX.y + 20, SUMMARY[state.aggregation], 'dg-boxtitle', 'middle'),
    text(BOX.x + BOX.w / 2, BOX.y + 36, `${taken} de ${count} ${count === 1 ? 'fragmento' : 'fragmentos'}`, 'dg-sub', 'middle'),
    s('line', { x1: BOX.x + BOX.w / 2, x2: BOX.x + BOX.w / 2, y1: BOX.y + BOX.h + 4, y2: BOX.y + BOX.h + 22, class: 'dg-pick' }),
    text(BOX.x + BOX.w / 2, BOX.y + BOX.h + 62, dec(score), 'dg-score', 'middle'),
    text(BOX.x + BOX.w / 2, BOX.y + BOX.h + 82, 'puntaje del par noticia-expediente', 'dg-sub', 'middle'));
  svg.append(summary);
  diagram.replaceChildren(svg);
}

// ---------- Wiring ----------
function update(): void {
  const config = current();
  setters.forEach((set, dimension) => set(state[dimension]));
  explorer?.querySelectorAll<HTMLButtonElement>('[data-dimension="aggregation"] button').forEach((button) => {
    button.disabled = state.size === WHOLE && button.dataset.value !== 'mean';
  });
  cells.forEach((cell, cellConfig) => cell.setAttribute('aria-pressed', String(cellConfig === config)));
  showResult();
  drawDiagram();
}

buildHeatmap();
update();
onTheme(paintHeatmap);
if (diagram) whenVisible(diagram, () => { diagramReady = true; drawDiagram(); });
