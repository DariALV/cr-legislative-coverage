// Chapter 3: the jump over the baseline (metric selector) and the two charts of the evolved ranker.
import './tips';
import { axis, base, mount } from './charts';
import { color, readData, segmented, stackedText } from './core';
import { dec } from '../../lib/process/format';

interface Metric { key: string; label: string; help: string; baseline: number; evolved: number }
interface History { best: number[]; mean: number[] }
interface Sweep { k: number; bill_coverage: number; link_recall: number; baseline_bill_coverage: number; baseline_link_recall: number }
interface Data { jump: Metric[]; history: { final: History; folds: History[] }; kSweep: Sweep[]; k: number }

const data = readData<Data>('data-ranker');

// ---------- The jump ----------
const jump = document.getElementById('ranker-jump');
const piece = (name: string) => jump?.querySelector<HTMLElement>(`[data-jump="${name}"]`);

function showJump(key: string): void {
  const metric = data.jump.find((item) => item.key === key) ?? data.jump[0];
  const set = (name: string, text: string) => { const element = piece(name); if (element) element.textContent = text; };
  set('base', dec(metric.baseline));
  set('evolved', dec(metric.evolved));
  jump?.querySelectorAll<HTMLElement>('[data-jump="compare"] > [data-key]').forEach((element) => {
    const on = element.dataset.key === metric.key;
    element.classList.toggle('on', on);
    element.setAttribute('aria-hidden', String(!on));
  });
  stackedText(piece('help'), Object.fromEntries(data.jump.map((item) => [item.key, item.help])), metric.key);
  piece('base-bar')?.style.setProperty('--w', `${metric.baseline * 100}%`);
  piece('evolved-bar')?.style.setProperty('--w', `${metric.evolved * 100}%`);
}
const group = jump?.querySelector('.segmented');
if (group) segmented(group, showJump);
showJump(data.jump[0].key);

// ---------- Fitness per generation ----------
const fitness = document.getElementById('ranker-fitness');
if (fitness) {
  const points = (values: number[]) => values.map((value, generation) => [generation, value]);
  const floor = Math.floor(Math.min(...data.history.final.best, ...data.history.folds.flatMap((fold) => fold.best)) * 50) / 50;
  mount(fitness, () => base({
    tooltip: { ...(base().tooltip as object), valueFormatter: (value: number) => dec(value, 3) },
    xAxis: axis('value', 'generación', { min: 0, max: data.history.final.best.length - 1, splitLine: { show: false } }),
    yAxis: axis('value', '', { min: floor, max: 1, axisLine: { show: false }, axisLabel: { formatter: (value: number) => dec(value, 2) } }),
    series: [
      ...data.history.folds.map((fold, index) => ({
        type: 'line', name: `Fold ${index + 1}`, data: points(fold.best), showSymbol: false, step: 'end',
        lineStyle: { color: color('--data-none'), width: 1.5, opacity: 0.8 }, itemStyle: { color: color('--data-none') },
      })),
      {
        type: 'line', name: 'Receta final', data: points(data.history.final.best), showSymbol: false, step: 'end', z: 5,
        lineStyle: { color: color('--accent'), width: 3 }, itemStyle: { color: color('--accent') },
      },
    ],
  }));
}

// ---------- Coverage by K ----------
const sweep = document.getElementById('ranker-ksweep');
if (sweep) {
  mount(sweep, () => base({
    tooltip: {
      ...(base().tooltip as object), valueFormatter: (value: number) => dec(value, 3),
      axisPointer: { type: 'line', label: { formatter: (params: { value: number }) => `K = ${Math.round(params.value)}` } },
    },
    xAxis: axis('log', 'K: candidatos por noticia', { min: 5, max: 300, splitLine: { show: false }, axisLabel: { formatter: (value: number) => String(value) } }),
    yAxis: axis('value', '', { min: 0.5, max: 1, axisLine: { show: false }, axisLabel: { formatter: (value: number) => dec(value, 1) } }),
    series: [
      {
        type: 'line', name: 'Solo embeddings', data: data.kSweep.map((row) => [row.k, row.baseline_bill_coverage]), symbolSize: 5,
        lineStyle: { color: color('--data-none'), width: 2, type: 'dashed' }, itemStyle: { color: color('--data-none') },
      },
      {
        type: 'line', name: 'Ranker evolucionado', data: data.kSweep.map((row) => [row.k, row.bill_coverage]), symbolSize: 6, z: 5,
        lineStyle: { color: color('--accent'), width: 3 }, itemStyle: { color: color('--accent') },
        markLine: {
          silent: true, symbol: 'none', lineStyle: { color: color('--ink-3'), type: 'dashed', width: 1.5 },
          label: { formatter: `K = ${data.k}`, color: color('--ink-2'), fontWeight: 700, fontSize: 12 },
          data: [{ xAxis: data.k }],
        },
      },
    ],
  }));
}
