#!/usr/bin/env node
/**
 * Reproducible DUMMY dataset generator (fixed seed).
 *
 *   node scripts/make_dummy_data.mjs [--bills 60] [--news 300] [--seed 20261109]
 *
 * Writes src/data/{bills.json, bills/<number>.json, news.json, outlets.json,
 * stats/factions.json} following the contract in src/lib/types.ts.
 *
 * Everything here is fictitious: person names carry made-up surnames
 * ("Ensayo", "Maqueta"...), parties are colors, URLs point to example.com.
 * Vocabulary values mirror src/lib/vocab.ts; keep both in sync.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const N_BILLS = Number(args.bills ?? 60);
const N_NEWS = Number(args.news ?? 300);
const SEED = Number(args.seed ?? 20261109);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'data');

/* ------------------------------------------------------------ random utils */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const sample = (arr, k) => shuffle(arr).slice(0, k);
function weightedPick(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/* -------------------------------------------------------------- date utils */
const DAY = 86_400_000;
const toDay = (iso) => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / DAY);
const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, '0');

const PERIOD = { start: toDay('2026-05-01'), end: toDay('2026-10-31') };
const clampPeriod = (d) => Math.min(PERIOD.end, Math.max(PERIOD.start, d));

/* ------------------------------------------------------------- vocabulary */
// Mirrors src/lib/vocab.ts
const LINK_SOURCES = ['delfino', 'manual', 'model'];
const STATUS = { active: 'En trámite', reported: 'Dictaminado', law: 'Convertido en ley', archived: 'Archivado' };
void LINK_SOURCES;

const OUTLETS = [
  { key: 'crhoy', name: 'CRHoy', type: 'general', sections: ['nacionales', 'politica', 'economia'] },
  { key: 'delfino', name: 'Delfino', type: 'specialized', sections: ['asamblea', 'politica'] },
  { key: 'elmundo', name: 'El Mundo CR', type: 'general', sections: ['nacionales', 'politica', 'economia'] },
  { key: 'semanario', name: 'Semanario Universidad', type: 'general', sections: ['pais', 'universitarias', 'cultura'] },
  { key: 'elobservador', name: 'El Observador', type: 'general', sections: ['politica', 'opinion'] },
  { key: 'teletica', name: 'Teletica', type: 'general', sections: ['nacionales', 'politica'] },
];
const OUTLET_WEIGHTS = [26, 22, 16, 12, 10, 14];

const FACTIONS = [
  { name: 'Partido Ámbar', seats: 20, support: 0.85 },
  { name: 'Partido Celeste', seats: 14, support: 0.6 },
  { name: 'Partido Granate', seats: 9, support: 0.5 },
  { name: 'Partido Índigo', seats: 7, support: 0.7 },
  { name: 'Partido Olivo', seats: 5, support: 0.45 },
  { name: 'Independiente', seats: 2, support: 0.55 },
];
const PROVINCES = [
  ['San José', 19], ['Alajuela', 11], ['Cartago', 7], ['Heredia', 6],
  ['Puntarenas', 5], ['Limón', 5], ['Guanacaste', 4],
];

const FIRST = ['Ana', 'Luis', 'María', 'José', 'Carmen', 'Jorge', 'Laura', 'Carlos', 'Sofía', 'Diego',
  'Elena', 'Andrés', 'Paula', 'Ricardo', 'Valeria', 'Esteban', 'Gabriela', 'Mauricio', 'Daniela',
  'Rodrigo', 'Lucía', 'Fernando', 'Isabel', 'Pablo', 'Natalia', 'Óscar', 'Marta', 'Adrián', 'Silvia', 'Tomás'];
const SUR1 = ['Solano', 'Mora', 'Vargas', 'Rojas', 'Jiménez', 'Castro', 'Quesada', 'Alfaro', 'Brenes',
  'Calderón', 'Chaves', 'Arias', 'Salas', 'Umaña', 'Zúñiga'];
// Deliberately fictitious second surnames.
const SUR2 = ['Ensayo', 'Ejemplo', 'Muestra', 'Borrador', 'Maqueta', 'Prueba', 'Ficticio', 'Simulacro'];

