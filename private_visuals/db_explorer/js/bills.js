// Bills (expedientes): index loaded once from /api/bills and filtered in the browser.
import {
  esc, icon, fmtN, fmtDate, titleCase, face, shortType, toast, hl, getJSON, colorOf,
  STATUS, statusOf, FLAG, TEXT, outletOf, link, href, fact, emptyTab, select, searchBox, chips, bindToolbar,
  renderDetail, backBtn, norm,
} from "./util.js";

const BATCH = 40;
const DELFINO = "https://delfino.cr/asamblea/proyecto/";
// vote_deputies.vote holds "for" / "against" / "absent" (DelfinoVotesParser); other labels come as Delfino shows them.
const VOTE_COLORS = { for: "var(--law)", against: "var(--bad)", absent: "var(--archived)" };
const VOTE_LABELS = { for: "A favor", against: "En contra", absent: "Ausente" };
const voteLabel = (k) => VOTE_LABELS[k] || k;
const VOTE_KINDS = { plenary: "Plenario", full_committee: "Comisión plena" };

let BILLS = null, TOTALS = null;
const byNumber = new Map();
const state = { q: "", qRaw: "", status: "", type: "", flag: "", text: "", extra: "", sort: "num" };
let filtered = [];
const tabState = { tab: "resumen" };
const cache = new Map();

function filter() {
  const words = state.q ? state.q.split(/\s+/) : [];
  filtered = BILLS.filter((b) =>
    (!state.status || b.status === state.status) &&
    (!state.type || b.type === state.type) &&
    (!state.flag || (state.flag === "none" ? !b.flag : b.flag === state.flag)) &&
    (!state.text || b.text === state.text) &&
    (!state.extra || (state.extra === "news" ? b.news > 0 : state.extra === "votes" ? b.votes > 0 : !!b.law)) &&
    words.every((w) => b.hay.includes(w)));
  const cmp = {
    num: (a, b) => b.n - a.n,
    "num-asc": (a, b) => a.n - b.n,
    date: (a, b) => (b.date || "").localeCompare(a.date || "") || b.n - a.n,
    news: (a, b) => b.news - a.news || b.n - a.n,
    steps: (a, b) => b.steps - a.steps || b.n - a.n,
  }[state.sort];
  filtered.sort(cmp);
  // An exact number match goes first.
  if (/^\d+$/.test(state.q)) {
    const i = filtered.findIndex((b) => String(b.n) === state.q);
    if (i > 0) filtered.unshift(filtered.splice(i, 1)[0]);
  }
}

