// Chapter 4: Jev's statistics. One outlet filter drives everything: the general tiles, the cost by stage, the
// bills-per-news distribution by level, the live thresholds and the body of every open question card.
import { h, readData, s, segmented, stackedText } from './core';
import { dec, int, pct, usd } from '../../lib/process/format';

interface Level {
  news: number; with_bills: number; pairs: number; mean_bills: number; mean_bills_when_any: number;
  median_bills_when_any: number; bills_per_news: Record<string, number>;
}
type StageCost = Record<'filter' | 'gate' | 'details', number>;
interface General {
  news_with_text: number; pass_filter: number; mean_match_confidence: number;
  levels: Record<string, Level>; gate_threshold_slider: Record<string, Level>; filter_threshold_slider: Record<string, number>;
  requests: StageCost; tokens: StageCost; cost_usd: StageCost; cost_usd_total: number;
}
interface OptionStats { count: number; share: number; mean_certainty: number; certainty_buckets: number[]; certainty_histogram: number[] }
interface QuestionStats {
  answers: number; mean_certainty: number; certainty_buckets: number[]; requests: number; tokens: number; cost_usd: number;
  tokens_per_answer: number; yes?: number; yes_share?: number; yes_mean_certainty?: number; yes_low_certainty_share?: number;
  no_mean_certainty?: number; p_histogram?: number[]; score_histogram?: number[];
  options?: Record<string, OptionStats>;
}
interface Question {
  stage: string; type: 'noul' | 'choice' | 'score'; instructions: string;
  criteria: Record<string, string> | string[] | null; by_outlet: Record<string, QuestionStats>;
}
interface QuestionLabel { short: string; yes?: string; no?: string; allOnly?: boolean }
interface Data {
  price: number; general: Record<string, General>; questions: Record<string, Question>;
  labels: {
    questions: Record<string, QuestionLabel>; options: Record<string, Record<string, string>>;
    outlets: { key: string; name: string; color: string }[]; types: Record<string, string>;
  };
}

const data = readData<Data>('data-jev');
const section = document.getElementById('jev');
const USED = { gate: 0.5, filter: 0.2 };
const BUCKETS = ['< 0,5', '0,5-0,75', '0,75-0,9', '≥ 0,9'];
const LEVEL_HELP: Record<string, string> = {
  match: 'Match: la mención explícita o la implícita llega a 0,5.',
  mention: 'Mención: explícita de 0,5 o más, o implícita de 0,75 o más.',
  substantive: 'Cobertura sustantiva: mención y, además, centralidad de 0,25 o más. Es lo que publica el sitio.',
};
const state = { outlet: 'all', level: 'match', kind: 'gate' as 'gate' | 'filter', threshold: USED.gate };
const general = (): General => data.general[state.outlet];
const outletName = (): string => data.labels.outlets.find((outlet) => outlet.key === state.outlet)?.name ?? '';
const tokens = (value: number): string => (value >= 1e6 ? `${dec(value / 1e6, 1)} M` : int(value));

const tile = (tone: string, label: string, value: string, foot = ''): HTMLElement =>
  h('div', { class: `stat ${tone}` }, h('dt', {}, label), h('dd', {}, value), foot && h('span', { class: 'stat-foot' }, foot));

// ---------- Distribution of bills per news: built once per container, then only resized ----------
const distributions = new WeakMap<Element, { bars: HTMLElement[]; values: HTMLElement[] }>();
function drawDistribution(container: Element | null, counts: Record<string, number>): void {
  if (!container) return;
  const keys = Object.keys(counts);
  let parts = distributions.get(container);
  if (!parts) {
    const bars: HTMLElement[] = [], values: HTMLElement[] = [];
    container.replaceChildren(...keys.map((key) => {
      const bar = h('i', {}), value = h('b', {});
      bars.push(bar); values.push(value);
      return h('div', { class: 'dist-col' }, value, h('span', { class: 'dist-track' }, bar), h('span', { class: 'dist-key' }, key));
    }), h('div', { class: 'dist-axis' }, 'expedientes por noticia'));
    parts = { bars, values };
    distributions.set(container, parts);
  }
  const peak = Math.max(1, ...Object.values(counts));
  keys.forEach((key, index) => {
    parts.bars[index].style.height = `${Math.max(counts[key] > 0 ? 2 : 0, (100 * counts[key]) / peak)}%`;
    parts.values[index].textContent = int(counts[key]);
  });
}

