/**
 * Browser-side helpers shared by the listings and the search box:
 * loading the compact indexes, escaping and row rendering.
 */
import type { BillIndexRow, NewsIndexRow } from './types';
import { dataHref, billHref, newsHref } from './paths';
import { formatBillNumber, formatDate } from './format';

const cache = new Map<string, Promise<unknown>>();
function load<T>(file: string): Promise<T> {
  if (!cache.has(file)) {
    cache.set(file, fetch(dataHref(file)).then((r) => {
      if (!r.ok) throw new Error(`No se pudo cargar ${file}`);
      return r.json();
    }));
  }
  return cache.get(file) as Promise<T>;
}
export const loadBills = () => load<BillIndexRow[]>('bills-index.json');
export const loadNews = () => load<NewsIndexRow[]>('news-index.json');

export function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function billRowHtml(b: BillIndexRow): string {
  const law = b.law ? ` · Ley ${esc(b.law)}` : '';
  return `<li>
    <div class="row" style="gap:.5rem;margin-bottom:.2rem">
      <span class="bill-num">Exp. ${esc(formatBillNumber(b.n))}</span>
      <span class="pill">${esc(b.st)}${law}</span>
    </div>
    <div class="item-title"><a href="${billHref(b.n)}">${esc(b.name)}</a></div>
    <div class="item-meta">
      ${b.subj.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}
      <span>Presentado en ${esc(b.y)}</span>
      <span>${b.nc ? plural(b.nc, 'noticia', 'noticias') : '<em>sin noticias</em>'}</span>
    </div>
  </li>`;
}

export function newsRowHtml(n: NewsIndexRow, outlets: Record<string, string>): string {
  const outlet = outlets[n.o] ?? n.o;
  const bills = n.b.length
    ? n.b.map((x) => `<a href="${billHref(x)}" class="bill-num">${esc(formatBillNumber(x))}</a>`).join(', ')
    : '<em>sin expediente vinculado</em>';
  return `<li>
    <div class="item-title"><a href="${newsHref(n.id)}">${esc(n.t)}</a></div>
    <div class="item-meta">
      <span>${esc(outlet)}</span>
      <time datetime="${esc(n.d)}">${esc(formatDate(n.d))}</time>
      <span>${esc(n.s)}</span>
      <span>Expedientes: ${bills}</span>
    </div>
  </li>`;
}

/** Read/write filter state in the query string so listings are shareable. */
export function readParams(): URLSearchParams {
  return new URLSearchParams(location.search);
}
export function writeParams(state: Record<string, string>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v) p.set(k, v);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}
