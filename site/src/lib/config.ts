/**
 * Site-wide configuration. Everything that will change when real data
 * arrives (or when external services exist) lives here.
 */

/** While true, a visible "Datos de prueba" banner is shown on every page. */
export const IS_DUMMY_DATA = false;

export const SITE_NAME = 'Cobertura legislativa';
export const SITE_TAGLINE = 'Qué proyectos de ley llegan a los medios en Costa Rica';

/** News collection window (Costa Rica local dates). */
export const STUDY_PERIOD = { start: '2026-05-01', end: '2026-10-31' } as const;

/**
 * External form for reporting a wrong news↔bill link. While null, the
 * "¿Este vínculo está mal?" link and every mention of it are hidden; set the
 * form URL here to turn them back on.
 */
export const REPORT_FORM_URL: string | null = null;

/** External questionnaire where visitors evaluate the site, linked from /evaluacion. */
export const EVALUATION_FORM_URL = 'https://forms.gle/3rLXye8CRz88ZTnKA';

/** License of the public data, shown on /datos. Hidden while null. */
export const DATA_LICENSE: string | null = null;

/** Future /analizar module: endpoint of the embeddings backend (not decided yet). */
export const ANALYZE_ENDPOINT: string | null = null;

/** Public consultation system of the Asamblea Legislativa, where the bill texts were retrieved. */
export const SIL_URL = 'https://produccion.asamblea.go.cr/SILConsulta/';

/** Page size used by the client-side listings. */
export const PAGE_SIZE = 25;

export const COURSE = 'CI-0133 Computación y Sociedad, Universidad de Costa Rica';
export const AUTHORS = ['Dariel Álvarez', 'Andrik Acuña'];