/** News by the filter's probability (20 bins of .05): the bins that reach the threshold in color. */
function drawFilterHistogram(container: HTMLElement | null, counts: number[], at: number): void {
  if (!container || counts.length === 0) return;
  if (container.childElementCount === 0) {
    container.replaceChildren(
      h('div', { class: 'hist-bars' }, ...counts.map((count, index) => h('span', { class: 'hist-col', title: `p ${dec(index / counts.length, 2)}-${dec((index + 1) / counts.length, 2)}: ${int(count)} noticias` },
        h('i', { style: `height:${Math.max(count > 0 ? 1.5 : 0, (100 * Math.sqrt(count)) / Math.sqrt(Math.max(...counts)))}%` })))),
      h('div', { class: 'hist-keys' }, h('span', {}, '0'), h('span', {}, '0,5'), h('span', {}, '1')),
      h('div', { class: 'dist-axis' }, 'noticias según la probabilidad de que hablen de la Asamblea (alto en raíz cuadrada)'));
  }
  container.querySelectorAll<HTMLElement>('.hist-col').forEach((column, index) => {
    column.classList.toggle('pass', index / counts.length >= at - 1e-9);
  });
}

// ---------- General statistics ----------
function drawTiles(): void {
  const g = general(), match = g.levels.match;
  document.getElementById('jev-tiles')?.replaceChildren(
    tile('sky', 'Noticias con texto', int(g.news_with_text), state.outlet === 'all' ? 'las que entraron a Jev' : outletName()),
    tile('lavender', 'Pasan el filtro', int(g.pass_filter), `${pct(g.pass_filter / g.news_with_text)} de las noticias`),
    tile('peach', 'Con match', int(match.with_bills), `${pct(match.with_bills / g.pass_filter)} de las que pasan`),
    tile('mint', 'Probabilidad media del match', dec(g.mean_match_confidence, 3), 'máximo de explícita e implícita'));
}

const STAGE_ROWS: { key: keyof StageCost; label: string; color: string }[] = [
  { key: 'filter', label: 'Filtro', color: '--cat-1' },
  { key: 'gate', label: 'Puerta', color: '--cat-2' },
  { key: 'details', label: 'Detalle', color: '--cat-3' },
];
function drawCost(): void {
  const g = general();
  const total = document.getElementById('jev-cost-total');
  if (total) total.textContent = `${usd(g.cost_usd_total)} en total`;
  document.getElementById('jev-cost-bar')?.replaceChildren(...STAGE_ROWS.map((row) =>
    h('span', { style: `--c: var(${row.color}); flex-grow:${g.cost_usd[row.key]}`, title: `${row.label}: ${usd(g.cost_usd[row.key])}` })));
  document.getElementById('jev-cost-rows')?.replaceChildren(...STAGE_ROWS.map((row) => h('div', { class: 'cost-row' },
    h('span', { class: 'cost-name' }, h('i', { class: 'swatch', style: `--c: var(${row.color})` }), row.label),
    h('span', {}, h('b', {}, int(g.requests[row.key])), ' requests'),
    h('span', {}, h('b', {}, tokens(g.tokens[row.key])), ' tokens'),
    h('span', { class: 'cost-usd' }, usd(g.cost_usd[row.key])),
    h('span', { class: 'cost-share' }, pct(g.cost_usd[row.key] / g.cost_usd_total, 0)))));
}

const levels = document.getElementById('jev-levels');
function drawLevels(): void {
  const level = general().levels[state.level];
  const piece = (name: string) => levels?.querySelector<HTMLElement>(`[data-level="${name}"]`) ?? null;
  stackedText(piece('help'), LEVEL_HELP, state.level);
  piece('tiles')?.replaceChildren(
    tile('sky', 'Noticias con expedientes', int(level.with_bills), `de ${int(level.news)}`),
    tile('lavender', 'Pares', int(level.pairs)),
    tile('peach', 'Media', dec(level.mean_bills_when_any, 2), 'si tiene alguno'),
    tile('mint', 'Mediana', dec(level.median_bills_when_any, 0), 'si tiene alguno'));
  drawDistribution(piece('dist'), level.bills_per_news);
}

