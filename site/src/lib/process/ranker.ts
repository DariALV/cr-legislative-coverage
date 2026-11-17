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
export const FITNESS_FORMULA = String.raw`\begin{aligned} \text{fitness} &= \text{cobertura@}K \\ &\quad +\; 0{,}001 \cdot \frac{1}{|B|} \sum_{b \in B} \frac{K}{K + r_b} \end{aligned}`;

/** What each symbol of the fitness formula is. {k} is replaced by the K of the run. */
export const FITNESS_NOTATION: { tex: string; text: string }[] = [
  { tex: String.raw`B`, text: 'Expedientes del dataset que tienen al menos una noticia en el fold de entrenamiento.' },
  { tex: String.raw`\text{cobertura@}K`, text: 'Parte de los expedientes de B que quedan entre los K primeros de alguna de sus noticias.' },
  { tex: String.raw`K`, text: 'Candidatos por noticia: se entrenó con K = {k} y el corpus usó 50.' },
  { tex: String.raw`r_b`, text: 'Mejor rango del expediente b entre sus noticias (1 es el primer lugar).' },
];

/** What each symbol of the inputs' formulas is. {background} is replaced by the count of background news. */
export const NOTATION: { tex: string; text: string; link?: 'bm25' }[] = [
  { tex: String.raw`n,\ b`, text: 'La noticia y el expediente del par.' },
  { tex: String.raw`f,\ F`, text: 'Un fragmento de la noticia y la cantidad de fragmentos.' },
  { tex: String.raw`\mathbf{n}_f`, text: 'Vector (embedding) del fragmento f de la noticia.' },
  { tex: String.raw`\mathbf{e}_{\text{exposición}},\ \mathbf{e}_{\text{materias}},\ \mathbf{e}_{\text{nombre}}`, text: 'Vector del expediente con el nombre más la exposición de motivos, con el nombre más las materias, y con el nombre solo.' },
  { tex: String.raw`\cos(\cdot,\ \cdot)`, text: 'Similitud coseno entre dos vectores: 1 si apuntan igual, 0 si no tienen nada en común.' },
  { tex: String.raw`c_{\text{exposición}},\ c_{\text{materias}}`, text: 'La mejor similitud coseno entre un fragmento y ese texto del expediente.' },
  { tex: String.raw`\mu_b,\ \sigma_b`, text: 'Media y desviación de esa similitud para el expediente b en {background} noticias de fondo.' },
  { tex: String.raw`\mathrm{BM25}(\cdot,\ \cdot)`, text: 'Puntaje de palabras en común entre la noticia y el nombre más las materias', link: 'bm25' },
  { tex: String.raw`t`, text: 'Fecha de la noticia.' },
  { tex: String.raw`t_{\text{presentado}}`, text: 'Fecha en que se presentó el expediente.' },
  { tex: String.raw`t_{\text{archivo o ley}}`, text: 'Fecha en que el expediente se archivó o se publicó como ley.' },
  { tex: String.raw`d_{\text{mov}}`, text: 'Días entre la noticia y el movimiento del expediente en el SIL más cercano a ella.' },
  { tex: String.raw`m`, text: 'Cantidad de movimientos del expediente en el SIL dentro de la ventana [t − a, t + p].' },
  { tex: String.raw`a,\ p`, text: 'Días antes y después de la noticia que cubre esa ventana (dos perillas).' },
  { tex: String.raw`h`, text: 'Vida media, en días, del decaimiento por antigüedad (la tercera perilla).' },
  { tex: String.raw`\mathbf{1}[\,\cdot\,]`, text: 'Vale 1 si la condición se cumple y 0 si no.' },
  { tex: String.raw`w_i`, text: 'Peso de la entrada i, entre −5 y 5.' },
  { tex: String.raw`\tilde{x}_i`, text: 'La entrada i estandarizada; las de 0 o 1 y las que dependen de las perillas entran tal cual.' },
  { tex: String.raw`\bar{x}_i,\ s_i`, text: 'Media y desviación de la entrada i sobre todos los pares.' },
];
