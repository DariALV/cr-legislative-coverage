// News graph (#69): the news items of the corpus, each one linked to the items most like it in
// content (qwen3 embeddings) or to the other items about the same bill, colored by outlet, topic,
// genre, month or tone. Data comes from build_news.py (window.GRAPH_NEWS); bill names and topics
// from build_graph.py (window.GRAPH_BILLS), when it is there.
(function () {
  "use strict";
  const D = window.GRAPH_NEWS, B = window.GRAPH_BILLS;
  const { $, nf, esc, norm, sentence, cut, fmt, plural, bindPanel, bindGrouping, bindTooltip, PALETTE, stanceBin, STANCE } = window.GraphUI;
  if (!D) {
    $("missing").hidden = false;
    return;
  }

  // ---------- bills, from the bills graph ----------
  const BILLS = new Map();
  if (B) {
    const at = Object.fromEntries(B.fields.map((f, i) => [f, i]));
    for (const row of B.nodes) BILLS.set(row[at.number], { name: row[at.name], topic: row[at.topic] });
  }
  const TOPICS = B ? B.topics : [];
  const billName = (number) => (BILLS.has(number) ? sentence(BILLS.get(number).name) : "");
  const topicColor = (number) => (BILLS.has(number) ? PALETTE[TOPICS[BILLS.get(number).topic].color] : NONE);

  // ---------- labels and colors ----------
  const NONE = "#63635d";
  const OUTLETS = { crhoy: "CRHoy", nacion: "La Nación", delfino: "Delfino", elmundo: "El Mundo CR", semanario: "Semanario Universidad" };
  const outletLabel = (key) => OUTLETS[key] || key;
  const GENRES = { news_report: "Noticia", opinion: "Opinión", interview: "Entrevista", analysis: "Análisis" };
  const months = [...new Set(D.nodes.map((row) => row[D.fields.indexOf("date")].slice(0, 7)))].sort();
  const monthLabel = (index) => new Date(`${months[index]}-15T12:00:00`).toLocaleDateString("es-CR", { month: "long", year: "numeric" });
  const monthColor = (index) => d3.interpolateViridis(0.3 + 0.65 * index / Math.max(1, months.length - 1));
  const fmtDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("es-CR", { day: "numeric", month: "short", year: "numeric" });

  // ---------- nodes ----------
  const F = Object.fromEntries(D.fields.map((f, i) => [f, i]));
  const nodes = D.nodes.map((row, i) => {
    const bills = row[F.bills].map(([number, centrality, stance]) => ({ number, centrality, stance }));
    const main = bills[0] || null;   // the bill with the highest centrality
    const outlet = D.outlets[row[F.outlet]];
    const author = row[F.author] >= 0 ? D.authors[row[F.author]] : "";
    const title = row[F.title];
    return {
      i, id: row[F.id], url: row[F.url], title, outlet, date: row[F.date], month: months.indexOf(row[F.date].slice(0, 7)),
      author, section: row[F.section] >= 0 ? D.sections[row[F.section]] : "",
      genre: row[F.genre] >= 0 ? D.genres[row[F.genre]] : null, assembly: !!row[F.assembly],
      bills, mentions: row[F.mentions], main, topic: main && BILLS.has(main.number) ? BILLS.get(main.number).topic : null,
      x: row[F.x], y: row[F.y],
      size: main ? 3.4 : row[F.assembly] ? 2.6 : 2.2,
      label: cut(title, 70), shortLabel: cut(title, 34),
      search: norm(`${title} ${author} ${outletLabel(outlet)} ${bills.map((b) => b.number).join(" ")} ${row[F.mentions].join(" ")}`),
    };
  });

  // ---------- which news, and what links them ----------
  const SUBSETS = {
    all: { label: "Todas", what: "todo el corpus" },
    assembly: { label: "Asamblea", what: "las que pasan el filtro de Jev sobre la Asamblea", keep: (n) => n.assembly },
    bill: { label: "Con expediente", what: "las que cubren un expediente (cobertura sustantiva)", keep: (n) => n.bills.length > 0 },
  };
  const PER_NEWS = D.meta.neighbors;
  const LINK_SETS = {
    content: {
      label: "Contenido",
      heading: "Noticias por parecido",
      list: "Noticias más parecidas",
      note: `Cada noticia con las ${PER_NEWS} más parecidas entre las que se ven: coseno de sus embeddings qwen3 promediados, `
        + `desde ${fmt(D.meta.min_similarity)}. Los embeddings se hicieron para buscar expedientes, así que «parecida» tira a «sobre el mismo asunto legislativo».`,
    },
    bill: {
      label: "Mismo expediente",
      heading: "Noticias sobre el mismo expediente",
      list: "Noticias sobre el mismo expediente",
      note: "Las noticias con cobertura sustantiva de un mismo expediente, encadenadas por fecha. Solo se ven las noticias con expediente; "
        + "las que tratan varios expedientes unen sus cadenas.",
      subset: "bill",
    },
  };

  /** Each item with its nearest items of the subset (the build stores them per subset, best first). */
  function contentLinks(subset) {
    const { ids, sims, members } = D.neighbors[subset];
    let low = Infinity, high = -Infinity;
    for (const w of sims) if (w >= 0) { low = Math.min(low, w); high = Math.max(high, w); }
    const links = [], seen = new Set();
    const count = members ? members.length : nodes.length;
    for (let row = 0; row < count; row++) {
      const a = nodes[members ? members[row] : row];
      for (let k = 0, at = row * PER_NEWS; k < PER_NEWS && ids[at] >= 0; k++, at++) {
        const b = nodes[ids[at]];
        const pair = a.i < b.i ? a.i * nodes.length + b.i : b.i * nodes.length + a.i;
        if (seen.has(pair)) continue;   // the other item already listed this one
        seen.add(pair);
        // The more alike two items are, the harder their link pulls.
        links.push({ source: a, target: b, w: sims[at], pull: 0.4 + 1.2 * (sims[at] - low) / (high - low || 1) });
      }
    }
    return links;
  }

  /** The items about each bill, one after the other (the nodes come in date order). */
  function billLinks() {
    const last = new Map(), links = [], seen = new Set();
    for (const n of nodes) {
      for (const { number } of n.bills) {
        const before = last.get(number);
        last.set(number, n);
        if (!before) continue;
        const pair = before.i * nodes.length + n.i;
        if (seen.has(pair)) continue;   // two items that share two bills are linked once
        seen.add(pair);
        links.push({ source: before, target: n, bill: number, pull: 1 });
      }
    }
    return links;
  }

  // ---------- color modes ----------
  const toneGroup = (n) => {
    if (!n.main || n.main.stance == null) return "none";
    const bin = stanceBin(n.main.stance);
    return bin <= 2 ? "against" : bin >= 6 ? "favor" : "neutral";
  };
  const MODES = {
    outlet: {
      label: "Medio",
      note: "Medio que publicó la noticia.",
      color: (n) => PALETTE[D.outlets.indexOf(n.outlet)],
      group: (n) => n.outlet,
      legend: () => D.outlets.map((o, i) => ({ key: o, label: outletLabel(o), color: PALETTE[i] })),
    },
    topic: {
      label: "Tema",
      note: "Tema del expediente principal de la noticia (el de mayor centralidad según Jev), tomado del grafo de expedientes.",
      color: (n) => (n.topic != null ? PALETTE[TOPICS[n.topic].color] : NONE),
      group: (n) => (n.topic != null ? n.topic : "none"),
      legend: () => [...TOPICS.map((t, i) => ({ key: i, label: t.name, color: PALETTE[t.color] })),
        { key: "none", label: "Sin expediente", color: NONE }],
      labels: true,
    },
    genre: {
      label: "Género",
      note: "Género según Jev. Solo lo tienen las noticias que pasan el filtro sobre la Asamblea.",
      color: (n) => (n.genre ? PALETTE[D.genres.indexOf(n.genre)] : NONE),
      group: (n) => n.genre || "none",
      legend: () => [...D.genres.map((g, i) => ({ key: g, label: GENRES[g] || g, color: PALETTE[i] })),
        { key: "none", label: "Fuera del filtro", color: NONE }],
    },
    month: {
      label: "Mes",
      note: "Mes de publicación.",
      color: (n) => monthColor(n.month),
      group: (n) => n.month,
      legend: () => months.map((_, i) => ({ key: i, label: monthLabel(i), color: monthColor(i) })),
    },
    tone: {
      label: "Tono",
      note: "Postura de la noticia sobre su expediente principal, según Jev (0 en contra, 100 a favor).",
      color: (n) => (n.main && n.main.stance != null ? STANCE(stanceBin(n.main.stance)) : NONE),
      group: toneGroup,
      legend: () => [
        { key: "against", label: "En contra", color: STANCE(1) },
        { key: "neutral", label: "Neutral o dividida", color: STANCE(4) },
        { key: "favor", label: "A favor", color: STANCE(7) },
        { key: "none", label: "Sin expediente", color: NONE },
      ],
      scale: true,
    },
  };
  if (!B) delete MODES.topic;   // no bills graph data: no topics

  // ---------- state ----------
  const GATHER = 0.06;   // pull toward the middle of the own group when the groups are gathered
  const S = { subset: "all", links: "content", mode: "outlet", isolated: new Set(), query: "" };
  const graph = new ForceGraph($("graph"), { far: 5, repelRadius: 40, labelZoom: 2.2 });
  graph.simulation.alphaDecay(0.035);   // tens of thousands of nodes: settle in 200 ticks instead of 300
  const subsetNow = () => LINK_SETS[S.links].subset || S.subset;
  // What sets the layout: the news shown, what links them and, when gathered, the grouping.
  let grouping = null;   // bindGrouping, below
  const stateKey = () => `${subsetNow()}|${S.links}|${grouping && grouping.gathered() ? grouping.by() : "-"}`;
  let lastKey = null;    // the state the current positions belong to
  // Only the whole map is remembered between visits: it is the slow one to lay out.
  const storageKey = `graph:news:${D.meta.as_of}:${nodes.length}`;
  graph.setData(nodes, []);   // apply() puts the links in
  const restored = graph.restoreLayout(storageKey);
  // The layouts already made in this visit, to go back to them without laying them out again.
  const layouts = new Map();
  const remember = (key = stateKey()) => layouts.set(key, Float32Array.from(nodes.flatMap((n) => [n.x, n.y])));
  function recall() {
    const saved = layouts.get(stateKey());
    if (!saved) return false;
    nodes.forEach((n, i) => { n.x = saved[2 * i]; n.y = saved[2 * i + 1]; n.vx = 0; n.vy = 0; });
    return true;
  }

  function apply() {
    const subset = SUBSETS[subsetNow()];
    for (const n of nodes) n.kept = !subset.keep || subset.keep(n);
    lastKey = stateKey();
    // The engine keeps it only while the groups are not gathered.
    graph.layoutKey = subsetNow() === "all" && S.links === "content" ? storageKey : null;
    graph.setLinks(S.links === "content" ? contentLinks(subsetNow()) : billLinks(), false);
    graph.setVisible((n) => n.kept, false);
    $("heading").textContent = LINK_SETS[S.links].heading;
    $("links-note").textContent = LINK_SETS[S.links].note;
    renderSubsets();
    renderLegend();
    applyHighlight();
    renderSubtitle();
  }

  /** Moves to another subset or link set: back to its layout if this visit already made it. */
  function switchTo(change) {
    remember();
    change();
    const known = recall();
    apply();
    moved = false;
    if (known) { graph.fit(graph.visibleNodes, 600, 3); graph.requestDraw(); } else graph.reheat(1);
  }

  function applyColors() {
    const mode = MODES[S.mode];
    for (const n of nodes) n.color = mode.color(n);
    graph.colorsChanged();
    grouping.refresh();   // the shapes take the colors when the grouping is the color
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
      set = new Set((found || graph.visibleNodes).filter((n) => !S.isolated.size || S.isolated.has(mode.group(n))));
      if (!set.size) set = new Set([{}]);   // nothing matches: dim everything
    }
    graph.setHighlight(set);
    $("search-count").textContent = found ? `${nf(found.length)} ${found.length === 1 ? "coincidencia" : "coincidencias"}` : "";
  }

  // ---------- panel ----------
  function renderSubsets() {
    const forced = LINK_SETS[S.links].subset;
    $("subsets").innerHTML = Object.entries(SUBSETS).map(([key, s]) =>
      `<button data-subset="${key}" class="${key === subsetNow() ? "on" : ""}"${forced && key !== forced ? ' disabled style="opacity: .4; cursor: default"' : ""}>${s.label}</button>`).join("");
  }
  $("subsets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-subset]");
    if (!b || b.disabled || b.dataset.subset === S.subset) return;
    switchTo(() => { S.subset = b.dataset.subset; });
  });

  $("links").innerHTML = Object.entries(LINK_SETS).map(([key, set]) =>
    `<button data-links="${key}" class="${key === S.links ? "on" : ""}">${set.label}</button>`).join("");
  $("links").addEventListener("click", (e) => {
    const b = e.target.closest("[data-links]");
    if (!b || b.dataset.links === S.links) return;
    for (const other of $("links").children) other.classList.toggle("on", other === b);
    switchTo(() => { S.links = b.dataset.links; });
  });

  function renderLegend() {
    const mode = MODES[S.mode];
    const counts = new Map();
    for (const n of graph.visibleNodes) counts.set(mode.group(n), (counts.get(mode.group(n)) || 0) + 1);
    $("legend").innerHTML = mode.legend().filter((item) => counts.get(item.key)).map((item) => `
      <button class="legend-item${S.isolated.has(item.key) ? " on" : ""}${S.isolated.size && !S.isolated.has(item.key) ? " off" : ""}" data-key="${esc(item.key)}">
        <span class="swatch" style="background:${item.color}"></span>
        <span class="legend-label" title="${esc(item.label)}">${esc(item.label)}</span>
        <span class="legend-count">${nf(counts.get(item.key))}</span>
      </button>`).join("");
    $("scale").hidden = !mode.scale;
    $("legend-note").textContent = mode.note;
    $("legend-clear").hidden = !S.isolated.size;
  }
  $("legend").addEventListener("click", (e) => {
    const item = e.target.closest(".legend-item");
    if (!item) return;
    const key = MODES[S.mode].legend().find((i) => String(i.key) === item.dataset.key).key;
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

  $("q").addEventListener("input", (e) => { S.query = e.target.value; applyHighlight(); });
  $("q").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const found = matches();
    if (!found || !found.length) return;
    if (found.length === 1) graph.select(found[0]);
    graph.fit(found, 700, 2.5);
  });

  bindPanel(graph, { grouping: true, look: "news" });
  // The outlets are mixed all over the map, so picking a grouping also gathers the groups. Moving in
  // or out of a gathered state keeps the layout it leaves and goes back to one this visit already made.
  grouping = bindGrouping(graph, {
    modes: MODES, colorMode: () => S.mode, nodes: () => nodes, groupBy: "none", strength: GATHER, gatherOnPick: true,
    onChange: () => {
      const key = stateKey();
      if (key === lastKey) return;
      if (lastKey) remember(lastKey);
      lastKey = key;
      if (recall()) { graph.startAt(0.02); graph.requestDraw(); }
    },
  });

  // ---------- tooltip ----------
  bindTooltip(graph, (n) => `<b>${esc(cut(n.title, 140))}</b>
    <span>${esc(outletLabel(n.outlet))} · ${fmtDate(n.date)}${n.main ? ` · expediente ${n.main.number}` : ""}</span>`);

  // ---------- detail card ----------
  const toneText = (stance) => {
    const bin = stanceBin(stance);
    return bin <= 1 ? "en contra" : bin <= 2 ? "algo en contra" : bin >= 7 ? "a favor" : bin >= 6 ? "algo a favor" : "neutral o dividida";
  };
  const billRow = (b) => `<div><span class="swatch" style="background:${topicColor(b.number)}"></span><b>${b.number}</b> `
    + `${esc(cut(billName(b.number), 60))} <i title="Centralidad según Jev, de 0 a 100">${b.centrality}</i></div>`;
  graph.onSelect = (n) => {
    const card = $("card");
    if (!n) { card.hidden = true; return; }
    const linked = graph.links.filter((l) => l.source === n || l.target === n)
      .map((l) => ({ node: l.source === n ? l.target : l.source, w: l.w, bill: l.bill }))
      .sort((a, b) => (b.w ?? 0) - (a.w ?? 0) || a.node.date.localeCompare(b.node.date));
    const url = /^https?:\/\//.test(n.url) ? n.url : null;
    card.innerHTML = `
      <button class="card-close" id="card-close" aria-label="Cerrar">×</button>
      <div class="card-number">${esc(outletLabel(n.outlet))} · ${fmtDate(n.date)}</div>
      <h2>${esc(n.title)}</h2>
      <dl>
        ${n.author ? `<dt>Autor</dt><dd>${esc(n.author)}</dd>` : ""}
        ${n.section ? `<dt>Sección</dt><dd>${esc(n.section)}</dd>` : ""}
        <dt>Asamblea</dt><dd>${n.assembly ? `pasa el filtro de Jev${n.genre ? ` · ${GENRES[n.genre] || n.genre}` : ""}` : "no pasa el filtro de Jev"}</dd>
        ${n.bills.length ? `<dt>Expedientes</dt><dd>${n.bills.map(billRow).join("")}</dd>` : ""}
        ${n.mentions.length ? `<dt>De paso</dt><dd>${n.mentions.join(", ")}</dd>` : ""}
        ${n.main && n.main.stance != null ? `<dt>Tono</dt><dd><span class="swatch" style="background:${STANCE(stanceBin(n.main.stance))}"></span>${toneText(n.main.stance)} (${n.main.stance} de 100)</dd>` : ""}
      </dl>
      <div class="card-links">
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir la noticia</a>` : ""}
        <a href="http://localhost:8765/#/news/${encodeURIComponent(n.id)}" target="_blank" rel="noopener">Explorador de la base</a>
        ${n.main ? `<a href="../jev_answers/#bill=${n.main.number}" target="_blank" rel="noopener">Expediente ${n.main.number} en el visor de Jev</a>` : ""}
      </div>
      ${linked.length ? `<h3>${LINK_SETS[S.links].list}</h3>
      <ul class="similar">${linked.map((s) => `
        <li><button data-node="${s.node.i}">
          <span class="swatch" style="background:${s.node.color}"></span>
          ${esc(cut(s.node.title, 64))}
          <i>${s.w != null ? s.w : s.bill}</i></button></li>`).join("")}</ul>` : ""}`;
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
    $("subtitle").textContent = `${plural(graph.visibleNodes.length, "noticia", "noticias")} · ${nf(graph.visibleLinks.length)} enlaces · `
      + `${SUBSETS[subsetNow()].what} · ${monthLabel(0)} a ${monthLabel(months.length - 1)}`;
  }
  let moved = false;   // the user took over the camera: stop re-framing
  for (const type of ["wheel", "pointerdown"]) graph.canvas.addEventListener(type, () => { moved = true; }, { passive: true });
  graph.onSettled = () => { if (!moved) graph.fit(graph.visibleNodes, 600, 3); };
  applyColors();
  apply();
  graph.fit(nodes, 0, 3);
  // A layout remembered from the last visit is used as it is: touching up 30,000 nodes takes seconds.
  graph.startAt(restored ? 0 : 1);
  window.GRAPH = graph;
})();
