// Organs (committees, Plenario, Directorio...): index from /api/organs, filtered in the browser.
import {
  esc, icon, fmtN, fmtDate, titleCase, hl, getJSON, colorOf, link, href, fact, emptyTab,
  select, searchBox, chips, bindToolbar, renderDetail, backBtn, billsTable,
} from "./util.js";

const BATCH = 60;
let ORGANS = null, TOTALS = null;
const state = { q: "", qRaw: "", status: "", type: "", extra: "", sort: "name" };
let filtered = [];
const tabState = { tab: "miembros" };
const cache = new Map();

function filter() {
  const words = state.q ? state.q.split(/\s+/) : [];
  filtered = ORGANS.filter((o) =>
    (!state.status || o.status === state.status) &&
    (!state.type || o.type === state.type) &&
    (!state.extra || (state.extra === "members" ? o.members > 0 : o.bills > 0)) &&
    words.every((w) => o.hay.includes(w)));
  const cmp = {
    name: (a, b) => clean(a.name).localeCompare(clean(b.name), "es"),
    recent: (a, b) => (b.from || "").localeCompare(a.from || ""),
    members: (a, b) => b.members - a.members,
    bills: (a, b) => b.bills - a.bills,
  }[state.sort];
  filtered.sort(cmp);
}

// Some special-commission names come wrapped in quotes in the SIL.
const clean = (s) => (s || "").replace(/^"+|"+$/g, "");

export default {
  label: "Órganos", listRoute: "organs", route: "organ", icon: "building", nounOne: "el órgano",
  placeholder: "Elegí un órgano para ver sus miembros y los expedientes que atiende.",

  async init() {
    if (ORGANS) return;
    const data = await getJSON("/api/organs");
    ORGANS = data.organs; TOTALS = data.totals;
  },

  stats: () => [
    ["Órganos", fmtN(TOTALS.organs)], ["Activos", fmtN(TOTALS.active)], ["Con miembros", fmtN(TOTALS.with_members)],
    ["Con expedientes", fmtN(TOTALS.with_bills)], ["Expedientes en agenda", fmtN(TOTALS.organ_bills)],
  ],

  toolbar() {
    const types = {};
    ORGANS.forEach((o) => (types[o.type] = (types[o.type] || 0) + 1));
    const active = ORGANS.filter((o) => o.status === "ACTIVO").length;
    return searchBox(state.qRaw, "Nombre, tipo o código…") +
      chips("org-chips", state.status, [["", "Todos", "var(--ink)", ORGANS.length], ["ACTIVO", "Activos", "var(--law)", active], ["INACTIVO", "Inactivos", "var(--archived)", ORGANS.length - active]]) +
      `<div class="controls">
        ${select("f-type", state.type, [["", "Todo tipo"], ...Object.entries(types).sort((a, b) => b[1] - a[1]).map(([t, n]) => [t, `${titleCase(t)} (${fmtN(n)})`])], "Tipo")}
        ${select("f-extra", state.extra, [["", "Todos"], ["members", "Con miembros"], ["bills", "Con expedientes"]], "Extras")}
        ${select("sort", state.sort, [["name", "Nombre A–Z"], ["recent", "Más recientes"], ["members", "Más miembros"], ["bills", "Más expedientes"]], "Orden")}
      </div>`;
  },

  bind(root, refresh) {
    bindToolbar(root, state, refresh, { selects: { "f-type": "type", "f-extra": "extra", sort: "sort" }, chipsId: "org-chips", chipsKey: "status" });
  },

  async page(offset) {
    if (offset === 0) filter();
    return { total: filtered.length, items: filtered.slice(offset, offset + BATCH) };
  },

  countLine: (n) => `${fmtN(n)} órgano${n === 1 ? "" : "s"}` + (n !== ORGANS.length ? ` de ${fmtN(ORGANS.length)}` : ""),
  idOf: (o) => o.code,
  href: (code) => href.organ(code),

  row(o, active) {
    const on = o.status === "ACTIVO";
    return `<a class="row${active ? " active" : ""}" data-id="${o.code}" href="${href.organ(o.code)}" role="listitem" style="--c:${on ? "var(--law)" : "var(--archived)"}">
      <div class="row-top">
        <span class="num">${hl(String(o.code), state.q)}</span>
        <span class="pill st-neutral">${esc(titleCase(o.type || "—"))}</span>
        ${on ? `<span class="pill dot st-law">Activo</span>` : ""}
        <span class="date">${o.from ? o.from.slice(0, 4) : ""}${o.to ? "–" + o.to.slice(0, 4) : ""}</span>
      </div>
      <p class="row-name">${hl(titleCase(clean(o.name)), state.q)}</p>
      ${o.members || o.bills ? `<div class="row-foot">
        ${o.members ? `<span class="mini" title="Diputados que fueron miembros">${icon("users")}${fmtN(o.members)}</span>` : ""}
        ${o.bills ? `<span class="mini" title="Expedientes en agenda">${icon("doc")}${fmtN(o.bills)}</span>` : ""}
      </div>` : ""}
    </a>`;
  },

  async load(code) {
    if (!cache.has(code)) cache.set(code, await getJSON(`/api/organ/${code}`));
    return cache.get(code);
  },

  detail(pane, d) {
    const o = d.organ;
    const on = o.status === "ACTIVO";
    const people = new Set(d.members.map((m) => m.person_id ?? m.deputy_id)).size;
    const head = `${backBtn("organs")}
      <div class="d-meta">
        <span class="d-num">${o.organ_code}</span>
        <span class="pill dot ${on ? "st-law" : "st-archived"}">${on ? "Activo" : "Inactivo"}</span>
        <span>${esc(titleCase(o.organ_type || ""))}</span>
      </div>
      <h2 class="d-title">${esc(titleCase(clean(o.name)))}</h2>
      <dl class="facts">
        ${fact("Constituido", fmtDate(o.date_constituted, true))}
        ${fact("Disuelto", fmtDate(o.date_dissolved, true))}
        ${fact("Diputados", fmtN(people))}
        ${fact("Expedientes en agenda", fmtN(d.bills.length))}
        ${d.steps ? fact("Pasos de trámite con este nombre", fmtN(d.steps)) : ""}
        ${fact("Extraído", fmtDate(o.date_extracted))}
      </dl>`;
    renderDetail(pane, head, [
      ["miembros", "Miembros", "users", d.members.length, () => miembros(d)],
      ["expedientes", "Expedientes", "doc", d.bills.length, () => expedientes(d)],
    ], tabState);
  },
};

