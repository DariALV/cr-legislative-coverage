// Deputies: one entry per person (person_id) with all their terms. Index from /api/deputies.
import {
  esc, icon, fmtN, fmtDate, titleCase, initials, hl, getJSON, colorOf, link, href, fact, emptyTab,
  select, searchBox, chips, bindToolbar, renderDetail, backBtn, billsTable,
} from "./util.js";

const BATCH = 60;
let DEPS = null, TOTALS = null;
const state = { q: "", qRaw: "", status: "", term: "", faction: "", sort: "name" };
let filtered = [];
const tabState = { tab: "resumen" };
const cache = new Map();

function filter() {
  const words = state.q ? state.q.split(/\s+/) : [];
  filtered = DEPS.filter((p) =>
    (!state.status || p.status === state.status) &&
    (!state.term || p.terms.includes(state.term)) &&
    (!state.faction || p.factions.includes(state.faction)) &&
    words.every((w) => p.hay.includes(w)));
  if (state.sort === "bills") filtered.sort((a, b) => b.bills - a.bills);
  else if (state.sort === "organs") filtered.sort((a, b) => b.organs - a.organs);
  else if (state.sort === "recent") filtered.sort((a, b) => b.terms.at(-1).localeCompare(a.terms.at(-1)) || a.sort.localeCompare(b.sort));
  else filtered.sort((a, b) => a.sort.localeCompare(b.sort, "es"));
}

