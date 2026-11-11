// Flow of the coverage (#69): outlet -> topic of the bill -> stage of the bill according to the
// news. Every band is a group of substantive pairs (news item and bill) and its thickness is how
// many they are. One column gives the color, and its bands keep that color across the whole
// diagram, so an outlet can be followed down to the stages (or a stage back to the outlets).
(function () {
  "use strict";
  const P = window.GraphPress;
  const { $, nf, esc, cut, plural, bindPanelToggle, showTip, hideTip } = window.GraphUI;
  if (!P) {
    $("missing").hidden = false;
    return;
  }

  const NODE_WIDTH = 12;
  const MIN_GAP = 10;          // between the blocks of the fullest column
  const MARGIN = { top: 30, bottom: 10, left: 168, right: 176 };
  const PARTICLES = 380;
  const DURATION = 650;

  // ---------- columns ----------
  // Outlets from the most to the least coverage; topics in the layer order of press.js;
  // stages in the order of the legislative process.
  const volume = d3.rollup(P.pairs, (list) => list.length, (p) => p.outlet);
  const COLUMNS = [
    { key: "outlet", label: "Medio", title: "Medio", items: [...P.outlets].sort((a, b) => volume.get(b.id) - volume.get(a.id)) },
    { key: "group", label: "Tema", title: "Tema del expediente", items: P.groups },
    { key: "stage", label: "Etapa", title: "Etapa según la noticia", items: P.stages },
  ];
  for (const column of COLUMNS) {
    column.rank = new Map(column.items.map((item, i) => [item.id, i]));
    column.item = new Map(column.items.map((item) => [item.id, item]));
  }
  const columnOf = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));

  // ---------- state ----------
  const S = {
    color: "group",              // the column whose blocks give the color
    focus: null,                // { dim, id }: only the pairs that go through that block
    showUnstated: true,
    motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
    hover: null,                 // { dim, id } (a block or a legend row) or { link }
  };
  const svg = d3.select("#flow");
  const layer = { links: svg.append("g"), nodes: svg.append("g"), heads: svg.append("g") };
  let nodes = [], links = [], total = 0, shown = [];

  // ---------- layout ----------
  function layout() {
    const box = $("chart").getBoundingClientRect();
    const narrow = box.width < 700;
    const left = narrow ? 96 : MARGIN.left, right = narrow ? 120 : MARGIN.right;
    const xs = [left, (left + box.width - right - NODE_WIDTH) / 2, box.width - right - NODE_WIDTH];
    const height = box.height - MARGIN.top - MARGIN.bottom;

    shown = P.pairs.filter((p) => (S.showUnstated || !P.stages[p.stage].unstated) && (!S.focus || p[S.focus.dim] === S.focus.id));
    total = shown.length;
    const counts = COLUMNS.map((c) => d3.rollup(shown, (list) => list.length, (p) => p[c.key]));
    const most = d3.max(counts, (c) => c.size) || 1;
    const scale = total ? Math.max(0, height - MIN_GAP * (most - 1)) / total : 0;

    nodes = [];
    COLUMNS.forEach((column, c) => {
      const present = column.items.filter((item) => counts[c].get(item.id));
      // Every column spans the full height: the ones with fewer blocks get wider gaps.
      const gap = present.length > 1 ? (height - scale * total) / (present.length - 1) : 0;
      let y = MARGIN.top + (present.length > 1 ? 0 : (height - scale * total) / 2);
      for (const item of present) {
        const value = counts[c].get(item.id);
        nodes.push({ key: `${column.key}|${item.id}`, dim: column.key, column: c, id: item.id, item, value, x: xs[c], y, h: value * scale });
        y += value * scale + gap;
      }
    });
    const nodeOf = new Map(nodes.map((n) => [n.key, n]));

    // A band joins two neighboring columns; when the color comes from the third one, it is
    // split into one band per color.
    links = [];
    const tint = columnOf[S.color];
    for (let side = 0; side < 2; side++) {
      const a = COLUMNS[side], b = COLUMNS[side + 1];
      const rolled = d3.rollup(shown, (list) => list.length, (p) => `${p[a.key]}|${p[b.key]}|${p[S.color]}`);
      for (const [key, value] of rolled) {
        const [ida, idb, idc] = key.split("|").map(Number);
        links.push({
          key: `${side}|${key}`, side, value, a: ida, b: idb, c: idc, split: tint !== a && tint !== b,
          source: nodeOf.get(`${a.key}|${ida}`), target: nodeOf.get(`${b.key}|${idb}`),
          color: tint.item.get(idc).color, w: value * scale,
          x0: xs[side] + NODE_WIDTH, x1: xs[side + 1],
        });
      }
      // Bands leave and reach a block in the order of the blocks at the other end, so they don't cross more than needed.
      const stack = (end, other, rank) => {
        for (const [, list] of d3.group(links.filter((l) => l.side === side), (l) => l[end])) {
          let y = list[0][end].y;
          list.sort((p, q) => rank.get(p[other]) - rank.get(q[other]) || tint.rank.get(p.c) - tint.rank.get(q.c));
          for (const l of list) {
            l[end === "source" ? "y0" : "y1"] = y;
            y += l.w;
          }
        }
      };
      stack("source", "b", b.rank);
      stack("target", "a", a.rank);
    }
    return { xs, narrow };
  }

  const r1 = (v) => Math.round(v * 10) / 10;
  function ribbon(l) {
    const xm = r1((l.x0 + l.x1) / 2), w = Math.max(l.w, 0.6);
    const x0 = r1(l.x0), x1 = r1(l.x1), a = r1(l.y0), b = r1(l.y1), c = r1(l.y1 + w), d = r1(l.y0 + w);
    return `M${x0},${a}C${xm},${a} ${xm},${b} ${x1},${b}L${x1},${c}C${xm},${c} ${xm},${d} ${x0},${d}Z`;
  }

  // ---------- drawing ----------
  const share = (part, whole) => `${Math.round(100 * part / (whole || 1))} %`;
  const nameOf = (dim, id) => columnOf[dim].item.get(id).name;

  function nodeTip(n) {
    return `<b>${esc(n.item.name)}</b><span>${plural(n.value, "par", "pares")} noticia–expediente · ${share(n.value, total)} ${S.focus ? "de lo filtrado" : "del total"}</span>`
      + (S.focus && S.focus.dim === n.dim ? "<span>Clic para quitar el filtro</span>" : "<span>Clic para dejar solo lo que pasa por aquí</span>");
  }
  function linkTip(l) {
    const whole = links.filter((o) => o.side === l.side && o.a === l.a && o.b === l.b).reduce((sum, o) => sum + o.value, 0);
    const from = l.source.item, to = l.target.item;
    return `<b>${esc(from.short || from.name)} → ${esc(to.short || to.name)}</b>`
      + (l.split ? `<span>${esc(columnOf[S.color].label)}: ${esc(nameOf(S.color, l.c))} · ${plural(l.value, "par", "pares")} de ${nf(whole)}</span>` : "")
      + `<span>${plural(whole, "par", "pares")} · ${share(whole, l.source.value)} de ${esc(from.short || from.name)} · ${share(whole, l.target.value)} de ${esc(to.short || to.name)}</span>`;
  }

  /** Whether a band belongs to what the pointer is on. */
  function lit(l) {
    const h = S.hover;
    if (!h) return true;
    if (h.link) return l === h.link || (l.split && h.link.split && l.c === h.link.c && l.side === h.link.side && l.a === h.link.a && l.b === h.link.b);
    if (h.dim === S.color && l.c === h.id) return true;
    return COLUMNS[l.side].key === h.dim ? l.a === h.id : COLUMNS[l.side + 1].key === h.dim && l.b === h.id;
  }
  function applyHover() {
    layer.links.selectAll("path").classed("dim", (l) => !lit(l)).classed("lit", (l) => !!S.hover && lit(l));
  }
  function setHover(hover, html, event) {
    S.hover = hover;
    applyHover();
    if (hover) showTip(html, event); else hideTip();
  }

  function toggleFocus(dim, id) {
    S.focus = S.focus && S.focus.dim === dim && S.focus.id === id ? null : { dim, id };
    S.hover = null;
    hideTip();
    render(true);
  }

  function render(animate) {
    const { xs, narrow } = layout();
    const t = d3.transition().duration(animate ? DURATION : 0).ease(d3.easeCubicInOut);

    layer.links.selectAll("path").data(links, (l) => l.key).join(
      (enter) => enter.append("path").attr("class", "flow-link").attr("d", ribbon).attr("fill", (l) => l.color)
        .style("opacity", 0).call((e) => e.transition(t).style("opacity", 1)),
      (update) => update.call((u) => u.transition(t).attr("d", ribbon).attr("fill", (l) => l.color).style("opacity", 1)),
      (exit) => exit.call((x) => x.transition(t).style("opacity", 0).remove()),
    )
      .on("pointermove", (e, l) => setHover({ link: l }, linkTip(l), e))
      .on("pointerleave", () => setHover(null));

    const label = (n) => {
      const text = n.dim === "group" ? cut(n.item.name, narrow ? 16 : 30) : narrow && n.dim === "outlet" ? n.item.name.split(" ")[0] : n.item.name;
      return `${esc(text)} <tspan class="muted">${nf(n.value)}</tspan>`;
    };
    const place = (sel) => sel.attr("transform", (n) => `translate(${r1(n.x)},${r1(n.y)})`);
    const blocks = layer.nodes.selectAll("g").data(nodes, (n) => n.key).join(
      (enter) => {
        const g = enter.append("g").attr("class", "flow-node").call(place).style("opacity", 0);
        g.append("rect").attr("width", NODE_WIDTH).attr("rx", 2).attr("height", (n) => Math.max(n.h, 1.5))
          .attr("fill", (n) => (n.dim === S.color ? n.item.color : P.NEUTRAL));
        // The topic names sit on top of the bands: a plate behind them keeps them readable.
        g.filter((n) => n.column === 1).append("rect").attr("class", "plate").attr("rx", 3);
        g.append("text").attr("class", "halo").attr("dy", "0.35em").attr("y", (n) => n.h / 2);
        g.call((e) => e.transition(t).style("opacity", 1));
        return g;
      },
      (update) => update.call((u) => u.transition(t).call(place).style("opacity", 1)),
      (exit) => exit.call((x) => x.transition(t).style("opacity", 0).remove()),
    );
    blocks.select("rect").transition(t).attr("height", (n) => Math.max(n.h, 1.5))
      .attr("fill", (n) => (n.dim === S.color ? n.item.color : P.NEUTRAL));
    blocks.select("text").html(label)
      .attr("text-anchor", (n) => (n.column === 0 ? "end" : "start"))
      .attr("x", (n) => (n.column === 0 ? -8 : NODE_WIDTH + 8))
      .each(function (n) { n.labelWidth = this.getComputedTextLength(); })
      .transition(t).attr("y", (n) => n.h / 2);
    blocks.select(".plate").attr("x", NODE_WIDTH + 4).attr("width", (n) => n.labelWidth + 8).attr("height", 16)
      .transition(t).attr("y", (n) => n.h / 2 - 8);
    blocks
      .on("pointermove", (e, n) => setHover({ dim: n.dim, id: n.id }, nodeTip(n), e))
      .on("pointerleave", () => setHover(null))
      .on("click", (e, n) => toggleFocus(n.dim, n.id));

    layer.heads.selectAll("text").data(COLUMNS).join("text")
      .attr("class", "muted head").attr("y", 14)
      .attr("text-anchor", (c, i) => (i === 0 ? "end" : "start"))
      .attr("x", (c, i) => (i === 0 ? xs[i] + NODE_WIDTH : xs[i]))
      .text((c) => c.title);

    applyHover();
    renderLegend();
    renderBills();
    const focus = S.focus ? ` · solo ${nameOf(S.focus.dim, S.focus.id)}` : "";
    $("subtitle").textContent = `${plural(total, "par", "pares")} noticia–expediente con cobertura sustantiva${focus} · ${P.period}`;
    seedParticles();
  }

  // ---------- legend (the column that gives the color) ----------
  function renderLegend() {
    const column = columnOf[S.color];
    const counts = d3.rollup(shown, (list) => list.length, (p) => p[S.color]);
    $("legend").innerHTML = column.items.map((item) => {
      const on = S.focus && S.focus.dim === S.color && S.focus.id === item.id;
      return `
      <button class="legend-item${on ? " on" : ""}" data-id="${item.id}" ${counts.get(item.id) ? "" : "disabled"}>
        <span class="swatch" style="background:${item.color}"></span>
        <span class="legend-label" title="${esc(item.name)}">${esc(item.name)}</span>
        <span class="legend-count">${nf(counts.get(item.id) || 0)}</span>
      </button>`;
    }).join("") + (S.focus ? `<button class="link-button" data-clear>Quitar el filtro (${esc(cut(nameOf(S.focus.dim, S.focus.id), 30))})</button>` : "");
  }
  $("legend").addEventListener("click", (e) => {
    if (e.target.closest("[data-clear]")) { S.focus = null; render(true); return; }
    const item = e.target.closest("[data-id]");
    if (item) toggleFocus(S.color, +item.dataset.id);
  });
  $("legend").addEventListener("pointerover", (e) => {
    const item = e.target.closest("[data-id]");
    S.hover = item ? { dim: S.color, id: +item.dataset.id } : null;
    applyHover();
  });
  $("legend").addEventListener("pointerleave", () => { S.hover = null; applyHover(); });

  $("modes").innerHTML = COLUMNS.map((c) => `<button data-color="${c.key}" class="${c.key === S.color ? "on" : ""}">${c.label}</button>`).join("");
  $("modes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-color]");
    if (!b || b.dataset.color === S.color) return;
    S.color = b.dataset.color;
    for (const other of $("modes").children) other.classList.toggle("on", other === b);
    render(true);
  });

  // ---------- bills behind what is shown ----------
  function renderBills() {
    $("bills-title").textContent = S.focus ? `Expedientes más cubiertos: ${cut(nameOf(S.focus.dim, S.focus.id), 24)}` : "Expedientes más cubiertos";
    $("bills").innerHTML = P.topBills(shown, 8).map((b) => `
      <li><a href="../jev_answers/#bill=${b.number}" target="_blank" rel="noopener" title="${esc(b.name)}">
        <b>${b.number}</b> ${esc(cut(b.name, 44))}<i>${nf(b.count)}</i></a></li>`).join("");
  }

  // ---------- filters ----------
  $("show-unstated").checked = S.showUnstated;
  $("show-unstated").addEventListener("change", (e) => {
    S.showUnstated = e.target.checked;
    if (!S.showUnstated && S.focus && S.focus.dim === "stage" && P.stages[S.focus.id].unstated) S.focus = null;
    render(true);
  });
  $("motion").checked = S.motion;
  $("motion").addEventListener("change", (e) => { S.motion = e.target.checked; animate(); });

  // ---------- particles ----------
  // Dots that travel along the bands, more of them where the band is thicker.
  const canvas = $("particles"), ctx = canvas.getContext("2d");
  let particles = [], cumulative = [], frame = 0, last = 0;
  function pickLink() {
    const target = Math.random() * cumulative[cumulative.length - 1];
    return links[d3.bisectLeft(cumulative, target)];
  }
  const spawn = (t) => ({ link: pickLink(), at: Math.random(), t, speed: 0.1 + Math.random() * 0.12 });
  function seedParticles() {
    let sum = 0;
    cumulative = links.map((l) => (sum += l.value));
    particles = links.length ? d3.range(PARTICLES).map(() => spawn(Math.random())) : [];
    animate();
  }
  function sizeCanvas() {
    const box = $("chart").getBoundingClientRect(), dpr = devicePixelRatio || 1;
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function draw(now) {
    frame = 0;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!S.motion || document.hidden) return;
    for (let i = 0; i < particles.length; i++) {
      let p = particles[i];
      p.t += p.speed * dt;
      if (p.t >= 1) p = particles[i] = spawn(0);
      const l = p.link, t = p.t, u = 1 - t;
      // Same curve as the band: a cubic with both handles at the middle x.
      const xm = (l.x0 + l.x1) / 2, y0 = l.y0 + p.at * l.w, y1 = l.y1 + p.at * l.w;
      const x = u * u * u * l.x0 + 3 * u * t * xm + t * t * t * l.x1;
      const y = (u * u * u + 3 * u * u * t) * y0 + (3 * u * t * t + t * t * t) * y1;
      ctx.globalAlpha = Math.min(1, t * 8, u * 8) * (lit(l) ? 0.95 : 0.12);
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, 6.2832);
      ctx.fill();
    }
    frame = requestAnimationFrame(draw);
  }
  function animate() {
    if (!frame) frame = requestAnimationFrame(draw);
  }
  document.addEventListener("visibilitychange", animate);

  // ---------- start ----------
  const resize = () => { sizeCanvas(); render(false); };
  addEventListener("resize", resize);
  bindPanelToggle(resize);
  resize();
  window.FLOW = { state: S, get nodes() { return nodes; }, get links() { return links; }, get total() { return total; } };
})();
