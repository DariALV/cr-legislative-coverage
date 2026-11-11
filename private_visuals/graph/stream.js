// Coverage over time (#69): substantive pairs (news item and bill) per week, one layer per topic.
// Three shapes of the same layers: a streamgraph, a stacked area and the share of each week.
(function () {
  "use strict";
  const P = window.GraphPress;
  const { $, nf, esc, cut, plural, bindPanelToggle, showTip, hideTip, isolateList } = window.GraphUI;
  if (!P) {
    $("missing").hidden = false;
    return;
  }

  const SHAPES = {
    river: { label: "Río", offset: d3.stackOffsetWiggle, note: "El grosor es lo que cuenta; la altura sobre el eje no significa nada." },
    stacked: { label: "Apilado", offset: d3.stackOffsetNone, note: "Franjas apiladas desde cero: el borde de arriba es el total de la semana." },
    share: { label: "Porcentaje", offset: d3.stackOffsetExpand, note: "Parte de la cobertura de cada semana que se lleva cada tema." },
  };
  const MARGIN = { top: 14, right: 18, bottom: 30, left: 44 };
  const DURATION = 750;
  const LABEL_MIN_PX = 15;     // a layer thinner than this at its widest gets no name on it
  const SCALE_PAIRS = 50;      // the thickness scale of the streamgraph

  const S = { shape: "river", outlets: new Set(), groups: new Set(), hover: null, pinned: null };
  const svg = d3.select("#stream");
  const layer = {
    grid: svg.append("g").attr("class", "stream-grid"),
    areas: svg.append("g"),
    labels: svg.append("g"),
    axis: svg.append("g").attr("class", "stream-axis"),
    scale: svg.append("g").attr("class", "stream-scale"),
    guide: svg.append("line").attr("class", "stream-guide").attr("visibility", "hidden"),
    hit: svg.append("rect").attr("class", "stream-hit"),
  };
  const x = d3.scaleLinear().domain([0, P.weeks.length - 1]);
  const y = d3.scaleLinear();
  const area = d3.area().x((d, i) => x(i)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
  let stacked = [], counts = [], size = { width: 0, height: 0 };

  // ---------- data ----------
  const passes = (p, { outlets = true, groups = true } = {}) =>
    (!outlets || !S.outlets.size || S.outlets.has(p.outlet)) && (!groups || !S.groups.size || S.groups.has(p.group));
  /** Pairs of one week (and one topic, if given) under the current filters. */
  const pairsOf = (week, group) => P.pairs.filter((p) => passes(p) && (week == null || p.week === week) && (group == null || p.group === group));

  // ---------- drawing ----------
  function render(animate) {
    const box = $("chart").getBoundingClientRect();
    size = { width: box.width, height: box.height };
    x.range([MARGIN.left, size.width - MARGIN.right]);
    counts = P.groups.map(() => new Array(P.weeks.length).fill(0));
    for (const p of P.pairs) if (passes(p)) counts[p.group][p.week]++;
    const rows = P.weeks.map((w) => counts.map((c) => c[w.id]));
    stacked = d3.stack().keys(d3.range(P.groups.length)).value((row, key) => row[key])
      .order(d3.stackOrderNone).offset(SHAPES[S.shape].offset)(rows);
    const low = d3.min(stacked, (l) => d3.min(l, (d) => d[0])), high = d3.max(stacked, (l) => d3.max(l, (d) => d[1]));
    y.domain([low, high > low ? high : low + 1]).range([size.height - MARGIN.bottom, MARGIN.top]);
    const t = d3.transition().duration(animate ? DURATION : 0).ease(d3.easeCubicInOut);

    layer.areas.selectAll("path").data(stacked, (l) => l.key).join(
      (enter) => enter.append("path").attr("class", "stream-layer").attr("fill", (l) => P.groups[l.key].color).attr("d", area),
      (update) => update.call((u) => u.transition(t).attr("d", area)),
    );

    // The name of a topic goes on its layer, at the week where it is thickest, if it fits.
    const spots = stacked.map((l) => {
      const inner = d3.range(1, P.weeks.length - 1);
      const week = d3.greatest(inner, (i) => l[i][1] - l[i][0]);
      const thickness = Math.abs(y(l[week][0]) - y(l[week][1]));
      return { key: l.key, x: x(week), y: (y(l[week][0]) + y(l[week][1])) / 2, fits: thickness >= LABEL_MIN_PX };
    });
    layer.labels.selectAll("text").data(spots, (s) => s.key).join(
      (enter) => enter.append("text").attr("class", "halo strong").attr("text-anchor", "middle").attr("dy", "0.35em")
        .attr("pointer-events", "none").text((s) => P.groups[s.key].short)
        .attr("x", (s) => s.x).attr("y", (s) => s.y).style("opacity", (s) => +s.fits),
      (update) => update.call((u) => u.transition(t).attr("x", (s) => s.x).attr("y", (s) => s.y).style("opacity", (s) => +s.fits)),
    );

    renderAxes(t);
    layer.hit.attr("x", MARGIN.left - 6).attr("y", MARGIN.top).attr("width", Math.max(0, size.width - MARGIN.left - MARGIN.right + 12))
      .attr("height", Math.max(0, size.height - MARGIN.top - MARGIN.bottom));
    renderLists();
    applyHover();

    const total = d3.sum(counts, (c) => d3.sum(c));
    const filters = [
      S.groups.size ? plural(S.groups.size, "tema", "temas") : "",
      S.outlets.size ? [...S.outlets].map((id) => P.outlets[id].name).join(", ") : "",
    ].filter(Boolean).join(" · ");
    $("subtitle").textContent = `${plural(total, "par", "pares")} noticia–expediente con cobertura sustantiva en ${P.weeks.length} semanas`
      + `${filters ? ` · solo ${filters}` : ""} · ${P.period}`;
    $("shape-note").textContent = SHAPES[S.shape].note;
  }

  function renderAxes(t) {
    const bottom = size.height - MARGIN.bottom;
    // Months along the bottom.
    const first = P.weeks[0].from, last = P.weeks[P.weeks.length - 1].to;
    const months = d3.utcMonth.range(d3.utcMonth.floor(first), d3.utcDay.offset(last, 1))
      .map((date) => ({ date, at: x(Math.max(0, P.weekPosition(date))) }));
    layer.axis.selectAll("line.base").data([0]).join("line").attr("class", "base")
      .attr("x1", MARGIN.left).attr("x2", size.width - MARGIN.right).attr("y1", bottom + 0.5).attr("y2", bottom + 0.5);
    layer.axis.selectAll("line.tick").data(months).join("line").attr("class", "tick")
      .attr("x1", (m) => m.at).attr("x2", (m) => m.at).attr("y1", bottom).attr("y2", bottom + 5);
    layer.axis.selectAll("text").data(months).join("text").attr("class", "muted")
      .attr("x", (m) => m.at + 4).attr("y", bottom + 17)
      .text((m) => m.date.toLocaleDateString("es-CR", { month: "long", timeZone: "UTC" }));

    // Values on the left: counts when stacked, percentages for the share; the streamgraph has
    // no baseline, so it gets a thickness scale instead.
    const ticks = S.shape === "river" ? [] : y.ticks(5);
    const format = S.shape === "share" ? (v) => `${Math.round(v * 100)} %` : (v) => nf(v);
    layer.grid.selectAll("line").data(ticks, (v) => v).join(
      (enter) => enter.append("line").attr("x1", MARGIN.left).attr("x2", size.width - MARGIN.right)
        .attr("y1", (v) => y(v)).attr("y2", (v) => y(v)).style("opacity", 0).call((e) => e.transition(t).style("opacity", 1)),
      (update) => update.call((u) => u.transition(t).attr("x2", size.width - MARGIN.right).attr("y1", (v) => y(v)).attr("y2", (v) => y(v)).style("opacity", 1)),
      (exit) => exit.remove(),
    );
    layer.grid.selectAll("text").data(ticks, (v) => v).join(
      (enter) => enter.append("text").attr("class", "muted").attr("text-anchor", "end").attr("dy", "0.32em").attr("x", MARGIN.left - 8)
        .attr("y", (v) => y(v)).text(format).style("opacity", 0).call((e) => e.transition(t).style("opacity", 1)),
      (update) => update.text(format).call((u) => u.transition(t).attr("y", (v) => y(v)).style("opacity", 1)),
      (exit) => exit.remove(),
    );
    // In the left margin, where the other shapes have their values: a bar as tall as 50 pairs.
    const bar = Math.abs(y(SCALE_PAIRS) - y(0)), middle = (MARGIN.top + bottom) / 2;
    layer.scale.attr("visibility", S.shape === "river" ? "visible" : "hidden").attr("transform", `translate(${MARGIN.left - 14},${middle})`);
    layer.scale.selectAll("line").data([0]).join("line").attr("y1", -bar / 2).attr("y2", bar / 2);
    layer.scale.selectAll("text").data([0]).join("text").attr("class", "muted").attr("text-anchor", "middle")
      .attr("transform", "rotate(-90)").attr("y", -8).text(`${SCALE_PAIRS} pares`);
  }

  // ---------- hover and pin ----------
  /** The week and the layer under a point of the chart. */
  function locate(event) {
    const [px, py] = d3.pointer(event, svg.node());
    const week = Math.max(0, Math.min(P.weeks.length - 1, Math.round(x.invert(px))));
    const value = y.invert(py);
    const hit = stacked.find((l) => l[week][1] > l[week][0] && value >= l[week][0] && value <= l[week][1]);
    return { week, group: hit ? hit.key : null };
  }
  const billLines = (list, limit) => P.topBills(list, limit)
    .map((b) => `<span><b>${b.number}</b> ${esc(cut(b.name, 54))} · ${nf(b.count)}</span>`).join("");
  function tipOf({ week, group }) {
    const inWeek = d3.sum(counts, (c) => c[week]);
    if (group == null) {
      return `<b>${esc(P.weekLabel(week))}</b><span>${plural(inWeek, "par", "pares")} en total</span>${billLines(pairsOf(week), 3)}`;
    }
    const n = counts[group][week];
    return `<b>${esc(P.groups[group].name)}</b>
      <span>${esc(P.weekLabel(week))} · ${plural(n, "par", "pares")} (${Math.round(100 * n / (inWeek || 1))} % de la semana)</span>
      ${billLines(pairsOf(week, group), 3)}`;
  }
  function applyHover() {
    const focus = S.hover || S.pinned;
    layer.areas.selectAll("path").classed("dim", (l) => !!focus && focus.group != null && l.key !== focus.group);
    layer.guide.attr("visibility", focus ? "visible" : "hidden");
    if (focus) layer.guide.attr("x1", x(focus.week)).attr("x2", x(focus.week)).attr("y1", MARGIN.top).attr("y2", size.height - MARGIN.bottom);
  }
  layer.hit
    .on("pointermove", (e) => { S.hover = locate(e); applyHover(); showTip(tipOf(S.hover), e); })
    .on("pointerleave", () => { S.hover = null; applyHover(); hideTip(); })
    .on("click", (e) => {
      const spot = locate(e);
      S.pinned = S.pinned && S.pinned.week === spot.week && S.pinned.group === spot.group ? null : spot;
      applyHover();
      renderBills();
    });

  // ---------- lists ----------
  function renderBills() {
    const pin = S.pinned;
    const list = pin ? pairsOf(pin.week, pin.group) : pairsOf();
    $("bills-title").textContent = pin ? `Expedientes de la ${P.weekLabel(pin.week).toLowerCase().replace(/ \(.*/, "")}` : "Expedientes más cubiertos";
    $("bills").innerHTML = P.topBills(list, 8).map((b) => `
      <li><a href="../jev_answers/#bill=${b.number}" target="_blank" rel="noopener" title="${esc(b.name)}">
        <b>${b.number}</b> ${esc(cut(b.name, 44))}<i>${nf(b.count)}</i></a></li>`).join("");
    $("bills-note").innerHTML = pin
      ? `${pin.group != null ? `${esc(P.groups[pin.group].name)} · ` : ""}${plural(list.length, "par", "pares")}. <button class="link-button" id="unpin">Volver a todo el período</button>`
      : "Un clic en el gráfico deja aquí los expedientes de esa semana y ese tema.";
  }
  $("bills-note").addEventListener("click", (e) => {
    if (!e.target.closest("#unpin")) return;
    S.pinned = null;
    applyHover();
    renderBills();
  });
  let drawGroups = () => {}, drawOutlets = () => {};
  function renderLists() {
    drawGroups();
    drawOutlets();
    renderBills();
  }
  const changed = () => { S.pinned = null; render(true); };
  drawGroups = isolateList($("groups"), () => {
    const totals = d3.rollup(P.pairs.filter((p) => passes(p, { groups: false })), (list) => list.length, (p) => p.group);
    return P.groups.map((g) => ({ key: g.id, label: g.name, color: g.color, count: totals.get(g.id) || 0 }));
  }, S.groups, changed);
  drawOutlets = isolateList($("outlets"), () => {
    const totals = d3.rollup(P.pairs.filter((p) => passes(p, { outlets: false })), (list) => list.length, (p) => p.outlet);
    return P.outlets.map((o) => ({ key: o.id, label: o.name, color: P.NEUTRAL, count: totals.get(o.id) || 0 }));
  }, S.outlets, changed);

  $("shapes").innerHTML = Object.entries(SHAPES).map(([key, s]) => `<button data-shape="${key}" class="${key === S.shape ? "on" : ""}">${s.label}</button>`).join("");
  $("shapes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-shape]");
    if (!b || b.dataset.shape === S.shape) return;
    S.shape = b.dataset.shape;
    for (const other of $("shapes").children) other.classList.toggle("on", other === b);
    render(true);
  });

  // ---------- start ----------
  const resize = () => render(false);
  addEventListener("resize", resize);
  bindPanelToggle(resize);
  render(false);
  window.STREAM = { state: S, get counts() { return counts; }, get stacked() { return stacked; } };
})();