const TOPICS = {
  'Salud': ['la atención primaria en salud', 'el acceso a medicamentos', 'la salud mental de adolescentes', 'los tiempos de espera en hospitales'],
  'Educación': ['la educación técnica dual', 'el transporte estudiantil', 'la conectividad en centros educativos', 'las becas universitarias'],
  'Ambiente': ['la protección de humedales', 'la gestión de residuos plásticos', 'el agua potable en zonas rurales', 'los corredores biológicos'],
  'Seguridad': ['la prevención de la violencia juvenil', 'el control de armas', 'la seguridad en zonas costeras', 'el sistema penitenciario'],
  'Hacienda': ['el impuesto a la propiedad de vehículos', 'la deuda pública', 'la transparencia en compras públicas', 'el régimen de zonas francas'],
  'Agro': ['el seguro de cosechas', 'los pequeños productores de café', 'el uso de agroquímicos', 'la pesca artesanal'],
  'Empleo': ['la jornada laboral flexible', 'el teletrabajo', 'el empleo de personas jóvenes', 'las pensiones no contributivas'],
  'Infraestructura': ['la red vial cantonal', 'las concesiones de obra pública', 'los puentes en rutas nacionales'],
  'Transporte': ['el tren eléctrico metropolitano', 'las plataformas de transporte', 'la movilidad en bicicleta'],
  'Vivienda': ['el bono de vivienda', 'los asentamientos informales', 'el alquiler de vivienda'],
  'Energía': ['la generación distribuida', 'la electromovilidad', 'las tarifas eléctricas'],
  'Tecnología': ['la protección de datos personales', 'la ciberseguridad del Estado', 'la inteligencia artificial en el sector público'],
  'Cultura': ['el patrimonio arquitectónico', 'las industrias creativas', 'las bibliotecas públicas'],
  'Turismo': ['el turismo rural comunitario', 'la llegada de cruceros', 'las playas accesibles'],
};
const SUBJECTS = Object.keys(TOPICS);
const COMMISSION = {
  'Salud': 'Comisión Permanente de Asuntos Sociales',
  'Educación': 'Comisión Permanente Especial de Ciencia, Tecnología y Educación',
  'Ambiente': 'Comisión Permanente Especial de Ambiente',
  'Seguridad': 'Comisión Permanente Especial de Seguridad y Narcotráfico',
  'Hacienda': 'Comisión Permanente de Asuntos Hacendarios',
  'Agro': 'Comisión Permanente de Asuntos Agropecuarios',
  'Empleo': 'Comisión Permanente de Asuntos Sociales',
  'Infraestructura': 'Comisión Permanente de Gobierno y Administración',
  'Transporte': 'Comisión Permanente de Gobierno y Administración',
  'Vivienda': 'Comisión Permanente de Asuntos Sociales',
  'Energía': 'Comisión Permanente de Asuntos Económicos',
  'Tecnología': 'Comisión Permanente Especial de Ciencia, Tecnología y Educación',
  'Cultura': 'Comisión Permanente de Asuntos Sociales',
  'Turismo': 'Comisión Permanente de Asuntos Económicos',
};

