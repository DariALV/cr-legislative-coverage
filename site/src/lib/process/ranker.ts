/**
 * What each input of the evolved ranker is, in Spanish, with the formula of the code that computes it
 * (tools/retrieval_tools/feature_builder.py for the fixed features, ranking_problem.py for the three that depend
 * on the evolved window and half-life, and for the score).
 */

export type FeatureGroup = 'semantic' | 'usual' | 'words' | 'dates';

export interface FeatureInfo {
  /** Short label drawn above the neuron. */
  label: string;
  /** What the input measures. */
  meaning: string;
  group: FeatureGroup;
  /** TeX of the input x before it is weighted. */
  formula: string;
  /** Continuous fixed features are standardized over all pairs before being weighted. */
  standardized: boolean;
  /** Evolved, non-weight genes this input depends on. */
  knobs?: string[];
}

export const GROUPS: Record<FeatureGroup, { label: string; color: string }> = {
  semantic: { label: 'Similitud semántica', color: '--cat-1' },
  usual: { label: 'Frente a lo usual', color: '--cat-7' },
  words: { label: 'Palabras', color: '--cat-4' },
  dates: { label: 'Trámite y fechas', color: '--cat-6' },
};

export const FEATURES: Record<string, FeatureInfo> = {
  cos_exposition_max: {
    label: 'Exposición: mejor fragmento', group: 'semantic', standardized: true,
    meaning: 'Similitud coseno máxima entre un fragmento de la noticia y el nombre más la exposición de motivos.',
    formula: String.raw`\max_{f}\; \cos\!\left(\mathbf{n}_f,\ \mathbf{e}_{\text{exposición}}\right)`,
  },
  cos_subjects_max: {
    label: 'Materias: mejor fragmento', group: 'semantic', standardized: true,
    meaning: 'Similitud coseno máxima entre un fragmento de la noticia y el nombre más las materias.',
    formula: String.raw`\max_{f}\; \cos\!\left(\mathbf{n}_f,\ \mathbf{e}_{\text{materias}}\right)`,
  },
  cos_name_max: {
    label: 'Nombre: mejor fragmento', group: 'semantic', standardized: true,
    meaning: 'Similitud coseno máxima entre un fragmento de la noticia y el nombre del expediente.',
    formula: String.raw`\max_{f}\; \cos\!\left(\mathbf{n}_f,\ \mathbf{e}_{\text{nombre}}\right)`,
  },
  cos_exposition_mean: {
    label: 'Exposición: promedio', group: 'semantic', standardized: true,
    meaning: 'Similitud coseno promedio de los fragmentos con el nombre más la exposición de motivos.',
    formula: String.raw`\frac{1}{F}\sum_{f=1}^{F} \cos\!\left(\mathbf{n}_f,\ \mathbf{e}_{\text{exposición}}\right)`,
  },
  z_exposition: {
    label: 'Exposición frente a lo usual', group: 'usual', standardized: true,
    meaning: 'La similitud con la exposición comparada con lo usual para ese expediente en 2.000 noticias de fondo (puntaje z).',
    formula: String.raw`\frac{c_{\text{exposición}} - \mu_b}{\sigma_b}`,
  },
  z_subjects: {
    label: 'Materias frente a lo usual', group: 'usual', standardized: true,
    meaning: 'La similitud con las materias comparada con lo usual para ese expediente en las noticias de fondo (puntaje z).',
    formula: String.raw`\frac{c_{\text{materias}} - \mu_b}{\sigma_b}`,
  },
  bm25: {
    label: 'Palabras en común (BM25)', group: 'words', standardized: true,
    meaning: 'Coincidencia de palabras (BM25, en logaritmo) entre la noticia y el nombre más las materias.',
    formula: String.raw`\ln\!\left(1 + \mathrm{BM25}(\text{noticia},\ \text{nombre} + \text{materias})\right)`,
  },
  event_distance: {
    label: 'Días al movimiento más cercano', group: 'dates', standardized: true,
    meaning: 'Días (en logaritmo, con tope de 365) entre la noticia y el movimiento del expediente en el SIL más cercano.',
    formula: String.raw`\ln\!\left(1 + \min(d_{\text{mov}},\ 365)\right)`,
  },
  alive: {
    label: 'Expediente vivo', group: 'dates', standardized: false,
    meaning: '1 si en la fecha de la noticia el expediente ya estaba presentado y no estaba archivado ni era ley.',
    formula: String.raw`\mathbf{1}\!\left[\,t_{\text{presentado}} \le t < t_{\text{archivo o ley}}\,\right]`,
  },
  filed_after_news: {
    label: 'Presentado después', group: 'dates', standardized: false,
    meaning: '1 si el expediente se presentó después de la noticia.',
    formula: String.raw`\mathbf{1}\!\left[\,t < t_{\text{presentado}}\,\right]`,
  },
  active: {
    label: 'Movimiento en la ventana', group: 'dates', standardized: false, knobs: ['window_before_days', 'window_after_days'],
    meaning: '1 si el expediente tuvo algún movimiento en el SIL dentro de la ventana alrededor de la noticia.',
    formula: String.raw`\mathbf{1}\!\left[\,m > 0\,\right],\quad m = \#\{\text{movimientos en } [t - a,\ t + p]\}`,
  },
  event_count: {
    label: 'Cantidad de movimientos', group: 'dates', standardized: false, knobs: ['window_before_days', 'window_after_days'],
    meaning: 'Cantidad de movimientos en el SIL dentro de la ventana (en logaritmo).',
    formula: String.raw`\ln(1 + m),\quad m = \#\{\text{movimientos en } [t - a,\ t + p]\}`,
  },
  age_decay: {
    label: 'Expediente reciente', group: 'dates', standardized: false, knobs: ['age_half_life_days'],
    meaning: 'Antigüedad del expediente en la fecha de la noticia, con decaimiento exponencial según la vida media.',
    formula: String.raw`2^{-\max(0,\ t - t_{\text{presentado}})\,/\,h}`,
  },
};

export interface KnobInfo {
  label: string;
  meaning: string;
  unit: string;
  symbol: string;
  feeds: string[];
  /** The gene is searched on a logarithmic scale. */
  log: boolean;
}

export const KNOBS: Record<string, KnobInfo> = {
  window_before_days: {
    label: 'Días antes', unit: 'días', symbol: 'a', feeds: ['active', 'event_count'], log: false,
    meaning: 'Días antes de la noticia que cubre la ventana de actividad.',
  },
  window_after_days: {
    label: 'Días después', unit: 'días', symbol: 'p', feeds: ['active', 'event_count'], log: false,
    meaning: 'Días después de la noticia que cubre la ventana de actividad.',
  },
  age_half_life_days: {
    label: 'Vida media', unit: 'días', symbol: 'h', feeds: ['age_decay'], log: true,
    meaning: 'Vida media, en días, del decaimiento por antigüedad.',
  },
};

/** Score of a news-bill pair: weighted sum over the switched-on inputs. */
export const SCORE_FORMULA = String.raw`s(n, b) = \sum_{i \,\in\, \text{activas}} w_i \cdot \tilde{x}_i(n, b)`;
/** Standardization of the continuous fixed features (mean and deviation over all pairs). */
export const STANDARD_FORMULA = String.raw`\tilde{x}_i = \frac{x_i - \bar{x}_i}{s_i}`;
/** Fitness of an individual on a training fold (TIE_BREAK = 0.001 in ranking_problem.py). */
export const FITNESS_FORMULA = String.raw`\text{fitness} = \text{cobertura@}K \;+\; 0{,}001 \cdot \overline{\left(\tfrac{K}{K + r}\right)}`;