// ---------- Live thresholds ----------
const threshold = document.getElementById('jev-threshold');
const range = threshold?.querySelector<HTMLInputElement>('input[type="range"]') ?? null;
const thresholdKey = (value: number): string => String(Number(value.toFixed(2)));
const signedInt = (value: number): string => (value > 0 ? `+${int(value)}` : value < 0 ? `−${int(-value)}` : 'igual');

function drawThreshold(): void {
  const g = general(), used = USED[state.kind];
  const piece = (name: string) => threshold?.querySelector<HTMLElement>(`[data-threshold="${name}"]`) ?? null;
  const set = (name: string, text: string) => { const element = piece(name); if (element) element.textContent = text; };
  set('label', state.kind === 'gate' ? 'Umbral de la puerta' : 'Umbral del filtro');
  set('value', dec(state.threshold, 2));
  stackedText(piece('help'), {
    gate: `Hay match si la mayor de las dos probabilidades (explícita, implícita) llega al umbral. En la corrida se usó ${dec(USED.gate, 1)}.`,
    filter: `Una noticia pasa si la probabilidad de que hable de la Asamblea llega al umbral. En la corrida se usó ${dec(USED.filter, 1)}.`,
  }, state.kind);
  piece('used')?.style.setProperty('--at', `${(100 * (used - 0.05)) / 0.9}%`);
  const usedMark = piece('used')?.querySelector('b');
  if (usedMark) usedMark.textContent = `usado: ${dec(used, 1)}`;
  // The tiles and the chart of both kinds share one cell each, so switching between them keeps the card's height.
  const tiles = { gate: piece('tiles-gate'), filter: piece('tiles-filter') };
  for (const kind of ['gate', 'filter'] as const) {
    if (tiles[kind] && tiles[kind]?.childElementCount === 0) tiles[kind]?.replaceChildren(...thresholdTiles(kind, USED[kind]));
    tiles[kind]?.classList.toggle('on', state.kind === kind);
  }
  tiles[state.kind]?.replaceChildren(...thresholdTiles(state.kind, state.threshold));
  const dist = piece('dist'), filterDist = piece('pdist');
  dist?.classList.toggle('on', state.kind === 'gate');
  filterDist?.classList.toggle('on', state.kind === 'filter');
  drawDistribution(dist, g.gate_threshold_slider[thresholdKey(state.kind === 'gate' ? state.threshold : USED.gate)].bills_per_news);
  drawFilterHistogram(filterDist, data.questions.assembly?.by_outlet.all.p_histogram ?? [], state.kind === 'filter' ? state.threshold : USED.filter);
}

function thresholdTiles(kind: 'gate' | 'filter', at: number): HTMLElement[] {
  const g = general(), used = USED[kind];
  if (kind === 'gate') {
    const now = g.gate_threshold_slider[thresholdKey(at)], base = g.gate_threshold_slider[thresholdKey(used)];
    return [
      tile('sky', 'Noticias con expediente', int(now.with_bills), `${signedInt(now.with_bills - base.with_bills)} frente a ${dec(used, 1)}`),
      tile('lavender', 'Pares con match', int(now.pairs), `${signedInt(now.pairs - base.pairs)} frente a ${dec(used, 1)}`),
      tile('peach', 'Media y mediana', `${dec(now.mean_bills_when_any, 1)} · ${dec(now.median_bills_when_any, 0)}`, 'expedientes, si tiene alguno'),
    ];
  }
  const now = g.filter_threshold_slider[thresholdKey(at)], base = g.filter_threshold_slider[thresholdKey(used)];
  return [
    tile('sky', 'Noticias que pasan el filtro', int(now), `${signedInt(now - base)} frente a ${dec(used, 1)}`),
    tile('lavender', 'De las noticias con texto', pct(now / g.news_with_text), `de ${int(g.news_with_text)}`),
    tile('peach', 'Quedan fuera', int(g.news_with_text - now), 'no entrarían a la puerta'),
  ];
}

