// Chapter 6: recall and Jev's cost by K, and the cost calculator. The cost model has the form of
// results/jev/cost_model.md with its constants measured on the corpus run (see export_process.py).
import { axis, base, mount } from './charts';
import { alpha, color, h, readData } from './core';
import { dec, int, pct, usd } from '../../lib/process/format';

interface Cost {
  price_per_million_tokens: number; news: number; outlets: number; months: number; k: number; filter_tokens: number;
  pass_rate: number; gate_base_tokens: number; candidate_tokens: number; match_rate: number; details_tokens: number;
}
interface Sweep { k: number; bill_coverage: number; link_recall: number }

const { cost, kSweep } = readData<{ cost: Cost; kSweep: Sweep[] }>('data-future');
const perOutletMonth = cost.news / (cost.outlets * cost.months);

/** Cost in USD of running Jev on `news` articles with K candidates each. */
function jevCost(news: number, k: number): number {
  const tokens = cost.filter_tokens + cost.pass_rate * (cost.gate_base_tokens + k * cost.candidate_tokens) + cost.pass_rate * cost.match_rate * cost.details_tokens;
  return (cost.price_per_million_tokens * news * tokens) / 1e6;
}

// ---------- Recall and cost by K ----------
const rows = kSweep.filter((row) => row.k <= 100);
const chart = document.getElementById('future-k');
if (chart) {
  mount(chart, () => base({
    grid: { left: 50, right: 56, top: 22, bottom: 44 },
    tooltip: {
      ...(base().tooltip as object), axisPointer: { type: 'shadow', shadowStyle: { color: alpha('--ink', 0.05) } },
      formatter: (items: { axisValue: string; seriesName: string; value: number; marker: string }[]) =>
        `<b>K = ${items[0].axisValue}</b><br>${items.map((item) => `${item.marker}${item.seriesName}: <b>${item.seriesName.startsWith('Costo') ? usd(item.value) : dec(item.value, 3)}</b>`).join('<br>')}`,
    },
    xAxis: axis('category', 'K: candidatos por noticia', { data: rows.map((row) => String(row.k)) }),
    yAxis: [
      axis('value', '', { min: 0.6, max: 1, axisLine: { show: false }, axisLabel: { formatter: (value: number) => dec(value, 1) } }),
      axis('value', '', { min: 0, axisLine: { show: false }, splitLine: { show: false }, axisLabel: { formatter: (value: number) => `$${int(value)}` } }),
    ],
    series: [
      {
        type: 'bar', name: 'Costo de Jev', yAxisIndex: 1, data: rows.map((row) => jevCost(cost.news, row.k)), barMaxWidth: 30,
        itemStyle: { color: alpha('--warn', 0.55), borderRadius: [5, 5, 0, 0] },
      },
      {
        type: 'line', name: 'Vínculos en el top K', data: rows.map((row) => row.link_recall), symbolSize: 5,
        lineStyle: { color: color('--cat-3'), width: 2, type: 'dashed' }, itemStyle: { color: color('--cat-3') },
      },
      {
        type: 'line', name: 'Cobertura de expedientes', data: rows.map((row) => row.bill_coverage), symbolSize: 7, z: 5,
        lineStyle: { color: color('--accent'), width: 3 }, itemStyle: { color: color('--accent') },
        markLine: {
          silent: true, symbol: 'none', lineStyle: { color: color('--ink-3'), type: 'dashed', width: 1.5 },
          label: { formatter: 'hoy', color: color('--ink-2'), fontWeight: 700, fontSize: 12 },
          data: [{ xAxis: String(cost.k) }],
        },
      },
    ],
  }));
}

const today = jevCost(cost.news, cost.k);
document.getElementById('future-k-tiles')?.replaceChildren(...[10, 5].map((k, index) => {
  const row = kSweep.find((item) => item.k === k);
  const value = jevCost(cost.news, k);
  return h('div', { class: `stat ${index === 0 ? 'mint' : 'sky'}` },
    h('dt', {}, `Con K = ${k}`), h('dd', {}, usd(value)),
    h('span', { class: 'stat-foot' }, `${pct(1 - value / today, 0)} menos; con el ranker de hoy la cobertura caería a ${dec(row?.bill_coverage ?? 0, 2)}`));
}));

// ---------- Cost calculator ----------
const calculator = document.getElementById('cost-calculator');
const inputs = new Map<string, HTMLInputElement>();
calculator?.querySelectorAll<HTMLInputElement>('input[data-calc]').forEach((input) => inputs.set(input.dataset.calc ?? '', input));
const defaults = new Map([...inputs].map(([key, input]) => [key, input.value]));

function calculate(): void {
  const value = (key: string) => Number(inputs.get(key)?.value ?? 0);
  const outlets = value('outlets'), months = value('months'), k = value('k');
  const news = outlets * months * perOutletMonth;
  const now = jevCost(news, cost.k), better = jevCost(news, k);
  const set = (name: string, text: string) => {
    const element = calculator?.querySelector<HTMLElement>(`[data-calc-out="${name}"], [data-calc-value="${name}"]`);
    if (element) element.textContent = text;
  };
  set('outlets', int(outlets));
  set('months', months >= 12 && months % 12 === 0 ? `${int(months)} (${months / 12} ${months === 12 ? 'año' : 'años'})` : int(months));
  set('k', int(k));
  set('news', int(news));
  set('now', usd(now, now >= 1000 ? 0 : 2));
  set('better', usd(better, better >= 1000 ? 0 : 2));
  set('k-label', `K = ${k}`);
  set('saving', k < cost.k ? `ahorra ${usd(now - better, now - better >= 1000 ? 0 : 2)} (${pct(1 - better / now, 0)})` : 'sin ahorro: es el mismo K');
  set('scale', `${dec(news / cost.news, 1)} veces este corpus`);
  calculator?.querySelector<HTMLElement>('[data-calc-bar="now"]')?.style.setProperty('--w', '100%');
  calculator?.querySelector<HTMLElement>('[data-calc-bar="better"]')?.style.setProperty('--w', `${(100 * better) / now}%`);
}

inputs.forEach((input) => input.addEventListener('input', calculate));
calculator?.querySelector('[data-calc-reset]')?.addEventListener('click', () => {
  inputs.forEach((input, key) => { input.value = defaults.get(key) ?? input.value; });
  calculate();
});
calculate();