export default {
  label: "Expedientes", listRoute: "bills", route: "bill", icon: "doc", nounOne: "el expediente",
  placeholder: "Elegí un expediente para ver su información.",

  async init() {
    if (BILLS) return;
    const data = await getJSON("/api/bills");
    BILLS = data.bills; TOTALS = data.totals;
    BILLS.forEach((b) => byNumber.set(b.n, b));
  },

  stats() {
    const count = (k) => BILLS.filter((b) => b.status === k).length;
    return [
      ["Expedientes", fmtN(TOTALS.bills)], ["Leyes", fmtN(count("law"))], ["En trámite", fmtN(count("in progress"))],
      ["Trámites", fmtN(TOTALS.steps)], ["Enlaces a noticias", fmtN(TOTALS.news_links)],
    ];
  },

  toolbar() {
    const counts = {}, types = {};
    BILLS.forEach((b) => { counts[b.status] = (counts[b.status] || 0) + 1; types[b.type] = (types[b.type] || 0) + 1; });
    return searchBox(state.qRaw, "Número, nombre, proponente o materia…") +
      chips("status-chips", state.status, [["", "Todos", "var(--ink)", BILLS.length], ...Object.entries(STATUS).map(([k, s]) => [k, s.label, s.color, counts[k] || 0])]) +
      `<div class="controls">
        ${select("f-type", state.type, [["", "Todo tipo"], ...Object.entries(types).sort((a, b) => b[1] - a[1]).map(([t, n]) => [t, `${shortType(t)} (${fmtN(n)})`])], "Tipo")}
        ${select("f-flag", state.flag, [["", "Toda bandera"], ["none", "Sin bandera"], ["administrative", "Administrativos"], ["honorific", "Honoríficos"]], "Bandera")}
        ${select("f-text", state.text, [["", "Todo texto"], ["ok", "Con exposición"], ["no_exposition", "Sin exposición"], ["no_text", "Sin texto"]], "Texto")}
        ${select("f-extra", state.extra, [["", "Todos"], ["news", "Con noticias"], ["votes", "Con votaciones"], ["law", "Con número de ley"]], "Extras")}
        ${select("sort", state.sort, [["num", "Número ↓"], ["num-asc", "Número ↑"], ["date", "Más recientes"], ["news", "Más noticias"], ["steps", "Más trámites"]], "Orden")}
      </div>`;
  },

  bind(root, refresh) {
    bindToolbar(root, state, refresh, {
      selects: { "f-type": "type", "f-flag": "flag", "f-text": "text", "f-extra": "extra", sort: "sort" },
      chipsId: "status-chips", chipsKey: "status",
    });
  },

  async page(offset) {
    if (offset === 0) filter();
    return { total: filtered.length, items: filtered.slice(offset, offset + BATCH) };
  },

  countLine: (n) => `${fmtN(n)} expediente${n === 1 ? "" : "s"}` + (n !== BILLS.length ? ` de ${fmtN(BILLS.length)}` : ""),
  idOf: (b) => b.n,
  href: (n) => href.bill(n),
  exact: (v) => (/^\d+$/.test(v) && byNumber.has(+v) ? +v : null),

  row(b, active) {
    const st = statusOf(b.status);
    const q = state.q;
    const who = b.props.length ? b.props.map(titleCase).join(", ") + (b.nprops > b.props.length ? ` +${b.nprops - b.props.length}` : "") : "Sin proponentes";
    return `<a class="row${active ? " active" : ""}" data-id="${b.n}" href="${href.bill(b.n)}" role="listitem" style="--c:${st.color}">
      <div class="row-top">
        <span class="num">${hl(String(b.n), q)}</span>
        <span class="pill dot ${st.cls}">${st.label}${b.law ? ` · ${b.law}` : ""}</span>
        ${b.flag ? `<span class="pill st-neutral">${FLAG[b.flag] || b.flag}</span>` : ""}
        <span class="date">${fmtDate(b.date)}</span>
      </div>
      <p class="row-name">${hl(b.name, q)}</p>
      <div class="row-foot">
        <span class="who">${hl(who, q)}</span>
        ${b.news ? `<span class="mini" title="Noticias enlazadas">${icon("news")}${b.news}</span>` : ""}
        ${b.votes ? `<span class="mini" title="Votaciones">${icon("vote")}${b.votes}</span>` : ""}
        ${b.text && b.text !== "ok" ? `<span class="mini" title="${TEXT[b.text]?.label}">${icon("doc")}${TEXT[b.text]?.label}</span>` : ""}
      </div>
    </a>`;
  },

  async load(n) {
    if (!cache.has(n)) cache.set(n, await getJSON(`/api/bill/${n}`));
    return cache.get(n);
  },

  detail(pane, d) {
    const b = d.bill;
    const st = statusOf(b.status);
    const expiryBad = b.date_expiry && b.date_proposed && b.date_expiry < b.date_proposed;
    const head = `${backBtn("bills")}
      <div class="d-meta">
        <button class="d-num" id="d-copy" title="Copiar número">${b.number}${icon("copy")}</button>
        <span class="pill dot ${st.cls}">${st.label}</span>
        ${b.flag ? `<span class="pill st-neutral">${FLAG[b.flag] || b.flag}</span>` : ""}
        ${d.text ? `<span class="pill ${TEXT[d.text.status]?.cls || "st-neutral"}">${TEXT[d.text.status]?.label || d.text.status}</span>` : ""}
        <span>${esc(shortType(b.file_type))}</span>
      </div>
      <h2 class="d-title">${esc(b.name)}</h2>
      <div class="d-links"><a href="${DELFINO}${b.number}" target="_blank" rel="noopener">${icon("external")}Delfino</a></div>
      <dl class="facts">
        ${fact("Presentado", fmtDate(b.date_proposed, true))}
        ${fact("Vencimiento", fmtDate(b.date_expiry, true), expiryBad, expiryBad ? "Fecha anterior a la presentación (dato del SIL)" : "")}
        ${fact("Plazo cuatrienal", fmtDate(b.date_expiry_four_year, true))}
        ${b.law_number ? fact("Número de ley", b.law_number) : ""}
        ${b.archive_number ? fact("Número de archivo", b.archive_number) : ""}
        ${fact("Extraído", fmtDate(b.date_extracted))}
      </dl>`;
    renderDetail(pane, head, [
      ["resumen", "Resumen", "doc", null, () => resumen(d)],
      ["texto", "Texto", "doc", null, () => texto(d)],
      ["proponentes", "Proponentes", "users", d.proponents.length, () => proponentes(d)],
      ["tramite", "Trámite", "steps", d.steps.length, () => tramite(d)],
      ["comisiones", "Comisiones", "building", d.organs.length, () => comisiones(d)],
      ["votaciones", "Votaciones", "vote", d.votes.length, () => votaciones(d)],
      ["noticias", "Noticias", "news", d.news.length, () => noticias(d)],
    ], tabState, (tab, el) => {
      if (tab === "texto") {
        const more = el.querySelector("#prose-more");
        if (more) more.onclick = () => { el.querySelector("#prose").classList.remove("clamped"); more.remove(); };
      }
      if (tab === "noticias") el.querySelectorAll("[data-news]").forEach((btn) => btn.onclick = () => loadNews(btn));
    });
    pane.querySelector("#d-copy").onclick = () => navigator.clipboard?.writeText(String(b.number)).then(() => toast("Número copiado"));
  },
};

