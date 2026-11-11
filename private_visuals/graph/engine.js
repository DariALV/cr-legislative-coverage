// Force-directed graph on a canvas, in the spirit of Obsidian's graph view.
// The engine knows nothing about bills or deputies: a view hands it nodes
// ({x, y, size, color, label, shortLabel, image?}) and links ({source, target} as node
// objects, plus optional `level` 0-2 for thickness, `color` and `pull` for spring strength)
// and sets colors, filters and highlights from outside. Needs d3 v7.
(function () {
  "use strict";

  const DEFAULTS = {
    center: 0.008,       // pull toward the middle
    repel: 300,          // node-to-node repulsion
    repelRadius: 80,     // nodes farther apart than this don't push each other
    linkStrength: 1,     // multiplier on d3's per-link default
    linkDistance: 30,
    damping: 0.4,        // velocity decay: higher settles faster
    nodeScale: 1,
    linkWidth: 1,
    labelZoom: 1.6,      // zoom level at which node labels start to appear
    groupLabels: true,
    physics: true,
  };
  const INK = "#f0efec";
  const INK_SOFT = "#c3c2b7";
  const SURFACE = "#1a1a19";
  const DIM = 0.12;            // opacity of nodes outside the current focus
  const MAX_LABELS = 220;
  const LINK_LEVELS = [{ width: 1, alpha: 1 }, { width: 1.5, alpha: 1.25 }, { width: 2.2, alpha: 1.6 }];
  const COLORED_LINK_BOOST = 3;
  const IMAGE_MIN_PX = 5;      // below this radius on screen a photo is just noise
  const FONT = '"Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

  // Short-range repulsion on a uniform grid. d3.forceManyBody takes about 100 ms a tick with
  // 6,000 nodes packed this densely; this one only pairs up nodes closer than `radius`,
  // and fades to zero there so nothing jumps when a pair crosses the limit.
  function forceRepel() {
    let nodes = [], strength = 300, radius = 80, r2 = 0, k = 0, nodeRadius = () => 0;
    // Positions and forces are kept in cell order, so the inner loops read memory in sequence.
    let xs, ys, rs, fx, fy, cellOf, order, start = new Int32Array(1), cursor = new Int32Array(1);

    // Pushes apart the nodes in slots [a0, a1) and [b0, b1); `same` when both are one cell.
    function repel(a0, a1, b0, b1, same) {
      const X = xs, Y = ys, R = rs, FX = fx, FY = fy, R2 = r2, K = k, INV = 1 / r2;
      for (let a = a0; a < a1; a++) {
        const xa = X[a], ya = Y[a], ra = R[a] + COLLIDE_PAD;
        let fxa = 0, fya = 0;
        for (let b = same ? a + 1 : b0; b < b1; b++) {
          let dx = X[b] - xa, dy = Y[b] - ya, d2 = dx * dx + dy * dy;
          if (d2 >= R2) continue;
          if (d2 < 1) {  // on top of each other: push in a random direction
            dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1;
          }
          let w = K * (1 / d2 - INV);
          const touch = ra + R[b];
          if (d2 < touch * touch) {  // circles overlap: push them apart whatever the alpha
            const d = Math.sqrt(d2);
            w += COLLIDE * (touch - d) / d;
          }
          dx *= w; dy *= w;
          fxa -= dx; fya -= dy;
          FX[b] += dx; FY[b] += dy;
        }
        FX[a] += fxa; FY[a] += fya;
      }
    }

    function force(alpha) {
      const n = nodes.length;
      if (!n || strength <= 0) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const d = nodes[i];
        if (d.x < x0) x0 = d.x;
        if (d.x > x1) x1 = d.x;
        if (d.y < y0) y0 = d.y;
        if (d.y > y1) y1 = d.y;
      }
      // Cells at least `radius` wide, so a node only meets its own cell and the eight around it.
      const size = Math.max(radius, (x1 - x0) / 400, (y1 - y0) / 400);
      const cols = Math.floor((x1 - x0) / size) + 1, rows = Math.floor((y1 - y0) / size) + 1;
      const cells = cols * rows;
      if (start.length < cells + 1) { start = new Int32Array(cells + 1); cursor = new Int32Array(cells + 1); }
      else start.fill(0, 0, cells + 1);
      for (let i = 0; i < n; i++) {
        const d = nodes[i];
        const c = Math.floor((d.x - x0) / size) + cols * Math.floor((d.y - y0) / size);
        cellOf[i] = c;
        start[c + 1]++;
      }
      for (let c = 0; c < cells; c++) start[c + 1] += start[c];
      cursor.set(start.subarray(0, cells));
      for (let i = 0; i < n; i++) {
        const slot = cursor[cellOf[i]]++;
        order[slot] = i;
        xs[slot] = nodes[i].x; ys[slot] = nodes[i].y; rs[slot] = nodeRadius(nodes[i]); fx[slot] = 0; fy[slot] = 0;
      }

      r2 = radius * radius;
      k = strength * alpha;
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const c = cx + cy * cols, a0 = start[c], a1 = start[c + 1];
          if (a0 === a1) continue;
          repel(a0, a1, a0, a1, true);
          // Half of the neighborhood (east, south-west, south, south-east): each pair of cells once.
          if (cx + 1 < cols) repel(a0, a1, start[c + 1], start[c + 2], false);
          if (cy + 1 < rows) {
            const below = c + cols;
            if (cx > 0) repel(a0, a1, start[below - 1], start[below], false);
            repel(a0, a1, start[below], start[below + 1], false);
            if (cx + 1 < cols) repel(a0, a1, start[below + 1], start[below + 2], false);
          }
        }
      }
      for (let slot = 0; slot < n; slot++) {
        const d = nodes[order[slot]];
        d.vx += fx[slot]; d.vy += fy[slot];
      }
    }

    force.initialize = (list) => {
      nodes = list;
      const n = nodes.length;
      xs = new Float64Array(n); ys = new Float64Array(n); rs = new Float64Array(n);
      fx = new Float64Array(n); fy = new Float64Array(n);
      cellOf = new Int32Array(n); order = new Int32Array(n);
    };
    force.strength = (v) => { strength = v; return force; };
    force.radius = (v) => { radius = Math.max(1, v); return force; };
    force.nodeRadius = (fn) => { nodeRadius = fn; return force; };
    return force;
  }
  const COLLIDE = 0.25;     // share of an overlap undone per tick
  const COLLIDE_PAD = 2;    // gap kept between two circles

  // Springs along the links, like d3.forceLink, but the pull stops growing past a few link
  // lengths. With d3's linear spring the far-apart pairs yank everything into a clump on the
  // first ticks; capped, the nodes drift together and the repulsion keeps up.
  const MAX_STRETCH = 2.5;  // in link distances
  function forceSpring() {
    let links = [], distance = 30, strength = 1;
    function force(alpha) {
      const limit = MAX_STRETCH * distance;
      for (const l of links) {
        const s = l.source, t = l.target;
        let dx = t.x + t.vx - s.x - s.vx, dy = t.y + t.vy - s.y - s.vy;
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
        const f = Math.min(d - distance, limit) / d * alpha * Math.min(1.5, strength * l.base * (l.pull || 1));
        dx *= f; dy *= f;
        t.vx -= dx * l.bias; t.vy -= dy * l.bias;
        s.vx += dx * (1 - l.bias); s.vy += dy * (1 - l.bias);
      }
    }
    force.links = (list) => { links = list; return force; };
    force.distance = (v) => { distance = v; return force; };
    force.strength = (v) => { strength = v; return force; };
    return force;
  }

  class ForceGraph {
    constructor(canvas, overrides = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.defaults = { ...DEFAULTS, ...overrides };   // what "reset" goes back to
      this.settings = { ...this.defaults };
      this.transform = d3.zoomIdentity;
      this.nodes = [];
      this.links = [];
      this.visibleNodes = [];
      this.visibleLinks = [];
      this.groups = [];          // [{label, nodes}] drawn as map labels at their centroid
      this.highlight = null;     // Set of nodes kept bright (search, legend), or null
      this.hovered = null;
      this.selected = null;
      this.insets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });  // canvas area covered by panels
      this.onHover = () => {};
      this.onSelect = () => {};
      this.frame = 0;

      this.linkForce = forceSpring();
      this.chargeForce = forceRepel().nodeRadius((n) => n.size * this.settings.nodeScale);
      this.xForce = d3.forceX(0);
      this.yForce = d3.forceY(0);
      this.simulation = d3.forceSimulation()
        .force("link", this.linkForce)
        .force("charge", this.chargeForce)
        .force("x", this.xForce)
        .force("y", this.yForce)
        .on("tick", () => this.requestDraw())
        .stop();

      this.zoom = d3.zoom().scaleExtent([0.03, 14]).on("zoom", (e) => {
        this.transform = e.transform;
        this.requestDraw();
      });
      const drag = d3.drag()
        .container(canvas)
        // The subject is a wrapper without x/y, so event.x/y stay in canvas pixels.
        .subject((e) => { const node = this.nodeAt(e.x, e.y); return node ? { node } : null; })
        .on("start", (e) => {
          if (!e.active && this.settings.physics) this.simulation.alphaTarget(0.25).restart();
          this.pin(e.subject.node, e.x, e.y);
        })
        .on("drag", (e) => { this.pin(e.subject.node, e.x, e.y); this.requestDraw(); })
        .on("end", (e) => {
          if (!e.active) this.simulation.alphaTarget(0);
          const node = e.subject.node;
          if (this.settings.physics) { node.fx = null; node.fy = null; }
          else { node.x = node.fx; node.y = node.fy; node.fx = null; node.fy = null; }
        });
      d3.select(canvas).call(drag).call(this.zoom).on("dblclick.zoom", null);

      canvas.addEventListener("pointermove", (e) => {
        const node = this.nodeAt(e.offsetX, e.offsetY);
        if (node !== this.hovered) {
          this.hovered = node;
          canvas.style.cursor = node ? "pointer" : "";
          this.requestDraw();
        }
        this.onHover(node, e);
      });
      canvas.addEventListener("pointerleave", (e) => {
        this.hovered = null;
        this.onHover(null, e);
        this.requestDraw();
      });
      canvas.addEventListener("click", (e) => this.select(this.nodeAt(e.offsetX, e.offsetY)));
      addEventListener("resize", () => this.resize());
      this.resize();
    }

    // ---------- data ----------
    setData(nodes, links) {
      this.nodes = nodes;
      this.hovered = null;
      this.select(null);
      nodes.forEach((n) => { n.visible = true; });
      this.bySize = [...nodes].sort((a, b) => b.size - a.size);
      this.keep = () => true;
      this.setLinks(links, false);
    }

    /** Replaces the links (say, after moving a threshold) and keeps the nodes where they are. */
    setLinks(links, reheat = true) {
      this.links = links;
      for (const n of this.nodes) n.neighbors = [];
      for (const l of links) {
        l.source.neighbors.push(l.target);
        l.target.neighbors.push(l.source);
      }
      this.setVisible(this.keep, reheat);
    }

    /** Keeps only the nodes that pass `keep` (and the links between them) in the simulation. */
    setVisible(keep, reheat = true) {
      this.keep = keep;
      for (const n of this.nodes) n.visible = !!keep(n);
      this.visibleNodes = this.nodes.filter((n) => n.visible);
      this.visibleLinks = this.links.filter((l) => l.source.visible && l.target.visible);
      // One drawing pass per thickness level and color.
      const groups = new Map();
      for (const l of this.visibleLinks) {
        const key = `${l.level || 0}|${l.color || ""}`;
        if (!groups.has(key)) groups.set(key, { level: l.level || 0, color: l.color || null, links: [] });
        groups.get(key).links.push(l);
      }
      this.linkGroups = [...groups.values()];
      const degree = new Map();
      for (const l of this.visibleLinks) {
        degree.set(l.source, (degree.get(l.source) || 0) + 1);
        degree.set(l.target, (degree.get(l.target) || 0) + 1);
      }
      // As in d3.forceLink: links of busy nodes pull less, and the busier end moves less.
      for (const l of this.visibleLinks) {
        const a = degree.get(l.source), b = degree.get(l.target);
        l.base = 1 / Math.min(a, b);
        l.bias = a / (a + b);
      }
      this.simulation.nodes(this.visibleNodes);
      this.linkForce.links(this.visibleLinks);
      this.applySettings();
      if (this.selected && !this.selected.visible) this.select(null);
      this.colorsChanged();
      if (reheat) this.reheat(0.4);
    }

    /** Call after changing node.color. */
    colorsChanged() {
      const batches = new Map();
      for (const n of this.visibleNodes) {
        if (!batches.has(n.color)) batches.set(n.color, []);
        batches.get(n.color).push(n);
      }
      // Colors whose nodes are bigger on average go last, so they aren't buried under the small ones.
      const meanSize = (list) => list.reduce((sum, n) => sum + n.size, 0) / list.length;
      this.batches = [...batches].sort((a, b) => meanSize(a[1]) - meanSize(b[1]));
      this.requestDraw();
    }

    setHighlight(set) {
      this.highlight = set && set.size ? set : null;
      this.requestDraw();
    }

    select(node) {
      if (node === this.selected) return;
      this.selected = node;
      this.onSelect(node);
      this.requestDraw();
    }

    // ---------- forces ----------
    applySettings() {
      const s = this.settings;
      this.linkForce.distance(s.linkDistance).strength(s.linkStrength);
      this.chargeForce.strength(s.repel).radius(s.repelRadius);
      this.xForce.strength(s.center);
      this.yForce.strength(s.center);
      this.simulation.velocityDecay(s.damping);
      this.requestDraw();
    }

    set(key, value) {
      this.settings[key] = value;
      if (key === "physics") {
        if (value) this.reheat(0.3); else this.simulation.stop();
        return;
      }
      this.applySettings();
      if (["center", "repel", "repelRadius", "linkStrength", "linkDistance", "damping"].includes(key)) this.reheat(0.5);
    }

    reheat(alpha = 1) {
      if (!this.settings.physics) return;
      this.simulation.alpha(Math.max(this.simulation.alpha(), alpha)).restart();
    }

    pin(node, sx, sy) {
      node.fx = this.transform.invertX(sx);
      node.fy = this.transform.invertY(sy);
      if (!this.settings.physics) { node.x = node.fx; node.y = node.fy; }
    }

    // ---------- geometry ----------
    radius(node) {
      return Math.max(node.size * this.settings.nodeScale, 1.6 / this.transform.k);
    }

    nodeAt(sx, sy) {
      const x = this.transform.invertX(sx), y = this.transform.invertY(sy);
      const slack = 4 / this.transform.k;
      let best = null, bestGap = slack;
      for (const n of this.visibleNodes) {
        const gap = Math.hypot(n.x - x, n.y - y) - this.radius(n);
        if (gap < bestGap) { best = n; bestGap = gap; }
      }
      return best;
    }

    resize() {
      const dpr = devicePixelRatio || 1;
      this.width = this.canvas.clientWidth;
      this.height = this.canvas.clientHeight;
      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
      if (this.pendingFit && this.width && this.height) {
        const args = this.pendingFit;
        this.pendingFit = null;
        this.fit(...args);
      }
      this.requestDraw();
    }

    /** Zooms so that `nodes` (default: all visible) fill the canvas. */
    fit(nodes = this.visibleNodes, duration = 700, maxZoom = 3) {
      if (!nodes.length) return;
      if (!this.width || !this.height) {  // canvas not laid out yet: fit on the first resize
        this.pendingFit = [nodes, 0, maxZoom];
        return;
      }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of nodes) {
        x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x);
        y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
      }
      // Frame inside the part of the canvas that no panel covers.
      const inset = this.insets();
      const width = this.width - inset.left - inset.right, height = this.height - inset.top - inset.bottom;
      const pad = Math.min(60, width / 8, height / 8);
      const k = Math.min(maxZoom, (width - 2 * pad) / Math.max(x1 - x0, 1), (height - 2 * pad) / Math.max(y1 - y0, 1));
      const t = d3.zoomIdentity.translate(inset.left + width / 2, inset.top + height / 2).scale(k)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
      d3.select(this.canvas).transition().duration(duration).call(this.zoom.transform, t);
    }

    // ---------- drawing ----------
    requestDraw() {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
    }

    draw() {
      const { ctx, transform: t, settings: s } = this;
      const dpr = devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      if (!this.visibleNodes.length) return;

      // World-space bounds of the canvas, with a margin so big nodes don't pop at the edges.
      const margin = 40 / t.k;
      const x0 = t.invertX(0) - margin, x1 = t.invertX(this.width) + margin;
      const y0 = t.invertY(0) - margin, y1 = t.invertY(this.height) + margin;
      const inView = (n) => n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1;

      // The node under the pointer (or the selected one) lights up with its neighbors.
      const anchor = this.hovered || this.selected;
      const near = anchor ? new Set([anchor, ...anchor.neighbors.filter((n) => n.visible)]) : null;
      const bright = near || this.highlight;

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // Links, one path per thickness level and color.
      if (s.linkWidth > 0) {
        const stroke = (alpha, on) => {
          for (const { level, color, links } of this.linkGroups) {
            ctx.strokeStyle = color || INK;
            ctx.lineWidth = s.linkWidth * LINK_LEVELS[level].width / t.k;
            // A link with its own color carries meaning, so it is drawn stronger than the plain ones.
            ctx.globalAlpha = Math.min(0.95, alpha * LINK_LEVELS[level].alpha * (color ? COLORED_LINK_BOOST : 1));
            ctx.beginPath();
            for (const l of links) {
              const a = l.source, b = l.target;
              if ((!inView(a) && !inView(b)) || !on(a, b)) continue;
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
            }
            ctx.stroke();
          }
        };
        // Fainter when zoomed out, where thousands of links overlap and would wash out the nodes.
        stroke(bright ? 0.03 : Math.max(0.045, Math.min(0.3, 0.16 * t.k)), () => true);
        if (near) stroke(0.75, (a, b) => a === anchor || b === anchor);
        else if (bright) stroke(0.3, (a, b) => bright.has(a) && bright.has(b));
      }

      // Nodes, one path per color. A thin ring in the surface color separates overlapping ones.
      const ring = t.k > 0.5;
      const paint = (keep, alpha) => {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = SURFACE;
        ctx.lineWidth = 1 / t.k;
        for (const [color, nodes] of this.batches) {
          ctx.fillStyle = color;
          ctx.beginPath();
          for (const n of nodes) {
            if (!inView(n) || !keep(n)) continue;
            const r = this.radius(n);
            ctx.moveTo(n.x + r, n.y);
            ctx.arc(n.x, n.y, r, 0, 6.2832);
          }
          ctx.fill();
          if (ring) ctx.stroke();
        }
      };
      if (bright) {
        paint((n) => !bright.has(n), DIM);
        paint((n) => bright.has(n), 1);
      } else {
        paint(() => true, 1);
      }
      this.drawImages(inView, bright);
      ctx.globalAlpha = 1;
      for (const n of [this.selected, this.hovered]) {
        if (!n || !n.visible) continue;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2 / t.k;
        ctx.beginPath();
        ctx.arc(n.x, n.y, this.radius(n) + 2 / t.k, 0, 6.2832);
        ctx.stroke();
      }
      ctx.restore();

      this.drawNodeLabels(inView, near, bright);
      if (s.groupLabels) this.drawGroupLabels();
    }

    /** Photos inside the nodes that have one; the node's color stays visible as a ring. */
    drawImages(inView, bright) {
      const { ctx, transform: t } = this;
      for (const n of this.visibleNodes) {
        const image = n.image;
        if (!image || !image.complete || !image.naturalWidth || !inView(n)) continue;
        const r = this.radius(n);
        if (r * t.k < IMAGE_MIN_PX) continue;
        const inner = r - Math.max(2 / t.k, r * 0.14);
        // Square crop; portraits keep the top, where the face is.
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        const sx = (image.naturalWidth - side) / 2;
        const sy = (image.naturalHeight - side) * 0.15;
        ctx.globalAlpha = bright && !bright.has(n) ? DIM : 1;
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, n.y, inner, 0, 6.2832);
        ctx.clip();
        ctx.drawImage(image, sx, sy, side, side, n.x - inner, n.y - inner, inner * 2, inner * 2);
        ctx.restore();
      }
    }

    text(label, x, y, alpha, font, color) {
      const { ctx } = this;
      ctx.font = font;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3;
      ctx.strokeStyle = SURFACE;
      ctx.strokeText(label, x, y);
      ctx.fillStyle = color;
      ctx.fillText(label, x, y);
    }

    drawNodeLabels(inView, near, bright) {
      const { ctx, transform: t, settings: s } = this;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      const fade = Math.max(0, Math.min(1, (t.k - s.labelZoom) / (s.labelZoom * 0.35)));
      const long = t.k > s.labelZoom * 1.9;
      const drawn = new Set();
      const label = (n, alpha, strong) => {
        if (drawn.has(n)) return;
        drawn.add(n);
        const y = t.applyY(n.y) + this.radius(n) * t.k + 4;
        this.text(strong || long ? n.label : n.shortLabel, t.applyX(n.x), y, alpha,
          `${strong ? 600 : 400} 11px ${FONT}`, strong ? INK : INK_SOFT);
      };
      if (near) {
        const anchor = this.hovered || this.selected;
        label(anchor, 1, true);
        for (const n of near) if (inView(n)) label(n, 0.9, false);
      }
      if (fade > 0) {
        let count = 0;
        for (const n of this.bySize) {
          if (!n.visible || !inView(n)) continue;
          if (bright && !bright.has(n)) continue;
          label(n, fade * 0.9, false);
          if (++count >= MAX_LABELS) break;
        }
      }
      ctx.globalAlpha = 1;
    }

    drawGroupLabels() {
      const { ctx, transform: t } = this;
      // They are a map legend: clearest when zoomed out, out of the way when reading nodes.
      const alpha = Math.max(0, Math.min(1, 1.15 - t.k * 0.45));
      if (alpha <= 0.02) return;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const font = `600 11px ${FONT}`;
      ctx.font = font;
      const placed = [];
      for (const g of this.groups) {
        let x = 0, y = 0, count = 0;
        for (const n of g.nodes) if (n.visible) { x += n.x; y += n.y; count++; }
        if (!count) continue;
        const sx = t.applyX(x / count), sy = t.applyY(y / count);
        const w = ctx.measureText(g.label).width / 2 + 6;
        if (sx + w < 0 || sx - w > this.width || sy < -10 || sy > this.height + 10) continue;
        if (placed.some((p) => Math.abs(p.x - sx) < p.w + w && Math.abs(p.y - sy) < 16)) continue;
        placed.push({ x: sx, y: sy, w });
        this.text(g.label, sx, sy, alpha, font, INK);
      }
      ctx.globalAlpha = 1;
    }
  }

  ForceGraph.DEFAULTS = DEFAULTS;
  window.ForceGraph = ForceGraph;
})();
