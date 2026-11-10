/** Minimal CSV writer (RFC 4180 quoting, UTF-8 with BOM for spreadsheets). */
export function toCsv(header: string[], rows: (string | number | null)[][]): Response {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  return new Response('﻿' + body + '\r\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
}
