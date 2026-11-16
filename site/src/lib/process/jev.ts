/**
 * Spanish wording for Jev's questions (the questions themselves were asked in English; see jev.json). The option
 * labels are those of the local viewer (private_visuals/jev_answers/labels.js).
 */
import type { IconName } from './icons';

export type StageKey = 'filter' | 'gate' | 'details_news' | 'details_bill';

export const STAGES: { key: StageKey; label: string; unit: string; text: string }[] = [
  { key: 'filter', label: 'Filtro', unit: 'por noticia', text: '¿La noticia habla de la Asamblea? Pasa con una probabilidad de 0,2 o más.' },
  { key: 'gate', label: 'Puerta', unit: 'por par noticia–candidato', text: 'El género de la noticia y, por cada candidato, si lo menciona de forma explícita o implícita. Hay match si alguna llega a 0,5.' },
  { key: 'details_news', label: 'Detalle', unit: 'por noticia con match', text: 'Cuatro preguntas sobre la noticia.' },
  { key: 'details_bill', label: 'Detalle', unit: 'por par con match', text: 'Treinta y dos preguntas sobre cómo trata la noticia a cada expediente.' },
];

export const TOPICS: { key: string; label: string }[] = [
  { key: 'filter', label: 'Filtro' },
  { key: 'gate', label: 'Menciones' },
  { key: 'news', label: 'La noticia' },
  { key: 'weight', label: 'Peso del expediente' },
  { key: 'framing', label: 'Postura y encuadre' },
  { key: 'content', label: 'Contenido' },
  { key: 'procedure', label: 'Trámite' },
  { key: 'voices', label: 'Voces' },
  { key: 'positions', label: 'Posiciones de partidos y Ejecutivo' },
];

export interface QuestionLabel {
  /** Short idea shown on the closed card. */
  short: string;
  topic: string;
  icon?: IconName;
  /** Small text badge used instead of an icon (the six actors). */
  badge?: string;
  /** Yes/no questions: what each answer means. */
  yes?: string;
  no?: string;
  /** Only the figure for all outlets is shown (judgments about how an outlet writes). */
  allOnly?: boolean;
}

const actor = (name: string, badge: string): QuestionLabel => ({ short: `Posición de ${name}`, topic: 'positions', badge });

export const QUESTIONS: Record<string, QuestionLabel> = {
  assembly: { short: 'Habla de la Asamblea', topic: 'filter', icon: 'qAssembly', yes: 'La noticia trata algo de la Asamblea Legislativa.', no: 'No trata nada de la Asamblea.' },
  genre: { short: 'Género', topic: 'gate', icon: 'news' },
  explicit: { short: 'Mención explícita', topic: 'gate', icon: 'qExplicit', yes: 'Lo nombra directo: por número, nombre o apodo.', no: 'No lo nombra.' },
  implicit: { short: 'Mención implícita', topic: 'gate', icon: 'qImplicit', yes: 'Lo describe o nombra a su proponente sin nombrarlo.', no: 'No lo menciona.' },
  press_release: { short: 'Comunicado de prensa', topic: 'news', icon: 'qPressRelease', yes: 'Repite el anuncio de una sola fuente, con poca reportería propia.', no: 'No es un comunicado.' },
  main_frame: { short: 'Encuadre principal', topic: 'news', icon: 'qFrame' },
  assembly_image: { short: 'Imagen de la Asamblea', topic: 'news', icon: 'qGauge' },
  headline_misleading: { short: 'Título engañoso', topic: 'news', icon: 'qWarning', yes: 'El título exagera o contradice el texto.', no: 'El título corresponde al texto.', allOnly: true },
  centrality: { short: 'Centralidad del expediente', topic: 'weight', icon: 'target' },
  in_headline: { short: 'En el título', topic: 'weight', icon: 'qHeadline', yes: 'El título se refiere al expediente.', no: 'El título no se refiere a él.' },
  stance: { short: 'Postura sobre el expediente', topic: 'framing', icon: 'qThumb' },
  author_judges: { short: 'El autor juzga el expediente', topic: 'framing', icon: 'pencil', yes: 'El autor (no una fuente citada) dice que es bueno o malo.', no: 'No lo juzga.', allOnly: true },
  conflict_frame: { short: 'Encuadre de conflicto', topic: 'framing', icon: 'qConflict', yes: 'Lo presenta sobre todo como una pelea entre actores políticos.', no: 'Explica el expediente más que la pelea.' },
  human_story: { short: 'Historia humana', topic: 'framing', icon: 'qHeart', yes: 'Ilustra con el caso de una persona o una familia.', no: 'No usa casos personales.' },
  explains_content: { short: 'Explica el contenido', topic: 'content', icon: 'qBook', yes: 'Explica qué haría o cambiaría el expediente.', no: 'No lo explica.' },
  explains_impact: { short: 'Explica el impacto', topic: 'content', icon: 'qImpact', yes: 'Dice a quién afectaría o qué consecuencias tendría.', no: 'No habla de afectados ni de consecuencias.' },
  gives_figures: { short: 'Da cifras', topic: 'content', icon: 'qBars', yes: 'Da costos, montos, tasas, personas afectadas o penas.', no: 'No da cifras de ese tipo.' },
  international: { short: 'Comparación internacional', topic: 'content', icon: 'globe', yes: 'Compara con otros países o cita a la OCDE, el FMI o la ONU.', no: 'No compara.' },
  constitutionality: { short: 'Dudas de constitucionalidad', topic: 'content', icon: 'qShield', yes: 'Menciona dudas, una consulta o un fallo de la Sala IV.', no: 'No toca la constitucionalidad.' },
  stage: { short: 'Etapa del trámite', topic: 'procedure', icon: 'qSteps' },
  new_development: { short: 'Novedad en el trámite', topic: 'procedure', icon: 'qBolt', yes: 'Reporta un paso reciente: presentación, dictamen, votación, veto o publicación.', no: 'No reporta un paso reciente.' },
  background: { short: 'Da antecedentes', topic: 'procedure', icon: 'qClock', yes: 'Dice cuándo se presentó o qué le pasó antes.', no: 'No da antecedentes.' },
  explains_procedure: { short: 'Explica el procedimiento', topic: 'procedure', icon: 'qFlow', yes: 'Explica debates, dictámenes, vía rápida, dispensa o votos necesarios.', no: 'No explica el trámite.' },
  vote_reported: { short: 'Reporta la votación', topic: 'procedure', icon: 'vote', yes: 'Da el conteo o dice cómo votaron diputados o partidos.', no: 'No reporta una votación.' },
  votes_outlook: { short: 'Panorama de votos', topic: 'procedure', icon: 'qTally', yes: 'Dice si tiene o no los votos que necesita.', no: 'No habla de los votos.' },
  next_step: { short: 'Siguiente paso', topic: 'procedure', icon: 'arrowRight', yes: 'Dice qué sigue: próximo debate, comisión, plenario o votación programada.', no: 'No dice qué sigue.' },
  names_proponent: { short: 'Nombra al proponente', topic: 'voices', icon: 'qIdCard', yes: 'Dice quién lo propuso.', no: 'No lo dice.' },
  deputy_quoted: { short: 'Cita a un diputado', topic: 'voices', icon: 'qQuote', yes: 'Cita o parafrasea a un diputado sobre el expediente.', no: 'No cita a ninguno.' },
  voice_business: { short: 'Voz empresarial', topic: 'voices', icon: 'qBriefcase', yes: 'Cita a empresarios, cámaras o asociaciones de la industria.', no: 'No los cita.' },
  voice_labor: { short: 'Voz sindical', topic: 'voices', icon: 'qHelmet', yes: 'Cita a sindicatos o trabajadores.', no: 'No los cita.' },
  voice_experts: { short: 'Voz experta', topic: 'voices', icon: 'teacher', yes: 'Cita a académicos, investigadores o expertos independientes.', no: 'No los cita.' },
  voice_civil_society: { short: 'Voz de la sociedad civil', topic: 'voices', icon: 'qPeople', yes: 'Cita a ONG, activistas o grupos comunales.', no: 'No los cita.' },
  voice_institutions: { short: 'Voz institucional', topic: 'voices', icon: 'brand', yes: 'Cita a instituciones públicas fuera de la Asamblea y el Ejecutivo.', no: 'No las cita.' },
  voice_affected: { short: 'Voz de afectados', topic: 'voices', icon: 'qPerson', yes: 'Cita a personas afectadas.', no: 'No las cita.' },
  pueblo_soberano: actor('Pueblo Soberano', 'PPSO'),
  liberacion_nacional: actor('Liberación Nacional', 'PLN'),
  frente_amplio: actor('Frente Amplio', 'FA'),
  unidad_social_cristiana: actor('Unidad Social Cristiana', 'PUSC'),
  agenda_ciudadana: actor('Agenda Ciudadana', 'CAC'),
  executive: actor('Poder Ejecutivo', 'Ej.'),
};

