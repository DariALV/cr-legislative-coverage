/**
 * Data access layer (build time only). This is the ONLY module that knows
 * where the JSON files live. Pages and components import from here.
 *
 * Source of truth: src/data/ (written by export_public.py, or by
 * scripts/make_dummy_data.mjs during the dummy phase). Compact versions for
 * the browser are emitted by src/pages/data/*.json.ts.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BillDetail, BillIndexRow, BillSummary, FactionStats,
  NewsArticle, NewsIndexRow, Outlet,
} from './types';
import { STUDY_PERIOD } from './config';

const DATA_DIR = join(process.cwd(), 'src', 'data');

const cache = new Map<string, unknown>();

function readJson<T>(rel: string): T {
  if (!cache.has(rel)) {
    const raw = readFileSync(join(DATA_DIR, rel), 'utf-8');
    cache.set(rel, JSON.parse(raw));
  }
  return cache.get(rel) as T;
}

export function getBills(): BillSummary[] {
  return readJson<BillSummary[]>('bills.json');
}

export function getBillDetail(number: number): BillDetail {
  return readJson<BillDetail>(`bills/${number}.json`);
}

export function getNews(): NewsArticle[] {
  return readJson<NewsArticle[]>('news.json');
}

export function getOutlets(): Outlet[] {
  return readJson<Outlet[]>('outlets.json');
}

export function getFactionStats(): FactionStats | null {
  return existsSync(join(DATA_DIR, 'stats', 'factions.json'))
    ? readJson<FactionStats>('stats/factions.json')
    : null;
}

let outletMap: Map<string, Outlet> | null = null;
export function outletName(key: string): string {
  outletMap ??= new Map(getOutlets().map((o) => [o.key, o]));
  return outletMap.get(key)?.name ?? key;
}

let billMap: Map<number, BillSummary> | null = null;
export function getBillSummary(n: number): BillSummary | undefined {
  billMap ??= new Map(getBills().map((b) => [b.number, b]));
  return billMap.get(n);
}

/** Headline figures for the home page. */
export function getSiteStats() {
  const bills = getBills();
  const news = getNews();
  return {
    news: news.length,
    linkedNews: news.filter((n) => n.bills.length > 0).length,
    bills: bills.length,
    billsWithCoverage: bills.filter((b) => b.news_count > 0).length,
    outlets: getOutlets().length,
    links: news.reduce((acc, n) => acc + n.bills.length, 0),
    period: STUDY_PERIOD,
  };
}

/* ---- Compact rows for the browser ---- */

export function getBillIndexRows(): BillIndexRow[] {
  return getBills().map((b) => ({
    n: b.number,
    name: b.name,
    st: b.status,
    y: Number(b.date_proposed.slice(0, 4)),
    subj: b.subjects,
    nc: b.news_count,
    law: b.law_number,
  }));
}

export function getNewsIndexRows(): NewsIndexRow[] {
  return getNews().map((n) => ({
    id: n.id,
    t: n.title,
    o: n.organization,
    d: n.date_published,
    s: n.section,
    u: n.url,
    b: n.bills.map((x) => x.number),
  }));
}
