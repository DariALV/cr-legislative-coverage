"use strict";
/* Blind evaluation of Jev: answer every Jev question for each drawn news without seeing Jev's answers.
   server.py serves the news as Jev saw it and stores the answers; this page never receives Jev's output.
   The questions stay in English, as Jev saw them; the page and its help (glossary.js) are in Spanish. */

const API = {
  session: "api/session",
  news: id => `api/news/${id}`,
  bills: "api/bills",
  card: number => `api/card/${number}`,
  save: id => `api/answers/${id}`,
};
const OUTLETS = { crhoy: "CRHoy", nacion: "La Nación", elmundo: "El Mundo CR", semanario: "Semanario Universidad", delfino: "Delfino" };
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
  "noviembre", "diciembre"];
const OPTION_LABELS = {
  news_report: "News report", opinion: "Opinion", interview: "Interview", analysis: "Analysis",
  conflict: "Conflict", economic: "Economic", human_interest: "Human interest", responsibility: "Responsibility",
  morality: "Morality", policy: "Policy",
  not_mentioned: "Not mentioned", strongly_against: "Strongly against", against: "Against",
  neutral_or_divided: "Neutral / divided", in_favor: "In favor", strongly_in_favor: "Strongly in favor",
  filing: "Filing", committee: "Committee", first_debate: "First debate", second_debate: "Second debate",
  veto_or_signing: "Veto or signing", constitutional_court: "Constitutional Court",
  archived_or_rejected: "Archived or rejected", not_stated: "Not stated",
};
const POSITION_COLUMNS = ["not_mentioned", "strongly_against", "against", "neutral_or_divided", "in_favor", "strongly_in_favor"];
const ACTORS = {
  pueblo_soberano: ["PPSO", "Pueblo Soberano"],
  liberacion_nacional: ["PLN", "Liberación Nacional"],
  frente_amplio: ["FA", "Frente Amplio"],
  unidad_social_cristiana: ["PUSC", "Unidad Social Cristiana"],
  agenda_ciudadana: ["CAC", "Coalición Agenda Ciudadana"],
  executive: ["Ejecutivo", "Poder Ejecutivo"],
};
const BILL_GROUPS = [
  { id: "weight", title: "Peso y postura", keys: ["centrality", "stance", "author_judges", "new_development", "in_headline"] },
  { id: "actors", title: "Partidos y Poder Ejecutivo", matrix: "position",
    keys: ["pueblo_soberano", "liberacion_nacional", "frente_amplio", "unidad_social_cristiana", "agenda_ciudadana", "executive"] },
  { id: "voices", title: "Voces citadas", matrix: "yesno",
    keys: ["voice_business", "voice_labor", "voice_experts", "voice_civil_society", "voice_institutions", "voice_affected"] },
  { id: "process", title: "Trámite", keys: ["stage", "names_proponent", "deputy_quoted", "background", "explains_procedure",
    "vote_reported", "votes_outlook", "next_step", "constitutionality"] },
  { id: "content", title: "Contenido y enfoque", keys: ["explains_content", "explains_impact", "gives_figures", "conflict_frame",
    "international", "human_story"] },
];
const MENTIONS = [["none", "No"], ["explicit", "Lo nombra"], ["implicit", "Lo describe"]];
const IDLE_MS = 120_000;     // active time stops counting after this long without any interaction
const SAVE_DELAY_MS = 600;

// Words kept in upper case, and names kept capitalized, when the SIL's upper-case titles are shown in sentence case.
const ACRONYMS = new Set(["CCSS", "ICE", "INS", "MOPT", "RECOPE", "AYA", "MEP", "CNP", "IMAS", "INA", "BCR", "BCCR",
  "BNCR", "CNE", "OIJ", "TSE", "PANI", "INAMU", "ARESEP", "SUGEF", "SUPEN", "SUGEVAL", "SUGESE", "CONASSIF", "CONAVI",
  "JAPDEVA", "INDER", "FODESAF", "IVA", "OCDE", "ONU", "FMI", "BID", "BCIE", "OMC", "UCR", "UNA", "TEC", "UNED",
  "CONARE", "COVID", "SINART", "INVU", "ICT", "ICODER", "IAFA", "INCOP", "JPS", "MIDEPLAN", "MINAE", "SENASA", "SINAC",
  "SETENA", "ONG", "ONGS", "PYME", "PYMES", "CNFL", "JASEC", "ESPH", "FONABE", "FEES", "DINADECO", "IFAM", "INCOFER",
  "INTA", "SICOP", "CEN", "CINAI", "EBAIS", "SENARA", "FONAFIFO", "COMEX", "PROCOMER", "MAG", "MEIC", "MICITT", "MIVAH",
  "MTSS", "MSP", "MJP", "MCJ", "FODELI", "SIL", "TLC", "UE", "EEUU"]);
const ROMAN = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xx)$/;
const PROPER = ["Costa Rica", "República", "Asamblea Legislativa", "Poder Ejecutivo", "Poder Judicial", "Corte Suprema",
  "Sala Constitucional", "Tribunal Supremo de Elecciones", "Caja Costarricense de Seguro Social", "Banco Central",
  "Banco Nacional", "Contraloría General", "Procuraduría General", "Defensoría de los Habitantes", "Constitución Política",
  "La Gaceta", "Fuerza Pública", "Cruz Roja", "San José", "Alajuela", "Cartago", "Heredia", "Guanacaste", "Puntarenas",
  "Limón", "Golfito", "Turrialba", "Pérez Zeledón", "San Carlos", "Nicoya", "Liberia", "Pococí", "Talamanca",
  "Sarapiquí", "Desamparados", "Escazú", "Santa Ana", "Corredores", "Coto Brus", "Upala", "Los Chiles", "Centroamérica",
  "Estados Unidos", "Panamá", "Nicaragua", "Unión Europea", "Naciones Unidas", "Código Penal", "Código de Trabajo",
  "Código Civil", "Universidad de Costa Rica"];
const PROPER_RE = new RegExp(`(?<![\\p{L}])(${PROPER.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}])`, "giu");

const $ = id => document.getElementById(id);
const newsPane = $("news-pane");
const answerPane = $("answer-pane");

const S = {
  session: null,
  items: [],
  index: 0,
  news: new Map(),       // news_id -> payload from the server (plus .extra: bills added by hand)
  answers: {},           // news_id -> entry
  bills: null,           // every bill [number, title, normalized title], loaded on the first search
  units: [],             // answerable things in the answer pane, in display order
  unitById: new Map(),
  focusId: null,
  expanded: new Set(),   // news whose reviewed candidate list was opened again
  dirty: new Set(),
  saving: false,
  saveTimer: null,
  lastSaved: null,
  lastInteraction: 0,    // time only counts after the first interaction: a page left open doesn't add minutes
  glossaryOpen: false,
};
let NEWS_KEYS = [];
let DETAIL_KEYS = [];