function miembros(d) {
  if (!d.members.length) return emptyTab("users", "Sin miembros registrados (organ_memberships viene de los puestos de cada diputado).");
  // Grouped by legislature (yearly), newest first.
  const groups = {};
  d.members.forEach((m) => (groups[m.legislature || "—"] ||= []).push(m));
  return Object.entries(groups).map(([leg, ms]) => `<h3 class="section-title">${esc(leg)}</h3>
    <ul class="people">${ms.map((m) => {
      const inner = `<span class="avatar" style="--c:${colorOf(m.position || "")}">${esc((m.name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join(""))}</span>
        <div><div class="nm">${esc(titleCase(m.name || `Diputado ${m.deputy_id}`))}</div>
        <div class="sm">${esc(titleCase(m.position || ""))}${m.date_joined ? ` · ${m.date_joined}` : ""}${m.date_left ? ` → ${m.date_left}` : ""}</div></div>`;
      return m.person_id ? `<li><a class="person linked" href="${href.deputy(m.person_id)}">${inner}</a></li>` : `<li><div class="person">${inner}</div></li>`;
    }).join("")}</ul>`).join("");
}

function expedientes(d) {
  if (!d.bills.length) return emptyTab("doc", "Sin expedientes en agenda. <code>organ_bills</code> solo cubre los órganos activos (27 con datos).");
  return billsTable(d.bills, [
    ["Ingreso", (b) => b.date_start || "—", "date"],
    ["Último paso", (b) => esc(b.last_step || ""), ""],
  ]);
}