function resumen(d) {
  const b = d.bill;
  const last = d.steps[d.steps.length - 1];
  const t = d.text;
  const out = [];
  out.push(`<h3 class="section-title">Materias</h3>`);
  out.push(d.subjects.length ? `<div class="tags">${d.subjects.map((s) => `<span class="tag" title="Código ${s.subject_code}">${esc(titleCase(s.subject))}</span>`).join("")}</div>` : `<p class="muted">Sin materias registradas.</p>`);
  if (d.laws.length) {
    out.push(`<h3 class="section-title">Ley</h3>`);
    out.push(d.laws.map((l) => `<p style="margin:0 0 6px"><span class="pill st-law">Ley ${l.law_number}</span> ${esc(l.title || "")}</p>`).join(""));
  }
  out.push(`<h3 class="section-title">De un vistazo</h3><dl class="facts" style="margin-top:0">
    ${fact("Proponentes", d.proponents.length)}
    ${fact("Trámites", d.steps.length)}
    ${fact("Comisiones", d.organs.length)}
    ${fact("Votaciones", d.votes.length)}
    ${fact("Noticias", d.news.length)}
    ${t ? fact("Palabras (exposición / total)", `${fmtN(t.exposition_words)} / ${fmtN(t.total_words)}`) : ""}
  </dl>`);
  if (last) {
    out.push(`<h3 class="section-title">Último trámite</h3>
      <p style="margin:0;font-size:14px">${esc(last.description)}</p>
      <p class="muted" style="margin:2px 0 0">${link.organ(last.organ_code, last.organ || "")} · ${fmtDate(last.date_start, true)}</p>`);
  }
  if (d.proponents.length) {
    const fx = {};
    d.proponents.forEach((p) => { const f = p.faction || (p.deputy_id ? "Sin fracción" : titleCase(p.name)); fx[f] = (fx[f] || 0) + 1; });
    out.push(`<h3 class="section-title">Fracciones proponentes</h3><div class="tags">${Object.entries(fx).sort((a, b) => b[1] - a[1]).map(([f, n]) => `<span class="tag">${esc(titleCase(f))} · ${n}</span>`).join("")}</div>`);
  }
  if (b.status === "in progress" && d.steps.some((s) => /^ARCHIVO/i.test(s.description))) {
    out.push(`<p class="muted" style="margin-top:22px">⚠ Marcado "en trámite", pero tiene un paso de archivo en el trámite.</p>`);
  }
  return out.join("");
}