const fixGrammar = (s) => s.replace(/\bde el\b/g, 'del').replace(/\ba el\b/g, 'al');
const NAME_TEMPLATES = [
  (t) => `Ley para fortalecer ${t}`,
  (t) => `Ley de regulación de ${t}`,
  (t) => `Ley marco sobre ${t}`,
  (t) => `Reforma del artículo ${int(2, 180)} de la Ley General sobre ${t}`,
  (t) => `Ley de incentivos para ${t}`,
  (t) => `Adición de un capítulo sobre ${t} a la Ley N.° ${int(7000, 9999)}`,
  (t) => `Ley de modernización de ${t}`,
];
const NEWS_TEMPLATES = [
  (t) => `Diputados discuten proyecto sobre ${t}`,
  (t) => `Comisión avanza en iniciativa sobre ${t}`,
  (t) => `Sectores critican propuesta sobre ${t}`,
  (t, n) => `Expediente ${fmtNum(n)}: qué propone la reforma sobre ${t}`,
  (t) => `Organizaciones piden cambios al proyecto sobre ${t}`,
  (t) => `Gobierno anuncia apoyo a iniciativa sobre ${t}`,
  (t) => `¿Qué cambiaría con el proyecto sobre ${t}?`,
  (t) => `Consultas a instituciones retrasan proyecto sobre ${t}`,
  (t) => `Mociones de fondo frenan iniciativa sobre ${t}`,
];
const VOTE_NEWS_TEMPLATES = [
  (t, _n, v) => `Plenario aprueba en ${v.toLowerCase()} proyecto sobre ${t}`,
  (t, _n, v) => `Así votaron las fracciones el ${v.toLowerCase()} del proyecto sobre ${t}`,
];
const UNLINKED_TEMPLATES = [
  (p) => `Municipalidad de ${p} anuncia cierre de vía por obras`,
  (p) => `Lluvias provocan inundaciones en ${p}`,
  (p) => `Festival cultural reúne a cientos de personas en ${p}`,
  (p) => `Comerciantes de ${p} reportan aumento de ventas`,
  (p) => `Vecinos de ${p} denuncian falta de agua`,
  (p) => `Nueva ruta de autobús conectará ${p} con la capital`,
  (p) => `Escuela de ${p} celebra 50 años`,
  (p) => `Cruz Roja atiende emergencia en ${p}`,
];
const PLACES = ['Pérez Zeledón', 'Nicoya', 'Turrialba', 'San Carlos', 'Limón centro', 'Liberia', 'Heredia',
  'Desamparados', 'Puntarenas', 'Grecia', 'Talamanca', 'Upala'];

const fmtNum = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------------------------------------------------------------- deputies */
const deputies = [];
{
  const usedNames = new Set();
  const provinces = shuffle(PROVINCES.flatMap(([p, k]) => Array(k).fill(p)));
  let idx = 0;
  for (const f of FACTIONS) {
    for (let i = 0; i < f.seats; i++) {
      let name;
      do name = `${pick(FIRST)} ${pick(SUR1)} ${pick(SUR2)}`; while (usedNames.has(name));
      usedNames.add(name);
      deputies.push({ name, faction: f.name, province: provinces[idx++] });
    }
  }
}
const factionByName = Object.fromEntries(FACTIONS.map((f) => [f.name, f]));

/* ------------------------------------------------------------------- bills */
const numbers = new Set();
while (numbers.size < N_BILLS) numbers.add(int(23100, 25350));
const sortedNumbers = [...numbers].sort((a, b) => a - b);

