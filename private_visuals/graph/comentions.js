// Co-mention graph (#69): two bills are linked when the same news item covers both of them
// substantively, so the bills the press tells as one story end up together, whatever their
// topic. Reads the pairs table of build_graph.py through press.js.
(function () {
  "use strict";
  const D = window.GRAPH_BILLS, P = window.GraphPress;
  const { $, nf, esc, norm, cut, plural, bindPanel, bindTooltip, isolateList, PALETTE, STANCE, stanceBin } = window.GraphUI;
  if (!D || !P) {
    $("missing").hidden = false;
    return;
  }

  // ---------- pairs of bills ----------
  // Every news item with two or more bills links each pair of them once.
  const byNews = d3.group(P.pairs, (p) => p.news);
  const shared = new Map();   // "a|b" (node indexes, a < b) -> outlet of each news item they share
  const multi = [];           // outlet of each news item with two or more bills
  for (const list of byNews.values()) {
    const bills = [...new Set(list.map((p) => p.node))].sort((a, b) => a - b);
    if (bills.length < 2) continue;
    multi.push(list[0].outlet);
    for (let i = 0; i < bills.length; i++) {
      for (let j = i + 1; j < bills.length; j++) {
        const key = `${bills[i]}|${bills[j]}`;
        if (!shared.has(key)) shared.set(key, []);
        shared.get(key).push(list[0].outlet);
      }
    }
  }

  // ---------- nodes ----------
  const nodeOf = new Map();
  for (const key of shared.keys()) {
    for (const index of key.split("|")) {
      if (nodeOf.has(+index)) continue;
      const bill = P.bill(+index);
      const angle = Math.random() * 2 * Math.PI, radius = 320 * Math.sqrt(Math.random());
      nodeOf.set(+index, {
        ...bill, id: nodeOf.size,
        x: Math.cos(angle) * radius, y: Math.sin(angle) * radius,
        size: 3.2 + 1.1 * Math.sqrt(bill.substantive),
        shortLabel: String(bill.number),
        label: `${bill.number} · ${cut(bill.name, 46)}`,
        search: norm(`${bill.number} ${bill.name}`),
      });
    }
  }
  const nodes = [...nodeOf.values()];
  const candidates = [...shared].map(([key, newsOutlets]) => {
    const [a, b] = key.split("|").map((index) => nodeOf.get(+index));
    return { source: a, target: b, newsOutlets, cross: a.topic !== b.topic };
  });

  // ---------- color modes ----------
  const toneGroup = (n) => {
    const bin = stanceBin(n.stance ?? 50);
    return bin <= 2 ? "against" : bin >= 6 ? "favor" : "neutral";
  };
  const MODES = {
    topic: {
      label: "Tema",
      note: "Temas del mapa de expedientes (parecido entre textos). Los colores se repiten entre temas lejanos.",
      color: (n) => PALETTE[D.topics[n.topic].color],
      group: (n) => n.topic,
      legend: () => D.topics.map((t, i) => ({ key: i, label: t.name, color: PALETTE[t.color] })),
    },
    tone: {
      label: "Tono",
      note: "Tono: promedio del puntaje de postura de Jev en las noticias con cobertura sustantiva del expediente.",
      color: (n) => STANCE(stanceBin(n.stance ?? 50)),
      group: toneGroup,
      legend: () => [
        { key: "against", label: "Prensa en contra", color: STANCE(1) },
        { key: "neutral", label: "Prensa neutral o dividida", color: STANCE(4) },
        { key: "favor", label: "Prensa a favor", color: STANCE(7) },
      ],
      scale: true,
    },
  };

  // ---------- state ----------
  // Two news items by default: a pair that met once is often just a list of the week's bills.
  const S = { mode: "topic", isolated: new Set(), query: "", minNews: 2, showSame: true, showCross: true, outlets: new Set() };
  const graph = new ForceGraph($("graph"), {
    center: 0.03, repel: 700, repelRadius: 140, linkDistance: 44, linkWidth: 1.4, labelZoom: 1.3, groupLabels: false,
  });

  function makeLinks() {
    const links = [];
    for (const c of candidates) {
      if (c.cross ? !S.showCross : !S.showSame) continue;
      const weight = S.outlets.size ? c.newsOutlets.filter((o) => S.outlets.has(o)).length : c.newsOutlets.length;
      if (weight < S.minNews) continue;
      links.push({
        source: c.source, target: c.target, weight,
        level: weight >= 5 ? 2 : weight >= 2 ? 1 : 0,
        // Bills that share many news items sit closer; a single shared item barely pulls.
        pull: weight === 1 ? 0.3 : Math.min(3, 0.5 + 0.4 * weight),
      });
    }
    return links;
  }

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
    $("search-count").textContent = found ? plural(found.length, "coincidencia", "coincidencias") : "";
  }

  function renderSubtitle() {
    const links = graph.visibleLinks;
    const cross = links.filter((l) => l.source.topic !== l.target.topic).length;
    $("subtitle").textContent = `${plural(graph.visibleNodes.length, "expediente", "expedientes")} · ${plural(links.length, "par", "pares")} que `
      + `comparten ${S.minNews === 1 ? "una noticia" : `${S.minNews} noticias`} o más`
      + (links.length ? ` · ${Math.round(100 * cross / links.length)} % entre temas distintos` : "")
      + ` · cobertura sustantiva, ${P.period}`;
  }

  // ---------- legend ----------
  function renderLegend() {
    const mode = MODES[S.mode];
    const counts = d3.rollup(graph.visibleNodes, (list) => list.length, mode.group);
    $("legend").innerHTML = mode.legend().filter((item) => counts.get(item.key) || S.isolated.has(item.key)).map((item) => `
      <button class="legend-item${S.isolated.has(item.key) ? " on" : ""}${S.isolated.size && !S.isolated.has(item.key) ? " off" : ""}" data-key="${esc(item.key)}">
        <span class="swatch" style="background:${item.color}"></span>
        <span class="legend-label" title="${esc(item.label)}">${esc(item.label)}</span>
        <span class="legend-count">${nf(counts.get(item.key) || 0)}</span>
      </button>`).join("");
    $("scale").hidden = !mode.scale;
    $("legend-note").textContent = mode.note;
    $("legend-clear").hidden = !S.isolated.size;
  }
  $("legend").addEventListener("click", (e) => {
    const item = e.target.closest(".legend-item");
    if (!item) return;
    const key = S.mode === "topic" ? +item.dataset.key : item.dataset.key;
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
  function refreshLinks() {
    graph.setLinks(makeLinks());
    renderLegend();
    applyHighlight();
    renderSubtitle();
  }
  $("min-news").value = S.minNews;
  $("out-min-news").textContent = S.minNews;
  $("min-news").addEventListener("input", (e) => {
    S.minNews = +e.target.value;
    $("out-min-news").textContent = S.minNews;
    refreshLinks();
  });
  for (const [id, key] of [["show-same", "showSame"], ["show-cross", "showCross"]]) {
    $(id).checked = S[key];
    $(id).addEventListener("change", (e) => { S[key] = e.target.checked; refreshLinks(); });
  }
  const multiByOutlet = d3.rollup(multi, (list) => list.length, (o) => o);
  isolateList($("outlets"), () => P.outlets.map((o) => ({ key: o.id, label: o.name, color: P.NEUTRAL, count: multiByOutlet.get(o.id) || 0 })),
    S.outlets, refreshLinks);
  $("q").addEventListener("input", (e) => { S.query = e.target.value; applyHighlight(); });
  $("q").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const found = matches();
    if (!found || !found.length) return;
    if (found.length === 1) graph.select(found[0]);
    graph.fit(found, 700, 2.5);
  });
  bindPanel(graph, { look: "comentions" });

  // ---------- tooltip ----------
  const weightOf = (a, b) => graph.visibleLinks.find((l) => (l.source === a && l.target === b) || (l.source === b && l.target === a))?.weight;
  bindTooltip(graph, (n) => {
    const together = graph.selected && graph.selected !== n ? weightOf(graph.selected, n) : null;
    return `<b>${n.number}</b> ${esc(cut(n.name, 150))}
      <span>${esc(D.topics[n.topic].name)} · ${plural(n.substantive, "noticia", "noticias")} · sale con ${plural(n.neighbors.filter((x) => x.visible).length, "expediente", "expedientes")}</span>
      ${together ? `<span>${plural(together, "noticia", "noticias")} en común con el ${graph.selected.number}</span>` : ""}`;
  });

  // ---------- detail card ----------
  graph.onSelect = (n) => {
    const card = $("card");
    if (!n) { card.hidden = true; return; }
    const together = graph.visibleLinks.filter((l) => l.source === n || l.target === n)
      .map((l) => ({ node: l.source === n ? l.target : l.source, weight: l.weight }))
      .sort((a, b) => b.weight - a.weight || b.node.substantive - a.node.substantive);
    card.innerHTML = `
      <button class="card-close" id="card-close" aria-label="Cerrar">×</button>
      <div class="card-number">Expediente ${n.number}</div>
      <h2>${esc(n.name)}</h2>
      <dl>
        <dt>Tema</dt><dd><span class="swatch" style="background:${PALETTE[D.topics[n.topic].color]}"></span>${esc(D.topics[n.topic].name)}</dd>
        <dt>Prensa</dt><dd>${plural(n.substantive, "noticia", "noticias")} con cobertura sustantiva</dd>
        ${n.stance != null ? `<dt>Tono</dt><dd><span class="swatch" style="background:${STANCE(stanceBin(n.stance))}"></span>${n.stance} de 100</dd>` : ""}
      </dl>
      <div class="card-links">
        <a href="../jev_answers/#bill=${n.number}" target="_blank" rel="noopener">Noticias en el visor de Jev</a>
        <a href="http://localhost:8765/#/bill/${n.number}" target="_blank" rel="noopener">Explorador de la base</a>
      </div>
      <h3>Sale en la misma noticia que (noticias en común)</h3>
      <ul class="similar">${together.map((t) => `
        <li><button data-node="${t.node.id}">
          <span class="swatch" style="background:${t.node.color}"></span>
          <b>${t.node.number}</b> ${esc(cut(t.node.name, 64))}
          <i>${t.weight}</i></button></li>`).join("")}</ul>`;
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
  let moved = false;   // the user took over the camera: stop re-framing
  for (const type of ["wheel", "pointerdown"]) graph.canvas.addEventListener(type, () => { moved = true; }, { passive: true });
  graph.onSettled = () => { if (!moved) graph.fit(undefined, 600, 2); };
  graph.setData(nodes, []);
  // A bill with no link under the current filters would just float away: leave it out.
  graph.setVisible((n) => n.neighbors.length > 0, false);
  applyColors();
  refreshLinks();
  graph.fit(nodes, 0, 2);
  graph.reheat(1);
  window.GRAPH = graph;
})();
