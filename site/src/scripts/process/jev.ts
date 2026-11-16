// Chapter 4: Jev's statistics. One outlet filter drives everything: the general tiles, the cost by stage, the
// bills-per-news distribution by level, the live thresholds and the body of every open question card.
import { h, readData, segmented } from './core';
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
interface OptionStats { count: number; share: number; mean_certainty: number; certainty_buckets: number[] }
interface QuestionStats {
  answers: number; mean_certainty: number; certainty_buckets: number[]; requests: number; tokens: number; cost_usd: number;
  tokens_per_answer: number; yes?: number; yes_share?: number; yes_mean_certainty?: number; yes_low_certainty_share?: number;
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
const BUCKETS = ['< 0,5', '0,5–0,75', '0,75–0,9', '≥ 0,9'];
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

// ---------- General statistics ----------
function drawTiles(): void {
  const g = general(), match = g.levels.match;
  document.getElementById('jev-tiles')?.replaceChildren(
    tile('sky', 'Noticias con texto', int(g.news_with_text), state.outlet === 'all' ? 'las que entraron a Jev' : outletName()),
    tile('lavender', 'Pasan el filtro', int(g.pass_filter), `${pct(g.pass_filter / g.news_with_text)} de las noticias`),
    tile('peach', 'Con match', int(match.with_bills), `${pct(match.with_bills / g.pass_filter)} de las que pasan`),
    tile('mint', 'Confianza media del match', dec(g.mean_match_confidence, 3), 'máximo de explícita e implícita'));
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
  const help = piece('help');
  if (help) help.textContent = LEVEL_HELP[state.level];
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
  set('help', state.kind === 'gate'
    ? `Hay match si la mayor de las dos probabilidades (explícita, implícita) llega al umbral. En la corrida se usó ${dec(used, 1)}.`
    : `Una noticia pasa si la probabilidad de que hable de la Asamblea llega al umbral. En la corrida se usó ${dec(used, 1)}.`);
  piece('used')?.style.setProperty('--at', `${(100 * (used - 0.05)) / 0.9}%`);
  const usedMark = piece('used')?.querySelector('b');
  if (usedMark) usedMark.textContent = `usado: ${dec(used, 1)}`;
  const tiles = piece('tiles'), dist = piece('dist');
  if (state.kind === 'gate') {
    const now = g.gate_threshold_slider[thresholdKey(state.threshold)], base = g.gate_threshold_slider[thresholdKey(used)];
    tiles?.replaceChildren(
      tile('sky', 'Noticias con al menos un expediente', int(now.with_bills), `${signedInt(now.with_bills - base.with_bills)} frente a ${dec(used, 1)}`),
      tile('lavender', 'Pares con match', int(now.pairs), `${signedInt(now.pairs - base.pairs)} frente a ${dec(used, 1)}`),
      tile('peach', 'Media y mediana', `${dec(now.mean_bills_when_any, 1)} · ${dec(now.median_bills_when_any, 0)}`, 'expedientes, si tiene alguno'));
    if (dist) { dist.hidden = false; drawDistribution(dist, now.bills_per_news); }
  } else {
    const now = g.filter_threshold_slider[thresholdKey(state.threshold)], base = g.filter_threshold_slider[thresholdKey(used)];
    tiles?.replaceChildren(
      tile('sky', 'Noticias que pasan el filtro', int(now), `${signedInt(now - base)} frente a ${dec(used, 1)}`),
      tile('lavender', 'De las noticias con texto', pct(now / g.news_with_text), `de ${int(g.news_with_text)}`),
      tile('peach', 'Quedan fuera', int(g.news_with_text - now), 'no entrarían a la puerta'));
    if (dist) dist.hidden = true;
  }
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
  return topStats ? `${optionLabel(key, top, question.type)} ${pct(topStats.share, 0)}` : '—';
}

function bar(label: string, share: number, count: number, extra = '', cls = ''): HTMLElement {
  return h('div', { class: `ans ${cls}` },
    h('span', { class: 'ans-label' }, label),
    h('span', { class: 'ans-track' }, h('i', { style: `width:${Math.max(share > 0 ? 0.6 : 0, share * 100)}%` })),
    h('span', { class: 'ans-value' }, h('b', {}, pct(share)), ` ${int(count)}`),
    extra && h('span', { class: 'ans-extra' }, extra));
}

function certainty(buckets: number[], mean: number): HTMLElement {
  return h('div', { class: 'q-block' },
    h('div', { class: 'q-block-title' }, 'Certeza de las respuestas', h('b', {}, `media ${dec(mean, 3)}`)),
    h('div', { class: 'cert-bar', role: 'img', 'aria-label': `Respuestas por tramo de certeza: ${buckets.map((share, index) => `${BUCKETS[index]}: ${pct(share)}`).join('; ')}` },
      ...buckets.map((share, index) => h('span', { class: `cert-${index}`, style: `flex-grow:${Math.max(share, 0.0001)}`, title: `${BUCKETS[index]}: ${pct(share)}` }))),
    h('div', { class: 'legend cert-legend' }, ...buckets.map((share, index) => h('span', {}, h('i', { class: `swatch cert-${index}` }), `${BUCKETS[index]} · ${pct(share, 0)}`))));
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
    ? [bar('Sí', stats.yes_share ?? 0, stats.yes ?? 0, '', 'yes'), bar('No', 1 - (stats.yes_share ?? 0), stats.answers - (stats.yes ?? 0), '', 'no')]
    : Object.entries(stats.options ?? {}).map(([option, value]) => bar(optionLabel(key, option, question.type), value.share, value.count,
        value.count > 0 ? `certeza ${dec(value.mean_certainty, 2)}` : ''));
  const perThousand = (stats.tokens_per_answer * data.price) / 1000;
  const right = h('div', { class: 'q-col' },
    label.allOnly && state.outlet !== 'all' && h('p', { class: 'note q-all' }, 'Esta pregunta se muestra solo para todos los medios juntos.'),
    certainty(stats.certainty_buckets, stats.mean_certainty),
    question.type === 'noul' && h('dl', { class: 'stats cols-3 q-yes' },
      tile('sky', 'Responde sí', pct(stats.yes_share ?? 0), `${int(stats.yes ?? 0)} de ${int(stats.answers)}`),
      tile('lavender', 'Certeza media del sí', dec(stats.yes_mean_certainty ?? 0, 3)),
      tile('peach', 'Sí con certeza baja', pct(stats.yes_low_certainty_share ?? 0), 'certeza menor que 0,5')),
    h('div', { class: 'q-block' },
      h('div', { class: 'q-block-title' }, 'Respuestas', h('b', {}, `${int(stats.answers)} en total`)),
      h('div', { class: 'answers' }, ...answers)),
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