let voteId = 1;
const bills = sortedNumbers.map((number) => {
  // Higher number => more recent proposal.
  const frac = (number - 23100) / (25350 - 23100);
  const proposed = toDay('2022-06-01') + Math.round(frac * (toDay('2026-09-10') - toDay('2022-06-01'))) + int(-20, 20);
  const subjects = sample(SUBJECTS, chance(0.5) ? 1 : chance(0.6) ? 2 : 3);
  const topic = pick(TOPICS[subjects[0]]);
  const name = capitalize(fixGrammar(pick(NAME_TEMPLATES)(topic)));
  const fileType = chance(0.85) ? 'Ordinario' : chance(0.5) ? 'Reforma constitucional' : 'Aprobación de convenio';
  const hot = chance(0.55); // its latest activity falls inside the study period

  // Decide how far it went.
  const old = proposed < toDay('2024-06-01');
  let kind;
  const r = rand();
  if (old) kind = r < 0.3 ? 'law' : r < 0.55 ? 'archived' : r < 0.7 ? 'reported' : 'active';
  else kind = r < 0.1 ? 'law' : r < 0.3 ? 'reported' : 'active';
  if (proposed > toDay('2026-04-01')) kind = 'active';

  const lastEvent = hot
    ? int(PERIOD.start + 5, PERIOD.end - 5)
    : int(Math.min(proposed + 120, PERIOD.start - 1), PERIOD.start - 1);
  const last = Math.max(lastEvent, proposed + 30);

  const commission = COMMISSION[subjects[0]];
  // Stage templates: [organ, description, closes-with-vote]
  const STAGES = [
    ['Secretaría del Directorio', 'Presentación del proyecto y asignación a comisión', null],
    [commission, 'Estudio en comisión, consultas y mociones', null],
    ['Plenario', 'Discusión por el fondo en primer debate', 'Primer debate'],
    ['Plenario', 'Segundo debate', 'Segundo debate'],
    ['Poder Ejecutivo', 'Sanción y publicación en La Gaceta', null],
  ];
  let reached; let lastOpen;
  if (kind === 'law') { reached = 5; lastOpen = false; }
  else if (kind === 'archived') { reached = 2; lastOpen = false; }
  else if (kind === 'reported') { reached = 3; lastOpen = true; }
  else { reached = chance(0.75) ? 2 : 4; lastOpen = true; }

  // Boundaries spread between proposal and the last event.
  const nBoundaries = lastOpen ? reached - 1 : reached;
  const cuts = Array.from({ length: nBoundaries }, () => rand()).sort();
  cuts[cuts.length - 1] = 1;
  const bounds = [proposed, ...cuts.map((c) => Math.round(proposed + c * (last - proposed)))];
  for (let i = 1; i < bounds.length; i++) bounds[i] = Math.max(bounds[i], bounds[i - 1] + 3);

  const steps = [];
  const votes = [];
  for (let i = 0; i < reached; i++) {
    const [organ, baseDesc, voteName] = STAGES[i];
    const start = bounds[i];
    const end = i + 1 < bounds.length ? bounds[i + 1] : null;
    let description = baseDesc;
    if (i === 1 && end !== null && kind !== 'archived') description += '; dictamen afirmativo de mayoría';
    steps.push({ organ, description, date_start: fromDay(start), date_end: end === null ? null : fromDay(end) });
    if (voteName && end !== null) votes.push(makeVote(end, voteName));
  }
  if (kind === 'archived') {
    const d = bounds[bounds.length - 1];
    steps.push({ organ: 'Secretaría del Directorio', description: 'Archivado por vencimiento del plazo cuatrienal', date_start: fromDay(d), date_end: fromDay(d) });
  }

  const nProp = int(1, 6);
  const proponents = sample(deputies, nProp).map((d, i) => ({
    name: d.name, faction: d.faction, province: d.province, signing_order: i + 1,
  }));

  return {
    number, name, topic, hot,
    file_type: fileType,
    date_proposed: fromDay(proposed),
    status: STATUS[kind],
    law_number: kind === 'law' ? int(10400, 10890) : null,
    subjects, proponents, steps, votes,
  };
});

function makeVote(day, name) {
  const deps = deputies.map((d) => {
    const f = factionByName[d.faction];
    const absent = chance(0.08);
    const vote = absent ? 'ausente' : chance(f.support + 0.1) ? 'a_favor' : 'en_contra';
    return { name: d.name, party: d.faction, vote };
  });
  const yes = deps.filter((d) => d.vote === 'a_favor').length;
  const no = deps.filter((d) => d.vote === 'en_contra').length;
  return { vote_id: voteId++, date: fromDay(day), name, result: yes > no ? 'Aprobado' : 'Rechazado', deputies: deps };
}

/* -------------------------------------------------------------------- news */
// Popularity: ~1/4 of bills get no coverage at all; hot bills get more.
const weights = bills.map((b) => {
  if (chance(0.25)) return 0;
  const base = b.hot ? 4 : 0.7;
  return base * (1 + 6 * Math.pow(rand(), 4)) * (b.votes.length ? 1.8 : 1);
});
const N_UNLINKED = Math.round(N_NEWS * 0.15);
const news = [];
const usedUrls = new Set();

function makeArticle(title, day) {
  const outlet = weightedPick(OUTLETS, OUTLET_WEIGHTS);
  const datetime = `${fromDay(day)}T${pad(int(6, 21))}:${pad(int(0, 59))}:00`;
  let url;
  do url = `https://example.com/${outlet.key}/${datetime.slice(0, 10).replace(/-/g, '/')}/${slugify(title)}-${int(100, 999)}`;
  while (usedUrls.has(url));
  usedUrls.add(url);
  return {
    id: createHash('sha256').update(url).digest('hex'),
    title,
    organization: outlet.key,
    outlet_type: outlet.type,
    section: pick(outlet.sections),
    date_published: datetime,
    url,
    bills: [],
  };
}

function linkFor(article, isPrimary) {
  const r = rand();
  let source;
  if (article.organization === 'delfino' && r < 0.75) source = 'delfino';
  else if (r < 0.88) source = 'model';
  else source = 'manual';
  const confidence = source === 'model'
    ? Math.round((isPrimary ? 0.55 + rand() * 0.43 : 0.3 + rand() * 0.45) * 100) / 100
    : null;
  return { link_source: source, confidence };
}

