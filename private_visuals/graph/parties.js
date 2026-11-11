// Parties and topics graph (#69): each party (and the Executive) linked to the topics of the
// bills graph, green where the press says it supports the bills of that topic and red where it
// opposes them. Reads the same data as the bills graph (build_graph.py, window.GRAPH_BILLS).
(function () {
  "use strict";
  const D = window.GRAPH_BILLS;
  const { $, nf, esc, sentence, cut, bindPanel, bindTooltip, ACTORS, STANCE, positionColor, leanOf, leanText, signed } = window.GraphUI;
  if (!D || !D.actors) {
    $("missing").hidden = false;
    return;
  }

  const TOPIC_COLOR = "#7d7c75";   // topics stay neutral: the links and the parties carry the color

  const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : many}`;

  // ---------- cells: actor x topic ----------
  // A bill counts once per actor, with the mean of what its news attribute to that actor.
  const F = Object.fromEntries(D.fields.map((name, i) => [name, i]));
  const cells = new Map();   // "actor|topic" -> { value, bills: [{number, name, value, news}] }
  const covered = D.topics.map(() => []);
  for (const row of D.nodes) {
    if (!row[F.substantive]) continue;
    covered[row[F.topic]].push({ number: row[F.number], name: row[F.name], news: row[F.substantive] });
    for (const [actor, value, news] of row[F.positions]) {
      const key = `${actor}|${row[F.topic]}`;
      if (!cells.has(key)) cells.set(key, { bills: [] });
      cells.get(key).bills.push({ number: row[F.number], name: row[F.name], value: value / 100, news });
    }
  }
  for (const cell of cells.values()) cell.value = cell.bills.reduce((sum, b) => sum + b.value, 0) / cell.bills.length;
  // (d3 overwrites node.index with the position in the simulation, so the data index is `id`.)
  const cellOf = (actor, topic) => cells.get(`${actor.id}|${topic.id}`);

  // ---------- nodes ----------
  const actors = D.actors.map((key, index) => {
    const angle = (index / D.actors.length) * 2 * Math.PI;
    const bills = new Set();
    for (const [k, cell] of cells) if (+k.split("|")[0] === index) cell.bills.forEach((b) => bills.add(b.number));
    return {
      kind: "actor", id: index, ...ACTORS[key], bills: bills.size,
      x: Math.cos(angle) * 300, y: Math.sin(angle) * 300,
      size: 24, color: ACTORS[key].color, label: ACTORS[key].short, shortLabel: ACTORS[key].short,
    };
  });
  const topics = D.topics.map((t, index) => ({
    kind: "topic", id: index, name: t.name, bills: covered[index].length,
    x: (Math.random() - 0.5) * 240, y: (Math.random() - 0.5) * 240,
    size: 6 + 1.5 * Math.sqrt(covered[index].length),
    color: TOPIC_COLOR, label: t.name, shortLabel: t.name.split(" · ")[0],
  })).filter((t) => t.bills > 0);
  const nodes = [...actors, ...topics];

  // ---------- state ----------
  const S = { minBills: 3, show: { favor: true, neutral: true, against: true }, isolated: new Set() };
  const graph = new ForceGraph($("graph"), {
    center: 0.04, repel: 2500, repelRadius: 320, linkDistance: 130, linkWidth: 1.2, labelZoom: 0.4, groupLabels: false,
  });

  function makeLinks() {
    const links = [];
    for (const actor of actors) {
      for (const topic of topics) {
        const cell = cellOf(actor, topic);
        if (!cell || cell.bills.length < S.minBills || !S.show[leanOf(cell.value)]) continue;
        links.push({
          source: actor, target: topic, value: cell.value,
          color: positionColor(cell.value),
          level: cell.bills.length >= 10 ? 2 : cell.bills.length >= 5 ? 1 : 0,
          // Only support pulls: a topic drifts toward the actors that back it.
          pull: cell.value > 0 ? 0.3 + cell.value : 0.05,
        });
      }
    }
    return links;
  }

  function renderSubtitle() {
    const shown = graph.visibleNodes.filter((n) => n.kind === "topic").length;
    $("subtitle").textContent = `${actors.length} actores · ${shown} temas · ${plural(graph.visibleLinks.length, "enlace", "enlaces")} `
      + `(${S.minBills} ${S.minBills === 1 ? "expediente" : "expedientes"} o más) · posiciones que las noticias de mayo a octubre de 2026 les atribuyen`;
  }

  function applyHighlight() {
    let set = null;
    if (S.isolated.size) {
      set = new Set();
      for (const actor of actors) {
        if (!S.isolated.has(actor.id)) continue;
        set.add(actor);
        actor.neighbors.forEach((n) => set.add(n));
      }
    }
    graph.setHighlight(set);
  }

  function refreshLinks() {
    graph.setLinks(makeLinks());
    applyHighlight();
    renderSubtitle();
  }

  // ---------- legend ----------
  function renderLegend() {
    $("legend").innerHTML = actors.map((a) => `
      <button class="legend-item${S.isolated.has(a.id) ? " on" : ""}${S.isolated.size && !S.isolated.has(a.id) ? " off" : ""}" data-key="${a.id}">
        <span class="swatch" style="background:${a.color}"></span>
        <span class="legend-label">${esc(a.short === a.name ? a.name : `${a.short} · ${a.name}`)}</span>
        <span class="legend-count">${nf(a.bills)}</span>
      </button>`).join("") + `
      <div class="legend-item" aria-hidden="true">
        <span class="swatch" style="background:${TOPIC_COLOR}"></span>
        <span class="legend-label">Tema (tamaño: expedientes cubiertos)</span>
      </div>`;
    $("legend-clear").hidden = !S.isolated.size;
  }
  $("legend-note").textContent = "El número es en cuántos expedientes la prensa le atribuye una posición. "
    + "Color del enlace: promedio de esas posiciones en el tema (a favor +1, en contra −1), con cada expediente pesando igual. "
    + "Grosor: cuántos expedientes hay detrás (5 o más, 10 o más).";
  $("legend").addEventListener("click", (e) => {
    const item = e.target.closest("button.legend-item");
    if (!item) return;
    const key = +item.dataset.key;
    if (S.isolated.has(key)) S.isolated.delete(key); else S.isolated.add(key);
    renderLegend();
    applyHighlight();
  });
  $("legend-clear").addEventListener("click", () => { S.isolated.clear(); renderLegend(); applyHighlight(); });
  $("scale-bar").style.background = `linear-gradient(90deg, ${d3.range(9).map((i) => STANCE(i)).join(",")})`;

  // ---------- filters ----------
  $("min-bills").value = S.minBills;
  $("out-min-bills").textContent = S.minBills;
  $("min-bills").addEventListener("input", (e) => {
    S.minBills = +e.target.value;
    $("out-min-bills").textContent = S.minBills;
    refreshLinks();
  });
  for (const lean of ["favor", "neutral", "against"]) {
    $(`show-${lean}`).checked = S.show[lean];
    $(`show-${lean}`).addEventListener("change", (e) => { S.show[lean] = e.target.checked; refreshLinks(); });
  }
  bindPanel(graph, { look: "parties" });

  // ---------- tooltip ----------
  const cellText = (actor, topic) => {
    const cell = cellOf(actor, topic);
    return cell ? `${esc(actor.short)}: ${leanText(cell.value)} (${signed(cell.value)}) en ${plural(cell.bills.length, "expediente", "expedientes")}`
      : `${esc(actor.short)}: sin posición atribuida en este tema`;
  };
  bindTooltip(graph, (n) => {
    const other = graph.selected && graph.selected.kind !== n.kind ? graph.selected : null;
    const pair = other ? `<span>${n.kind === "actor" ? cellText(n, other) : cellText(other, n)}</span>` : "";
    return n.kind === "actor"
      ? `<b>${esc(n.name)}</b><span>Posición atribuida en ${plural(n.bills, "expediente", "expedientes")}</span>${pair}`
      : `<b>${esc(n.name)}</b><span>${plural(n.bills, "expediente", "expedientes")} con cobertura sustantiva</span>${pair}`;
  });

  // ---------- detail card ----------
  const cellRow = (node, cell) => `
    <li><button data-node="${nodes.indexOf(node)}">
      <span class="swatch" style="background:${positionColor(cell.value)}"></span>
      <b>${esc(node.kind === "actor" ? node.short : cut(node.name, 34))}</b> ${leanText(cell.value)}
      <i>${signed(cell.value)} · ${cell.bills.length}</i></button></li>`;
  const billRow = (bill, extra) => `
    <li><a href="../jev_answers/#bill=${bill.number}" target="_blank" rel="noopener">
      <b>${bill.number}</b> ${esc(cut(sentence(bill.name), 60))}<i>${extra}</i></a></li>`;
  graph.onSelect = (n) => {
    const card = $("card");
    if (!n) { card.hidden = true; return; }
    if (n.kind === "topic") {
      const rows = actors.map((a) => ({ node: a, cell: cellOf(a, n) })).filter((r) => r.cell)
        .sort((a, b) => b.cell.value - a.cell.value);
      const top = [...covered[n.id]].sort((a, b) => b.news - a.news).slice(0, 6);
      card.innerHTML = `
        <button class="card-close" id="card-close" aria-label="Cerrar">×</button>
        <div class="card-number">Tema · ${plural(n.bills, "expediente cubierto", "expedientes cubiertos")}</div>
        <h2>${esc(n.name)}</h2>
        <h3>Posición de cada actor (promedio · expedientes)</h3>
        <ul class="similar">${rows.map((r) => cellRow(r.node, r.cell)).join("")}</ul>
        <h3>Expedientes más cubiertos del tema</h3>
        <ul class="similar">${top.map((b) => billRow(b, plural(b.news, "noticia", "noticias"))).join("")}</ul>`;
    } else {
      const rows = topics.map((t) => ({ node: t, cell: cellOf(n, t) }))
        .filter((r) => r.cell && r.cell.bills.length >= S.minBills)
        .sort((a, b) => b.cell.value - a.cell.value);
      const half = Math.min(5, Math.ceil(rows.length / 2));
      card.innerHTML = `
        <button class="card-close" id="card-close" aria-label="Cerrar">×</button>
        <div class="card-number">Posición atribuida en ${plural(n.bills, "expediente", "expedientes")}</div>
        <h2><span class="swatch" style="background:${n.color}"></span> ${esc(n.name)}</h2>
        <h3>Temas que más apoya (promedio · expedientes)</h3>
        <ul class="similar">${rows.slice(0, half).map((r) => cellRow(r.node, r.cell)).join("")}</ul>
        <h3>Temas que menos apoya</h3>
        <ul class="similar">${rows.slice(-half).reverse().map((r) => cellRow(r.node, r.cell)).join("")}</ul>
        <p class="hint">Solo temas con ${S.minBills} ${S.minBills === 1 ? "expediente" : "expedientes"} o más.</p>`;
    }
    card.hidden = false;
  };
  $("card").addEventListener("click", (e) => {
    if (e.target.closest("#card-close")) { graph.select(null); return; }
    const b = e.target.closest("[data-node]");
    if (b) graph.select(nodes[+b.dataset.node]);
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") graph.select(null); });

  // ---------- start ----------
  let moved = false;   // the user took over the camera: stop re-framing
  for (const type of ["wheel", "pointerdown"]) graph.canvas.addEventListener(type, () => { moved = true; }, { passive: true });
  graph.onSettled = () => { if (!moved) graph.fit(nodes, 600, 2); };
  graph.setData(nodes, makeLinks());
  // A topic with no link under the current filters would just float away: leave it out.
  graph.setVisible((n) => n.kind === "actor" || n.neighbors.length > 0, false);
  renderLegend();
  renderSubtitle();
  graph.fit(nodes, 0, 2);
  graph.reheat(1);
  window.GRAPH = graph;
})();
