// Bills graph (#69): every bill linked to its most similar bills, colored by topic,
// press coverage or status. Data comes from build_graph.py (window.GRAPH_BILLS).
(function () {
  "use strict";
  const D = window.GRAPH_BILLS;
  const { $, nf, esc, norm, sentence, cut, fmt, bindPanel, bindTooltip, STANCE, ACTORS, positionColor, leanOf, leanText, signed } = window.GraphUI;
  if (!D) {
    $("missing").hidden = false;
    return;
  }

  // ---------- colors ----------
  // Eight categorical hues stepped for the dark surface. Topics outnumber them, so the build
  // gives neighboring topics different slots and the map labels carry the identity.
  const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
  const NO_COVERAGE = "#63635d";
  const OLD = "#2f2f2c";
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
    const [number, name, type, date, status, law, topic, mention, substantive, main, outlets, stance, x, y, positions = []] = row;
    const age = date ? (asOf - new Date(date)) / (365.25 * 864e5) : null;
    const readable = sentence(name);
    return {
      i, number, name, type: D.types[type] || "", date, status: D.statuses[status] || "", law, topic,
      mention, substantive, main, outlets, stance, age, old: age != null && age > OLD_YEARS,
      // actor index -> what the news say that actor thinks of the bill: mean from -1 to 1, and how many news
      positions: new Map(positions.map(([actor, value, news]) => [actor, { value: value / 100, news }])),
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
  const actors = (D.actors || []).map((key, index) => ({ index, ...ACTORS[key] }));
  const positionGroup = (n) => {
    const position = n.positions.get(S.actor);
    return position ? leanOf(position.value) : n.substantive ? "unstated" : "none";
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
    position: {
      label: "Partidos",
      note: "Posición: promedio de lo que las noticias con cobertura sustantiva dicen que ese actor opina del expediente (a favor +1, en contra −1).",
      color: (n) => {
        const position = n.positions.get(S.actor);
        return position ? positionColor(position.value) : n.substantive ? NO_COVERAGE : OLD;
      },
      group: positionGroup,
      get legend() {
        const who = actors[S.actor].short;
        return [
          { key: "against", label: `${who} en contra`, color: positionColor(-0.75) },
          { key: "neutral", label: `${who} dividido`, color: positionColor(0) },
          { key: "favor", label: `${who} a favor`, color: positionColor(0.75) },
          { key: "unstated", label: `Cubierto, sin posición de ${who}`, color: NO_COVERAGE },
          { key: "none", label: "Sin cobertura", color: OLD, outline: true },
        ];
      },
      scale: true,
      actors: true,
    },
  };
  if (!actors.length) delete MODES.position;   // data built before positions existed

  // ---------- state ----------
  const S = { mode: "topic", isolated: new Set(), query: "", showUncovered: true, showOld: true, actor: 0, topicFocus: null };
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
    if (found || S.isolated.size || S.topicFocus != null) {
      set = new Set((found || nodes).filter((n) => n.visible && (!S.isolated.size || S.isolated.has(mode.group(n)))
        && (S.topicFocus == null || n.topic === S.topicFocus)));
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
    $("legend-clear").hidden = !S.isolated.size && S.topicFocus == null;
    $("actors").hidden = !mode.actors;
    renderTopicSummary();
  }

  // Under the "Partidos" mode: the topics where the chosen actor has a position on enough bills,
  // from the one it backs least to the one it backs most. Click one to light up its bills.
  const SUMMARY_MIN_BILLS = 3;
  function renderTopicSummary() {
    const box = $("topic-summary");
    box.hidden = !MODES[S.mode].actors;
    if (box.hidden) return;
    const byTopic = new Map();
    for (const n of nodes) {
      const position = n.visible && n.positions.get(S.actor);
      if (!position) continue;
      if (!byTopic.has(n.topic)) byTopic.set(n.topic, []);
      byTopic.get(n.topic).push(position.value);
    }
    const rows = [...byTopic].filter(([, values]) => values.length >= SUMMARY_MIN_BILLS)
      .map(([topic, values]) => ({ topic, n: values.length, value: values.reduce((a, b) => a + b, 0) / values.length }))
      .sort((a, b) => a.value - b.value);
    box.innerHTML = `<h4>Por tema (${SUMMARY_MIN_BILLS} expedientes o más)</h4>` + rows.map((r) => `
      <button class="legend-item${S.topicFocus === r.topic ? " on" : ""}" data-topic="${r.topic}">
        <span class="swatch" style="background:${positionColor(r.value)}"></span>
        <span class="legend-label">${esc(D.topics[r.topic].name)}</span>
        <span class="legend-count">${signed(r.value)} · ${r.n}</span>
      </button>`).join("");
  }
  $("topic-summary").addEventListener("click", (e) => {
    const item = e.target.closest("[data-topic]");
    if (!item) return;
    const topic = +item.dataset.topic;
    S.topicFocus = S.topicFocus === topic ? null : topic;
    renderLegend();
    applyHighlight();
  });
  $("actors").innerHTML = actors.map((a) => `<button data-actor="${a.index}" class="${a.index === S.actor ? "on" : ""}" title="${esc(a.name)}">${esc(a.short)}</button>`).join("");
  $("actors").addEventListener("click", (e) => {
    const b = e.target.closest("[data-actor]");
    if (!b || +b.dataset.actor === S.actor) return;
    S.actor = +b.dataset.actor;
    S.isolated.clear();
    for (const other of $("actors").children) other.classList.toggle("on", other === b);
    applyColors();
    renderLegend();
    applyHighlight();
  });

  $("legend").addEventListener("click", (e) => {
    const item = e.target.closest(".legend-item");
    if (!item) return;
    const raw = item.dataset.key;
    const key = S.mode === "topic" ? +raw : raw;
    if (S.isolated.has(key)) S.isolated.delete(key); else S.isolated.add(key);
    renderLegend();
    applyHighlight();
  });
  $("legend-clear").addEventListener("click", () => { S.isolated.clear(); S.topicFocus = null; renderLegend(); applyHighlight(); });

  $("modes").innerHTML = Object.entries(MODES).map(([key, m]) =>
    `<button data-mode="${key}" class="${key === S.mode ? "on" : ""}">${m.label}</button>`).join("");
  $("modes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b || b.dataset.mode === S.mode) return;
    S.mode = b.dataset.mode;
    S.isolated.clear();
    S.topicFocus = null;
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
    $(id).checked = S[key];
    $(id).addEventListener("change", (e) => onChange(e.target.checked));
  };
  toggle("show-uncovered", "showUncovered", (v) => { S.showUncovered = v; applyFilters(); });
  toggle("show-old", "showOld", (v) => { S.showOld = v; applyFilters(); });
  bindPanel(graph);

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
  bindTooltip(graph, (n) => `<b>${n.number}</b> ${esc(cut(sentence(n.name), 150))}
      <span>${esc(D.topics[n.topic].name)} · ${coverageText(n)}</span>`);

  // ---------- detail card ----------
  const fmtDate = (iso) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString("es-CR", { day: "numeric", month: "short", year: "numeric" }) : "sin fecha");
  const positionChip = (n) => (a) => {
    const position = n.positions.get(a.index);
    const news = `${position.news} ${position.news === 1 ? "noticia" : "noticias"}`;
    return `<span title="${esc(a.name)}: ${signed(position.value)} en ${news}"><span class="swatch" style="background:${positionColor(position.value)}"></span>${esc(a.short)} ${leanText(position.value)}</span>`;
  };
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
        ${n.positions.size ? `<dt>Partidos</dt><dd class="positions">${actors.filter((a) => n.positions.has(a.index)).map(positionChip(n)).join("")}</dd>` : ""}
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
