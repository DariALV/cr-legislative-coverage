// Shared helpers, constants and cross-entity links for the explorer.

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const icon = (id) => `<svg><use href="#i-${id}"/></svg>`;
export const fmtN = (n) => Number(n || 0).toLocaleString("es-CR");
export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export const fmtDate = (iso, long) => {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("es-CR", long ? { day: "numeric", month: "long", year: "numeric" } : { day: "2-digit", month: "short", year: "numeric" });
};
export const titleCase = (s) => (s || "").toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
export const initials = (name) => (name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("");
// A person's circle: their Delfino photo when the server has one (p.photo), else the initials of first name and
// first surname (p.ini, from the server; plain name initials for people who are not known deputies).
// If the photo fails to load, the initials come back.
export const face = (p, c, cls = "") => {
  const ini = esc(p.ini || initials(p.name));
  const img = p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" onerror="this.parentNode.classList.remove('has-photo');this.replaceWith('${ini}')">` : ini;
  return `<span class="avatar${p.photo ? " has-photo" : ""}${cls ? " " + cls : ""}" style="--c:${c}">${img}</span>`;
};
export const shortType = (t) => (t || "").replace(/^PROCEDIMIENTO\s+(DE\s+)?/i, "").replace(/^PROYECTOS?\s+(DE\s+)?/i, "").toLowerCase().replace(/^./, (c) => c.toUpperCase());
export const toast = (msg) => {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 1400);
};
export const plural = (n, one, many) => `${fmtN(n)} ${n === 1 ? one : many}`;

export const STATUS = {
  "in progress": { label: "En trámite", cls: "st-progress", color: "var(--progress)" },
  law: { label: "Ley", cls: "st-law", color: "var(--law)" },
  archived: { label: "Archivado", cls: "st-archived", color: "var(--archived)" },
};
export const statusOf = (s) => STATUS[s] || { label: s || "—", cls: "st-neutral", color: "var(--line-strong)" };
export const FLAG = { administrative: "Administrativo", honorific: "Honorífico" };
export const TEXT = {
  ok: { label: "Con exposición", cls: "st-law" },
  no_exposition: { label: "Sin exposición", cls: "st-warn" },
  no_text: { label: "Sin texto", cls: "st-bad" },
};
export const OUTLETS = {
  crhoy: { name: "CRHoy", color: "var(--crhoy)" },
  nacion: { name: "La Nación", color: "var(--nacion)" },
  delfino: { name: "Delfino", color: "var(--delfino)" },
  elmundo: { name: "El Mundo", color: "var(--elmundo)" },
  semanario: { name: "Semanario Universidad", color: "var(--semanario)" },
};
export const outletOf = (o) => OUTLETS[o] || { name: o, color: "var(--ink-3)" };

// Stable color per string (factions, organ types).
const PALETTE = ["var(--accent)", "var(--law)", "var(--progress)", "var(--delfino)", "var(--semanario)", "var(--crhoy)"];
export const colorOf = (s) => PALETTE[[...(s || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

// ---------- cross-entity links ----------
// Every reference to another entity is an <a class="xref"> to its hash route.
export const href = {
  bill: (n) => `#/bill/${n}`,
  deputy: (id) => `#/deputy/${id}`,
  organ: (code) => `#/organ/${code}`,
  news: (id) => `#/news/${encodeURIComponent(id)}`,
};
export const link = {
  bill: (n, label = n) => `<a class="xref" href="${href.bill(n)}">${esc(label)}</a>`,
  // Bills outside the corpus (e.g. before 20000) are shown as plain text.
  billMaybe: (n, inCorpus, label = n) => inCorpus ? link.bill(n, label) : `<span class="xref-off" title="Fuera del corpus (no está en bills)">${esc(label)}</span>`,
  deputy: (id, label) => id ? `<a class="xref" href="${href.deputy(id)}">${esc(label)}</a>` : esc(label),
  organ: (code, label) => code ? `<a class="xref" href="${href.organ(code)}">${esc(label)}</a>` : esc(label),
  news: (id, label) => `<a class="xref" href="${href.news(id)}">${esc(label)}</a>`,
};

// Accent-insensitive highlight of the query words inside `text`.
export function hl(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const src = String(text ?? "");
  const n = norm(src);
  if (n.length !== src.length) return safe;
  const marks = new Array(src.length).fill(false);
  q.split(/\s+/).filter(Boolean).forEach((w) => {
    let i = n.indexOf(w);
    while (i !== -1) { for (let k = i; k < i + w.length; k++) marks[k] = true; i = n.indexOf(w, i + w.length); }
  });
  let out = "", open = false;
  for (let i = 0; i < src.length; i++) {
    if (marks[i] && !open) { out += "<mark>"; open = true; }
    if (!marks[i] && open) { out += "</mark>"; open = false; }
    out += esc(src[i]);
  }
  return out + (open ? "</mark>" : "");
}

export async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// ---------- shared UI pieces ----------
export const fact = (k, v, bad, title) => `<div class="fact"><dt>${k}</dt><dd class="${bad ? "bad" : ""}" ${title ? `title="${esc(title)}"` : ""}>${v}</dd></div>`;
export const emptyTab = (ic, msg) => `<div class="empty-tab">${icon(ic)}${msg}</div>`;
export const loading = (msg) => `<div class="loading"><div class="spin"></div>${esc(msg)}</div>`;

export const select = (id, value, options, label) => `<label class="select"><span class="sr">${esc(label)}</span>
  <select id="${id}" class="${value && id !== "sort" ? "on" : ""}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>${icon("chevron")}</label>`;

export const searchBox = (value, placeholder) => `<label class="search">${icon("search")}
  <input id="q" type="search" placeholder="${esc(placeholder)}" autocomplete="off" value="${esc(value)}"><kbd>/</kbd></label>`;

export const chips = (id, value, items) => `<div class="chips" id="${id}" role="group">${items.map(([k, l, c, n]) =>
  `<button class="chip" data-v="${esc(k)}" aria-pressed="${String(k) === String(value)}" style="--c:${c}">${k ? "<i></i>" : ""}${esc(l)}${n !== undefined ? `<span>${fmtN(n)}</span>` : ""}</button>`).join("")}</div>`;

// Binds the search box, chips and selects of a toolbar to a state object; calls onChange after each change.
export function bindToolbar(root, state, onChange, { selects = {}, chipsId, chipsKey, searchKey = "q" } = {}) {
  let t;
  const q = root.querySelector("#q");
  if (q) q.addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state[searchKey] = norm(e.target.value); state.qRaw = e.target.value; onChange(); }, 150); });
  for (const [id, key] of Object.entries(selects)) {
    const el = root.querySelector("#" + id);
    el.addEventListener("change", (e) => { state[key] = e.target.value; e.target.classList.toggle("on", !!e.target.value && key !== "sort"); onChange(); });
  }
  if (chipsId) root.querySelector("#" + chipsId).addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state[chipsKey] = chip.dataset.v;
    root.querySelectorAll(`#${chipsId} .chip`).forEach((c) => c.setAttribute("aria-pressed", c.dataset.v === state[chipsKey]));
    onChange();
  });
}

