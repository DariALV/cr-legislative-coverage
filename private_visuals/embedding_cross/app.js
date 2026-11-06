// Renders news cards with their top related bills. Data: window.EMBEDDING_CROSS from data.js.
// To stay light with thousands of news: cards are added in batches while scrolling, and each card
// only builds its full list of bills when expanded.
(() => {
  const BATCH = 30;
  const PREVIEW = 5;
  const BILL_URL = "https://delfino.cr/asamblea/proyecto/";
  const OUTLETS = {
    crhoy: { name: "CRHoy", color: "var(--crhoy)" },
    nacion: { name: "La Nación", color: "var(--nacion)" },
    delfino: { name: "Delfino", color: "var(--delfino)" },
    elmundo: { name: "El Mundo", color: "var(--elmundo)" },
    semanario: { name: "Semanario Universidad", color: "var(--semanario)" },
  };

  const $ = (id) => document.getElementById(id);
  const data = window.EMBEDDING_CROSS;
  if (!data) { $("nodata").hidden = false; return; }

  const bills = data.bills;
  const news = data.news.map((n) => {
    const m = n.matches;
    const top5 = m.slice(0, PREVIEW);
    return {
      ...n,
      best: m.length ? m[0][1] : 0,
      mean: top5.length ? top5.reduce((s, x) => s + x[1], 0) / top5.length : 0,
      haystack: (n.title + " " + m.map((x) => x[0] + " " + (bills[x[0]]?.name || "")).join(" ")).toLowerCase(),
      titleLow: n.title.toLowerCase(),
    };
  });

  const state = { q: "", min: 0, sort: "score", outlets: new Set(Object.keys(OUTLETS)) };
  let filtered = [];
  let shown = 0;
  // Loads the next batch when the end of the list is within 800px of the viewport.
  const nearEnd = () => $("sentinel").getBoundingClientRect().top < innerHeight + 800;
  const onScroll = () => { if (nearEnd()) renderMore(); };

  // ---------- helpers ----------
  const fmtScore = (s) => s.toFixed(3);
  const band = (s) => (s >= 0.8 ? "hi" : s >= 0.6 ? "mid" : "lo");
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("es-CR", { day: "numeric", month: "short", year: "numeric" });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (id) => `<svg><use href="#i-${id}"/></svg>`;
  const highlight = (text) => {
    const safe = esc(text);
    if (!state.q) return safe;
    const re = new RegExp(state.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return safe.replace(re, (m) => `<mark>${m}</mark>`);
  };
  const outletOf = (key) => OUTLETS[key] || { name: key, color: "var(--ink-3)" };

  // ---------- header ----------
  const meta = data.meta || {};
  $("test-badge").hidden = !meta.test_data;
  if (meta.model) $("subtitle").textContent = `Modelo: ${meta.model} · top ${meta.top_k} por noticia`;
  const allScores = news.flatMap((n) => n.matches.map((m) => m[1]));
  const explicit = news.reduce((s, n) => s + n.matches.filter((m) => m[2]).length, 0);
  $("stats").innerHTML = [
    ["Noticias", news.length.toLocaleString("es-CR")],
    ["Expedientes distintos", Object.keys(bills).length.toLocaleString("es-CR")],
    ["Conexiones", allScores.length.toLocaleString("es-CR")],
    ["Enlaces explícitos", explicit.toLocaleString("es-CR")],
  ].map(([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${v}</dd></div>`).join("");

  // ---------- outlet chips ----------
  const counts = {};
  news.forEach((n) => (counts[n.outlet] = (counts[n.outlet] || 0) + 1));
  $("outlets").innerHTML = Object.entries(OUTLETS)
    .filter(([k]) => counts[k])
    .map(([k, o]) => `<button class="chip" data-outlet="${k}" aria-pressed="true" style="--c:${o.color}"><i></i>${o.name}<span>${counts[k]}</span></button>`)
    .join("");
  $("outlets").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const k = chip.dataset.outlet;
    // Alt/Ctrl click: show only this outlet.
    if (e.altKey || e.ctrlKey || e.metaKey) {
      state.outlets = new Set([k]);
    } else if (state.outlets.has(k)) state.outlets.delete(k);
    else state.outlets.add(k);
    document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", state.outlets.has(c.dataset.outlet)));
    apply();
  });

  // ---------- rendering ----------
  function matchRow(m, i) {
    const [num, score, link] = m;
    const b = bills[num] || { name: "(expediente sin datos)" };
    const tags = [
      link ? `<span class="tag link">${icon("link")}Enlace explícito</span>` : "",
      b.status ? `<span class="tag">${esc(b.status)}</span>` : "",
      b.commission && b.commission !== "-" ? `<span>${esc(b.commission)}</span>` : "",
    ].join("");
    return `<li class="match">
      <span class="pos">${i + 1}</span>
      <a class="num" href="${BILL_URL}${num}" target="_blank" rel="noopener">${highlight(String(num))}</a>
      <div class="name"><strong title="${esc(b.name)}">${highlight(b.name)}</strong><div class="tags">${tags}</div></div>
      <div class="score ${band(score)}"><span class="bar"><i style="width:${Math.round(score * 100)}%"></i></span><b>${fmtScore(score)}</b></div>
    </li>`;
  }

  function visibleMatches(n) {
    return state.min ? n.matches.filter((m) => m[1] >= state.min) : n.matches;
  }

  function distribution(ms) {
    // Tiny histogram of the remaining scores, 10 buckets between the threshold and 1.
    const buckets = new Array(10).fill(0);
    ms.forEach((m) => buckets[Math.min(9, Math.floor(m[1] * 10))]++);
    const max = Math.max(...buckets, 1);
    return buckets.map((c, i) => c ? `<i class="${band(i / 10 + 0.05)}" style="height:${2 + (c / max) * 12}px;background:var(--sc)"></i>` : `<i style="height:2px;opacity:.25;background:var(--lo)"></i>`).join("");
  }

  function card(n, rank) {
    const o = outletOf(n.outlet);
    const ms = visibleMatches(n);
    const rest = ms.length - PREVIEW;
    const el = document.createElement("article");
    el.className = "card";
    el.style.setProperty("--c", o.color);
    el.innerHTML = `
      <div class="card-head">
        <div>
          <div class="meta">
            <span class="outlet" style="--c:${o.color}">${icon("news")}${esc(o.name)}</span>
            <span class="date">${icon("calendar")}${fmtDate(n.date)}</span>
            ${n.section ? `<span>${esc(n.section)}</span>` : ""}
            <span class="rank">#${rank}</span>
          </div>
          <h2 class="title"><a href="${esc(n.url)}" target="_blank" rel="noopener">${highlight(n.title)}</a>${icon("external")}</h2>
        </div>
        <div class="best ${band(n.best)}"><div class="num" style="color:var(--sc)">${fmtScore(n.best)}</div><div class="lbl">mejor score</div></div>
      </div>
      <ul class="matches">${ms.slice(0, PREVIEW).map(matchRow).join("")}</ul>
      ${rest > 0 ? `<button class="more" aria-expanded="false">${icon("chevron")}<span>Ver los ${ms.length} expedientes</span><span class="dist">${distribution(ms.slice(PREVIEW))}</span></button>` : ""}
    `;
    const btn = el.querySelector(".more");
    if (btn) {
      let extra = null;
      btn.addEventListener("click", () => {
        const open = btn.getAttribute("aria-expanded") === "true";
        if (!open) {
          if (!extra) {
            // Built only on first open.
            extra = document.createElement("ul");
            extra.className = "matches";
            extra.style.borderTop = "0";
            extra.style.marginTop = "0";
            extra.innerHTML = ms.slice(PREVIEW).map((m, i) => matchRow(m, i + PREVIEW)).join("");
            el.querySelector(".matches").after(extra);
          }
          extra.hidden = false;
          btn.querySelector("span").textContent = "Mostrar solo el top " + PREVIEW;
        } else {
          extra.hidden = true;
          btn.querySelector("span").textContent = `Ver los ${ms.length} expedientes`;
          if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
        }
        btn.setAttribute("aria-expanded", String(!open));
      });
    }
    return el;
  }

  function renderMore() {
    if (shown >= filtered.length) return;
    const frag = document.createDocumentFragment();
    filtered.slice(shown, shown + BATCH).forEach((n, i) => frag.appendChild(card(n, shown + i + 1)));
    shown += BATCH;
    $("list").appendChild(frag);
  }

  function apply() {
    const q = state.q;
    filtered = news.filter((n) =>
      state.outlets.has(n.outlet) &&
      n.best >= state.min &&
      (!q || n.haystack.includes(q))
    );
    const key = state.sort;
    filtered.sort(key === "date" ? (a, b) => b.date.localeCompare(a.date) : (a, b) => b[key === "mean" ? "mean" : "best"] - a[key === "mean" ? "mean" : "best"]);
    $("list").innerHTML = "";
    shown = 0;
    renderMore();
    $("empty").hidden = filtered.length > 0;
    $("result-line").textContent = filtered.length
      ? `${filtered.length.toLocaleString("es-CR")} noticias · ordenadas por ${{ score: "mejor score", mean: "promedio del top 5", date: "fecha" }[key]}`
      : "";
  }

  // ---------- controls ----------
  let t;
  $("q").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); apply(); }, 180);
  });
  $("min").addEventListener("input", (e) => { $("min-val").textContent = Number(e.target.value).toFixed(2); });
  $("min").addEventListener("change", (e) => { state.min = Number(e.target.value); apply(); });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; apply(); });

  const toTop = $("to-top");
  addEventListener("scroll", () => { toTop.hidden = scrollY < 900; onScroll(); }, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  toTop.addEventListener("click", () => scrollTo({ top: 0 }));

  apply();
})();
