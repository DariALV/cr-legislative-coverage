// Deputies graph (#69): two deputies are linked when they vote alike, so the blocs of each
// legislative term show up on their own. Data comes from build_deputies.py (window.GRAPH_DEPUTIES).
(function () {
  "use strict";
  const D = window.GRAPH_DEPUTIES;
  const { $, nf, esc, norm, bindPanel, bindTooltip, PALETTE, PARTY_COLORS } = window.GraphUI;
  if (!D) {
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
  // Thicker links for the pairs that almost always vote together.
  const linkLevel = (agreement) => (agreement >= 95 ? 2 : agreement >= 85 ? 1 : 0);

  // ---------- state ----------
  const S = { term: D.terms.length - 1, threshold: 75, mode: "party", isolated: new Set(), query: "" };
  const graph = new ForceGraph($("graph"), {
    center: 0.05, repel: 1500, repelRadius: 260, linkDistance: 70, linkWidth: 0.6, labelZoom: 0.5, groupLabels: false,
  });
  let T, nodes, agreement;   // current term, its nodes and the pair lookup
  let moved = false;         // the user took over the camera: stop re-framing

  const pairKey = (a, b) => (a.i < b.i ? a.i * nodes.length + b.i : b.i * nodes.length + a.i);
  const pairOf = (a, b) => agreement.get(pairKey(a, b));

  // ---------- color modes ----------
  const MODES = {
    party: {
      label: "Partido",
      note: "Partido: el que Delfino le pone más veces al diputado en esa legislatura.",
      color: (n) => partyOf(n.party).color,
      group: (n) => n.party,
      legend: () => [...new Set(nodes.map((n) => n.party))]
        .sort((a, b) => count(b) - count(a))
        .map((p) => ({ key: p, label: `${partyOf(p).short} · ${p.replace(/^Partido /, "")}`, color: partyOf(p).color })),
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
    agreement = new Map(T.pairs.map(([a, b, value, shared]) => [a * nodes.length + b, { value, shared }]));
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
    const links = [];
    for (const [a, b, value] of T.pairs) {
      if (value < S.threshold) continue;
      links.push({ source: nodes[a], target: nodes[b], value, level: linkLevel(value), pull: (value / 100) ** 2 });
    }
    return links;
  }

  function applyColors() {
    for (const n of nodes) n.color = MODES[S.mode].color(n);
    graph.colorsChanged();
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
    $("subtitle").textContent = `${nodes.length} diputados · ${nf(graph.visibleLinks.length)} enlaces con coincidencia ≥ ${S.threshold} % · `
      + `${nf(T.contested)} votaciones disputadas en ${nf(T.bills)} expedientes`;
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
    $("legend-note").textContent = `${mode.note} Dos diputados se enlazan si votaron igual al menos ese porcentaje de las veces: `
      + `solo cuentan las votaciones disputadas (la minoría fue al menos el ${Math.round(D.meta.contested * 100)} %) y cada expediente pesa lo mismo.`;
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
  $("threshold").value = S.threshold;
  $("out-threshold").textContent = `${S.threshold} %`;
  $("threshold").addEventListener("input", (e) => {
    S.threshold = +e.target.value;
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
  bindPanel(graph);

  // ---------- tooltip ----------
  const pairText = (a, b) => {
    const pair = pairOf(a, b);
    return pair ? `Coincide ${pair.value} % con ${esc(b.short)} (${pair.shared} expedientes)`
      : `Muy pocos expedientes en común con ${esc(b.short)}`;
  };
  bindTooltip(graph, (n) => `<b>${esc(n.name)}</b>
    <span>${esc(partyOf(n.party).short)} · ${esc(n.province || "sin provincia")}</span>
    ${graph.selected && graph.selected !== n ? `<span>${pairText(n, graph.selected)}</span>` : ""}`);

  // ---------- detail card ----------
  const mean = (values) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
  const row = (other, value) => `
    <li><button data-node="${other.i}">
      <span class="swatch" style="background:${partyOf(other.party).color}"></span>
      <b>${esc(other.short)}</b> ${esc(partyOf(other.party).short)}
      <i>${value} %</i></button></li>`;
  graph.onSelect = (n) => {
    const card = $("card");
    if (!n) { card.hidden = true; return; }
    const others = nodes.filter((o) => o !== n && pairOf(n, o))
      .map((o) => ({ node: o, value: pairOf(n, o).value }))
      .sort((a, b) => b.value - a.value);
    const own = mean(others.filter((o) => o.node.party === n.party).map((o) => o.value));
    const rest = mean(others.filter((o) => o.node.party !== n.party).map((o) => o.value));
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
        <dt>Coincide</dt><dd>${own != null ? `${own} % con su partido` : "sin compañeros de partido"}${rest != null ? ` · ${rest} % con el resto` : ""}</dd>
      </dl>
      ${n.deputy_id ? `<div class="card-links"><a href="http://localhost:8765/#/deputy/${n.deputy_id}" target="_blank" rel="noopener">Explorador de la base</a></div>` : ""}
      <h3>Vota más parecido a</h3>
      <ul class="similar">${others.slice(0, 6).map((o) => row(o.node, o.value)).join("")}</ul>
      <h3>Vota menos parecido a</h3>
      <ul class="similar">${others.slice(-5).reverse().map((o) => row(o.node, o.value)).join("")}</ul>`;
    card.hidden = false;
  };
  $("card").addEventListener("click", (e) => {
    if (e.target.closest("#card-close")) { graph.select(null); return; }
    const b = e.target.closest("[data-node]");
    if (b) graph.select(nodes[+b.dataset.node]);
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") graph.select(null); });

  // ---------- start ----------
  // Re-frame when the layout settles, unless the user already moved the camera.
  for (const type of ["wheel", "pointerdown"]) graph.canvas.addEventListener(type, () => { moved = true; }, { passive: true });
  graph.simulation.on("end.frame", () => { if (!moved) graph.fit(nodes, 600, 2.2); });
  loadTerm(S.term);
  window.GRAPH = graph;
})();
