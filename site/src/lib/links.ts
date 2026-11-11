/** Helpers for news↔bill links (origin, confidence, error reports). */
import { REPORT_FORM_URL } from './config';
import { confidenceBand, LINK_SOURCES, type LinkSource } from './vocab';

/** URL of the external form, pre-filled with the link being reported. */
export function reportLinkUrl(billNumber: number, newsId: string): string {
  const u = new URL(REPORT_FORM_URL);
  u.searchParams.set('expediente', String(billNumber));
  u.searchParams.set('noticia', newsId);
  return u.toString();
}

export function describeLink(source: LinkSource | string, confidence: number | null) {
  const meta = (LINK_SOURCES as Record<string, { label: string; description: string }>)[source];
  const band = confidence === null ? null : confidenceBand(confidence);
  return {
    sourceLabel: meta?.label ?? source,
    sourceDescription: meta?.description ?? '',
    band,
    confidenceText: confidence === null ? null : confidence.toFixed(2).replace('.', ','),
  };
}