export default {
  label: "Diputados", listRoute: "deputies", route: "deputy", icon: "users", nounOne: "el diputado",
  placeholder: "Elegí un diputado para ver sus períodos, fracciones, órganos y expedientes.",

  async init() {
    if (DEPS) return;
    const data = await getJSON("/api/deputies");
    DEPS = data.deputies; TOTALS = data.totals;
  },

  stats: () => [
    ["Personas", fmtN(TOTALS.people)], ["Diputado × período", fmtN(TOTALS.rows)], ["En ejercicio", fmtN(TOTALS.current)],
    ["Fracciones", fmtN(TOTALS.factions)], ["Puestos en órganos", fmtN(TOTALS.memberships)],
  ],

  toolbar() {
    const terms = [...new Set(DEPS.flatMap((p) => p.terms))].sort().reverse();
    const fx = {};
    DEPS.forEach((p) => p.factions.forEach((f) => (fx[f] = (fx[f] || 0) + 1)));
    const current = DEPS.filter((p) => p.status === "VIGENTE").length;
    return searchBox(state.qRaw, "Nombre, fracción o provincia…") +
      chips("dep-chips", state.status, [["", "Todos", "var(--ink)", DEPS.length], ["VIGENTE", "En ejercicio", "var(--law)", current], ["NO VIGENTE", "Anteriores", "var(--archived)", DEPS.length - current]]) +
      `<div class="controls">
        ${select("f-term", state.term, [["", "Todo período"], ...terms.map((t) => [t, t])], "Período")}
        ${select("f-faction", state.faction, [["", "Toda fracción"], ...Object.entries(fx).sort((a, b) => a[0].localeCompare(b[0], "es")).map(([f, n]) => [f, `${titleCase(f)} (${n})`])], "Fracción")}
        ${select("sort", state.sort, [["name", "Apellido A–Z"], ["recent", "Período más reciente"], ["bills", "Más expedientes"], ["organs", "Más órganos"]], "Orden")}
      </div>`;
  },

  bind(root, refresh) {
    bindToolbar(root, state, refresh, { selects: { "f-term": "term", "f-faction": "faction", sort: "sort" }, chipsId: "dep-chips", chipsKey: "status" });
  },

  async page(offset) {
    if (offset === 0) filter();
    return { total: filtered.length, items: filtered.slice(offset, offset + BATCH) };
  },

  countLine: (n) => `${fmtN(n)} diputado${n === 1 ? "" : "s"}` + (n !== DEPS.length ? ` de ${fmtN(DEPS.length)}` : ""),
  idOf: (p) => p.id,
  href: (id) => href.deputy(id),

  row(p, active) {
    const c = colorOf(p.faction || p.name);
    const on = p.status === "VIGENTE";
    return `<a class="row row-person${active ? " active" : ""}" data-id="${p.id}" href="${href.deputy(p.id)}" role="listitem" style="--c:${c}">
      <span class="avatar" style="--c:${c}">${esc(initials(p.name))}</span>
      <div class="row-main">
        <div class="row-top">
          <span class="row-title">${hl(titleCase(p.name), state.q)}</span>
          ${on ? `<span class="pill dot st-law">En ejercicio</span>` : ""}
        </div>
        <div class="row-foot">
          <span class="who">${hl(titleCase(p.faction || "Sin fracción"), state.q)} · ${hl(titleCase(p.provinces.join(", ")), state.q)}</span>
          <span class="mini" title="Períodos">${icon("calendar")}${p.terms.join(", ")}</span>
          ${p.bills ? `<span class="mini" title="Expedientes presentados">${icon("doc")}${fmtN(p.bills)}</span>` : ""}
        </div>
      </div>
    </a>`;
  },

  async load(id) {
    if (!cache.has(id)) cache.set(id, await getJSON(`/api/deputy/${id}`));
    return cache.get(id);
  },

  detail(pane, d) {
    const last = d.terms.at(-1);
    const lastFaction = d.factions.at(-1)?.faction;
    const c = colorOf(lastFaction || d.name);
    const inCorpus = d.bills.filter((b) => b.in_corpus).length;
    const organCount = new Set(d.memberships.filter((m) => m.organ_code).map((m) => m.organ_code)).size;
    const head = `${backBtn("deputies")}
      <div class="d-person">
        <span class="avatar lg" style="--c:${c}">${esc(initials(d.name))}</span>
        <div>
          <div class="d-meta">
            <span class="pill dot ${last.status === "VIGENTE" ? "st-law" : "st-archived"}">${last.status === "VIGENTE" ? "En ejercicio" : "No vigente"}</span>
            <span>${d.terms.map((t) => t.term).join(" · ")}</span>
          </div>
          <h2 class="d-title">${esc(titleCase(d.name))}</h2>
        </div>
      </div>
      <dl class="facts">
        ${fact("Fracción actual", esc(titleCase(lastFaction || "—")))}
        ${fact("Provincia", esc(titleCase(last.province || "—")))}
        ${fact("Curul", esc(last.seat ?? "—"))}
        ${fact("Desde", fmtDate(d.terms[0].date_from, true))}
        ${fact("Hasta", last.date_to ? fmtDate(last.date_to, true) : "—")}
        ${fact("Expedientes en el corpus", `${fmtN(inCorpus)} <span class="muted">de ${fmtN(d.bills.length)}</span>`)}
      </dl>`;
    renderDetail(pane, head, [
      ["resumen", "Resumen", "users", null, () => resumen(d)],
      ["expedientes", "Expedientes", "doc", d.bills.length, () => expedientes(d)],
      ["organos", "Órganos", "building", organCount, () => organos(d)],
      ["votaciones", "Votaciones", "vote", d.votes.length, () => votaciones(d)],
    ], tabState);
  },
};