function texto(d) {
  const t = d.text;
  if (!t) return emptyTab("doc", "No hay registro en bill_texts.");
  const pct = t.total_words ? Math.round((t.exposition_words / t.total_words) * 100) : 0;
  const meta = `<div class="text-meta">
    <span class="pill ${TEXT[t.status]?.cls || "st-neutral"}">${TEXT[t.status]?.label || t.status}</span>
    <span>${fmtN(t.exposition_words)} palabras de exposición · ${fmtN(t.total_words)} en total</span>
    ${t.total_words ? `<span class="wordbar" title="${pct}% del texto"><i style="width:${pct}%"></i></span>` : ""}
  </div>`;
  if (!t.exposition) return meta + emptyTab("doc", t.status === "no_text" ? "El expediente no tiene texto en el SIL." : "No se pudo separar la exposición de motivos.");
  const long = t.exposition.length > 4000;
  return meta + `<h3 class="section-title">Exposición de motivos</h3>
    <div class="prose${long ? " clamped" : ""}" id="prose">${esc(t.exposition)}</div>
    ${long ? `<button class="btn" id="prose-more">${icon("chevron")}Mostrar todo (${fmtN(t.exposition_words)} palabras)</button>` : ""}`;
}

function proponentes(d) {
  if (!d.proponents.length) return emptyTab("users", "Sin proponentes registrados.");
  return `<ul class="people">${d.proponents.map((p) => {
    const sub = [p.faction && titleCase(p.faction), p.province && titleCase(p.province), p.term].filter(Boolean).join(" · ");
    const inner = `${face(p, colorOf(p.faction || p.name))}
      <div><div class="nm">${esc(titleCase(p.name))}</div><div class="sm">${esc(sub || (p.deputy_id ? "" : "No es diputado"))}</div></div>
      <span class="ord">${p.signing_order ?? ""}</span>`;
    // Proponents with a deputy are links to the deputy's page; the rest (no deputy_id) are plain.
    return p.person_id
      ? `<li><a class="person linked" href="${href.deputy(p.person_id)}">${inner}</a></li>`
      : `<li><div class="person">${inner}</div></li>`;
  }).join("")}</ul>`;
}

function tramite(d) {
  if (!d.steps.length) return emptyTab("steps", "Sin trámites registrados.");
  const proposed = d.bill.date_proposed || "";
  const organColor = (o) => {
    if (!o) return "var(--ink-3)";
    if (/PLENARIO/i.test(o)) return "var(--accent)";
    if (/ARCHIVO/i.test(o)) return "var(--archived)";
    if (/SERVICIOS|DEPARTAMENTO|SECRETAR/i.test(o)) return "var(--delfino)";
    return "var(--law)";
  };
  let prev = null;
  return `<ol class="timeline">${d.steps.map((s) => {
    const bad = s.date_start && proposed && s.date_start < proposed;
    const gap = prev !== null && prev !== s.organ;
    prev = s.organ;
    // The step's organ is free text; it links only when it matches exactly one organ name.
    const org = s.organ_code ? `<a class="tl-org xref" href="${href.organ(s.organ_code)}">${esc(s.organ)}</a>` : `<span class="tl-org">${esc(s.organ || "")}</span>`;
    return `<li class="tl${gap ? " group-gap" : ""}" style="--c:${organColor(s.organ)}">
      <span class="tl-date${bad ? " bad" : ""}" ${bad ? 'title="Anterior a la presentación (dato del SIL)"' : ""}>${s.date_start || "—"}</span>
      <div><div class="tl-desc">${esc(s.description)}</div>
        ${org}${s.date_end && s.date_end !== s.date_start ? `<span class="tl-end">hasta ${s.date_end}</span>` : ""}</div>
    </li>`;
  }).join("")}</ol>`;
}

function comisiones(d) {
  if (!d.organs.length) return emptyTab("building", "El expediente no aparece en la agenda de ningún órgano (organ_bills).");
  return `<table class="tbl"><thead><tr><th>Órgano</th><th>Ingreso</th><th>Salida</th><th>Último paso</th></tr></thead><tbody>
    ${d.organs.map((o) => `<tr>
      <td><div style="font-weight:550">${link.organ(o.organ_code, titleCase(o.name || String(o.organ_code)))}</div><div class="muted" style="font-size:12px">${esc(titleCase(o.organ_type || ""))}${o.organ_status ? " · " + esc(titleCase(o.organ_status)) : ""}</div></td>
      <td class="date">${o.date_start || "—"}</td><td class="date">${o.date_end || "—"}</td>
      <td>${esc(o.last_step || "")}</td></tr>`).join("")}
  </tbody></table>`;
}

