/**
 * TypeScript types for the public JSON contract produced by
 * export_public.py (main repo). Dates are Costa Rica local time without
 * timezone: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS".
 *
 * Controlled vocabularies are declared in ./vocab.ts.
 */
import type { LinkSource, VoteValue, OutletType } from './vocab';

export type { LinkSource, VoteValue, OutletType };

/** ISO date "YYYY-MM-DD". */
export type IsoDate = string;
/** ISO date-time "YYYY-MM-DDTHH:MM:SS" (local CR time). */
export type IsoDateTime = string;

/** Row of bills.json (compact index of every bill). */
export interface BillSummary {
  number: number;
  name: string;
  file_type: string;
  date_proposed: IsoDate;
  status: string;
  law_number: number | null;
  subjects: string[];
  proponents: string[];
  news_count: number;
  /** Votes published in detail (motions excluded). */
  votes_count: number;
  /** Motions voted on this bill, published only as a summary. */
  motions_count: number;
}

export interface Proponent {
  name: string;
  faction: string;
  province: string;
  signing_order: number;
}

export interface BillStep {
  organ: string;
  description: string;
  date_start: IsoDate;
  date_end: IsoDate | null;
}

export interface VoteDeputy {
  name: string;
  party: string;
  vote: VoteValue;
}

export interface Vote {
  vote_id: number;
  date: IsoDate;
  name: string;
  result: string;
  /** "Plenario" or "Comisión con potestad legislativa plena". */
  kind: string;
  deputies: VoteDeputy[];
}

/** Motions of one kind voted on a bill (e.g. "Moción de fondo"). */
export interface MotionSummary {
  name: string;
  approved: number;
  rejected: number;
  /** Annulled or tied. */
  other: number;
  date_first: IsoDate;
  date_last: IsoDate;
}

/** Base text of a bill (the one it was filed with), served as textos/<number>.txt. */
export interface BillTextInfo {
  /** False when the SIL has no text for the bill. */
  available: boolean;
  /** True when only the beginning is published (very long texts, mostly budget tables). */
  truncated: boolean;
  /** Words of the whole text, before any cut. */
  words: number;
}

/** A news article as seen from a bill. */
export interface BillNewsLink {
  id: string;
  title: string;
  organization: string;
  date_published: IsoDateTime;
  url: string;
  link_source: LinkSource;
  confidence: number | null;
}

/** bills/<number>.json */
export interface BillDetail {
  bill: BillSummary;
  proponents: Proponent[];
  steps: BillStep[];
  votes: Vote[];
  motions: MotionSummary[];
  text: BillTextInfo;
  news: BillNewsLink[];
}

/** A bill as seen from a news article. */
export interface NewsBillRef {
  number: number;
  link_source: LinkSource;
  confidence: number | null;
}

/** Row of news.json. Only title/outlet/date/section/url are ever published. */
export interface NewsArticle {
  id: string;
  title: string;
  organization: string;
  outlet_type: OutletType;
  section: string;
  date_published: IsoDateTime;
  url: string;
  bills: NewsBillRef[];
}

/** Row of outlets.json */
export interface Outlet {
  key: string;
  name: string;
  type: OutletType;
}

export type VoteCounts = Record<VoteValue, number>;

/** stats/factions.json (for the future /estadisticas module). */
export interface FactionStats {
  generated_from_votes: number;
  factions: { faction: string; deputies: number; counts: VoteCounts }[];
}

/* ---- Compact shapes served to the browser (src/pages/data/*.json.ts) ---- */

/** Compact bill row for the /expedientes listing and the search box. */
export interface BillIndexRow {
  n: number;
  name: string;
  st: string;
  y: number;
  subj: string[];
  nc: number;
  law: number | null;
}

/** Compact news row for the /noticias listing and the search box. */
export interface NewsIndexRow {
  id: string;
  t: string;
  o: string;
  d: IsoDateTime;
  s: string;
  u: string;
  b: number[];
}
