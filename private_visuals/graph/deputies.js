// Deputies graph (#69): two deputies are linked when they vote alike, sign the same bills or sit
// on the same committees, so the blocs of each legislative term show up on their own. Data comes
// from build_deputies.py (window.GRAPH_DEPUTIES).
(function () {
  "use strict";
  const D = window.GRAPH_DEPUTIES;
  const { $, nf, esc, norm, plural, bindPanel, bindGrouping, bindTooltip, PALETTE, PARTY_COLORS } = window.GraphUI;
  // No data file, or one from before the connection types: running the build again fixes both.
  if (!D || !D.terms[0].links) {
    $("missing").hidden = false;
    return;
  }

  // ---------- colors ----------
  // Each party in its own color, as people know them, stepped to read on the dark surface.
  const PARTIES = {
    "Partido Pueblo Soberano": { short: "PPSO", color: PARTY_COLORS.PPSO },
    "Partido Liberación Nacional": { short: "PLN", color: PARTY_COLORS.PLN },
    "Partido Frente Amplio": { short: "FA", color: PARTY_COLORS.FA },
    "Partido Unidad Social Cristiana": { short: "PUSC", color: PARTY_COLORS.PUSC },
    "Coalición Agenda Ciudadana": { short: "CAC", color: PARTY_COLORS.CAC },
    "Independiente": { short: "Indep.", color: "#8f8e85" },
    "Partido Acción Ciudadana": { short: "PAC", color: "#c9601a" },
    "Partido Restauración Nacional": { short: "PRN", color: "#3f6fd9" },
    "Partido Nueva República": { short: "PNR", color: "#9a6fe0" },
    "Partido Liberal Progresista": { short: "PLP", color: "#e87ba4" },
    "Partido Progreso Social Democrático": { short: "PPSD", color: "#2bb5a6" },
    "Partido Integración Nacional": { short: "PIN", color: "#b08968" },
    "Partido Republicano Social Cristiano": { short: "PRSC", color: "#c77d7d" },
  };
  const OTHER_PARTY = { short: "Otro", color: "#8f8e85" };
  const partyOf = (name) => PARTIES[name] || OTHER_PARTY;
  const PROVINCES = ["San José", "Alajuela", "Cartago", "Heredia", "Guanacaste", "Puntarenas", "Limón"];
  const provinceColor = (name) => PALETTE[PROVINCES.indexOf(name)] || OTHER_PARTY.color;
  // Thicker links for the pairs that almost always vote together (the other connection types
  // are put on this scale first, see makeLinks).
  const linkLevel = (agreement) => (agreement >= 95 ? 2 : agreement >= 85 ? 1 : 0);

  // ---------- state ----------
  // `custom` holds the thresholds the user moved, by connection type; the rest come from the data.
  const S = { term: D.terms.length - 1, link: "votes", threshold: 75, custom: {}, mode: "party", isolated: new Set(), query: "" };
  const graph = new ForceGraph($("graph"), {
    center: 0.05, repel: 1500, repelRadius: 260, linkDistance: 70, linkWidth: 0.6, labelZoom: 0.5,
  });
  let grouping = null;       // bindGrouping, below
  let T, L, nodes, pairs;    // current term, its links of the current connection type, its nodes and the pair lookup
  let moved = false;         // the user took over the camera: stop re-framing

  const pairKey = (a, b) => (a.i < b.i ? a.i * nodes.length + b.i : b.i * nodes.length + a.i);
  const pairOf = (a, b) => pairs.get(pairKey(a, b));

  // ---------- connection types ----------
  // What links two deputies. Each type has its own pairs in the data (T.links[key]), as
  // [a, b, value, count]: a value from 0 to 100 and the bills or committees behind it.
  // `pair` is the sentence about deputy `a` and another one, `row` what a row of the card shows.
  // The types with `none` are overlaps: a pair that is not in the data has nothing in common.
  // `min` is where the slider starts: agreement stays mostly above 40, overlaps mostly below it.
  const LINKS = {
    votes: {
      label: "Co-votación",
      title: "Diputados que votan igual",
      slider: "Coincidencia mínima",
      min: 40,
      missing: "Sin votaciones en esta legislatura.",
      subtitle: () => `coincidencia ≥ ${S.threshold} % · ${nf(T.contested)} votaciones disputadas en ${nf(T.bills)} expedientes`,
      note: () => "Dos diputados se enlazan si votaron igual al menos ese porcentaje de las veces: "
        + `solo cuentan las votaciones disputadas (la minoría fue al menos el ${Math.round(D.meta.contested * 100)} %) y cada expediente pesa lo mismo.`,
      pair: (a, b, pair) => (pair ? `Coincide ${pair.value} % con ${esc(b.short)} (${pair.count} expedientes)`
        : `Muy pocos expedientes en común con ${esc(b.short)}`),
      row: (pair) => `${pair.value} %`,
      summary: "Coincide",
      most: "Vota más parecido a",
      least: "Vota menos parecido a",
    },
    signatures: {
      label: "Co-firma",
      title: "Diputados que firman juntos",
      slider: "Firmas en común mínimas",
      min: 0,
      missing: "Sin datos de firmas en esta legislatura.",
      subtitle: () => `firmas en común ≥ ${S.threshold} % · ${nf(L.total)} expedientes firmados por diputados`,
      note: () => "Dos diputados se enlazan si los expedientes que firmaron los dos son al menos ese porcentaje "
        + "de los que firmó alguno de los dos en la legislatura.",
      pair: (a, b, pair) => (pair
        ? `Firmó ${plural(a.bills, "expediente", "expedientes")}, ${nf(pair.count)} con ${esc(b.short)}, que firmó ${nf(b.bills)} (${pair.value} % en común)`
        : `Ningún expediente firmado con ${esc(b.short)}`),
      row: (pair) => `${nf(pair.count)} en común · ${pair.value} %`,
      summary: "Co-firma",
      most: "Firma más con",
      least: "Firma menos con",
      none: (n) => `No firmó ningún expediente con ${plural(n, "diputado", "diputados")}.`,
    },
    committees: {
      label: "Comisiones",
      title: "Diputados que comparten comisiones",
      slider: "Comisiones en común mínimas",
      min: 0,
      missing: "Sin datos de comisiones en esta legislatura.",
      subtitle: () => `comisiones en común ≥ ${S.threshold} % · ${nf(L.total)} comisiones`,
      note: () => "Dos diputados se enlazan si las comisiones en que estuvieron los dos son al menos ese porcentaje "
        + "de aquellas en que estuvo alguno de los dos, en cualquier momento de la legislatura. No cuentan el Plenario ni el Directorio.",
      pair: (a, b, pair) => (pair
        ? `Estuvo en ${plural(a.committees, "comisión", "comisiones")}, ${pair.count} con ${esc(b.short)}, que estuvo en ${b.committees} (${pair.value} % en común)`
        : `Ninguna comisión en común con ${esc(b.short)}`),
      row: (pair) => `${pair.count} en común · ${pair.value} %`,
      summary: "Comparte",
      most: "Comparte más comisiones con",
      least: "Comparte menos comisiones con",
      none: (n) => `No comparte ninguna comisión con ${plural(n, "diputado", "diputados")}.`,
    },
  };

  // Moves to another connection type of the current term: its pairs, its threshold and the texts
  // that name it. The caller rebuilds the links.
  function useLink(key) {
    S.link = key;
    L = T.links[key];
    pairs = new Map(L.pairs.map(([a, b, value, count]) => [a * nodes.length + b, { value, count }]));
    // Every type and term has its own scale, hence its own default; a threshold the user moved stays.
    S.threshold = S.custom[key] ?? L.threshold;
    $("threshold").min = LINKS[key].min;  // before the value, or a default below the old minimum gets clamped
    $("threshold").value = S.threshold;
    $("out-threshold").textContent = `${S.threshold} %`;
    $("threshold-label").textContent = LINKS[key].slider;
    $("heading").textContent = LINKS[key].title;
    const missing = Object.keys(LINKS).filter((k) => !T.links[k]);
    $("links").innerHTML = Object.entries(LINKS).map(([k, m]) =>
      `<button data-link="${k}" class="${k === key ? "on" : ""}"${missing.includes(k) ? ' disabled style="opacity: .4; cursor: default"' : ""}>${m.label}</button>`).join("");
    $("links-note").textContent = missing.map((k) => LINKS[k].missing).join(" ");
  }

  // ---------- color modes ----------
  const MODES = {
    party: {
      label: "Partido",
      note: "Partido: el que Delfino le pone más veces al diputado en esa legislatura.",
      color: (n) => partyOf(n.party).color,
      group: (n) => n.party,
      legend: () => [...new Set(nodes.map((n) => n.party))]
        .sort((a, b) => count(b) - count(a))
        .map((p) => ({ key: p, label: `${partyOf(p).short} · ${p.replace(/^Partido /, "")}`, short: partyOf(p).short, color: partyOf(p).color })),
    },
    province: {
      label: "Provincia",
      note: "Provincia por la que fue electo, según el SIL.",
      color: (n) => provinceColor(n.province),
      group: (n) => n.province,
      legend: () => PROVINCES.map((p) => ({ key: p, label: p, color: provinceColor(p) })),
    },
  };
  const count = (party) => nodes.filter((n) => n.party === party).length;

  // ---------- term ----------
  function loadTerm(index) {
    S.term = index;
    S.isolated.clear();
    T = D.terms[index];
    // Start with each party on its own spot of a circle, so the blocs untangle quickly.
    const parties = [...new Set(T.nodes.map((d) => d.party))];
    const sizes = new Map();
    for (const d of T.nodes) sizes.set(d.party, (sizes.get(d.party) || 0) + 1);
    nodes = T.nodes.map((d, i) => {
      const angle = (parties.indexOf(d.party) / parties.length) * 2 * Math.PI;
      const spread = 45 * Math.sqrt(sizes.get(d.party));  // room for the whole party, so it doesn't burst
      const node = {
        ...d, i,
        x: Math.cos(angle) * 320 + (Math.random() - 0.5) * spread,
        y: Math.sin(angle) * 320 + (Math.random() - 0.5) * spread,
        size: 9 + 0.9 * Math.sqrt(d.bills),
        label: d.short,       // full names collide; the tooltip and the card carry them
        shortLabel: d.short,
        search: norm(`${d.name} ${d.party} ${partyOf(d.party).short}`),
      };
      if (d.photo) {
        node.image = new Image();
        node.image.onload = () => graph.requestDraw();
        node.image.src = `../output/graph/photos/${encodeURIComponent(d.photo)}`;
      }
      return node;
    });
    useLink(T.links[S.link] ? S.link : "votes");  // a term may lack the data of a connection type
    graph.setData(nodes, makeLinks());
    applyColors();
    renderLegend();
    applyHighlight();
    renderSubtitle();
    for (const b of $("terms").children) b.classList.toggle("on", +b.dataset.term === index);
    moved = false;
    graph.fit(nodes, 0, 2.2);
    graph.reheat(1);
  }

  function makeLinks() {
    // Overlaps run far below agreement, so every connection type goes onto the co-voting scale
    // before it sets thickness and pull: its default threshold lands on 75 and its strong links
    // on 95 (co-voting maps onto itself).
    const step = 20 / (L.strong - L.threshold);
    const links = [];
    for (const [a, b, value] of L.pairs) {
      if (value < S.threshold) continue;
      const agreement = Math.max(0, Math.min(100, 75 + (value - L.threshold) * step));
      links.push({ source: nodes[a], target: nodes[b], value, level: linkLevel(agreement), pull: (agreement / 100) ** 2 });
    }
    return links;
  }

  function applyColors() {
    for (const n of nodes) n.color = MODES[S.mode].color(n);
    graph.colorsChanged();
    grouping.refresh();   // a new term brings new nodes; the shapes take the colors when the grouping is the color
  }

  function applyHighlight() {
    const mode = MODES[S.mode];
    const q = norm(S.query.trim());
    const found = q ? nodes.filter((n) => n.search.includes(q)) : null;
    let set = null;
    if (found || S.isolated.size) {
      set = new Set((found || nodes).filter((n) => !S.isolated.size || S.isolated.has(mode.group(n))));
      if (!set.size) set = new Set([{}]);  // nothing matches: dim everything
    }
    graph.setHighlight(set);
    $("search-count").textContent = found ? `${nf(found.length)} ${found.length === 1 ? "coincidencia" : "coincidencias"}` : "";
    return found;
  }

  function renderSubtitle() {
    $("subtitle").textContent = `${nodes.length} diputados · ${nf(graph.visibleLinks.length)} enlaces con ${LINKS[S.link].subtitle()}`;
  }

  // ---------- legend ----------
  function renderLegend() {
    const mode = MODES[S.mode];
    const counts = new Map();
    for (const n of nodes) counts.set(mode.group(n), (counts.get(mode.group(n)) || 0) + 1);
    $("legend").innerHTML = mode.legend().map((item) => `
      <button class="legend-item${S.isolated.has(item.key) ? " on" : ""}${S.isolated.size && !S.isolated.has(item.key) ? " off" : ""}"
              data-key="${esc(item.key)}" ${counts.get(item.key) ? "" : "disabled"}>
        <span class="swatch" style="background:${item.color}"></span>
        <span class="legend-label">${esc(item.label)}</span>
        <span class="legend-count">${nf(counts.get(item.key) || 0)}</span>
      </button>`).join("");
    $("legend-note").textContent = `${mode.note} ${LINKS[S.link].note()}`;
    $("legend-clear").hidden = !S.isolated.size;
  }
  $("legend").addEventListener("click", (e) => {
    const item = e.target.closest(".legend-item");
    if (!item) return;
    const key = item.dataset.key;
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

  // ---------- filters ----------
  $("terms").innerHTML = D.terms.map((t, i) => `<button data-term="${i}">${t.term.replace("-", "–")}</button>`).join("");
  $("terms").addEventListener("click", (e) => {
    const b = e.target.closest("[data-term]");
    if (b && +b.dataset.term !== S.term) loadTerm(+b.dataset.term);
  });
  $("links").addEventListener("click", (e) => {
    const b = e.target.closest("[data-link]");
    if (!b || b.dataset.link === S.link) return;
    useLink(b.dataset.link);
    graph.setLinks(makeLinks(), false);
    graph.reheat(1);  // a whole new arrangement, not the nudge of moving the threshold
    renderLegend();
    renderSubtitle();
    renderCard(graph.selected);
  });
  $("threshold").addEventListener("input", (e) => {
    S.threshold = S.custom[S.link] = +e.target.value;
    $("out-threshold").textContent = `${S.threshold} %`;
    graph.setLinks(makeLinks());
    renderSubtitle();
  });
  $("q").addEventListener("input", (e) => { S.query = e.target.value; applyHighlight(); });
  $("q").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const found = applyHighlight();
    if (!found || !found.length) return;
    if (found.length === 1) graph.select(found[0]);
    graph.fit(found, 700, 2.5);
  });
  bindPanel(graph, { grouping: true, images: true, look: "deputies" });
  // Grouped by party: its shape shows where the co-voting puts each party and how much the parties
  // overlap. Gathering them would hide exactly that, so the pull stays off unless asked for.
  grouping = bindGrouping(graph, { modes: MODES, colorMode: () => S.mode, nodes: () => nodes, groupBy: "party", strength: 0.06 });

  // ---------- tooltip ----------
  const pairText = (a, b) => LINKS[S.link].pair(a, b, pairOf(a, b));
  bindTooltip(graph, (n) => `<b>${esc(n.name)}</b>
    <span>${esc(partyOf(n.party).short)} · ${esc(n.province || "sin provincia")}</span>
    ${graph.selected && graph.selected !== n ? `<span>${pairText(n, graph.selected)}</span>` : ""}`);

  // ---------- detail card ----------
  const mean = (values) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
  function renderCard(n) {
    const card = $("card");
    if (!n) { card.hidden = true; return; }
    const link = LINKS[S.link];
    // A pair that is not in the data has no value in co-voting (too few bills in common) and a 0 in the overlaps.
    const others = nodes.filter((o) => o !== n && (link.none || pairOf(n, o)))
      .map((o) => ({ node: o, ...(pairOf(n, o) || { value: 0, count: 0 }) }))
      .sort((a, b) => b.value - a.value);
    const own = mean(others.filter((o) => o.node.party === n.party).map((o) => o.value));
    const rest = mean(others.filter((o) => o.node.party !== n.party).map((o) => o.value));
    // The lists rank those with something in common; the rest would be a tie at 0, so they are only counted.
    const common = others.filter((o) => o.count);
    const list = (title, rows) => (rows.length ? `
      <h3>${title}</h3>
      <ul class="similar">${rows.map((o) => `
        <li><button data-node="${o.node.i}" title="${link.pair(n, o.node, o)}">
          <span class="swatch" style="background:${partyOf(o.node.party).color}"></span>
          <b>${esc(o.node.short)}</b> ${esc(partyOf(o.node.party).short)}
          <i>${link.row(o)}</i></button></li>`).join("")}</ul>` : "");
    card.innerHTML = `
      <button class="card-close" id="card-close" aria-label="Cerrar">×</button>
      <div class="person">
        ${n.photo ? `<img src="../output/graph/photos/${encodeURIComponent(n.photo)}" alt="">` : ""}
        <div>
          <div class="card-number">${esc(partyOf(n.party).short)} · ${esc(T.term.replace("-", "–"))}</div>
          <h2>${esc(n.name)}</h2>
        </div>
      </div>
      <dl>
        <dt>Partido</dt><dd><span class="swatch" style="background:${partyOf(n.party).color}"></span>${esc(n.party)}</dd>
        <dt>Provincia</dt><dd>${esc(n.province || "sin dato")}</dd>
        <dt>Firmó</dt><dd>${nf(n.bills)} expedientes</dd>
        <dt>Votó en</dt><dd>${nf(n.voted)} de ${nf(T.votes)} votaciones</dd>
        ${S.link === "committees" ? `<dt>Comisiones</dt><dd>${n.committees} en la legislatura</dd>` : ""}
        <dt>${link.summary}</dt><dd>${own != null ? `${own} % con su partido` : "sin compañeros de partido"}${rest != null ? ` · ${rest} % con el resto` : ""}</dd>
      </dl>
      ${n.deputy_id ? `<div class="card-links"><a href="http://localhost:8765/#/deputy/${n.deputy_id}" target="_blank" rel="noopener">Explorador de la base</a></div>` : ""}
      ${list(link.most, common.slice(0, 6))}
      ${list(link.least, common.slice(-5).reverse())}
      ${common.length < others.length ? `<p class="hint">${link.none(others.length - common.length)}</p>` : ""}`;
    card.hidden = false;
  }
  graph.onSelect = renderCard;
  $("card").addEventListener("click", (e) => {
    if (e.target.closest("#card-close")) { graph.select(null); return; }
    const b = e.target.closest("[data-node]");
    if (b) graph.select(nodes[+b.dataset.node]);
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") graph.select(null); });

  // ---------- start ----------
  // Re-frame when the layout settles, unless the user already moved the camera.
  for (const type of ["wheel", "pointerdown"]) graph.canvas.addEventListener(type, () => { moved = true; }, { passive: true });
  graph.onSettled = () => { if (!moved) graph.fit(nodes, 600, 2.2); };
  loadTerm(S.term);
  window.GRAPH = graph;
})();