function votaciones(d) {
  if (!d.votes.length) return emptyTab("vote", "Sin votaciones. Las tablas <code>votes</code> y <code>vote_deputies</code> todavía están vacías.");
  return d.votes.map((v) => {
    const tally = {};
    v.deputies.forEach((x) => (tally[x.vote] = (tally[x.vote] || 0) + 1));
    const total = v.deputies.length || 1;
    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const col = (k, i) => VOTE_COLORS[k] || ["var(--progress)", "var(--delfino)", "var(--semanario)"][i % 3];
    return `<div class="vote">
      <div class="news-meta"><span>${fmtDate(v.date, true)}</span><span class="pill ${v.kind === "full_committee" ? "st-warn" : "st-progress"}">${esc(VOTE_KINDS[v.kind] || v.kind || "")}</span>${v.result ? `<span class="pill st-neutral">${esc(v.result)}</span>` : ""}
        ${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener" style="margin-left:auto;color:var(--accent)">Ver ${icon("external")}</a>` : ""}</div>
      <div class="news-title">${esc(v.name)}</div>
      ${v.description ? `<p class="news-snippet">${esc(v.description)}</p>` : ""}
      ${entries.length ? `<div class="vote-bar">${entries.map(([k, n], i) => `<i style="width:${(n / total) * 100}%;background:${col(k, i)}"></i>`).join("")}</div>
      <div class="vote-legend">${entries.map(([k, n], i) => `<span><span class="sw" style="background:${col(k, i)}"></span>${esc(voteLabel(k))} <b>${n}</b></span>`).join("")}</div>` : ""}
      ${v.deputies.length ? `<details class="vote-who"><summary>Ver diputados (${v.deputies.length})</summary>
        <table class="tbl"><tbody>${v.deputies.map((x) => `<tr><td>${link.deputy(x.person_id, titleCase(x.name))}</td><td class="muted">${esc(x.party || "")}</td><td>${esc(voteLabel(x.vote))}</td></tr>`).join("")}</tbody></table>
      </details>` : ""}
    </div>`;
  }).join("");
}

function noticias(d) {
  if (!d.news.length) return emptyTab("news", "Ninguna noticia enlazada a este expediente.");
  return `<ul class="news">${d.news.map((a) => {
    const o = outletOf(a.organization);
    const snippet = a.description || a.snippet || "";
    return `<li class="news-item" style="--c:${o.color}">
      <div class="news-meta">
        <span class="outlet" style="--c:${o.color}">${icon("news")}${esc(o.name)}</span>
        <span>${fmtDate(a.date_published)}</span>
        ${a.section ? `<span>${esc(a.section)}</span>` : ""}
        ${a.author ? `<span>${esc(a.author)}</span>` : ""}
        <a class="ext" href="${esc(a.url)}" target="_blank" rel="noopener" title="Abrir en el medio">${icon("external")}</a>
      </div>
      <h4 class="news-title">${link.news(a.id, a.title)}</h4>
      ${snippet ? `<p class="news-snippet" data-snip>${esc(snippet.length > 300 ? snippet.slice(0, 300) + "…" : snippet)}</p>` : ""}
      ${a.content_len > 300 ? `<button class="linkbtn" data-news="${esc(a.id)}">Leer contenido (${fmtN(a.content_len)} caracteres)</button>` : ""}
    </li>`;
  }).join("")}</ul>`;
}

async function loadNews(btn) {
  btn.textContent = "Cargando…";
  try {
    const a = await getJSON(`/api/news/${encodeURIComponent(btn.dataset.news)}`);
    const item = btn.closest(".news-item");
    let p = item.querySelector("[data-snip]");
    if (!p) { p = document.createElement("p"); p.className = "news-snippet"; btn.before(p); }
    p.textContent = a.content || "";
    btn.remove();
  } catch { btn.textContent = "No se pudo cargar"; }
}