for (let i = 0; i < N_NEWS - N_UNLINKED; i++) {
  const bill = weightedPick(bills, weights);
  const inPeriodEvents = [...bill.steps.flatMap((s) => [s.date_start, s.date_end]), ...bill.votes.map((v) => v.date)]
    .filter(Boolean).map(toDay).filter((d) => d >= PERIOD.start && d <= PERIOD.end);
  const day = inPeriodEvents.length && chance(0.65)
    ? clampPeriod(pick(inPeriodEvents) + int(-4, 12))
    : int(PERIOD.start, PERIOD.end);
  const recentVote = bill.votes.find((v) => Math.abs(toDay(v.date) - day) < 10);
  const title = recentVote && chance(0.7)
    ? capitalize(fixGrammar(pick(VOTE_NEWS_TEMPLATES)(bill.topic, bill.number, recentVote.name)))
    : capitalize(fixGrammar(pick(NEWS_TEMPLATES)(bill.topic, bill.number)));
  const art = makeArticle(title, day);
  art.bills.push({ number: bill.number, ...linkFor(art, true) });
  // Secondary links (the model often proposes related bills).
  const extra = chance(0.45) ? (chance(0.25) ? 2 : 1) : 0;
  const pool = bills.filter((b) => b.number !== bill.number && weights[bills.indexOf(b)] > 0);
  const related = pool.filter((b) => b.subjects.some((s) => bill.subjects.includes(s)));
  for (const other of sample(related.length >= extra ? related : pool, extra)) {
    art.bills.push({ number: other.number, ...linkFor(art, false) });
  }
  news.push(art);
}
for (let i = 0; i < N_UNLINKED; i++) {
  news.push(makeArticle(pick(UNLINKED_TEMPLATES)(pick(PLACES)), int(PERIOD.start, PERIOD.end)));
}
news.sort((a, b) => b.date_published.localeCompare(a.date_published));

/* ------------------------------------------------------------------ output */
const billNews = new Map(bills.map((b) => [b.number, []]));
for (const n of news) {
  for (const l of n.bills) {
    billNews.get(l.number).push({
      id: n.id, title: n.title, organization: n.organization, date_published: n.date_published,
      url: n.url, link_source: l.link_source, confidence: l.confidence,
    });
  }
}

rmSync(join(OUT, 'bills'), { recursive: true, force: true });
mkdirSync(join(OUT, 'bills'), { recursive: true });
mkdirSync(join(OUT, 'stats'), { recursive: true });

const write = (rel, data) => writeFileSync(join(OUT, rel), JSON.stringify(data, null, 1) + '\n');

const summaries = bills.map((b) => ({
  number: b.number,
  name: b.name,
  file_type: b.file_type,
  date_proposed: b.date_proposed,
  status: b.status,
  law_number: b.law_number,
  subjects: b.subjects,
  proponents: b.proponents.map((p) => p.name),
  news_count: billNews.get(b.number).length,
  votes_count: b.votes.length,
})).sort((a, b) => b.number - a.number);

for (const s of summaries) {
  const b = bills.find((x) => x.number === s.number);
  write(`bills/${s.number}.json`, {
    bill: s, proponents: b.proponents, steps: b.steps, votes: b.votes, news: billNews.get(s.number),
  });
}
write('bills.json', summaries);
write('news.json', news);
write('outlets.json', OUTLETS.map(({ key, name, type }) => ({ key, name, type })));

const factionStats = FACTIONS.map((f) => ({
  faction: f.name,
  deputies: f.seats,
  counts: { a_favor: 0, en_contra: 0, ausente: 0 },
}));
let totalVotes = 0;
for (const b of bills) for (const v of b.votes) {
  totalVotes++;
  for (const d of v.deputies) factionStats.find((f) => f.faction === d.party).counts[d.vote]++;
}
write('stats/factions.json', { generated_from_votes: totalVotes, factions: factionStats });

const links = news.reduce((a, n) => a + n.bills.length, 0);
console.log(`bills=${summaries.length} (sin noticias: ${summaries.filter((s) => !s.news_count).length}) ` +
  `news=${news.length} (sin vínculo: ${news.filter((n) => !n.bills.length).length}) links=${links} votes=${totalVotes}`);