/* ---------- small helpers ---------- */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}
const fmtNum = number => String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const norm = text => (text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function fmtDate(iso) {
  if (!iso) return "";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return `${day} de ${MONTHS[month - 1]} de ${year}`;
}
function fmtMonth(iso) {
  if (!iso) return "";
  const [year, month] = iso.split("-").map(Number);
  return `${MONTHS[month - 1]} de ${year}`;
}
function sentenceCase(text) {
  if (!text) return "";
  let out = text.toLocaleLowerCase("es").replace(/\p{L}[\p{L}]*/gu, word =>
    ACRONYMS.has(word.toLocaleUpperCase("es")) || ROMAN.test(word) ? word.toLocaleUpperCase("es") : word);
  out = out.replace(PROPER_RE, match => PROPER.find(name => name.toLocaleLowerCase("es") === match.toLocaleLowerCase("es")) || match);
  out = out.replace(/\bn\.\s?º|\bnº|\bn°/g, "N.º");
  out = out.replace(/\((\p{L}{2,8})\)/gu, (match, word) => `(${word.toLocaleUpperCase("es")})`);   // "(snit)" -> "(SNIT)"
  return out.charAt(0).toLocaleUpperCase("es") + out.slice(1);
}
function titleCaseName(text) {
  const small = new Set(["de", "del", "la", "las", "los", "y"]);
  return (text || "").toLocaleLowerCase("es").split(/\s+/).filter(Boolean)
    .map((word, i) => i > 0 && small.has(word) ? word
      : word.replace(/(^|-)(\p{L})/gu, (match, sep, letter) => sep + letter.toLocaleUpperCase("es")))
    .join(" ");
}
const partyShort = party => PARTIES[party]?.short || titleCaseName(party);
function resolveText(text, number) {
  return (text || "")
    .replace(/`news`/g, "the news")
    .replace(/`(?:candidates|bills)\.b<number>`/g, number ? `file ${fmtNum(number)}` : "this file")
    .replace(/(^|[.?!]\s+)this file/g, (match, start) => `${start}This file`)
    .replace(/`deputies` lists each deputy's party\./g, "The glossary lists each deputy's party.");
}

/* ---------- questions and entries ---------- */
function specFor(scope, key) {
  const raw = S.session.questions[scope][key];
  const spec = { key, scope, type: raw.type, instructions: raw.instructions, criteria: raw.criteria, options: [] };
  if (raw.type === "choice") {
    spec.options = Object.entries(raw.criteria).map(([value, desc]) => ({ value, label: OPTION_LABELS[value] || value, desc }));
  } else if (raw.type === "score") {
    spec.options = raw.criteria.map((label, value) => ({ value, label }));
  } else {
    spec.options = [{ value: true, label: "Yes", desc: raw.criteria?.true }, { value: false, label: "No", desc: raw.criteria?.false }];
  }
  return spec;
}
function billGroups() {
  const covered = new Set(BILL_GROUPS.flatMap(group => group.keys));
  const others = DETAIL_KEYS.filter(key => !covered.has(key));
  const groups = BILL_GROUPS.map(group => ({ ...group, keys: group.keys.filter(key => DETAIL_KEYS.includes(key)) }));
  return others.length ? [...groups, { id: "others", title: "Otras", keys: others }] : groups;
}
function blankEntry() {
  return { genre: null, candidates_done: false, bills: {}, news_answers: {}, doubtful: [], note: "", seconds: 0,
    opened_at: new Date().toISOString(), completed_at: null, complete: false };
}
const current = () => S.items[S.index];
function entryFor(newsId) {
  return S.answers[newsId] || (S.answers[newsId] = blankEntry());
}
const currentEntry = () => entryFor(current().news_id);
const candidatesOf = payload => [...(payload?.extra || []), ...(payload?.candidates || [])];
const markedNumbers = entry => Object.keys(entry.bills).filter(number => entry.bills[number]?.mention);
function orderedMarked(entry, payload) {
  const order = new Map(candidatesOf(payload).map((info, i) => [String(info.number), i]));
  return markedNumbers(entry).sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a - b);
}
function progressOf(entry) {
  const marked = markedNumbers(entry);
  let required = 2;
  let answered = (entry.genre != null ? 1 : 0) + (entry.candidates_done ? 1 : 0);
  if (marked.length) {
    required += NEWS_KEYS.length + DETAIL_KEYS.length * marked.length;
    answered += NEWS_KEYS.filter(key => entry.news_answers[key] !== undefined).length;
    for (const number of marked) answered += DETAIL_KEYS.filter(key => entry.bills[number].answers?.[key] !== undefined).length;
  }
  return { required, answered, left: required - answered, complete: answered >= required };
}
const allComplete = () => S.items.every(item => S.answers[item.news_id] && progressOf(S.answers[item.news_id]).complete);

/* ---------- loading and navigation ---------- */
async function init() {
  try {
    const response = await fetch(API.session);
    if (!response.ok) throw new Error(`el servidor respondió ${response.status}`);
    S.session = await response.json();
  } catch (error) {
    showFatal(`No hubo respuesta del servidor local (${error.message}).`);
    return;
  }
  S.items = S.session.items;
  NEWS_KEYS = Object.keys(S.session.questions.details_news);
  DETAIL_KEYS = Object.keys(S.session.questions.details);
  for (const [newsId, saved] of Object.entries(S.session.answers || {})) S.answers[newsId] = Object.assign(blankEntry(), saved);
  $("set-label").textContent = S.session.set === "pilot" ? `Piloto · ${S.items.length} noticias` : `${S.items.length} noticias`;
  setSaveState("idle");
  buildGlossary();
  bindEvents();
  const fromHash = Number(location.hash.slice(1)) - 1;
  const firstOpen = S.items.findIndex(item => !(S.answers[item.news_id] && progressOf(S.answers[item.news_id]).complete));
  await goTo(fromHash >= 0 && fromHash < S.items.length ? fromHash : Math.max(0, firstOpen));
}

async function loadNews(newsId) {
  if (S.news.has(newsId)) return S.news.get(newsId);
  const response = await fetch(API.news(newsId));
  if (!response.ok) throw new Error(`el servidor respondió ${response.status}`);
  const payload = await response.json();
  S.news.set(newsId, payload);
  return payload;
}
async function loadAddedCards(payload, entry) {
  const known = new Set(candidatesOf(payload).map(info => String(info.number)));
  for (const [number, bill] of Object.entries(entry.bills)) {
    if (!bill.added || known.has(number)) continue;
    const info = await (await fetch(API.card(number))).json();
    info.added = true;
    payload.extra = [...(payload.extra || []), info];
  }
}

async function goTo(index) {
  if (index < 0 || index >= S.items.length) return;
  if (S.dirty.size) flush();
  S.index = index;
  S.focusId = null;
  const item = current();
  newsPane.replaceChildren(h("div", { class: "news-inner" }, h("p", { class: "news-loading" }, "Cargando la noticia…")));
  let payload;
  try {
    payload = await loadNews(item.news_id);
    await loadAddedCards(payload, entryFor(item.news_id));
  } catch (error) {
    newsPane.replaceChildren(h("div", { class: "news-inner" }, h("p", { class: "news-cut" }, `No se pudo cargar la noticia (${error.message}).`)));
    return;
  }
  if (S.index !== index) return;
  renderNews(item, payload);
  renderAnswers();
  newsPane.scrollTop = 0;
  answerPane.scrollTop = 0;
  window.scrollTo(0, 0);
  history.replaceState(null, "", `#${index + 1}`);
  const next = S.items[index + 1];
  if (next) loadNews(next.news_id).catch(() => {});
}

/* ---------- news pane ---------- */
function renderNews(item, payload) {
  const paragraphs = (payload.content || "").split(/\n+/).map(text => text.trim()).filter(Boolean);
  newsPane.replaceChildren(h("div", { class: "news-inner" },
    h("div", { class: "news-kicker" },
      h("span", { class: "kicker-pos" }, `Noticia ${S.index + 1} de ${S.items.length}`),
      h("span", { class: `outlet o-${item.outlet}` }, OUTLETS[item.outlet] || item.outlet),
      h("time", {}, fmtDate(payload.date || item.date))),
    h("h1", { class: "news-title" }, payload.title || "(sin título)"),
    h("div", { class: "news-body" }, paragraphs.map(text => h("p", {}, text))),
    payload.cut ? h("p", { class: "news-cut" },
      `Aquí se corta el texto: Jev solo vio los primeros ${fmtNum(S.session.max_chars)} caracteres, y vos contestás sobre lo mismo.`) : null));
}

/* ---------- answer pane ---------- */
function renderAnswers() {
  const item = current();
  const payload = S.news.get(item.news_id);
  const entry = entryFor(item.news_id);
  S.units = [];
  S.unitById = new Map();
  const marked = orderedMarked(entry, payload);
  const parts = [h("nav", { class: "section-nav", id: "section-nav", "aria-label": "Secciones" }),
    sectionGenre(entry), sectionCandidates(entry, payload, marked)];
  if (marked.length) {
    parts.push(sectionNews(entry));
    for (const number of marked) parts.push(sectionBill(entry, payload, number));
  }
  parts.push(sectionFooter(entry));
  const top = answerPane.scrollTop;
  answerPane.replaceChildren(...parts);
  answerPane.scrollTop = top;
  S.units.forEach(syncUnit);
  updateProgress();
  if (S.focusId && S.unitById.has(S.focusId)) focusUnit(S.focusId, { scroll: false });
}

function card(id, step, title, countId, ...children) {
  return h("section", { class: "card", id },
    h("header", { class: "card-head" },
      h("h2", {}, step ? h("span", { class: "card-step" }, step) : null, title),
      h("span", { class: "card-count", id: countId })),
    ...children);
}
function registerUnit(unit) {
  S.units.push(unit);
  S.unitById.set(unit.id, unit);
  return unit;
}
function tools(unitId, helpId) {
  return h("span", { class: "q-tools" },
    h("button", { type: "button", class: "flag-btn", "data-flag": unitId, "aria-pressed": "false", title: "Marcar como dudosa (D)" }, "Dudosa"),
    h("button", { type: "button", class: "icon-btn", "data-help": helpId, title: "¿Qué significa? (?)", "aria-label": "Ayuda sobre esta pregunta" }, "?"));
}
function optionButton(unitId, option, index) {
  return h("button", { type: "button", class: "opt", role: "radio", "aria-checked": "false", "data-unit": unitId,
    "data-value": JSON.stringify(option.value) },
    h("span", { class: "opt-key" }, String(index + 1)),
    h("span", {}, h("span", { class: "opt-label" }, option.label), option.desc ? h("span", { class: "opt-desc" }, option.desc) : null),
    h("span", { class: "opt-check" }));
}
function questionBlock(def) {
  const el = h("div", { class: `q q-${def.layout || "list"}`, "data-unit": def.id, tabindex: "-1" },
    h("div", { class: "q-head" }, def.hideTitle ? null : h("span", { class: "q-title" }, def.title), tools(def.id, def.help)),
    h("p", { class: "q-text" }, resolveText(def.spec.instructions, def.bill)),
    h("div", { class: "opts", role: "radiogroup", "aria-label": def.title }, def.spec.options.map((option, i) => optionButton(def.id, option, i))));
  registerUnit({ ...def, el, kind: "question", required: true, options: def.spec.options.map(option => option.value) });
  return el;
}
function yesNoRow(def) {
  const el = h("div", { class: "q q-row", "data-unit": def.id, tabindex: "-1" },
    h("div", {}, h("div", { class: "q-title" }, def.title), h("p", { class: "q-text" }, resolveText(def.spec.instructions, def.bill))),
    h("div", { class: "q-row-side" },
      h("div", { class: "yesno", role: "radiogroup", "aria-label": def.title },
        def.spec.options.map(option => h("button", { type: "button", class: "yn", role: "radio", "aria-checked": "false",
          "data-unit": def.id, "data-value": JSON.stringify(option.value), title: option.desc || null }, option.label))),
      tools(def.id, def.help)));
  registerUnit({ ...def, el, kind: "question", required: true, yesno: true, options: [true, false] });
  return el;
}

function sectionGenre(entry) {
  return card("sec-genre", "1", "Tipo de pieza", "count-genre",
    questionBlock({ id: "genre", spec: specFor("gate", "genre"), layout: "grid", title: QUESTION_TITLES.genre, help: "genre", hideTitle: true,
      get: () => entry.genre ?? undefined, set: value => { entry.genre = value ?? null; } }));
}

function sectionCandidates(entry, payload, marked) {
  const list = candidatesOf(payload);
  const expanded = !entry.candidates_done || S.expanded.has(current().news_id);
  const children = [
    h("p", { class: "card-sub" }, `Los ${payload.candidates.length} expedientes que el sistema le propuso a Jev para esta noticia, `
      + "en el orden en que se los dio. Marcá los que la noticia nombra o describe; el resto queda en «No»."),
    gateLegend(entry),
  ];
  if (expanded) {
    children.push(
      h("div", { class: "filter-row" },
        h("input", { class: "input", type: "search", id: "cand-filter", placeholder: "Filtrar la lista por número o palabra…", autocomplete: "off" }),
        h("span", { class: "filter-count", id: "cand-filter-count" }, `${list.length} candidatos`)),
      h("div", { class: "cand-list" }, list.map(info => candidateRow(entry, info))),
      searchOther(),
      h("div", { class: "cand-actions" },
        h("span", { class: "hint" }, marked.length
          ? `Marcaste ${marked.length} ${marked.length === 1 ? "expediente" : "expedientes"}.`
          : "Si la noticia no habla de ninguno, dejalos todos en «No»."),
        doneUnit(entry, list.length)));
  } else {
    children.push(h("div", { class: "cand-summary" },
      marked.length
        ? marked.map(number => h("span", { class: "marked-pill" }, h("b", {}, fmtNum(number)),
          h("em", {}, entry.bills[number].mention === "explicit" ? "lo nombra" : "lo describe")))
        : h("span", { class: "hint" }, "No marcaste ningún expediente."),
      h("button", { type: "button", class: "btn small", "data-action": "expand" }, "Revisar la lista")));
    if (!marked.length) children.push(h("p", { class: "done-note" }, "Como no marcaste ningún expediente, esta noticia termina aquí."));
  }
  return card("sec-cands", "2", "Expedientes", "count-cands", ...children);
}
function gateLegend(entry) {
  const gate = S.session.questions.gate;
  const definition = (label, raw) => h("div", { class: "def" }, h("b", {}, label),
    h("p", {}, resolveText(raw.instructions)),
    h("p", { class: "crit" }, `Yes: ${raw.criteria.true}`), h("p", { class: "crit" }, `No: ${raw.criteria.false}`));
  return h("div", {},
    h("div", { class: "legend" },
      h("div", {}, h("b", {}, "Lo nombra"), ": da su número, cita su título oficial o usa un apodo que se refiere a él."),
      h("div", {}, h("b", {}, "Lo describe"), ": habla de ese expediente en particular sin nombrarlo.")),
    h("details", { class: "defs", open: !entry.candidates_done && S.index === 0 ? true : null },
      h("summary", {}, "Las dos preguntas completas, como las vio Jev"),
      definition("Lo nombra", gate.explicit), definition("Lo describe", gate.implicit)));
}
function candidateRow(entry, info) {
  const number = String(info.number);
  const id = `cand:${number}`;
  const subjects = [...new Set((info.subjects || []).map(subject => subject.toLocaleLowerCase("es")))];
  const proponents = info.proponents || [];
  const meta = [];
  if (proponents.length) {
    meta.push(h("span", {}, proponents.map((person, i) => [i ? ", " : "", titleCaseName(person.name),
      person.party ? h("span", { class: "party-tag" }, ` (${partyShort(person.party)})`) : null])));
  }
  if (info.date_filed) meta.push(h("span", {}, `presentado en ${fmtMonth(info.date_filed)}`));
  if (subjects.length) {
    meta.push(h("span", { class: "chips" }, subjects.slice(0, 4).map(subject => h("span", { class: "chip" }, subject)),
      subjects.length > 4 ? h("button", { type: "button", class: "chip-more", "data-action": "more-subjects",
        "data-more": JSON.stringify(subjects.slice(4)) }, `+${subjects.length - 4}`) : null));
  }
  const el = h("div", { class: "cand", "data-unit": id, tabindex: "-1",
    "data-search": norm([number, fmtNum(number), info.name, ...subjects, ...proponents.map(person => person.name)].join(" ")) },
    h("div", { class: "cand-num" }, fmtNum(number), info.added ? h("div", {}, h("span", { class: "badge" }, "agregado")) : null),
    h("div", {}, h("div", { class: "cand-title", title: info.name }, sentenceCase(info.name)), h("div", { class: "cand-meta" }, meta)),
    h("div", { class: "seg", role: "radiogroup", "aria-label": `Expediente ${fmtNum(number)}` },
      MENTIONS.map(([value, label]) => h("button", { type: "button", role: "radio", "aria-checked": "false",
        "data-unit": id, "data-value": JSON.stringify(value) }, label))));
  registerUnit({ id, el, kind: "cand", bill: number, required: false, help: "mention", options: MENTIONS.map(([value]) => value),
    get: () => entry.bills[number]?.mention || "none", set: value => setMention(entry, number, value, !!info.added) });
  return el;
}
function doneUnit(entry, total) {
  const el = h("div", { class: "done-unit", "data-unit": "done", tabindex: "-1" },
    h("button", { type: "button", class: "btn primary", "data-action": "done" }, `Listo: revisé los ${total}`));
  registerUnit({ id: "done", el, kind: "done", required: true, options: [true],
    get: () => entry.candidates_done || undefined,
    set: () => { entry.candidates_done = true; S.expanded.delete(current().news_id); } });
  return el;
}
function searchOther() {
  return h("details", { class: "search-other" },
    h("summary", {}, "¿Falta alguno? Buscalo entre todos los expedientes"),
    h("div", { class: "filter-row" },
      h("input", { class: "input", type: "search", id: "other-search", placeholder: "Número o palabras del título…", autocomplete: "off" })),
    h("div", { class: "search-results", id: "other-results" }));
}

function sectionNews(entry) {
  const blocks = NEWS_KEYS.map(key => {
    const spec = specFor("details_news", key);
    const def = { id: `news:${key}`, spec, key, title: QUESTION_TITLES[key] || key, help: key,
      get: () => entry.news_answers[key],
      set: value => { if (value === undefined) delete entry.news_answers[key]; else entry.news_answers[key] = value; } };
    return spec.type === "noul" && !spec.criteria ? yesNoRow(def) : questionBlock({ ...def, layout: key === "main_frame" ? "grid" : "list" });
  });
  return card("sec-news", "3", "La noticia en conjunto", "count-news",
    h("p", { class: "card-sub" }, "Estas preguntas son sobre la noticia entera, no sobre un expediente."), ...blocks);
}

function sectionBill(entry, payload, number) {
  const bill = entry.bills[number];
  const info = candidatesOf(payload).find(candidate => String(candidate.number) === number) || { number, name: "" };
  const facts = [];
  if (info.proponents?.length) facts.push(`Proponentes: ${info.proponents.map(person => titleCaseName(person.name)).join(", ")}`);
  if (info.date_filed) facts.push(`presentado en ${fmtMonth(info.date_filed)}`);
  const groups = billGroups().map(group => h("div", { class: "group" },
    h("h3", { class: "group-title" }, group.title),
    group.matrix === "position" ? positionMatrix(entry, number, group.keys)
      : group.matrix === "yesno" ? voicesMatrix(entry, number, group.keys)
        : group.keys.map(key => detailQuestion(entry, number, key))));
  return h("section", { class: "card bill-card", id: `sec-bill-${number}` },
    h("header", { class: "card-head" },
      h("h2", {}, `Expediente ${fmtNum(number)}`, h("span", { class: "mention-tag" }, bill.mention === "explicit" ? "Lo nombra" : "Lo describe")),
      h("span", { class: "card-count", id: `count-bill-${number}` })),
    h("p", { class: "bill-title", title: info.name }, sentenceCase(info.name)),
    facts.length ? h("div", { class: "bill-meta" }, facts.join(" · ")) : null,
    h("p", { class: "card-sub bill-scope" }, "Todas estas preguntas son sobre el expediente entero, no sobre una moción, un reglamento "
      + "o un cambio que se le hizo."),
    ...groups);
}
function billAnswerAccess(entry, number, key) {
  return {
    get: () => entry.bills[number]?.answers?.[key],
    set: value => {
      const answers = entry.bills[number].answers || (entry.bills[number].answers = {});
      if (value === undefined) delete answers[key]; else answers[key] = value;
    },
  };
}
function detailQuestion(entry, number, key) {
  const spec = specFor("details", key);
  const def = { id: `${number}:${key}`, spec, bill: number, key, title: QUESTION_TITLES[key] || key, help: key,
    ...billAnswerAccess(entry, number, key) };
  return spec.type === "noul" ? yesNoRow(def) : questionBlock({ ...def, layout: "list" });
}
function matrixRow(entry, number, key, columns, label, small, help) {
  const id = `${number}:${key}`;
  const spec = specFor("details", key);
  const el = h("div", { class: "matrix-row q", "data-unit": id, tabindex: "-1", style: `--cols: ${columns.length}`,
    title: resolveText(spec.instructions, number) },
    h("div", { class: "row-label" }, h("b", {}, label), small ? h("small", {}, small) : null),
    columns.map(([value, name], i) => h("button", { type: "button", class: "cell", role: "radio", "aria-checked": "false",
      "aria-label": `${label}: ${name}`, "data-unit": id, "data-value": JSON.stringify(value),
      title: `${i + 1} · ${name}${spec.criteria?.[value] ? `: ${spec.criteria[value]}` : ""}` })),
    h("div", { class: "row-tools" }, tools(id, help)));
  registerUnit({ id, el, kind: "question", bill: number, key, required: true, help, title: label,
    yesno: columns.length === 2, options: columns.map(([value]) => value), ...billAnswerAccess(entry, number, key) });
  return el;
}
function matrixHead(columns) {
  return h("div", { class: "matrix-head", style: `--cols: ${columns.length}` }, h("span", {}), columns.map(([, name]) => h("span", {}, name)), h("span", {}));
}
function positionMatrix(entry, number, keys) {
  const columns = POSITION_COLUMNS.map(value => [value, OPTION_LABELS[value]]);
  const criteria = S.session.questions.details[keys[0]].criteria;
  return h("div", {},
    h("p", { class: "matrix-intro" }, `What position on file ${fmtNum(number)} does the news attribute to each party, through its `
      + "deputies or spokespeople, and to the Executive Branch (the President, a minister or a government spokesperson)?"),
    h("div", { class: "matrix" }, h("div", { class: "matrix-grid" }, matrixHead(columns),
      keys.map(key => matrixRow(entry, number, key, columns, ACTORS[key]?.[0] || key, ACTORS[key]?.[1], key)))),
    h("p", { class: "matrix-note" }, POSITION_COLUMNS.map((value, i) => [i ? " · " : "", h("strong", {}, OPTION_LABELS[value]), `: ${criteria[value]}`])),
    h("p", { class: "matrix-note" }, "Pueblo Soberano (PPSO) is the governing party since May 2026. News call it «el oficialismo» when "
      + "they talk about the Assembly that took office in May 2026; «el oficialismo» of the previous Assembly (2022-2026) was another "
      + "party and does not count as Pueblo Soberano. ",
      h("button", { type: "button", class: "g-link", "data-action": "roster" }, "Diputados por partido")));
}
function voicesMatrix(entry, number, keys) {
  const columns = [[true, "Yes"], [false, "No"]];
  const affected = S.session.questions.details.voice_affected;
  const groupText = key => {
    const text = resolveText(S.session.questions.details[key].instructions, number);
    const match = text.match(/paraphrase (.+?)(?: about file [\d.]+)?\?$/);
    return match ? match[1] : text;
  };
  return h("div", {},
    h("p", { class: "matrix-intro" }, `Does the news quote or paraphrase each of these about file ${fmtNum(number)}?`),
    h("div", { class: "matrix" }, h("div", { class: "matrix-grid" }, matrixHead(columns),
      keys.map(key => matrixRow(entry, number, key, columns, QUESTION_TITLES[key] || key, groupText(key), key)))),
    affected?.criteria ? h("p", { class: "matrix-note" }, h("strong", {}, `${QUESTION_TITLES.voice_affected}. `),
      `Yes: ${affected.criteria.true} No: ${affected.criteria.false}`) : null);
}

function sectionFooter(entry) {
  const note = h("textarea", { class: "input", id: "note", rows: "3", placeholder: "Dudas, problemas con el texto, algo que quieras dejar anotado…" });
  note.value = entry.note || "";
  const last = S.index === S.items.length - 1;
  return h("section", { class: "card footer-card" },
    h("label", { class: "note-label", for: "note" }, "Notas sobre esta noticia (opcional)"),
    note,
    h("div", { class: "nav-row" },
      h("button", { type: "button", class: "btn", "data-action": "prev", disabled: S.index === 0 ? true : null }, "← Anterior"),
      h("span", { class: "nav-status", id: "nav-status" }),
      h("button", { type: "button", class: "btn", id: "next-btn", "data-action": "next", disabled: last ? true : null }, "Siguiente noticia →")),
    h("div", { id: "finished-slot" }),
    h("p", { class: "hints" }, SHORTCUTS.slice(0, 5).map(([key, text]) => h("span", {}, h("kbd", {}, key), text))));
}
function finishedBlock() {
  const seconds = S.items.reduce((sum, item) => sum + (S.answers[item.news_id]?.seconds || 0), 0);
  const perNews = (seconds / 60 / S.items.length).toFixed(1).replace(".", ",");
  return h("div", { class: "finished" },
    h("h2", {}, S.session.set === "pilot" ? "¡Terminaste el piloto!" : "¡Terminaste todas las noticias!"),
    h("p", {}, `${S.items.length} noticias en ${Math.round(seconds / 60)} minutos de trabajo activo (${perNews} min por noticia, en promedio). `
      + "Avisale a Claude para revisar los tiempos y seguir."));
}

/* ---------- answering ---------- */
function setMention(entry, number, value, added) {
  const existing = entry.bills[number];
  if (value === "none") {
    if (!existing) return false;
    const answered = Object.keys(existing.answers || {}).length;
    const lastOne = markedNumbers(entry).length === 1;
    const newsAnswered = lastOne ? Object.keys(entry.news_answers).length : 0;
    if ((answered || newsAnswered) && !confirm(`¿Quitar el expediente ${fmtNum(number)}? Se borran sus ${answered} respuestas`
      + (newsAnswered ? ` y las ${newsAnswered} sobre la noticia.` : "."))) return false;
    delete entry.bills[number];
    entry.doubtful = entry.doubtful.filter(id => !id.startsWith(`${number}:`));
    if (lastOne) {
      entry.news_answers = {};
      entry.doubtful = entry.doubtful.filter(id => !id.startsWith("news:"));
    }
    return true;
  }
  if (existing) existing.mention = value;
  else entry.bills[number] = { mention: value, added, answers: {} };
  return true;
}
function afterChange(entry) {
  const progress = progressOf(entry);
  entry.complete = progress.complete;
  if (progress.complete && !entry.completed_at) entry.completed_at = new Date().toISOString();
  markDirty(current().news_id);
}
function choose(unit, value, { keyboard = false } = {}) {
  const entry = currentEntry();
  const before = unit.get();
  if (unit.kind === "cand") {
    if (same(before, value) || unit.set(value) === false) return;
    afterChange(entry);
    renderAnswers();
    if (keyboard) focusNext(unit.id);
    return;
  }
  if (unit.kind === "done") {
    unit.set(true);
    afterChange(entry);
    S.focusId = null;
    renderAnswers();
    const marked = markedNumbers(entry);
    scrollToSection(marked.length ? "sec-news" : "sec-cands");
    if (keyboard && marked.length) {
      const first = S.units.find(candidate => candidate.required && candidate.kind === "question" && candidate.get() === undefined);
      if (first) focusUnit(first.id, { scroll: false });
    }
    return;
  }
  const clearing = same(before, value);
  unit.set(clearing ? undefined : value);
  afterChange(entry);
  syncUnit(unit);
  updateProgress();
  if (keyboard && !clearing) focusNext(unit.id);
}
function toggleDoubtful(id) {
  const entry = currentEntry();
  const at = entry.doubtful.indexOf(id);
  if (at === -1) entry.doubtful.push(id); else entry.doubtful.splice(at, 1);
  const unit = S.unitById.get(id);
  if (unit) syncUnit(unit);
  markDirty(current().news_id);
}
function syncUnit(unit) {
  const value = unit.get();
  unit.el.querySelectorAll("[data-value]").forEach(button => {
    if (button.dataset.unit === unit.id) button.setAttribute("aria-checked", String(same(JSON.parse(button.dataset.value), value)));
  });
  if (unit.kind === "cand") unit.el.classList.toggle("is-marked", value !== "none");
  else unit.el.classList.toggle("is-answered", value !== undefined);
  const flag = unit.el.querySelector("[data-flag]");
  if (flag) flag.setAttribute("aria-pressed", String(currentEntry().doubtful.includes(unit.id)));
}

/* ---------- focus and keyboard ---------- */
function focusUnit(id, { scroll = true } = {}) {
  const unit = S.unitById.get(id);
  if (!unit) return;
  answerPane.querySelectorAll(".is-focused").forEach(el => el.classList.remove("is-focused"));
  S.focusId = id;
  unit.el.classList.add("is-focused");
  if (!unit.el.contains(document.activeElement)) unit.el.focus({ preventScroll: true });
  if (scroll) unit.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function clearFocus() {
  answerPane.querySelectorAll(".is-focused").forEach(el => el.classList.remove("is-focused"));
  S.focusId = null;
}
const visibleUnits = () => S.units.filter(unit => unit.el.isConnected && unit.el.offsetParent !== null);
function moveFocus(delta) {
  const units = visibleUnits();
  if (!units.length) return;
  let at = units.findIndex(unit => unit.id === S.focusId);
  at = at === -1 ? (delta > 0 ? 0 : units.length - 1) : Math.max(0, Math.min(units.length - 1, at + delta));
  focusUnit(units[at].id);
}
function focusNext(fromId) {
  const units = visibleUnits();
  const at = units.findIndex(unit => unit.id === fromId);
  if (at === -1) return;
  if (units[at].kind === "cand") {
    if (units[at + 1]) focusUnit(units[at + 1].id);
    return;
  }
  const next = units.slice(at + 1).find(unit => unit.required && unit.get() === undefined) || units[at + 1];
  if (next) focusUnit(next.id);
}
function scrollToSection(id) {
  const el = $(id);
  if (!el) return;
  // long jumps (e.g. after the candidate list folds) go at once; a slow smooth scroll looks like nothing happened
  const far = Math.abs(el.getBoundingClientRect().top - answerPane.getBoundingClientRect().top) > 1200;
  el.scrollIntoView({ block: "start", behavior: far ? "auto" : "smooth" });
}

/* ---------- progress ---------- */
function updateProgress() {
  const track = $("progress-track");
  if (track.children.length !== S.items.length) {
    track.replaceChildren(...S.items.map((item, i) => h("button", { type: "button", class: "track-seg", "data-index": i,
      "aria-label": `Ir a la noticia ${i + 1}` })));
  }
  let done = 0;
  S.items.forEach((item, i) => {
    const entry = S.answers[item.news_id];
    const progress = entry ? progressOf(entry) : null;
    const complete = !!progress?.complete;
    if (complete) done += 1;
    const seg = track.children[i];
    seg.classList.toggle("done", complete);
    seg.classList.toggle("partial", !complete && !!progress && progress.answered > 0);
    seg.classList.toggle("current", i === S.index);
    seg.title = `Noticia ${i + 1}: ${complete ? "completa" : progress?.answered ? "empezada" : "sin empezar"}`;
  });
  const entry = currentEntry();
  const progress = progressOf(entry);
  const left = S.items.length - done;
  let here;
  if (progress.complete) here = "esta ya está completa";
  else if (!entry.candidates_done) here = entry.genre == null ? "en esta faltan el tipo de pieza y los expedientes" : "en esta falta revisar los expedientes";
  else here = `en esta ${progress.left === 1 ? "falta 1 pregunta" : `faltan ${progress.left} preguntas`}`;
  $("progress-text").replaceChildren(
    h("strong", {}, left === 0 ? `Terminaste las ${S.items.length} noticias` : `Faltan ${left} de ${S.items.length} noticias`),
    left === 0 ? "" : ` · ${here}`);

  const setCount = (id, answered, required) => {
    const el = $(id);
    if (!el) return;
    el.textContent = answered >= required ? "Completo" : `${answered} de ${required}`;
    el.classList.toggle("done", answered >= required);
  };
  setCount("count-genre", entry.genre != null ? 1 : 0, 1);
  const candidatesCount = $("count-cands");
  if (candidatesCount) {
    candidatesCount.textContent = entry.candidates_done ? "Revisados" : "Por revisar";
    candidatesCount.classList.toggle("done", entry.candidates_done);
  }
  const payload = S.news.get(current().news_id);
  const marked = orderedMarked(entry, payload);
  const newsAnswered = NEWS_KEYS.filter(key => entry.news_answers[key] !== undefined).length;
  const billAnswered = number => DETAIL_KEYS.filter(key => entry.bills[number].answers?.[key] !== undefined).length;
  if (marked.length) setCount("count-news", newsAnswered, NEWS_KEYS.length);
  marked.forEach(number => setCount(`count-bill-${number}`, billAnswered(number), DETAIL_KEYS.length));

  const chips = [["sec-genre", "Tipo", entry.genre != null ? 1 : 0, 1], ["sec-cands", "Expedientes", entry.candidates_done ? 1 : 0, 1]];
  if (marked.length) {
    chips.push(["sec-news", "Noticia", newsAnswered, NEWS_KEYS.length]);
    marked.forEach(number => chips.push([`sec-bill-${number}`, `Exp. ${fmtNum(number)}`, billAnswered(number), DETAIL_KEYS.length]));
  }
  const nav = $("section-nav");
  if (nav) {
    nav.replaceChildren(...chips.map(([target, label, answered, required]) => h("button", { type: "button",
      class: `nav-chip ${answered >= required ? "done" : answered ? "partial" : ""}`, "data-action": "jump", "data-target": target },
      h("span", { class: "dot" }), label, required > 1 && answered < required ? h("span", { class: "left" }, `${answered}/${required}`) : null)));
  }
  const next = $("next-btn");
  if (next) next.classList.toggle("primary", progress.complete);
  const status = $("nav-status");
  if (status) status.textContent = progress.complete ? "Esta noticia está completa" : here.replace(/^en esta /, "En esta noticia ");
  const slot = $("finished-slot");
  if (slot) slot.replaceChildren(...(allComplete() ? [finishedBlock()] : []));
}

/* ---------- saving ---------- */
function markDirty(newsId) {
  S.dirty.add(newsId);
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(flush, SAVE_DELAY_MS);
}
async function flush() {
  if (S.saving) {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(flush, 300);
    return;
  }
  const ids = [...S.dirty];
  if (!ids.length) return;
  S.saving = true;
  setSaveState("saving");
  try {
    for (const id of ids) {
      S.dirty.delete(id);
      const response = await fetch(API.save(id), { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(S.answers[id]) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }
    S.lastSaved = new Date();
    setSaveState("saved");
  } catch (error) {
    ids.forEach(id => S.dirty.add(id));
    setSaveState("error");
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(flush, 3000);
  } finally {
    S.saving = false;
  }
}
function setSaveState(kind) {
  const el = $("save-state");
  el.className = `save-state ${kind}`;
  if (kind === "idle") el.textContent = "Se guarda solo";
  else if (kind === "saving") el.textContent = "Guardando…";
  else if (kind === "error") el.textContent = "Sin conexión: reintentando";
  else el.textContent = `Guardado ${S.lastSaved.toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })}`;
}

/* ---------- bill search ---------- */
async function searchBills(query) {
  const box = $("other-results");
  if (!box) return;
  const text = query.trim();
  if (text.length < 2) {
    box.replaceChildren();
    return;
  }
  if (!S.bills) {
    box.replaceChildren(h("div", { class: "hint" }, "Cargando los expedientes…"));
    const all = await (await fetch(API.bills)).json();
    S.bills = all.map(([number, title]) => [number, title, norm(title)]);
  }
  const inList = new Set(candidatesOf(S.news.get(current().news_id)).map(info => String(info.number)));
  const digits = text.replace(/\./g, "");
  const tokens = norm(text).split(/\s+/).filter(Boolean);
  const hits = [];
  for (const [number, title, normalized] of S.bills) {
    if (inList.has(String(number))) continue;
    const match = /^\d+$/.test(digits) ? String(number).startsWith(digits) : tokens.every(token => normalized.includes(token));
    if (match && hits.push([number, title]) >= 8) break;
  }
  if ($("other-search")?.value.trim() !== text) return;
  box.replaceChildren(...(hits.length
    ? hits.map(([number, title]) => h("div", { class: "search-hit" }, h("span", { class: "num" }, fmtNum(number)),
      h("span", { title }, sentenceCase(title)),
      h("button", { type: "button", class: "btn small", "data-action": "add-bill", "data-number": number }, "Agregar")))
    : [h("div", { class: "hint" }, "Ningún expediente coincide.")]));
}
async function addBill(number) {
  const payload = S.news.get(current().news_id);
  const id = `cand:${number}`;
  if (!candidatesOf(payload).some(info => String(info.number) === String(number))) {
    const info = await (await fetch(API.card(number))).json();
    info.added = true;
    payload.extra = [info, ...(payload.extra || [])];
    S.focusId = id;
    renderAnswers();
  }
  focusUnit(id);
}
function filterCandidates(query) {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  const rows = answerPane.querySelectorAll(".cand");
  let shown = 0;
  rows.forEach(row => {
    const match = tokens.every(token => row.dataset.search.includes(token));
    row.hidden = !match;
    if (match) shown += 1;
  });
  $("cand-filter-count").textContent = tokens.length ? `${shown} de ${rows.length}` : `${rows.length} candidatos`;
}

/* ---------- glossary ---------- */
function buildGlossary() {
  const questions = S.session.questions;
  const english = key => {
    const raw = questions.gate[key] || questions.details_news[key] || questions.details[key];
    return raw ? resolveText(raw.instructions) : null;
  };
  const conceptTitle = id => CONCEPTS.find(concept => concept.id === id)?.title;
  const entry = (id, title, paragraphs, points, extra, terms) => h("article", { class: "g-entry", id,
    "data-search": norm([title, ...paragraphs, ...points, extra || ""].join(" ")) },
    h("h3", {}, title),
    paragraphs.map(text => h("p", {}, text)),
    points.length ? h("ul", {}, points.map(text => h("li", {}, text))) : null,
    extra ? h("p", { class: "g-english" }, h("span", { class: "g-english-label" }, "La pregunta en inglés: "), extra) : null,
    terms?.length ? h("div", { class: "g-see" }, "Ver:", terms.map(term => term === "roster"
      ? h("button", { type: "button", class: "g-link", "data-goto": "g-roster" }, "Diputados por partido")
      : conceptTitle(term) ? h("button", { type: "button", class: "g-link", "data-goto": `c-${term}` }, conceptTitle(term)) : null)) : null);
  const section = (id, title, children) => [h("h3", { class: "g-section-title", id }, title), ...[children].flat(Infinity)];

  const questionOrder = ["genre", "mention", ...NEWS_KEYS, ...billGroups().flatMap(group => group.keys)];
  const questionEntries = questionOrder.map(key => {
    const help = QUESTION_HELP[key] || {};
    return entry(`q-${key}`, QUESTION_TITLES[key] || key, help.what ? [help.what] : [], help.points || [],
      key === "mention" ? null : english(key), help.terms);
  });
  const conceptEntries = CONCEPTS.map(concept => entry(`c-${concept.id}`, concept.title, concept.text, [], null, null));

  const byParty = new Map();
  for (const deputy of S.session.roster) {
    if (!byParty.has(deputy.party)) byParty.set(deputy.party, []);
    byParty.get(deputy.party).push(titleCaseName(deputy.name));
  }
  const rosterEntries = [...byParty.entries()].sort((a, b) => b[1].length - a[1].length).map(([party, names]) => {
    const info = PARTIES[party] || { short: "", name: titleCaseName(party) };
    return h("article", { class: "g-entry party-block", "data-search": norm([party, info.short, info.name, ...names].join(" ")) },
      h("h4", {}, info.name, h("small", {}, `${info.short ? `${info.short} · ` : ""}${names.length} ${names.length === 1 ? "diputado" : "diputados"}`
        + (info.note ? ` · ${info.note}` : ""))),
      h("div", { class: "party-names" }, names.sort((a, b) => a.localeCompare(b, "es")).map(name => h("span", {}, name))));
  });

  const howto = h("article", { class: "g-entry", "data-search": norm([...HOWTO, ...SHORTCUTS.flat()].join(" ")) },
    h("ul", {}, HOWTO.map(text => h("li", {}, text))),
    h("div", { class: "g-shortcuts" }, SHORTCUTS.map(([key, text]) => [h("kbd", {}, key), h("span", {}, text)])));

  $("glossary-body").replaceChildren(
    ...section("g-howto", "Cómo usar esta página", [howto]),
    ...section("g-questions", "Las preguntas, una por una", questionEntries),
    ...section("g-concepts", "Términos del trámite legislativo", conceptEntries),
    ...section("g-roster", "Partidos y diputados 2026-2030", [
      h("p", { class: "g-intro" }, "Los 57 diputados de la Asamblea que empezó en mayo de 2026, con su partido."), rosterEntries]),
    h("p", { class: "g-empty", id: "g-empty", hidden: true }, "Nada coincide con la búsqueda."));
  $("glossary-tabs").replaceChildren(...[["g-howto", "Cómo usar"], ["g-questions", "Preguntas"], ["g-concepts", "Términos"],
    ["g-roster", "Diputados"]].map(([id, label]) => h("button", { type: "button", class: "g-tab", "data-goto": id }, label)));
}
function filterGlossary(query) {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  let shown = 0;
  document.querySelectorAll("#glossary-body .g-entry").forEach(el => {
    const match = tokens.every(token => el.dataset.search.includes(token));
    el.hidden = !match;
    if (match) shown += 1;
  });
  document.querySelectorAll("#glossary-body .g-section-title, #glossary-body .g-intro").forEach(el => { el.hidden = tokens.length > 0; });
  $("g-empty").hidden = shown > 0;
}
function gotoGlossary(id) {
  const search = $("glossary-search");
  if (search.value) {
    search.value = "";
    filterGlossary("");
  }
  const el = $(id);
  if (!el) return;
  el.scrollIntoView({ block: "start" });
  if (el.classList.contains("g-entry")) {
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1400);
  }
}
function openGlossary(targetId) {
  S.glossaryOpen = true;
  $("glossary").classList.add("open");
  $("glossary").setAttribute("aria-hidden", "false");
  $("scrim").classList.add("open");
  if (targetId) requestAnimationFrame(() => gotoGlossary(targetId));
  else $("glossary-search").focus({ preventScroll: true });
}
function closeGlossary() {
  S.glossaryOpen = false;
  $("glossary").classList.remove("open");
  $("glossary").setAttribute("aria-hidden", "true");
  $("scrim").classList.remove("open");
  if (S.focusId) focusUnit(S.focusId, { scroll: false });
}

/* ---------- events ---------- */
function bindEvents() {
  answerPane.addEventListener("click", event => {
    const valueButton = event.target.closest("[data-unit][data-value]");
    if (valueButton) {
      const unit = S.unitById.get(valueButton.dataset.unit);
      if (unit) {
        focusUnit(unit.id, { scroll: false });
        choose(unit, JSON.parse(valueButton.dataset.value));
        // keep keyboard focus on the question, not the button, so Enter or Space can't undo the answer
        const kept = S.unitById.get(unit.id);
        if (kept?.el.isConnected) kept.el.focus({ preventScroll: true });
      }
      return;
    }
    const flag = event.target.closest("[data-flag]");
    if (flag) return toggleDoubtful(flag.dataset.flag);
    const help = event.target.closest("[data-help]");
    if (help) return openGlossary(`q-${help.dataset.help}`);
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const kind = action.dataset.action;
    if (kind === "done") {
      const unit = S.unitById.get("done");
      if (unit) choose(unit, true);
    } else if (kind === "expand") {
      S.expanded.add(current().news_id);
      renderAnswers();
      scrollToSection("sec-cands");
    } else if (kind === "prev") goTo(S.index - 1);
    else if (kind === "next") goTo(S.index + 1);
    else if (kind === "jump") scrollToSection(action.dataset.target);
    else if (kind === "add-bill") addBill(Number(action.dataset.number));
    else if (kind === "roster") openGlossary("g-roster");
    else if (kind === "more-subjects") {
      action.replaceWith(...JSON.parse(action.dataset.more).map(subject => h("span", { class: "chip" }, subject)));
    }
  });
  answerPane.addEventListener("pointerdown", event => {
    if (event.target.closest("input, textarea, summary")) return;
    const container = event.target.closest("[data-unit]:not(button)");
    if (container) focusUnit(container.dataset.unit, { scroll: false });
  });
  answerPane.addEventListener("input", event => {
    const id = event.target.id;
    if (id === "cand-filter") filterCandidates(event.target.value);
    else if (id === "other-search") searchBills(event.target.value);
    else if (id === "note") {
      currentEntry().note = event.target.value;
      markDirty(current().news_id);
    }
  });
  newsPane.addEventListener("pointerdown", clearFocus);
  $("progress-track").addEventListener("click", event => {
    const seg = event.target.closest(".track-seg");
    if (seg) goTo(Number(seg.dataset.index));
  });
  $("open-glossary").addEventListener("click", () => openGlossary(null));
  $("close-glossary").addEventListener("click", closeGlossary);
  $("scrim").addEventListener("click", closeGlossary);
  $("glossary-search").addEventListener("input", event => filterGlossary(event.target.value));
  $("glossary").addEventListener("click", event => {
    const link = event.target.closest("[data-goto]");
    if (link) gotoGlossary(link.dataset.goto);
  });

  document.addEventListener("keydown", event => {
    const inField = event.target.matches?.("input, textarea, select");
    if (event.key === "Escape") {
      if (S.glossaryOpen) {
        closeGlossary();
        event.preventDefault();
      } else if (inField) event.target.blur();
      return;
    }
    if (inField || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "?") {
      const unit = S.unitById.get(S.focusId);
      openGlossary(unit?.help ? `q-${unit.help}` : null);
      event.preventDefault();
      return;
    }
    if (S.glossaryOpen) return;
    const key = event.key.toLowerCase();
    if (key === "j" || (key === "arrowdown" && S.focusId)) {
      moveFocus(1);
      event.preventDefault();
      return;
    }
    if (key === "k" || (key === "arrowup" && S.focusId)) {
      moveFocus(-1);
      event.preventDefault();
      return;
    }
    const unit = S.unitById.get(S.focusId);
    if (!unit) return;
    if (/^[1-9]$/.test(event.key)) {
      const value = unit.options[Number(event.key) - 1];
      if (value !== undefined) {
        choose(unit, value, { keyboard: true });
        event.preventDefault();
      }
      return;
    }
    if (unit.yesno && (key === "s" || key === "y" || key === "n")) {
      choose(unit, key !== "n", { keyboard: true });
      event.preventDefault();
      return;
    }
    if (key === "d" && unit.kind === "question") {
      toggleDoubtful(unit.id);
      event.preventDefault();
      return;
    }
    if (key === "enter" && unit.kind === "done") {
      choose(unit, true, { keyboard: true });
      event.preventDefault();
    }
  });

  const awake = () => { S.lastInteraction = Date.now(); };
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) document.addEventListener(type, awake, { passive: true });
  newsPane.addEventListener("scroll", awake, { passive: true });
  answerPane.addEventListener("scroll", awake, { passive: true });
  setInterval(() => {
    if (!S.items.length || document.visibilityState !== "visible" || Date.now() - S.lastInteraction > IDLE_MS) return;
    const entry = S.answers[current().news_id];
    if (!entry) return;
    entry.seconds = (entry.seconds || 0) + 1;
    if (entry.seconds % 15 === 0) markDirty(current().news_id);
  }, 1000);
  window.addEventListener("pagehide", () => {
    for (const id of S.dirty) {
      navigator.sendBeacon(API.save(id), new Blob([JSON.stringify(S.answers[id])], { type: "application/json" }));
    }
  });
}

function showFatal(message) {
  const layout = $("layout");
  layout.style.display = "block";
  layout.replaceChildren(h("div", { class: "fatal" },
    h("h1", {}, "No se pudo abrir la evaluación"),
    h("p", {}, message),
    h("p", {}, "Revisá que el servidor esté corriendo: ", h("code", {}, "python private_visuals/jev_eval/server.py"))));
}

init();