function resumen(d) {
  const out = [];
  out.push(`<h3 class="section-title">Períodos</h3><table class="tbl"><thead><tr><th>Período</th><th>Provincia</th><th>Curul</th><th>Desde</th><th>Hasta</th><th>Estado</th></tr></thead><tbody>
    ${d.terms.map((t) => `<tr><td class="num">${esc(t.term)}</td><td>${esc(titleCase(t.province || ""))}</td><td class="num">${t.seat ?? "—"}</td>
      <td class="date">${t.date_from || "—"}</td><td class="date">${t.date_to || "—"}</td><td>${esc(titleCase(t.status || ""))}</td></tr>`).join("")}
  </tbody></table>`);
  out.push(`<h3 class="section-title">Fracciones</h3>`);
  out.push(d.factions.length ? `<ol class="timeline">${d.factions.map((f) => `<li class="tl" style="--c:${colorOf(f.faction)}">
      <span class="tl-date">${f.date_from || "—"}</span>
      <div><div class="tl-desc">${esc(titleCase(f.faction))}</div><span class="tl-org">${esc(f.term)}${f.province ? " · " + esc(titleCase(f.province)) : ""}</span>${f.date_to ? `<span class="tl-end">hasta ${f.date_to}</span>` : ""}</div>
    </li>`).join("")}</ol>` : `<p class="muted">Sin fracciones registradas.</p>`);
  const reps = [
    ...d.replacements.map((r) => ({ date: r.date, text: titleCase(r.detail), id: r.other_person_id, name: r.name })),
    // Seen from the other person's record: "X REEMPLAZADO POR <this person>" means this person replaced X.
    ...d.replaced_in.map((r) => ({ date: r.date, text: /POR/i.test(r.detail) ? "Reemplazó a" : "Reemplazado por", id: r.person_id, name: r.other_name })),
  ];
  const seen = new Set();
  reps.splice(0, reps.length, ...reps.filter((r) => { const k = `${r.id || r.name}|${r.date}`; return seen.has(k) ? false : seen.add(k); }));
  if (reps.length) {
    out.push(`<h3 class="section-title">Reemplazos</h3><ul class="plain">${reps.map((r) =>
      `<li><span class="date">${r.date || "—"}</span> ${esc(r.text)} ${link.deputy(r.id, titleCase(r.name))}</li>`).join("")}</ul>`);
  }
  return out.join("");
}

function expedientes(d) {
  if (!d.bills.length) return emptyTab("doc", "Sin expedientes presentados.");
  const off = d.bills.length - d.bills.filter((b) => b.in_corpus).length;
  return (off ? `<p class="muted note">${fmtN(off)} expediente${off === 1 ? "" : "s"} de <code>deputy_bills</code> no están en el corpus (anteriores al 20000) y se muestran sin link.</p>` : "") +
    billsTable(d.bills, [["Período", (b) => esc(b.term || ""), "num"], ["Firma", (b) => b.signing_order ?? "—", "num"]]);
}

function organos(d) {
  if (!d.memberships.length) return emptyTab("building", "Sin puestos en órganos.");
  return `<table class="tbl"><thead><tr><th>Órgano</th><th>Puesto</th><th>Legislatura</th><th>Desde</th><th>Hasta</th></tr></thead><tbody>
    ${d.memberships.map((m) => `<tr>
      <td>${m.known ? link.organ(m.organ_code, titleCase(m.organ_name)) : `<span class="muted">${esc(titleCase(m.organ_name || "—"))}</span>`}
        ${m.organ_type ? `<div class="sub-line">${esc(titleCase(m.organ_type))}</div>` : ""}</td>
      <td>${esc(titleCase(m.position || ""))}</td><td class="num">${esc(m.legislature || "")}</td>
      <td class="date">${m.date_joined || "—"}</td><td class="date">${m.date_left || "—"}</td></tr>`).join("")}
  </tbody></table>`;
}

function votaciones(d) {
  if (!d.votes.length) return emptyTab("vote", "Sin votaciones. Las tablas <code>votes</code> y <code>vote_deputies</code> todavía están vacías.");
  return `<table class="tbl"><thead><tr><th>Fecha</th><th>Expediente</th><th>Votación</th><th>Voto</th></tr></thead><tbody>
    ${d.votes.map((v) => `<tr><td class="date">${v.date || "—"}</td><td class="num">${link.bill(v.number)}</td>
      <td>${esc(v.name)}${v.result ? `<div class="sub-line">${esc(v.result)}</div>` : ""}</td><td>${esc(v.vote)}</td></tr>`).join("")}
  </tbody></table>`;
}

