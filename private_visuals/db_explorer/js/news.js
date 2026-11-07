// News: ~30k articles, so search and paging happen on the server (/api/news).
import {
  esc, icon, fmtN, fmtDate, hl, getJSON, outletOf, href, fact, emptyTab,
  select, searchBox, chips, bindToolbar, renderDetail, backBtn, billsTable,
} from "./util.js";

const LIMIT = 50;
let FACETS = null;
const state = { q: "", qRaw: "", org: "", from: "", to: "", linked: "", sort: "" };
const tabState = { tab: "contenido" };
const cache = new Map();

const params = (offset) => new URLSearchParams({ q: state.q, org: state.org, from: state.from, to: state.to, linked: state.linked, sort: state.sort, offset, limit: LIMIT });

export default {
  label: "Noticias", listRoute: "news", route: "news", icon: "news", nounOne: "la noticia",
  placeholder: "Elegí una noticia para leerla y ver los expedientes enlazados.",

  async init() {
    if (!FACETS) FACETS = await getJSON("/api/news-facets");
  },

  stats: () => [
    ["Noticias", fmtN(FACETS.total)], ["Enlazadas a expedientes", fmtN(FACETS.linked)], ["Medios", fmtN(Object.keys(FACETS.organizations).length)],
    ["Desde", fmtDate(FACETS.date_min)], ["Hasta", fmtDate(FACETS.date_max)],
  ],

  toolbar() {
    const orgs = Object.entries(FACETS.organizations).sort((a, b) => b[1] - a[1]);
    return searchBox(state.qRaw, "Título, descripción, autor o sección…") +
      chips("news-chips", state.org, [["", "Todos", "var(--ink)", FACETS.total], ...orgs.map(([k, n]) => [k, outletOf(k).name, outletOf(k).color, n])]) +
      `<div class="controls">
        <label class="date-in"><span>Desde</span><input type="date" id="f-from" value="${esc(state.from)}" min="${(FACETS.date_min || "").slice(0, 10)}" max="${(FACETS.date_max || "").slice(0, 10)}"></label>
        <label class="date-in"><span>Hasta</span><input type="date" id="f-to" value="${esc(state.to)}" min="${(FACETS.date_min || "").slice(0, 10)}" max="${(FACETS.date_max || "").slice(0, 10)}"></label>
        ${select("f-linked", state.linked, [["", "Todas"], ["1", `Enlazadas a expedientes (${fmtN(FACETS.linked)})`]], "Enlaces")}
        ${select("sort", state.sort, [["", "Más recientes"], ["asc", "Más antiguas"], ["bills", "Más expedientes"]], "Orden")}
      </div>`;
  },

  bind(root, refresh) {
    bindToolbar(root, state, refresh, { selects: { "f-linked": "linked", sort: "sort" }, chipsId: "news-chips", chipsKey: "org" });
    for (const [id, key] of [["f-from", "from"], ["f-to", "to"]]) {
      root.querySelector("#" + id).addEventListener("change", (e) => { state[key] = e.target.value; e.target.classList.toggle("on", !!e.target.value); refresh(); });
    }
  },

  page: (offset) => getJSON(`/api/news?${params(offset)}`),

  countLine: (n) => `${fmtN(n)} noticia${n === 1 ? "" : "s"}` + (FACETS && n !== FACETS.total ? ` de ${fmtN(FACETS.total)}` : ""),
  idOf: (a) => a.id,
  href: (id) => href.news(id),

  row(a, active) {
    const o = outletOf(a.organization);
    return `<a class="row${active ? " active" : ""}" data-id="${esc(a.id)}" href="${href.news(a.id)}" role="listitem" style="--c:${o.color}">
      <div class="row-top">
        <span class="outlet" style="--c:${o.color}">${esc(o.name)}</span>
        ${a.section ? `<span>${esc(a.section)}</span>` : ""}
        <span class="date">${fmtDate(a.date_published)}</span>
      </div>
      <p class="row-name">${hl(a.title, state.q)}</p>
      <div class="row-foot">
        <span class="who">${hl(a.author || "Sin autor", state.q)}</span>
        ${a.bills ? `<span class="mini" title="Expedientes enlazados">${icon("doc")}${a.bills}</span>` : ""}
      </div>
    </a>`;
  },

  async load(id) {
    if (!cache.has(id)) cache.set(id, await getJSON(`/api/news/${encodeURIComponent(id)}`));
    return cache.get(id);
  },

  detail(pane, a) {
    const o = outletOf(a.organization);
    const head = `${backBtn("news")}
      <div class="d-meta">
        <span class="outlet" style="--c:${o.color}">${icon("news")}${esc(o.name)}</span>
        ${a.section ? `<span>${esc(a.section)}</span>` : ""}
        ${a.extraction_status !== "Success" ? `<span class="pill st-warn">${esc(a.extraction_status)}</span>` : ""}
      </div>
      <h2 class="d-title">${esc(a.title)}</h2>
      <div class="d-links"><a href="${esc(a.url)}" target="_blank" rel="noopener">${icon("external")}Abrir en ${esc(o.name)}</a></div>
      <dl class="facts">
        ${fact("Publicada", fmtDate(a.date_published, true))}
        ${fact("Autor", esc(a.author || "—"))}
        ${fact("Tipo de medio", esc(a.outlet_type || "—"))}
        ${fact("Caracteres", fmtN((a.content || "").length))}
        ${fact("Extraída", fmtDate(a.date_extracted))}
      </dl>`;
    renderDetail(pane, head, [
      ["contenido", "Contenido", "doc", null, () => contenido(a)],
      ["expedientes", "Expedientes", "doc", a.bills.length, () => expedientes(a)],
    ], tabState);
  },
};

function contenido(a) {
  return (a.description ? `<p class="lede">${esc(a.description)}</p>` : "") +
    (a.content ? `<div class="prose">${esc(a.content)}</div>` : emptyTab("doc", "Sin contenido extraído."));
}

function expedientes(a) {
  if (!a.bills.length) return emptyTab("doc", "Esta noticia no está enlazada a ningún expediente (news_bill_links).");
  return billsTable(a.bills, [["Fuente del enlace", (b) => esc(b.sources || ""), ""]]);
}

