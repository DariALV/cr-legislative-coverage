/**
 * Controlled vocabularies and their Spanish labels.
 *
 * TO CONFIRM WITH REAL DATA (private_corpus.db). Update ONLY this file:
 *  - link_source values  -> news_bill_links.source
 *  - vote values         -> vote_deputies.vote
 *  - bill status / file_type values
 *  - whether confidence exists for every link or only for "model" links
 *
 * scripts/make_dummy_data.mjs mirrors these values for the dummy dataset.
 */

export const LINK_SOURCES = {
  delfino: {
    label: 'Delfino',
    description: 'Vínculo tomado de la ficha del expediente publicada por Delfino.cr.',
  },
  manual: {
    label: 'Revisión manual',
    description: 'Vínculo revisado a mano por el equipo del proyecto.',
  },
  model: {
    label: 'Modelo automático',
    description: 'Vínculo propuesto por el cruce automático (embeddings + ranker). Puede equivocarse.',
  },
} as const;
export type LinkSource = keyof typeof LINK_SOURCES;

export const VOTE_VALUES = {
  a_favor: { label: 'A favor' },
  en_contra: { label: 'En contra' },
  ausente: { label: 'Ausente' },
} as const;
export type VoteValue = keyof typeof VOTE_VALUES;
export const VOTE_ORDER: VoteValue[] = ['a_favor', 'en_contra', 'ausente'];

export const OUTLET_TYPES = {
  general: { label: 'Generalista' },
  specialized: { label: 'Especializado' },
} as const;
export type OutletType = keyof typeof OUTLET_TYPES;

/** Known bill statuses (dummy). Unknown values are still displayed verbatim. */
export const BILL_STATUSES = ['En trámite', 'Dictaminado', 'Convertido en ley', 'Archivado'];

export const FILE_TYPES = ['Ordinario', 'Reforma constitucional', 'Aprobación de convenio'];

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