// Detail pane with a header and tabs. `tabs`: [[key, label, icon, count|null, render()]].
// `tabState` is an object {tab} kept by the section so the chosen tab survives navigation.
export function renderDetail(pane, headHtml, tabs, tabState, after) {
  if (!tabs.some((t) => t[0] === tabState.tab)) tabState.tab = tabs[0][0];
  pane.innerHTML = `
    <div class="d-head fade">${headHtml}</div>
    <nav class="d-tabs" role="tablist">
      ${tabs.map(([k, l, ic, n]) => `<button role="tab" data-tab="${k}" aria-selected="${k === tabState.tab}" class="${n === 0 ? "zero" : ""}">${icon(ic)}${l}${n !== null && n !== undefined ? `<span>${fmtN(n)}</span>` : ""}</button>`).join("")}
    </nav>
    <div class="d-body" id="d-body"></div>`;
  pane.scrollTop = 0;
  const body = () => {
    const el = pane.querySelector("#d-body");
    el.innerHTML = tabs.find((t) => t[0] === tabState.tab)[4]();
    el.classList.remove("fade"); void el.offsetWidth; el.classList.add("fade");
    after?.(tabState.tab, el);
  };
  pane.querySelector(".d-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    tabState.tab = btn.dataset.tab;
    pane.querySelectorAll(".d-tabs button").forEach((x) => x.setAttribute("aria-selected", x === btn));
    body();
    const bar = pane.querySelector(".d-tabs");
    if (pane.scrollTop > bar.offsetTop) pane.scrollTop = bar.offsetTop;
  });
  body();
}

// Mobile only (hidden on desktop): back to the section's list.
export const backBtn = (listRoute) => `<a class="d-back" href="#/${listRoute}">${icon("back")}Volver a la lista</a>`;

// Small table of bills (used by deputies, organs and news).
export function billsTable(list, extraCols = []) {
  return `<table class="tbl"><thead><tr><th>Expediente</th><th>Nombre</th>${extraCols.map((c) => `<th>${c[0]}</th>`).join("")}</tr></thead><tbody>
    ${list.map((b) => {
      const st = statusOf(b.status);
      return `<tr class="${b.in_corpus ? "" : "off"}">
        <td class="num">${link.billMaybe(b.bill_number, b.in_corpus)}</td>
        <td>${b.in_corpus ? `<div class="clamp2">${esc(b.name)}</div><div class="sub-line"><span class="pill dot ${st.cls}">${st.label}</span> ${fmtDate(b.date_proposed)}</div>` : `<span class="muted">Fuera del corpus</span>`}</td>
        ${extraCols.map((c) => `<td class="${c[2] || ""}">${c[1](b)}</td>`).join("")}
      </tr>`;
    }).join("")}
  </tbody></table>`;
}
