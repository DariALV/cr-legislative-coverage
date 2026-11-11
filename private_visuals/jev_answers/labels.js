// Spanish labels for Jev's questions and options (the questions themselves are in English, see
// results/jev/corpus/questions.json). Kept apart from app.js so wording can change without touching logic.
window.JEV_LABELS = {
  outlets: {
    crhoy: { name: "CRHoy", color: "var(--crhoy)" },
    nacion: { name: "La Nación", color: "var(--nacion)" },
    delfino: { name: "Delfino", color: "var(--delfino)" },
    elmundo: { name: "El Mundo", color: "var(--elmundo)" },
    semanario: { name: "Semanario Universidad", color: "var(--semanario)" },
  },
  genre: { news_report: "Noticia", opinion: "Opinión", interview: "Entrevista", analysis: "Análisis" },
  main_frame: {
    conflict: "Conflicto", economic: "Económico", human_interest: "Interés humano",
    responsibility: "Responsabilidad", morality: "Moral", policy: "Política pública",
  },
  assembly_image: ["Muy negativa", "Negativa", "Neutral", "Positiva", "Muy positiva"],
  centrality: ["De paso", "Una parte", "Tema principal"],
  stance: ["Muy crítica", "Crítica", "Neutral", "Favorable", "Muy favorable"],
  stage: {
    filing: "Presentado", committee: "Comisión", first_debate: "Primer debate", second_debate: "Segundo debate",
    veto_or_signing: "Sanción o veto", constitutional_court: "Sala IV", archived_or_rejected: "Archivado o rechazado",
    not_stated: "No se dice",
  },
  actors: {
    pueblo_soberano: "Pueblo Soberano", liberacion_nacional: "Liberación Nacional", frente_amplio: "Frente Amplio",
    unidad_social_cristiana: "Unidad Social Cristiana", agenda_ciudadana: "Agenda Ciudadana", executive: "Poder Ejecutivo",
  },
  actorShort: {
    pueblo_soberano: "PPSO", liberacion_nacional: "PLN", frente_amplio: "FA",
    unidad_social_cristiana: "PUSC", agenda_ciudadana: "CAC", executive: "Ejecutivo",
  },
  // Categorical slots in fixed order (validated reference palette), one per actor; other parties are gray.
  actorColors: {
    pueblo_soberano: "#2a78d6", liberacion_nacional: "#eb6834", frente_amplio: "#1baf7a",
    unidad_social_cristiana: "#eda100", agenda_ciudadana: "#e87ba4", executive: "#008300",
  },
  position: {
    not_mentioned: "No dice", strongly_against: "Muy en contra", against: "En contra",
    neutral_or_divided: "Neutral o dividido", in_favor: "A favor", strongly_in_favor: "Muy a favor",
  },
  voices: {
    voice_business: "Empresas", voice_labor: "Sindicatos", voice_experts: "Expertos",
    voice_civil_society: "Sociedad civil", voice_institutions: "Instituciones", voice_affected: "Afectados",
  },
  features: {
    new_development: "Hecho nuevo", in_headline: "En el titular", explains_content: "Explica el contenido",
    explains_impact: "Explica el impacto", gives_figures: "Da cifras", names_proponent: "Nombra al proponente",
    deputy_quoted: "Cita a un diputado", background: "Da antecedentes", explains_procedure: "Explica el trámite",
    vote_reported: "Reporta la votación", votes_outlook: "Habla de los votos", next_step: "Dice el próximo paso",
    conflict_frame: "Pleito político", author_judges: "El autor opina", constitutionality: "Constitucionalidad",
    international: "Comparación internacional", human_story: "Historia personal",
  },
  news_flags: { press_release: "Comunicado de prensa", headline_misleading: "Titular engañoso" },
};
