/**
 * Controlled vocabularies and their Spanish labels.
 *
 * The keys are the values written by export_public.py (main repo), which
 * translates the English vocabularies of private_corpus.db to Spanish.
 * Keep both in sync:
 *  - link_source   <- news_bill_links.source ("link") or a Jev match
 *  - vote values   <- vote_deputies.vote
 *  - bill status   <- bills.status
 * file_type, vote result, section and names are published as they are in
 * the database.
 */

export const LINK_SOURCES = {
  enlace: {
    label: 'Enlace del medio',
    description: 'La noticia enlaza la ficha del expediente, y el modelo confirma que lo cubre.',
  },
  modelo: {
    label: 'Modelo automático',
    description: 'Vínculo propuesto por el cruce automático (embeddings, ranker y verificación con un modelo de lenguaje). Puede equivocarse.',
  },
} as const;
export type LinkSource = keyof typeof LINK_SOURCES;

export const VOTE_VALUES = {
  a_favor: { label: 'A favor' },
  en_contra: { label: 'En contra' },
  abstencion: { label: 'Abstención' },
  ausente: { label: 'Ausente' },
  ausente_pierde_dieta: { label: 'Ausente (pierde dieta)' },
} as const;
export type VoteValue = keyof typeof VOTE_VALUES;
export const VOTE_ORDER: VoteValue[] = ['a_favor', 'en_contra', 'abstencion', 'ausente', 'ausente_pierde_dieta'];

export const OUTLET_TYPES = {
  general: { label: 'Generalista' },
  specialized: { label: 'Especializado' },
} as const;
export type OutletType = keyof typeof OUTLET_TYPES;

/** Bill statuses, in display order. Unknown values are still displayed verbatim. */
export const BILL_STATUSES = ['En trámite', 'Convertido en ley', 'Archivado'];

/** Confidence bands used by LinkBadge. Applies only when confidence !== null. */
export const CONFIDENCE_BANDS = [
  { min: 0.75, key: 'high', label: 'alta' },
  { min: 0.5, key: 'medium', label: 'media' },
  { min: 0, key: 'low', label: 'baja' },
] as const;

export function confidenceBand(c: number) {
  return CONFIDENCE_BANDS.find((b) => c >= b.min) ?? CONFIDENCE_BANDS[CONFIDENCE_BANDS.length - 1];
}

export function linkSourceLabel(s: string): string {
  return (LINK_SOURCES as Record<string, { label: string }>)[s]?.label ?? s;
}

export function voteLabel(v: string): string {
  return (VOTE_VALUES as Record<string, { label: string }>)[v]?.label ?? v;
}
