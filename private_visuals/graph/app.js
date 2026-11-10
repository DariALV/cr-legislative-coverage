// Bills graph (#69): every bill linked to its most similar bills, colored by topic,
// press coverage or status. Data comes from build_graph.py (window.GRAPH_BILLS).
(function () {
  "use strict";
  const D = window.GRAPH_BILLS;
  const $ = (id) => document.getElementById(id);
  if (!D) {
    $("missing").hidden = false;
    return;
  }

  const nf = (n) => n.toLocaleString("es-CR");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const sentence = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

  // ---------- colors ----------
  // Eight categorical hues stepped for the dark surface. Topics outnumber them, so the build
  // gives neighboring topics different slots and the map labels carry the identity.
  const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
  const NO_COVERAGE = "#63635d";
  const OLD = "#2f2f2c";
  const STANCE = d3.scaleLinear().domain([0, 4, 8]).range(["#d9435e", "#cfccc2", "#23a878"]).interpolate(d3.interpolateLab);
  // Stance 0-100 (50 is neutral) in nine steps; most bills sit between 30 and 80.
  const stanceBin = (stance) => Math.round(Math.max(0, Math.min(1, (stance - 15) / 70)) * 8);
  const STATUS = {
    "in progress": { label: "En trámite", color: PALETTE[0] },
    law: { label: "Ley", color: PALETTE[2] },
    archived: { label: "Archivado", color: PALETTE[1] },
  };
  const OLD_YEARS = 4;

  // ---------- nodes ----------
  const asOf = new Date(D.meta.as_of);
  const nodes = D.nodes.map((row, i) => {
    const [number, name, type, date, status, law, topic, mention, substantive, main, outlets, stance, x, y] = row;
    const age = date ? (asOf - new Date(date)) / (365.25 * 864e5) : null;
    const readable = sentence(name);
    return {
      i, number, name, type: D.types[type] || "", date, status: D.statuses[status] || "", law, topic,
      mention, substantive, main, outlets, stance, age, old: age != null && age > OLD_YEARS,
      x, y,
      size: 3.2 + 1.1 * Math.sqrt(substantive),
      shortLabel: String(number),
      label: `${number} · ${cut(readable, 46)}`,
      search: norm(`${number} ${name}`),
    };
  });
  const links = D.links.map(([a, b, w]) => ({ source: nodes[a], target: nodes[b], w }));

  // ---------- color modes ----------
  // Each mode says how to color a node and which legend group it falls in.
  const coverageGroup = (n) => {
    if (!n.substantive) return n.old ? "old" : "none";
    const bin = stanceBin(n.stance ?? 50);
    return bin <= 2 ? "against" : bin >= 6 ? "favor" : "neutral";
  };
  const MODES = {
    topic: {
      label: "Tema",
      note: "Temas: comunidades del grafo de similitud, nombradas con sus descriptores del SIL más propios. Los colores se repiten entre temas lejanos.",
      color: (n) => PALETTE[D.topics[n.topic].color],
      group: (n) => n.topic,
      legend: D.topics.map((t, i) => ({ key: i, label: t.name, color: PALETTE[t.color] })),
    },
    coverage: {
      label: "Cobertura",
      note: "Tono: promedio del puntaje de postura de Jev en las noticias con cobertura sustantiva del expediente.",
      color: (n) => (n.substantive ? STANCE(stanceBin(n.stance ?? 50)) : n.old ? OLD : NO_COVERAGE),
      group: coverageGroup,
      legend: [
        { key: "against", label: "Prensa en contra", color: STANCE(1) },
        { key: "neutral", label: "Prensa neutral o dividida", color: STANCE(4) },
        { key: "favor", label: "Prensa a favor", color: STANCE(7) },
        { key: "none", label: "Sin cobertura", color: NO_COVERAGE },
        { key: "old", label: `Sin cobertura y más de ${OLD_YEARS} años`, color: OLD, outline: true },
      ],
      scale: true,
    },
    status: {
      label: "Estado",
      note: `Estado en el SIL al ${D.meta.as_of}.`,
      color: (n) => (STATUS[n.status] || { color: NO_COVERAGE }).color,
      group: (n) => n.status,
      legend: Object.entries(STATUS).map(([key, s]) => ({ key, label: s.label, color: s.color })),
    },
  };

  // ---------- state ----------
  const S = { mode: "topic", isolated: new Set(), query: "", showUncovered: true, showOld: true };
  const graph = new ForceGraph($("graph"));
  graph.groups = D.topics.map((t, i) => ({ label: t.name, nodes: nodes.filter((n) => n.topic === i) }));
  graph.setData(nodes, links);

  function applyColors() {
    const mode = MODES[S.mode];
    for (const n of nodes) n.color = mode.color(n);
    graph.colorsChanged();
  }

  function matches() {
    const q = norm(S.query.trim());
    return q ? nodes.filter((n) => n.visible && n.search.includes(q)) : null;
  }

  function applyHighlight() {
    const mode = MODES[S.mode];
    const found = matches();
    let set = null;
    if (found || S.isolated.size) {
      set = new Set((found || nodes).filter((n) => n.visible && (!S.isolated.size || S.isolated.has(mode.group(n)))));
      if (!set.size) set = new Set([{}]);  // nothing matches: dim everything
    }
    graph.setHighlight(set);
    $("search-count").textContent = found ? `${nf(found.length)} ${found.length === 1 ? "coincidencia" : "coincidencias"}` : "";
  }

  function applyFilters() {
    graph.setVisible((n) => (S.showUncovered || n.substantive > 0) && (S.showOld || !n.old));
    renderLegend();
    applyHighlight();
    renderSubtitle();
  }

  // ---------- legend ----------
  function renderLegend() {
    const mode = MODES[S.mode];
    const counts = new Map();
    for (const n of nodes) if (n.visible) counts.set(mode.group(n), (counts.get(mode.group(n)) || 0) + 1);
    $("legend").innerHTML = mode.legend.map((item) => `
      <button class="legend-item${S.isolated.has(item.key) ? " on" : ""}${S.isolated.size && !S.isolated.has(item.key) ? " off" : ""}"
              data-key="${esc(item.key)}" ${counts.get(item.key) ? "" : "disabled"}>
        <span class="swatch${item.outline ? " outline" : ""}" style="background:${item.color}"></span>
        <span class="legend-label">${esc(item.label)}</span>
        <span class="legend-count">${nf(counts.get(item.key) || 0)}</span>
      </button>`).join("");
    $("scale").hidden = !mode.scale;
    $("legend-note").textContent = mode.note;
    $("legend-clear").hidden = !S.isolated.size;
  }

  $("legend").addEventListener("click", (e) => {
    const item = e.target.closest(".legend-item");
    if (!item) return;
    const raw = item.dataset.key;
    const key = S.mode === "topic" ? +raw : raw;
    if (S.isolated.has(key)) S.isolated.delete(key); else S.isolated.add(key);
    renderLegend();
    applyHighlight();
  });
  $("legend-clear").addEventListener("click", () => { S.isolated.clear(); renderLegend(); applyHighlight(); });

  $("modes").innerHTML = Object.entries(MODES).map(([key, m]) =>
    `<button data-mode="${key}" class="${key === S.mode ? "on" : ""}">${m.label}</button>`).join("");
  $("modes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b || b.dataset.mode === S.mode) return;
    S.mode = b.dataset.mode;
    S.isolated.clear();
    for (const other of $("modes").children) other.classList.toggle("on", other === b);
    applyColors();
    renderLegend();
    applyHighlight();
  });
  $("scale-bar").style.background = `linear-gradient(90deg, ${d3.range(9).map((i) => STANCE(i)).join(",")})`;

  // ---------- filters ----------
  $("q").addEventListener("input", (e) => { S.query = e.target.value; applyHighlight(); });
  $("q").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const found = matches();
    if (!found || !found.length) return;
    if (found.length === 1) graph.select(found[0]);
    graph.fit(found, 700, 2.5);
  });
  const toggle = (id, key, onChange) => {
    $(id).checked = S[key] ?? graph.settings[key];
    $(id).addEventListener("change", (e) => onChange(e.target.checked));
  };
  toggle("show-uncovered", "showUncovered", (v) => { S.showUncovered = v; applyFilters(); });
  toggle("show-old", "showOld", (v) => { S.showOld = v; applyFilters(); });
  toggle("group-labels", "groupLabels", (v) => graph.set("groupLabels", v));
  toggle("physics", "physics", (v) => graph.set("physics", v));

  // ---------- sliders ----------
  const SLIDERS = {
    appearance: [
      { key: "nodeScale", label: "Tamaño de los nodos", min: 0.3, max: 4, step: 0.05 },
      { key: "linkWidth", label: "Grosor de los enlaces", min: 0, max: 4, step: 0.1 },
      { key: "labelZoom", label: "Umbral del texto", min: 0.3, max: 6, step: 0.1 },
    ],
    forces: [
      { key: "center", label: "Fuerza central", min: 0, max: 0.08, step: 0.001 },
      { key: "repel", label: "Repulsión", min: 0, max: 1500, step: 10 },
      { key: "repelRadius", label: "Alcance de la repulsión", min: 20, max: 300, step: 5 },
      { key: "linkStrength", label: "Fuerza de los enlaces", min: 0, max: 3, step: 0.05 },
      { key: "linkDistance", label: "Distancia de los enlaces", min: 2, max: 200, step: 1 },
      { key: "damping", label: "Fricción", min: 0.05, max: 0.9, step: 0.01 },
    ],
  };
  const fmt = (v) => String(+(+v).toFixed(3)).replace(".", ",");
  for (const [box, sliders] of Object.entries(SLIDERS)) {
    $(box).innerHTML = sliders.map((s) => `
      <label class="slider">
        <span>${s.label}<output id="out-${s.key}">${fmt(graph.settings[s.key])}</output></span>
        <input type="range" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${graph.settings[s.key]}">
      </label>`).join("");
    $(box).addEventListener("input", (e) => {
      const key = e.target.dataset.key;
      if (!key) return;
      graph.set(key, +e.target.value);
      $(`out-${key}`).textContent = fmt(e.target.value);
    });
  }
  $("reheat").addEventListener("click", () => graph.reheat(1));
  $("fit").addEventListener("click", () => graph.fit());
  $("reset").addEventListener("click", () => {
    for (const input of document.querySelectorAll("input[type=range][data-key]")) {
      const value = ForceGraph.DEFAULTS[input.dataset.key];
      input.value = value;
      graph.settings[input.dataset.key] = value;
      $(`out-${input.dataset.key}`).textContent = fmt(value);
    }
    graph.applySettings();
    graph.reheat(1);
  });
  $("panel-toggle").addEventListener("click", () => {
    const closed = $("panel").classList.toggle("closed");
    $("panel-toggle").setAttribute("aria-expanded", String(!closed));
  });

  // ---------- tooltip ----------
  const coverageText = (n) => {
    if (n.substantive) return `${nf(n.substantive)} ${n.substantive === 1 ? "noticia" : "noticias"} con cobertura sustantiva`;
    if (n.mention) return `Solo ${nf(n.mention)} ${n.mention === 1 ? "mención" : "menciones"} de paso`;
    return "Sin cobertura";
  };
  const stanceText = (stance) => {
    const bin = stanceBin(stance);
    return bin <= 1 ? "en contra" : bin <= 2 ? "algo en contra" : bin >= 7 ? "a favor" : bin >= 6 ? "algo a favor" : "neutral o dividida";
  };
  const tip = $("tip");
  graph.onHover = (n, e) => {
    if (!n) { tip.hidden = true; return; }
    tip.innerHTML = `<b>${n.number}</b> ${esc(cut(sentence(n.name), 150))}
      <span>${esc(D.topics[n.topic].name)} · ${coverageText(n)}</span>`;
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
    tip.style.top = Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 8) + "px";
  };

  // ---------- detail card ----------
  const fmtDate = (iso) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString("es-CR", { day: "numeric", month: "short", year: "numeric" }) : "sin fecha");
  graph.onSelect = (n) => {
    const card = $("card");
    if (!n) { card.hidden = true; return; }
    const status = STATUS[n.status]?.label || n.status || "sin estado";
    const similar = links.filter((l) => l.source === n || l.target === n)
      .map((l) => ({ node: l.source === n ? l.target : l.source, w: l.w }))
      .sort((a, b) => b.w - a.w);
    card.innerHTML = `
      <button class="card-close" id="card-close" aria-label="Cerrar">×</button>
      <div class="card-number">Expediente ${n.number}</div>
      <h2>${esc(sentence(n.name))}</h2>
      <dl>
        <dt>Tema</dt><dd><span class="swatch" style="background:${PALETTE[D.topics[n.topic].color]}"></span>${esc(D.topics[n.topic].name)}</dd>
        <dt>Tipo</dt><dd>${esc(sentence(n.type.replace(/^PROCEDIMIENTO\s+/, "")))}</dd>
        <dt>Presentado</dt><dd>${fmtDate(n.date)}${n.age != null ? ` · ${fmt(n.age.toFixed(1))} años` : ""}</dd>
        <dt>Estado</dt><dd>${esc(status)}${n.law ? ` N.º ${n.law}` : ""}</dd>
        <dt>Prensa</dt><dd>${coverageText(n)}${n.substantive ? ` en ${n.outlets} ${n.outlets === 1 ? "medio" : "medios"}; tema principal en ${nf(n.main)}` : ""}${n.substantive && n.mention > n.substantive ? `; ${nf(n.mention - n.substantive)} de paso` : ""}</dd>
        ${n.substantive && n.stance != null ? `<dt>Tono</dt><dd><span class="swatch" style="background:${STANCE(stanceBin(n.stance))}"></span>${stanceText(n.stance)} (${n.stance} de 100)</dd>` : ""}
      </dl>
      <div class="card-links">
        <a href="../jev_answers/#bill=${n.number}" target="_blank" rel="noopener">Noticias en el visor de Jev</a>
        <a href="http://localhost:8765/#/bill/${n.number}" target="_blank" rel="noopener">Explorador de la base</a>
      </div>
      <h3>Expedientes más parecidos</h3>
      <ul class="similar">${similar.map((s) => `
        <li><button data-node="${s.node.i}"${s.node.visible ? "" : " disabled"}>
          <span class="swatch" style="background:${s.node.color}"></span>
          <b>${s.node.number}</b> ${esc(cut(sentence(s.node.name), 70))}
          <i>${s.w}</i></button></li>`).join("")}</ul>`;
    card.hidden = false;
  };
  $("card").addEventListener("click", (e) => {
    if (e.target.closest("#card-close")) { graph.select(null); return; }
    const b = e.target.closest("[data-node]");
    if (!b) return;
    const node = nodes[+b.dataset.node];
    graph.select(node);
    graph.fit([node, ...node.neighbors.filter((x) => x.visible)], 600, 2.5);
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") graph.select(null); });

  // ---------- start ----------
  function renderSubtitle() {
    $("subtitle").textContent = `${nf(graph.visibleNodes.length)} expedientes · ${nf(graph.visibleLinks.length)} enlaces · ${D.topics.length} temas`;
  }
  applyColors();
  renderLegend();
  renderSubtitle();
  graph.fit(nodes, 0, 3);
  graph.reheat(1);
  window.GRAPH = graph;
})();