// ---------- Question cards ----------
const cards = [...document.querySelectorAll<HTMLDetailsElement>('details.q')];
const outletFor = (key: string): string => (data.labels.questions[key].allOnly ? 'all' : state.outlet);
const optionLabel = (key: string, option: string, type: string): string =>
  type === 'noul' ? (option === 'true' ? 'Sí' : 'No') : data.labels.options[key]?.[option] ?? option;

function headline(key: string): string {
  const question = data.questions[key], stats = question.by_outlet[outletFor(key)];
  if (question.type === 'noul') return `${pct(stats.yes_share ?? 0)} sí`;
  const [top, topStats] = Object.entries(stats.options ?? {}).sort((a, b) => b[1].count - a[1].count)[0] ?? ['', null];
  return topStats ? `${optionLabel(key, top, question.type)} ${pct(topStats.share, 0)}` : '-';
}

function bar(label: string, share: number, count: number, extra = '', cls = ''): HTMLElement {
  return h('div', { class: `ans ${cls}` },
    h('span', { class: 'ans-label' }, label),
    h('span', { class: 'ans-track' }, h('i', { style: `width:${Math.max(share > 0 ? 0.6 : 0, share * 100)}%` })),
    h('span', { class: 'ans-value' }, h('b', {}, pct(share)), ` ${int(count)}`),
    extra && h('span', { class: 'ans-extra' }, extra));
}

// ---------- Distributions: of the answers, and of their certainty ----------
// Answers: yes/no, the probability of yes (0 to 1); scores, the raw score on the scale (choices already have their
// bars). Certainty: every question, all answers together or one option at a time (a small selector).
const CURVE_W = 300, CURVE_H = 100;
const chosen = new Map<string, string>();

/** Monotone cubic through the points (Fritsch-Carlson): smooth, and never overshoots the bins. */
function monotone(points: [number, number][]): string {
  const n = points.length;
  const slopes = points.slice(0, -1).map(([x, y], i) => (points[i + 1][1] - y) / (points[i + 1][0] - x));
  const tangents = points.map((_, i) => (i === 0 ? slopes[0] : i === n - 1 ? slopes[n - 2]
    : slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2));
  slopes.forEach((slope, i) => {
    if (slope === 0) { tangents[i] = 0; tangents[i + 1] = 0; return; }
    const a = tangents[i] / slope, b = tangents[i + 1] / slope, sum = a * a + b * b;
    if (sum > 9) { const tau = 3 / Math.sqrt(sum); tangents[i] = tau * a * slope; tangents[i + 1] = tau * b * slope; }
  });
  const r = (value: number) => Math.round(value * 100) / 100;
  let path = `M ${r(points[0][0])} ${r(points[0][1])}`;
  for (let i = 0; i < n - 1; i += 1) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1], third = (x1 - x0) / 3;
    path += ` C ${r(x0 + third)} ${r(y0 + tangents[i] * third)} ${r(x1 - third)} ${r(y1 - tangents[i + 1] * third)} ${r(x1)} ${r(y1)}`;
  }
  return path;
}

