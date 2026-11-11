// Bills graph (#69): every bill linked to its most similar bills, colored by topic,
// press coverage or status. The links can be swapped (similar exposition, name or subject
// descriptors, or the same signers) and the bills narrowed to a window of filing dates.
// Data comes from build_graph.py (window.GRAPH_BILLS).
(function () {
  "use strict";
  const D = window.GRAPH_BILLS, NB = window.GRAPH_NEIGHBORS;
  const { $, nf, esc, norm, sentence, cut, fmt, plural, bindPanel, bindTooltip, PALETTE, stanceBin, STANCE, ACTORS, positionColor, leanOf, leanText, signed } = window.GraphUI;
  if (!D || !NB) {
    $("missing").hidden = false;
    return;
  }

  // ---------- colors ----------
  // Topics outnumber the eight hues of the palette, so the build gives neighboring topics
  // different slots and the map labels carry the identity.
  const NO_COVERAGE = "#63635d";
  const OLD = "#2f2f2c";
  const STATUS = {
    "in progress": { label: "En trámite", color: PALETTE[0] },
    law: { label: "Ley", color: PALETTE[2] },
    archived: { label: "Archivado", color: PALETTE[1] },
  };
  const OLD_YEARS = 4;

  // ---------- nodes ----------
  const asOf = new Date(D.meta.as_of);
  // Filing dates as months counted from the first one, for the time window.
  const firstDate = d3.min(D.nodes, (row) => row[3] || undefined) || D.meta.as_of;
  const monthOf = (iso) => (+iso.slice(0, 4) - +firstDate.slice(0, 4)) * 12 + (+iso.slice(5, 7) - +firstDate.slice(5, 7));
  const lastMonth = monthOf(D.meta.as_of);
  const monthLabel = (index) => {
    const month = +firstDate.slice(5, 7) - 1 + index;
    return new Date(Date.UTC(+firstDate.slice(0, 4) + Math.floor(month / 12), month % 12, 1))
      .toLocaleDateString("es-CR", { month: "short", year: "numeric", timeZone: "UTC" });
  };
  const nodes = D.nodes.map((row, i) => {
    const [number, name, type, date, status, law, topic, mention, substantive, main, outlets, stance, x, y, positions = []] = row;
    const age = date ? (asOf - new Date(date)) / (365.25 * 864e5) : null;
    const readable = sentence(name);
    return {
      i, number, name, type: D.types[type] || "", date, status: D.statuses[status] || "", law, topic,
      mention, substantive, main, outlets, stance, age, old: age != null && age > OLD_YEARS,
      month: date ? Math.max(0, Math.min(lastMonth, monthOf(date))) : 0,
      // actor index -> what the news say that actor thinks of the bill: mean from -1 to 1, and how many news
      positions: new Map(positions.map(([actor, value, news]) => [actor, { value: value / 100, news }])),
      x, y,
      size: 3.2 + 1.1 * Math.sqrt(substantive),
      shortLabel: String(number),
      label: `${number} · ${cut(readable, 46)}`,
      search: norm(`${number} ${name}`),
    };
  });

  // ---------- link sets ----------
  // Different rules for joining two bills. For each one the build stores the nearest bills of
  // every bill, best first (window.GRAPH_NEIGHBORS), and the page joins each bill it shows to the
  // first five of them that are also shown. So the links follow the filters: in a window of
  // filing dates a bill is tied to the most similar bills of that window, not to ones left out.
  const PER_BILL = D.meta.neighbors || 5;
  const STORED = NB.stored;
  const LINK_SETS = {
    exposition: { label: "Exposición", list: "Expedientes más parecidos", what: "la exposición de motivos más parecida (embeddings qwen3)" },
    name: { label: "Nombre", list: "Expedientes con el nombre más parecido", what: "el nombre más parecido (embeddings qwen3)" },
    subjects: { label: "Descriptores", list: "Expedientes con descriptores más parecidos", what: "los descriptores del SIL más parecidos (embeddings qwen3)" },
    signers: { label: "Firmantes", list: "Expedientes con los mismos firmantes",
      what: "más firmantes en común (Jaccard; entre empates, los presentados más cerca). Los expedientes sin firmantes en el SIL no aparecen" },
  };
  for (const [key, set] of Object.entries(LINK_SETS)) {
    if (!NB.lists[key]) { delete LINK_SETS[key]; continue; }   // data built without that kind of link
    Object.assign(set, NB.lists[key]);
    [set.low, set.high] = d3.extent(set.sims, (w) => (w < 0 ? undefined : w));
    set.note = `Enlaces: cada expediente con los ${PER_BILL} que tienen ${set.what}, entre los que están a la vista `
      + `(se buscan entre sus ${STORED} más cercanos, así que en una ventana angosta algunos quedan con menos).`;
  }
  /** Whether the bill has any data for this kind of link (a bill with no signers on record has none). */
  const linkable = (n, key) => LINK_SETS[key].ids[n.i * STORED] >= 0;
  /** Links among the bills marked `kept`. */
  function makeLinks(key) {
    const { ids, sims, low, high } = LINK_SETS[key];
    const links = [], seen = new Set();
    for (const n of nodes) {
      if (!n.kept) continue;
      for (let k = 0, at = n.i * STORED, taken = 0; k < STORED && taken < PER_BILL && ids[at] >= 0; k++, at++) {
        const other = nodes[ids[at]];
        if (!other.kept) continue;
        taken++;
        const pair = n.i < other.i ? n.i * nodes.length + other.i : other.i * nodes.length + n.i;
        if (seen.has(pair)) continue;   // the other bill already listed this one
        seen.add(pair);
        // The more alike two bills are, the harder their link pulls, so the closest ones end up together.
        links.push({ source: n, target: other, w: sims[at], pull: 0.4 + 1.2 * (sims[at] - low) / (high - low || 1) });
      }
    }
    return links;
  }

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
  const S = {
    mode: "topic", isolated: new Set(), query: "", showUncovered: true, showOld: true, actor: 0, topicFocus: null,
    links: "exposition", from: 0, to: lastMonth,
  };
  // The long-range repulsion is what lets the topics drift apart into islands; with it the
  // short-range one only has to keep neighbors from overlapping, so its reach can be short.
  const graph = new ForceGraph($("graph"), { far: 5, repelRadius: 40 });
  const topicGroups = D.topics.map((t, i) => ({ label: t.name, nodes: nodes.filter((n) => n.topic === i) }));
  const layoutKey = () => `graph:bills:${D.meta.as_of}:${nodes.length}:${S.links}`;
  graph.groups = topicGroups;
  graph.setData(nodes, []);   // applyFilters() puts the links in
  const restored = graph.restoreLayout(layoutKey());

  function applyColors() {
    const mode = MODES[S.mode];
    for (const n of nodes) {
      n.color = mode.color(n);
      n.group = mode.group(n);   // what "group by color" pulls together
    }
    graph.colorsChanged();
    if (graph.settings.group > 0) graph.reheat(0.6);
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
    for (const n of nodes) {
      n.kept = (S.showUncovered || n.substantive > 0) && (S.showOld || !n.old)
        && n.month >= S.from && n.month <= S.to && linkable(n, S.links);
    }
    // Only the layout of the whole map is worth remembering for the next visit.
    const whole = S.showUncovered && S.showOld && S.from === 0 && S.to === lastMonth;
    graph.layoutKey = whole ? layoutKey() : null;
    graph.setLinks(makeLinks(S.links), false);
    graph.setVisible((n) => n.kept);
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

  // Connections: swapping the link set keeps the bills where they are and lets them flow to the new layout.
  $("links").innerHTML = Object.entries(LINK_SETS).map(([key, set]) =>
    `<button data-links="${key}" class="${key === S.links ? "on" : ""}">${set.label}</button>`).join("");
  $("links-note").textContent = LINK_SETS[S.links].note;
  $("links").addEventListener("click", (e) => {
    const b = e.target.closest("[data-links]");
    if (!b || b.dataset.links === S.links) return;
    S.links = b.dataset.links;
    for (const other of $("links").children) other.classList.toggle("on", other === b);
    $("links-note").textContent = LINK_SETS[S.links].note;
    // The topic names mark where each topic sits; with the signers the topics are scattered.
    graph.groups = S.links === "signers" ? [] : topicGroups;
    applyFilters();
    graph.reheat(1);
  });

  // Time window on the filing date, with shortcuts for the legislative terms (they start on May 1).
  const clampMonth = (iso) => Math.max(0, Math.min(lastMonth, monthOf(iso)));
  const WINDOWS = [
    { label: "Todo", from: 0, to: lastMonth },
    { label: "2018–2022", from: clampMonth("2018-05-01"), to: clampMonth("2022-04-30") },
    { label: "2022–2026", from: clampMonth("2022-05-01"), to: clampMonth("2026-04-30") },
    { label: "2026–2030", from: clampMonth("2026-05-01"), to: lastMonth },
    { label: "Último año", from: Math.max(0, lastMonth - 11), to: lastMonth },
  ];
  function renderWindow() {
    $("from").value = S.from;
    $("to").value = S.to;
    $("out-from").textContent = monthLabel(S.from);
    $("out-to").textContent = monthLabel(S.to);
    $("windows").innerHTML = WINDOWS.map((w, i) =>
      `<button data-window="${i}" class="${w.from === S.from && w.to === S.to ? "on" : ""}">${w.label}</button>`).join("");
  }
  function setWindow(from, to) {
    S.from = from;
    S.to = to;
    renderWindow();
    applyFilters();
  }
  for (const id of ["from", "to"]) $(id).max = lastMonth;
  // The two ends push each other, so the window is never empty.
  $("from").addEventListener("input", (e) => setWindow(+e.target.value, Math.max(S.to, +e.target.value)));
  $("to").addEventListener("input", (e) => setWindow(Math.min(S.from, +e.target.value), +e.target.value));
  $("windows").addEventListener("click", (e) => {
    const b = e.target.closest("[data-window]");
    if (b) setWindow(WINDOWS[+b.dataset.window].from, WINDOWS[+b.dataset.window].to);
  });
  renderWindow();
  toggle("show-old", "showOld", (v) => { S.showOld = v; applyFilters(); });
  bindPanel(graph, { grouping: true });

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
    const similar = graph.links.filter((l) => l.source === n || l.target === n)
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
      <h3>${LINK_SETS[S.links].list}</h3>
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
    const whole = S.from === 0 && S.to === lastMonth;
    $("subtitle").textContent = `${plural(graph.visibleNodes.length, "expediente", "expedientes")} · ${nf(graph.visibleLinks.length)} enlaces · ${D.topics.length} temas`
      + (whole ? "" : ` · presentados de ${monthLabel(S.from)} a ${monthLabel(S.to)}`);
  }
  applyColors();
  applyFilters();
  graph.fit(nodes, 0, 3);
  // A layout remembered from the last visit only needs a touch-up, not the whole animation.
  graph.startAt(restored ? 0.05 : 1);
  window.GRAPH = graph;
})();