const POSITION = {
  not_mentioned: 'No dice', strongly_against: 'Muy en contra', against: 'En contra',
  neutral_or_divided: 'Neutral o dividido', in_favor: 'A favor', strongly_in_favor: 'Muy a favor',
};

/** Spanish label of every option of the choice and score questions. */
export const OPTIONS: Record<string, Record<string, string>> = {
  genre: { news_report: 'Noticia', opinion: 'Opinión', interview: 'Entrevista', analysis: 'Análisis' },
  main_frame: { conflict: 'Conflicto', economic: 'Económico', human_interest: 'Interés humano', responsibility: 'Responsabilidad', morality: 'Moral', policy: 'Política pública' },
  assembly_image: { 0: 'Muy negativa', 1: 'Negativa', 2: 'Neutral', 3: 'Positiva', 4: 'Muy positiva' },
  centrality: { 0: 'De paso', 1: 'Una parte', 2: 'Tema principal' },
  stance: { 0: 'Muy crítica', 1: 'Crítica', 2: 'Neutral', 3: 'Favorable', 4: 'Muy favorable' },
  stage: {
    filing: 'Presentado', committee: 'Comisión', first_debate: 'Primer debate', second_debate: 'Segundo debate',
    veto_or_signing: 'Sanción o veto', constitutional_court: 'Sala IV', archived_or_rejected: 'Archivado o rechazado', not_stated: 'No se dice',
  },
  pueblo_soberano: POSITION, liberacion_nacional: POSITION, frente_amplio: POSITION,
  unidad_social_cristiana: POSITION, agenda_ciudadana: POSITION, executive: POSITION,
};

export const OUTLETS: { key: string; name: string; color: string }[] = [
  { key: 'all', name: 'Todos', color: '--ink-3' },
  { key: 'crhoy', name: 'CRHoy', color: '--crhoy' },
  { key: 'nacion', name: 'La Nación', color: '--nacion' },
  { key: 'delfino', name: 'Delfino', color: '--delfino' },
  { key: 'elmundo', name: 'El Mundo', color: '--elmundo' },
  { key: 'semanario', name: 'Semanario', color: '--semanario' },
];

export const TYPE_LABELS: Record<string, string> = { noul: 'Sí / no', choice: 'Opción', score: 'Escala' };
