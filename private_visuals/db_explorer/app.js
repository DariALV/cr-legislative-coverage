// Explorer for private_corpus.db. The list of bills is loaded once (/api/bills) and filtered in the
// browser; the detail of each bill comes from /api/bill/<n>. Routing by hash: #/bill/23000.
(() => {
  const BATCH = 40;
  const DELFINO = "https://delfino.cr/asamblea/proyecto/";
  const STATUS = {
    "in progress": { label: "En trámite", cls: "st-progress", color: "var(--progress)" },
    law: { label: "Ley", cls: "st-law", color: "var(--law)" },
    archived: { label: "Archivado", cls: "st-archived", color: "var(--archived)" },
  };
  const FLAG = { administrative: "Administrativo", honorific: "Honorífico" };
  const TEXT = {
    ok: { label: "Con exposición", cls: "st-law" },
    no_exposition: { label: "Sin exposición", cls: "st-warn" },
    no_text: { label: "Sin texto", cls: "st-bad" },
  };
  const OUTLETS = {
    crhoy: { name: "CRHoy", color: "var(--crhoy)" },
    nacion: { name: "La Nación", color: "var(--nacion)" },
    delfino: { name: "Delfino", color: "var(--delfino)" },
    elmundo: { name: "El Mundo", color: "var(--elmundo)" },
    semanario: { name: "Semanario Universidad", color: "var(--semanario)" },
  };
  const VOTE_COLORS = { a_favor: "var(--law)", "a favor": "var(--law)", en_contra: "var(--bad)", "en contra": "var(--bad)" };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (id) => `<svg><use href="#i-${id}"/></svg>`;
  const fmtN = (n) => Number(n || 0).toLocaleString("es-CR");
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const fmtDate = (iso, long) => {
    if (!iso) return "—";
    const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("es-CR", long ? { day: "numeric", month: "long", year: "numeric" } : { day: "2-digit", month: "short", year: "numeric" });
  };
  const shortType = (t) => (t || "").replace(/^PROCEDIMIENTO\s+(DE\s+)?/i, "").replace(/^PROYECTOS?\s+(DE\s+)?/i, "").toLowerCase().replace(/^./, (c) => c.toUpperCase());
  const statusOf = (s) => STATUS[s] || { label: s || "—", cls: "st-neutral", color: "var(--line-strong)" };
  const titleCase = (s) => (s || "").toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  const initials = (name) => (name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("");
  const toast = (msg) => {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 1400);
  };

  let BILLS = [];
  const byNumber = new Map();
  const state = { q: "", status: "", type: "", flag: "", text: "", extra: "", sort: "num" };
  let filtered = [];
  let shown = 0;
  let current = null;

  // ---------- boot ----------
  const setToolbarH = () => document.documentElement.style.setProperty("--toolbar-h", document.querySelector(".toolbar").offsetHeight + "px");
  addEventListener("resize", setToolbarH);
  setToolbarH();

  fetch("/api/bills").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((data) => {
    BILLS = data.bills;
    BILLS.forEach((b) => byNumber.set(b.n, b));
    header(data.totals);
    controls();
    apply();
    route();
  }).catch(() => {
    $("layout").hidden = true;
    document.querySelector(".toolbar").hidden = true;
    $("error").hidden = false;
  });

  function header(t) {
    const count = (k) => BILLS.filter((b) => b.status === k).length;
    $("stats").innerHTML = [
      ["Expedientes", fmtN(t.bills)],
      ["Leyes", fmtN(count("law"))],
      ["En trámite", fmtN(count("in progress"))],
      ["Trámites", fmtN(t.steps)],
      ["Enlaces a noticias", fmtN(t.news_links)],
    ].map(([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  }

  function controls() {
    const counts = {};
    BILLS.forEach((b) => (counts[b.status] = (counts[b.status] || 0) + 1));
    const chips = [["", "Todos", "var(--ink)", BILLS.length], ...Object.entries(STATUS).map(([k, s]) => [k, s.label, s.color, counts[k] || 0])];
    $("status-chips").innerHTML = chips.map(([k, l, c, n]) =>
      `<button class="chip" data-status="${k}" aria-pressed="${k === state.status}" style="--c:${c}">${k ? "<i></i>" : ""}${l}<span>${fmtN(n)}</span></button>`).join("");
    $("status-chips").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      state.status = chip.dataset.status;
      document.querySelectorAll("#status-chips .chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.status === state.status));
      apply();
    });

    const types = {};
    BILLS.forEach((b) => (types[b.type] = (types[b.type] || 0) + 1));
    $("f-type").innerHTML = `<option value="">Todo tipo</option>` + Object.entries(types).sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `<option value="${esc(t)}">${esc(shortType(t))} (${fmtN(n)})</option>`).join("");

    const bind = (id, key) => $(id).addEventListener("change", (e) => {
      state[key] = e.target.value;
      e.target.classList.toggle("on", !!e.target.value && key !== "sort");
      apply();
    });
    bind("f-type", "type"); bind("f-flag", "flag"); bind("f-text", "text"); bind("f-extra", "extra"); bind("sort", "sort");

    let t;
    $("q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.q = norm(e.target.value); apply(); }, 120); });
    $("q").addEventListener("keydown", (e) => {
      // Enter on an exact number opens it.
      if (e.key === "Enter" && /^\d+$/.test(e.target.value.trim())) {
        const n = +e.target.value.trim();
        if (byNumber.has(n)) location.hash = `#/bill/${n}`;
      }
    });
    addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== $("q")) { e.preventDefault(); $("q").focus(); $("q").select(); }
      if (e.key === "Escape" && document.activeElement === $("q")) $("q").blur();
      if ((e.key === "j" || e.key === "k") && document.activeElement === document.body && current) step(e.key === "j" ? 1 : -1);
    });
    addEventListener("scroll", () => { if (nearEnd()) renderMore(); }, { passive: true });
    addEventListener("hashchange", route);
  }

  // j/k: move to the next/previous bill in the filtered list.
  function step(d) {
    const i = filtered.findIndex((b) => b.n === current);
    const next = filtered[i + d];
    if (next) location.hash = `#/bill/${next.n}`;
  }

  // ---------- list ----------
  const nearEnd = () => $("sentinel").getBoundingClientRect().top < innerHeight + 600;

  function apply() {
    const words = state.q ? state.q.split(/\s+/) : [];
    filtered = BILLS.filter((b) =>
      (!state.status || b.status === state.status) &&
      (!state.type || b.type === state.type) &&
      (!state.flag || (state.flag === "none" ? !b.flag : b.flag === state.flag)) &&
      (!state.text || b.text === state.text) &&
      (!state.extra || (state.extra === "news" ? b.news > 0 : state.extra === "votes" ? b.votes > 0 : !!b.law)) &&
      words.every((w) => b.hay.includes(w)));
    const s = state.sort;
    const cmp = {
      num: (a, b) => b.n - a.n,
      "num-asc": (a, b) => a.n - b.n,
      date: (a, b) => (b.date || "").localeCompare(a.date || "") || b.n - a.n,
      news: (a, b) => b.news - a.news || b.n - a.n,
      steps: (a, b) => b.steps - a.steps || b.n - a.n,
    }[s];
    filtered.sort(cmp);
    // An exact number match goes first.
    if (/^\d+$/.test(state.q)) {
      const i = filtered.findIndex((b) => String(b.n) === state.q);
      if (i > 0) filtered.unshift(filtered.splice(i, 1)[0]);
    }
    $("result-line").textContent = `${fmtN(filtered.length)} expediente${filtered.length === 1 ? "" : "s"}` +
      (filtered.length !== BILLS.length ? ` de ${fmtN(BILLS.length)}` : "");
    $("list").innerHTML = "";
    shown = 0;
    $("empty").hidden = filtered.length > 0;
    renderMore();
    while (shown < filtered.length && nearEnd()) renderMore();
  }

  function hl(text) {
    const safe = esc(text);
    if (!state.q) return safe;
    // Accent-insensitive highlight: map each normalized word back onto the original string.
    const src = String(text ?? "");
    const n = norm(src);
    if (n.length !== src.length) return safe;
    const marks = new Array(src.length).fill(false);
    state.q.split(/\s+/).filter(Boolean).forEach((w) => {
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

  function rowHtml(b) {
    const st = statusOf(b.status);
    const who = b.props.length ? b.props.map(titleCase).join(", ") + (b.nprops > b.props.length ? ` +${b.nprops - b.props.length}` : "") : "Sin proponentes";
    return `<button class="row${b.n === current ? " active" : ""}" data-n="${b.n}" role="listitem" style="--c:${st.color}">
      <div class="row-top">
        <span class="num">${hl(String(b.n))}</span>
        <span class="pill dot ${st.cls}">${st.label}${b.law ? ` · ${b.law}` : ""}</span>
        ${b.flag ? `<span class="pill st-neutral">${FLAG[b.flag] || b.flag}</span>` : ""}
        <span class="date">${fmtDate(b.date)}</span>
      </div>
      <p class="row-name">${hl(b.name)}</p>
      <div class="row-foot">
        <span class="who">${hl(who)}</span>
        ${b.news ? `<span class="mini" title="Noticias enlazadas">${icon("news")}${b.news}</span>` : ""}
        ${b.votes ? `<span class="mini" title="Votaciones">${icon("vote")}${b.votes}</span>` : ""}
        ${b.text && b.text !== "ok" ? `<span class="mini" title="${TEXT[b.text]?.label}">${icon("doc")}${TEXT[b.text]?.label}</span>` : ""}
      </div>
    </button>`;
  }

  function renderMore() {
    if (shown >= filtered.length) return;
    $("list").insertAdjacentHTML("beforeend", filtered.slice(shown, shown + BATCH).map(rowHtml).join(""));
    shown += BATCH;
  }

  $("list").addEventListener("click", (e) => {
    const row = e.target.closest(".row");
    if (row) location.hash = `#/bill/${row.dataset.n}`;
  });

  // ---------- routing ----------
  function route() {
    const m = location.hash.match(/^#\/bill\/(\d+)/);
    if (m) openBill(+m[1]);
    else {
      current = null;
      $("layout").classList.remove("show-detail");
      document.querySelectorAll(".row.active").forEach((r) => r.classList.remove("active"));
    }
  }

  // ---------- detail ----------
  const cache = new Map();
  let tab = "resumen";

  async function openBill(n) {
    current = n;
    document.querySelectorAll(".row.active").forEach((r) => r.classList.remove("active"));
    const row = document.querySelector(`.row[data-n="${n}"]`);
    if (row) { row.classList.add("active"); row.scrollIntoView({ block: "nearest" }); }
    $("layout").classList.add("show-detail");
    const pane = $("detail");
    if (!cache.has(n)) {
      pane.innerHTML = `<div class="loading"><div class="spin"></div>Cargando expediente ${n}…</div>`;
      try {
        const r = await fetch(`/api/bill/${n}`);
        if (!r.ok) throw new Error(r.status);
        cache.set(n, await r.json());
      } catch {
        pane.innerHTML = `<div class="empty-tab">${icon("empty")}No se encontró el expediente ${n}.</div>`;
        return;
      }
    }
    if (current !== n) return;
    renderDetail(cache.get(n));
  }

  function renderDetail(d) {
    const b = d.bill;
    const st = statusOf(b.status);
    const counts = {
      resumen: null,
      texto: d.text?.status === "ok" ? 1 : 0,
      proponentes: d.proponents.length,
      tramite: d.steps.length,
      comisiones: d.organs.length,
      votaciones: d.votes.length,
      noticias: d.news.length,
    };
    const TABS = [
      ["resumen", "Resumen", "doc"], ["texto", "Texto", "doc"], ["proponentes", "Proponentes", "users"],
      ["tramite", "Trámite", "steps"], ["comisiones", "Comisiones", "building"], ["votaciones", "Votaciones", "vote"],
      ["noticias", "Noticias", "news"],
    ];
    const expiryBad = b.date_expiry && b.date_proposed && b.date_expiry < b.date_proposed;
    const pane = $("detail");
    pane.innerHTML = `
      <div class="d-head fade">
        <button class="d-back" id="d-back">${icon("back")}Volver a la lista</button>
        <div class="d-meta">
          <button class="d-num" id="d-copy" title="Copiar número">${b.number}${icon("copy")}</button>
          <span class="pill dot ${st.cls}">${st.label}</span>
          ${b.flag ? `<span class="pill st-neutral">${FLAG[b.flag] || b.flag}</span>` : ""}
          ${d.text ? `<span class="pill ${TEXT[d.text.status]?.cls || "st-neutral"}">${TEXT[d.text.status]?.label || d.text.status}</span>` : ""}
          <span>${esc(shortType(b.file_type))}</span>
        </div>
        <h2 class="d-title">${esc(b.name)}</h2>
        <div class="d-links">
          <a href="${DELFINO}${b.number}" target="_blank" rel="noopener">${icon("external")}Delfino</a>
        </div>
        <dl class="facts">
          ${fact("Presentado", fmtDate(b.date_proposed, true))}
          ${fact("Vencimiento", fmtDate(b.date_expiry, true), expiryBad)}
          ${fact("Plazo cuatrienal", fmtDate(b.date_expiry_four_year, true))}
          ${b.law_number ? fact("Número de ley", b.law_number) : ""}
          ${b.archive_number ? fact("Número de archivo", b.archive_number) : ""}
          ${fact("Extraído", fmtDate(b.date_extracted))}
        </dl>
      </div>
      <nav class="d-tabs" role="tablist">
        ${TABS.map(([k, l, ic]) => `<button role="tab" data-tab="${k}" aria-selected="${k === tab}" class="${counts[k] === 0 ? "zero" : ""}">${icon(ic)}${l}${counts[k] !== null && k !== "texto" ? `<span>${counts[k]}</span>` : ""}</button>`).join("")}
      </nav>
      <div class="d-body" id="d-body"></div>`;
    pane.scrollTop = 0;
    $("d-back").onclick = () => { location.hash = "#/"; };
    $("d-copy").onclick = () => navigator.clipboard?.writeText(String(b.number)).then(() => toast("Número copiado"));
    pane.querySelector(".d-tabs").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-tab]");
      if (!btn) return;
      tab = btn.dataset.tab;
      pane.querySelectorAll(".d-tabs button").forEach((x) => x.setAttribute("aria-selected", x === btn));
      body(d);
      const tabs = pane.querySelector(".d-tabs");
      if (pane.scrollTop > tabs.offsetTop) pane.scrollTop = tabs.offsetTop;
    });
    body(d);
  }

  const fact = (k, v, bad) => `<div class="fact"><dt>${k}</dt><dd class="${bad ? "bad" : ""}" ${bad ? 'title="Fecha anterior a la presentación (dato del SIL)"' : ""}>${esc(v)}</dd></div>`;
  const emptyTab = (ic, msg) => `<div class="empty-tab">${icon(ic)}${msg}</div>`;

  function body(d) {
    const el = $("d-body");
    el.innerHTML = ({ resumen, texto, proponentes, tramite, comisiones, votaciones, noticias }[tab] || resumen)(d);
    el.classList.remove("fade"); void el.offsetWidth; el.classList.add("fade");
    if (tab === "texto") {
      const more = $("prose-more");
      if (more) more.onclick = () => { $("prose").classList.remove("clamped"); more.remove(); };
    }
    if (tab === "noticias") el.querySelectorAll("[data-news]").forEach((btn) => btn.onclick = () => loadNews(btn));
  }

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
        <p class="muted" style="margin:2px 0 0">${esc(last.organ || "")} · ${fmtDate(last.date_start, true)}</p>`);
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
    const palette = ["var(--accent)", "var(--law)", "var(--progress)", "var(--delfino)", "var(--semanario)", "var(--crhoy)"];
    const colorOf = (s) => palette[[...(s || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % palette.length];
    return `<ul class="people">${d.proponents.map((p) => {
      const sub = [p.faction && titleCase(p.faction), p.province && titleCase(p.province), p.term].filter(Boolean).join(" · ");
      return `<li class="person">
        <span class="avatar" style="--c:${colorOf(p.faction || p.name)}">${esc(initials(p.name))}</span>
        <div><div class="nm">${esc(titleCase(p.name))}</div><div class="sm">${esc(sub || (p.deputy_id ? "" : "No es diputado"))}</div></div>
        <span class="ord">${p.signing_order ?? ""}</span>
      </li>`;
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
      return `<li class="tl${gap ? " group-gap" : ""}" style="--c:${organColor(s.organ)}">
        <span class="tl-date${bad ? " bad" : ""}" ${bad ? 'title="Anterior a la presentación (dato del SIL)"' : ""}>${s.date_start || "—"}</span>
        <div><div class="tl-desc">${esc(s.description)}</div>
          <span class="tl-org">${esc(s.organ || "")}</span>${s.date_end && s.date_end !== s.date_start ? `<span class="tl-end">hasta ${s.date_end}</span>` : ""}</div>
      </li>`;
    }).join("")}</ol>`;
  }

  function comisiones(d) {
    if (!d.organs.length) return emptyTab("building", "El expediente no aparece en la agenda de ningún órgano (organ_bills).");
    return `<table class="tbl"><thead><tr><th>Órgano</th><th>Ingreso</th><th>Salida</th><th>Último paso</th></tr></thead><tbody>
      ${d.organs.map((o) => `<tr>
        <td><div style="font-weight:550">${esc(titleCase(o.name || String(o.organ_code)))}</div><div class="muted" style="font-size:12px">${esc(titleCase(o.organ_type || ""))}${o.organ_status ? " · " + esc(titleCase(o.organ_status)) : ""}</div></td>
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
      const col = (k, i) => VOTE_COLORS[norm(k)] || ["var(--progress)", "var(--archived)", "var(--delfino)"][i % 3];
      return `<div class="vote">
        <div class="news-meta"><span>${fmtDate(v.date, true)}</span>${v.result ? `<span class="pill st-neutral">${esc(v.result)}</span>` : ""}
          ${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener" style="margin-left:auto;color:var(--accent)">Ver ${icon("external")}</a>` : ""}</div>
        <div class="news-title">${esc(v.name)}</div>
        ${v.description ? `<p class="news-snippet">${esc(v.description)}</p>` : ""}
        ${entries.length ? `<div class="vote-bar">${entries.map(([k, n], i) => `<i style="width:${(n / total) * 100}%;background:${col(k, i)}"></i>`).join("")}</div>
        <div class="vote-legend">${entries.map(([k, n], i) => `<span><span class="sw" style="background:${col(k, i)}"></span>${esc(k)} <b>${n}</b></span>`).join("")}</div>` : ""}
      </div>`;
    }).join("");
  }

  function noticias(d) {
    if (!d.news.length) return emptyTab("news", "Ninguna noticia enlazada a este expediente.");
    return `<ul class="news">${d.news.map((a) => {
      const o = OUTLETS[a.organization] || { name: a.organization, color: "var(--ink-3)" };
      const snippet = a.description || a.snippet || "";
      return `<li class="news-item" style="--c:${o.color}">
        <div class="news-meta">
          <span class="outlet" style="--c:${o.color}">${icon("news")}${esc(o.name)}</span>
          <span>${fmtDate(a.date_published)}</span>
          ${a.section ? `<span>${esc(a.section)}</span>` : ""}
          ${a.author ? `<span>${esc(a.author)}</span>` : ""}
        </div>
        <h4 class="news-title"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>${icon("external")}</h4>
        ${snippet ? `<p class="news-snippet" data-snip>${esc(snippet.length > 300 ? snippet.slice(0, 300) + "…" : snippet)}</p>` : ""}
        ${a.content_len > 300 ? `<button class="linkbtn" data-news="${esc(a.id)}">Leer contenido (${fmtN(a.content_len)} caracteres)</button>` : ""}
      </li>`;
    }).join("")}</ul>`;
  }

  async function loadNews(btn) {
    btn.textContent = "Cargando…";
    try {
      const r = await fetch(`/api/news/${encodeURIComponent(btn.dataset.news)}`);
      const a = await r.json();
      const item = btn.closest(".news-item");
      let p = item.querySelector("[data-snip]");
      if (!p) { p = document.createElement("p"); p.className = "news-snippet"; btn.before(p); }
      p.textContent = a.content || "";
      btn.remove();
    } catch { btn.textContent = "No se pudo cargar"; }
  }
})();