function densityChart(key: string, values: number[], root: boolean, split: boolean): SVGSVGElement {
  const scaled = values.map((value) => (root ? Math.sqrt(value) : value));
  const peak = Math.max(1e-9, ...scaled);
  const y = (value: number) => CURVE_H - 2 - (value / peak) * (CURVE_H - 8);
  const points: [number, number][] = scaled.map((value, i) => [((i + 0.5) / scaled.length) * CURVE_W, y(value)]);
  const line = monotone([[0, points[0][1]], ...points, [CURVE_W, points[points.length - 1][1]]]);
  const fill = split ? `url(#q-split-${key})` : 'var(--outlet, var(--accent))';
  return s('svg', { class: 'q-curve', viewBox: `0 0 ${CURVE_W} ${CURVE_H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    split && s('defs', {}, s('linearGradient', { id: `q-split-${key}`, gradientUnits: 'userSpaceOnUse', x1: 0, x2: CURVE_W, y1: 0, y2: 0 },
      s('stop', { offset: '0.5', style: 'stop-color: var(--data-none)' }), s('stop', { offset: '0.5', style: 'stop-color: var(--outlet, var(--accent))' }))),
    s('path', { class: 'q-curve-area', d: `${line} L ${CURVE_W} ${CURVE_H} L 0 ${CURVE_H} Z`, style: `fill: ${fill}` }),
    s('path', { class: 'q-curve-line', d: line }),
    split && s('line', { class: 'q-curve-mid', x1: CURVE_W / 2, x2: CURVE_W / 2, y1: 0, y2: CURVE_H }));
}

function axis(ticks: { at: number; text: string }[]): HTMLElement {
  return h('div', { class: ticks.length > 3 ? 'q-curve-axis many' : 'q-curve-axis' },
    ...ticks.map((tick) => h('span', { style: `--at:${tick.at * 100}%`, class: tick.at === 0 ? 'start' : tick.at === 1 ? 'end' : '' }, tick.text)));
}

/** The answers themselves: the probability of yes, or the raw score. Choice questions have only their bars. */
function distribution(key: string, question: Question, stats: QuestionStats): HTMLElement | null {
  const options = Object.entries(stats.options ?? {});
  if (question.type === 'noul' && stats.p_histogram?.length) {
    return h('div', { class: 'q-block q-dist' },
      h('div', { class: 'q-block-title' }, 'Distribución de las respuestas'),
      h('div', { class: 'q-curve-wrap' }, densityChart(key, stats.p_histogram, true, true)),
      axis([{ at: 0, text: 'p = 0: un «no» seguro' }, { at: 0.5, text: 'p = 0,5: duda' }, { at: 1, text: 'p = 1: un «sí» seguro' }]),
      h('p', { class: 'note q-curve-caption' }, 'Probabilidad de «sí» que dio Jev en cada respuesta: a la izquierda los no, a la derecha los sí. p = 0 es un «no» con certeza total y p = 0,5, una duda total. El alto va en raíz cuadrada, para que se vean también las respuestas poco comunes.'));
  }
  if (question.type === 'score' && stats.score_histogram?.length) {
    return h('div', { class: 'q-block q-dist' },
      h('div', { class: 'q-block-title' }, 'Distribución de las respuestas'),
      h('div', { class: 'q-curve-wrap' }, densityChart(key, stats.score_histogram, false, false)),
      axis(options.map(([option], i) => ({ at: i / Math.max(1, options.length - 1), text: optionLabel(key, option, question.type) }))),
      h('p', { class: 'note q-curve-caption' }, 'Puntaje que dio Jev en la escala, antes de redondearlo a la opción más cercana.'));
  }
  return null;
}

interface CertaintySet { key: string; label: string; values: number[]; count: number; mean: number }

/** Certainty histograms of all the answers and of each option. Yes/no: folded from the histogram of p (10 bins of
 * .1, since certainty = |2p - 1|); the rest: Jev's confidence, 20 bins of .05. */
function certaintySets(key: string, question: Question, stats: QuestionStats): CertaintySet[] {
  if (question.type === 'noul') {
    const p = stats.p_histogram ?? [], half = p.length / 2, yesCount = stats.yes ?? 0;
    const yes = p.slice(half);                  // p from .5 up: certainty grows with p
    const no = p.slice(0, half).reverse();      // p below .5: certainty grows as p falls
    return [
      { key: 'all', label: 'Todas', values: yes.map((value, i) => value + no[i]), count: stats.answers, mean: stats.mean_certainty },
      { key: 'true', label: 'Sí', values: yes, count: yesCount, mean: stats.yes_mean_certainty ?? 0 },
      { key: 'false', label: 'No', values: no, count: stats.answers - yesCount, mean: stats.no_mean_certainty ?? 0 },
    ].filter((set) => set.count > 0);
  }
  const options = Object.entries(stats.options ?? {}).filter(([, option]) => option.count > 0).sort((a, b) => b[1].count - a[1].count);
  const all = options.reduce<number[]>((sum, [, option]) => option.certainty_histogram.map((value, i) => value + (sum[i] ?? 0)), []);
  return [
    { key: 'all', label: 'Todas', values: all, count: stats.answers, mean: stats.mean_certainty },
    ...options.map(([option, value]) => ({ key: option, label: optionLabel(key, option, question.type), values: value.certainty_histogram, count: value.count, mean: value.mean_certainty })),
  ];
}

/** How sure Jev was: the formula, a density curve (all answers or one option) and the share by bucket. */
function certainty(key: string, question: Question, stats: QuestionStats): HTMLElement {
  const buckets = stats.certainty_buckets;
  const how = question.type === 'noul'
    ? h('p', { class: 'note q-how' }, 'Certeza = |2p − 1|, con p la probabilidad de «sí»: vale 0 con p = 0,5 y 1 con p = 0 o p = 1, así que mide igual un sí que un no (',
        h('a', { class: 'ext-link', href: 'https://docs.typesafe.ai/go/noul', target: '_blank', rel: 'noopener noreferrer' }, 'documentación de Jev'), ').')
    : h('p', { class: 'note q-how' }, 'Certeza = la confianza que reporta Jev para la opción que eligió.');
  const sets = certaintySets(key, question, stats);
  const active = sets.find((set) => set.key === chosen.get(key)) ?? sets[0];
  const root = question.type === 'noul';
  const picker = sets.length > 1
    ? h('div', { class: 'q-pick', role: 'group', 'aria-label': 'Respuestas de la curva de certeza' },
        ...sets.map((set) => h('button', { type: 'button', 'data-value': set.key, 'aria-pressed': String(set.key === active.key) }, set.label)))
    : null;
  const which = active.key === 'all' ? 'todas las respuestas' : `las respuestas «${active.label}»`;
  const block = h('div', { class: 'q-block q-dist' },
    h('div', { class: 'q-block-title' }, 'Certeza de las respuestas', h('b', {}, `media ${dec(stats.mean_certainty, 3)}`)),
    how,
    h('div', { class: 'q-block-sub' }, 'Distribución de la certeza'),
    picker,
    h('div', { class: 'q-curve-wrap' }, densityChart(`c-${key}`, active.values, root, false)),
    axis([{ at: 0, text: '0: duda total' }, { at: 0.5, text: '0,5' }, { at: 1, text: '1: certeza total' }]),
    h('p', { class: 'note q-curve-caption' }, `Certeza de ${which}: ${int(active.count)}, con media ${dec(active.mean, 2)}.${root ? ' El alto va en raíz cuadrada.' : ''}`),
    h('div', { class: 'cert-bar', role: 'img', 'aria-label': `Respuestas por tramo de certeza: ${buckets.map((share, index) => `${BUCKETS[index]}: ${pct(share)}`).join('; ')}` },
      ...buckets.map((share, index) => h('span', { class: `cert-${index}`, style: `flex-grow:${Math.max(share, 0.0001)}`, title: `${BUCKETS[index]}: ${pct(share)}` }))),
    h('div', { class: 'legend cert-legend' }, ...buckets.map((share, index) => h('span', {}, h('i', { class: `swatch cert-${index}` }), `${BUCKETS[index]} · ${pct(share, 0)}`))));
  picker?.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-value]');
    if (!button || button.getAttribute('aria-pressed') === 'true') return;
    chosen.set(key, button.dataset.value ?? '');
    const next = certainty(key, question, stats);
    block.replaceWith(next);
    next.querySelector<HTMLButtonElement>(`button[data-value="${CSS.escape(button.dataset.value ?? '')}"]`)?.focus();
  });
  return block;
}

function body(key: string): HTMLElement[] {
  const question = data.questions[key], label = data.labels.questions[key], outlet = outletFor(key);
  const stats = question.by_outlet[outlet];
  const criteria = Array.isArray(question.criteria)
    ? question.criteria.map((text, index) => [String(index), text])
    : Object.entries(question.criteria ?? {});
  const left = h('div', { class: 'q-col' },
    h('div', { class: 'q-block' },
      h('div', { class: 'q-block-title' }, 'Pregunta exacta'),
      h('blockquote', { class: 'q-quote', lang: 'en' }, question.instructions)),
    criteria.length > 0 && h('div', { class: 'q-block' },
      h('div', { class: 'q-block-title' }, 'Criterio de cada opción'),
      h('dl', { class: 'q-criteria' }, ...criteria.flatMap(([option, text]) => [
        h('dt', {}, optionLabel(key, option, question.type)), h('dd', { lang: 'en' }, text)]))),
    label.yes && h('div', { class: 'q-meaning' },
      h('div', { class: 'stat mint' }, h('b', {}, 'Sí significa'), h('p', {}, label.yes)),
      h('div', { class: 'stat rose' }, h('b', {}, 'No significa'), h('p', {}, label.no ?? ''))));

  const answers = question.type === 'noul'
    ? [bar('Sí', stats.yes_share ?? 0, stats.yes ?? 0, stats.yes ? `certeza ${dec(stats.yes_mean_certainty ?? 0, 2)}` : '', 'yes'),
       bar('No', 1 - (stats.yes_share ?? 0), stats.answers - (stats.yes ?? 0), stats.answers > (stats.yes ?? 0) ? `certeza ${dec(stats.no_mean_certainty ?? 0, 2)}` : '', 'no')]
    : Object.entries(stats.options ?? {}).map(([option, value]) => bar(optionLabel(key, option, question.type), value.share, value.count,
        value.count > 0 ? `certeza ${dec(value.mean_certainty, 2)}` : ''));
  const perThousand = (stats.tokens_per_answer * data.price) / 1000;
  const right = h('div', { class: 'q-col' },
    label.allOnly && state.outlet !== 'all' && h('p', { class: 'note q-all' }, 'Esta pregunta se muestra solo para todos los medios juntos.'),
    question.type === 'noul' && h('dl', { class: 'stats cols-3 q-yes' },
      tile('sky', 'Responde sí', pct(stats.yes_share ?? 0), `${int(stats.yes ?? 0)} de ${int(stats.answers)}`),
      tile('lavender', 'Certeza media', dec(stats.mean_certainty, 3), 'de todas las respuestas'),
      tile('peach', 'Certeza baja', pct(stats.certainty_buckets[0] ?? 0), 'certeza menor que 0,5')),
    h('div', { class: 'q-block' },
      h('div', { class: 'q-block-title' }, 'Respuestas', h('b', {}, `${int(stats.answers)} en total`)),
      h('div', { class: 'answers' }, ...answers)),
    distribution(key, question, stats),
    certainty(key, question, stats),
    h('div', { class: 'q-cost' },
      h('span', {}, h('b', {}, `${int(stats.tokens_per_answer)} tokens`), ` por respuesta (${usd(perThousand, 3)} cada mil)`),
      h('span', {}, h('b', {}, usd(stats.cost_usd, stats.cost_usd < 1 ? 3 : 2)), ` en total: ${int(stats.requests)} requests, ${tokens(stats.tokens)} tokens`)));
  return [left, right];
}

function drawCard(card: HTMLDetailsElement): void {
  const key = card.dataset.q ?? '';
  const stat = card.querySelector<HTMLElement>('[data-q-stat]');
  if (stat) stat.textContent = headline(key);
  const text = card.querySelector<HTMLElement>('.q-open-text');
  if (text) text.textContent = card.open ? 'Cerrar' : 'Abrir';
  if (card.open) card.querySelector('[data-q-body]')?.replaceChildren(...body(key));
}
cards.forEach((card) => card.addEventListener('toggle', () => drawCard(card)));

// ---------- Wiring ----------
function drawAll(): void {
  const outlet = data.labels.outlets.find((item) => item.key === state.outlet);
  section?.style.setProperty('--outlet', state.outlet === 'all' ? 'var(--accent)' : `var(${outlet?.color})`);
  drawTiles(); drawCost(); drawLevels(); drawThreshold();
  cards.forEach(drawCard);
}

const outletGroup = document.querySelector('#jev-filter .segmented');
if (outletGroup) segmented(outletGroup, (value) => { state.outlet = value; drawAll(); });
const levelGroup = levels?.querySelector('.segmented');
if (levelGroup) segmented(levelGroup, (value) => { state.level = value; drawLevels(); });
const kindGroup = threshold?.querySelector('.segmented');
if (kindGroup) segmented(kindGroup, (value) => {
  state.kind = value as 'gate' | 'filter';
  state.threshold = USED[state.kind];
  if (range) range.value = String(state.threshold);
  drawThreshold();
});
range?.addEventListener('input', () => { state.threshold = Number(range.value); drawThreshold(); });
threshold?.querySelector('[data-threshold="reset"]')?.addEventListener('click', () => {
  state.threshold = USED[state.kind];
  if (range) range.value = String(state.threshold);
  drawThreshold();
});
drawAll();
