/**
 * Formatting and normalization helpers. Pure functions: safe to import
 * from both build-time code and client-side scripts.
 */

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Split a local ISO date/datetime without converting timezones. */
export function dateParts(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

/** "19 may 2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const { y, m, d } = dateParts(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "19 de mayo de 2026" */
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  const { y, m, d } = dateParts(iso);
  return `${d} de ${MONTHS_LONG[m - 1]} de ${y}`;
}

export function monthShort(m: number): string {
  return MONTHS[m - 1];
}

/** Days since epoch for a local ISO date (UTC arithmetic, no TZ shifts). */
export function toDayNumber(iso: string): number {
  const { y, m, d } = dateParts(iso);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function fromDayNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

/** 24567 -> "24.567" (Asamblea Legislativa style). */
export function formatBillNumber(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatInt(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Recognize a bill number typed by a user:
 * "24567", "24.567", "24 567", "exp. 24567", "expediente N.° 24.567".
 */
export function parseBillNumber(q: string): number | null {
  const s = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const m = s.match(/^(?:exp(?:ediente)?\.?\s*)?(?:n(?:o|ro|um|umero)?\s*[.°º]*\s*)?(\d{1,2})[.\s]?(\d{3})$/);
  if (!m) return null;
  return Number(m[1] + m[2]);
}

/** Canonical form of a news URL for matching pasted links. */
export function normalizeUrl(u: string): string | null {
  try {
    const url = new URL(u.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    return `${host}${path}`.toLowerCase();
  } catch {
    return null;
  }
}

/** "Ana María Solano Ensayo" -> "AS" */
export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 2 ? parts[parts.length - 2][0] : parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

export function pluralize(n: number, one: string, many: string): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`;
}
