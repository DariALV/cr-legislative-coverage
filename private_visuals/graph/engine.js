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
    far: 0,              // long-range repulsion between whole regions: what opens gaps between groups
    group: 0,            // pull of each node toward the middle of its own group (node.group)
    linkStrength: 1,     // multiplier on d3's per-link default
    linkDistance: 30,
    damping: 0.4,        // velocity decay: higher settles faster
    nodeScale: 1,
    imageOpacity: 1,     // photos inside the nodes; at 0 the nodes are plain
    linkWidth: 1,
    linkOpacity: 1,      // multiplier on the links' opacity; at 0 only those of the node under the pointer show
    labelZoom: 1.6,      // zoom level at which node labels start to appear
    labelSize: 11,       // node names, in px
    labelOpacity: 1,     // node names shown by the zoom (those of the node under the pointer stay)
    maxLabels: 220,      // node names drawn at once, biggest nodes first
    groupLabels: true,   // the names of the groups (graph.groups) on the map
    groupLabelSize: 11,
    groupLabelOpacity: 1,
    shapes: true,        // a soft patch of color behind each group (see computeShapes)
    shapeOpacity: 1,
    shapeEdges: false,   // the outline of each patch, where it holds most of the group's nodes
    physics: true,
  };
  const INK = "#f0efec";
  const INK_SOFT = "#c3c2b7";
  const SURFACE = "#1a1a19";
  const DIM = 0.12;            // opacity of nodes outside the current focus
  const LINK_LEVELS = [{ width: 1, alpha: 1 }, { width: 1.5, alpha: 1.25 }, { width: 2.2, alpha: 1.6 }];
  const COLORED_LINK_BOOST = 3;
  const IMAGE_MIN_PX = 5;      // below this radius on screen a photo is just noise
  // The engine steps the simulation itself: several ticks per frame while they fit in the
  // budget (a fast machine settles in a third of the frames) and one per frame when they don't.
  // A frame that is slow to draw (tens of thousands of nodes) gets about as long for ticks as
  // the drawing takes, up to MAX_TICK_BUDGET_MS, so a big layout settles in fewer frames.
  const TICK_BUDGET_MS = 9;
  const MAX_TICK_BUDGET_MS = 50;
  const MAX_TICKS_PER_FRAME = 4;
  // Links drawn per frame, while the layout moves and once it settles. With more than that on
  // screen a frame draws an even sample, stronger to keep the look; zoomed in, they all fit.
  const MOVING_LINKS = 6000;
  const SETTLED_LINKS = 40000;
  const MOVING_LABELS = 1500;  // with more nodes than this, names wait until the layout settles
  // Chrome strokes a line one device pixel wide or more through its general path code, which
  // is slow with thousands of segments (about 190 ms for the 22,000 links of the bills map), and
  // a thinner one through its hairline code (9 ms). So thin links are drawn just under a device
  // pixel, with the alpha raised to keep their weight; only the thick ones keep their width.
  const HAIRLINE = 0.95;       // device pixels
  const HAIRLINE_MAX = 2;      // links thinner than this, in device pixels, are drawn as hairlines
  const SQUARE_BELOW = 1.75;   // nodes smaller than this radius on screen are squares: cheaper to fill than arcs
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

  // Long-range repulsion, computed between the cells of a coarse grid instead of between nodes.
  // Every occupied cell pushes away with a force that falls off as 1/distance, and a node takes
  // the push at its own position, interpolated between the four cell centers around it. This is
  // what opens gaps between groups that don't touch: the short-range force can't, and
  // d3.forceManyBody does it node by node, which costs about twenty times more here.
  // With the pull toward the center, the nodes settle at an even density (about
  // center / (pi * strength) nodes per square unit), and the links gather them above it.
  const FAR_CELLS = 28;
  function forceFar() {
    let nodes = [], strength = 0;
    const G = FAR_CELLS, cells = G * G;
    const mass = new Float64Array(cells), mx = new Float64Array(cells), my = new Float64Array(cells);
    const fx = new Float64Array(cells), fy = new Float64Array(cells), occupied = new Int32Array(cells);
    function force(alpha) {
      const n = nodes.length;
      if (n < 2 || strength <= 0) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const d = nodes[i];
        if (d.x < x0) x0 = d.x;
        if (d.x > x1) x1 = d.x;
        if (d.y < y0) y0 = d.y;
        if (d.y > y1) y1 = d.y;
      }
      const w = Math.max((x1 - x0) / G, 1e-6), h = Math.max((y1 - y0) / G, 1e-6);
      mass.fill(0); mx.fill(0); my.fill(0);
      for (let i = 0; i < n; i++) {
        const d = nodes[i];
        const c = Math.min(G - 1, Math.floor((d.x - x0) / w)) + G * Math.min(G - 1, Math.floor((d.y - y0) / h));
        mass[c]++; mx[c] += d.x; my[c] += d.y;
      }
      let count = 0;
      for (let c = 0; c < cells; c++) {
        if (!mass[c]) continue;
        mx[c] /= mass[c]; my[c] /= mass[c];
        occupied[count++] = c;
      }
      // Push at every cell center from the other occupied cells. `soft` keeps a center of mass
      // that sits right next to a cell center from blowing up.
      const k = strength * alpha, soft = 0.25 * w * h;
      for (let cy = 0; cy < G; cy++) {
        for (let cx = 0; cx < G; cx++) {
          const c = cx + cy * G, px = x0 + (cx + 0.5) * w, py = y0 + (cy + 0.5) * h;
          let ax = 0, ay = 0;
          for (let o = 0; o < count; o++) {
            const b = occupied[o];
            if (b === c) continue;
            const dx = px - mx[b], dy = py - my[b];
            const f = mass[b] / (dx * dx + dy * dy + soft);
            ax += dx * f; ay += dy * f;
          }
          fx[c] = ax * k; fy[c] = ay * k;
        }
      }
      for (let i = 0; i < n; i++) {
        const d = nodes[i];
        const gx = (d.x - x0) / w - 0.5, gy = (d.y - y0) / h - 0.5;
        const ix = Math.max(0, Math.min(G - 2, Math.floor(gx))), iy = Math.max(0, Math.min(G - 2, Math.floor(gy)));
        const tx = Math.max(0, Math.min(1, gx - ix)), ty = Math.max(0, Math.min(1, gy - iy));
        const a = ix + iy * G, b = a + 1, c = a + G, e = c + 1;
        d.vx += (fx[a] * (1 - tx) + fx[b] * tx) * (1 - ty) + (fx[c] * (1 - tx) + fx[e] * tx) * ty;
        d.vy += (fy[a] * (1 - tx) + fy[b] * tx) * (1 - ty) + (fy[c] * (1 - tx) + fy[e] * tx) * ty;
      }
    }
    force.initialize = (list) => { nodes = list; };
    force.strength = (v) => { strength = v; return force; };
    return force;
  }

  // Pull toward the middle of the node's own group, plus a push between whole groups. The group is
  // whatever the page puts in node.group, so changing it makes the nodes regroup. The pull alone
  // gathers each group around its middle, but groups spread over the whole map have their middles
  // close together, and they would only pile up there. So two groups whose middles are closer than
  // their sizes ask (GROUP_ROOM times the sum of their spreads) also move apart, as a whole, each
  // the more the smaller it is.
  const GROUP_ROOM = 1.5;   // a spread (root mean square distance to the middle) is ~0.7 of a disk's radius
  const GROUP_PUSH = 2;     // push per unit of overlap, relative to the pull's strength
  function forceGroup() {
    let nodes = [], strength = 0;
    function force(alpha) {
      if (strength <= 0) return;
      const groups = new Map();
      for (const d of nodes) {
        if (d.group === undefined) continue;
        let g = groups.get(d.group);
        if (!g) groups.set(d.group, g = { x: 0, y: 0, n: 0, spread: 0, px: 0, py: 0 });
        g.x += d.x; g.y += d.y; g.n++;
      }
      for (const g of groups.values()) { g.x /= g.n; g.y /= g.n; }
      for (const d of nodes) {
        const g = groups.get(d.group);
        if (g) g.spread += (d.x - g.x) ** 2 + (d.y - g.y) ** 2;
      }
      const list = [...groups.values()];
      for (const g of list) g.spread = Math.sqrt(g.spread / g.n);
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          let dx = a.x - b.x, dy = a.y - b.y, dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1e-6) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dist = Math.sqrt(dx * dx + dy * dy); }
          const overlap = GROUP_ROOM * (a.spread + b.spread) - dist;
          if (overlap <= 0) continue;
          const f = overlap / dist * GROUP_PUSH * strength * alpha;
          const share = b.n / (a.n + b.n);
          a.px += dx * f * share; a.py += dy * f * share;
          b.px -= dx * f * (1 - share); b.py -= dy * f * (1 - share);
        }
      }
      const k = strength * alpha;
      for (const d of nodes) {
        const g = groups.get(d.group);
        if (!g) continue;
        d.vx += (g.x - d.x) * k + g.px;
        d.vy += (g.y - d.y) * k + g.py;
      }
    }
    force.initialize = (list) => { nodes = list; };
    force.strength = (v) => { strength = v; return force; };
    return force;
  }

  // Group shapes: a soft patch of color behind each group, made from the density of its nodes on a
  // coarse grid. It is strongest where most of the group sits and fades out toward its stray nodes;
  // where the patches of two groups overlap, their colors mix. The outline, when drawn, is the
  // density level that holds SHAPE_COVER of the group's nodes.
  const SHAPE_CELLS = 180;      // grid cells along the longer side of the map, for up to
  const SHAPE_FULL_GROUPS = 8;  // ... this many groups; with more, a coarser grid keeps the total work even,
  const SHAPE_MIN_CELLS = 96;   // ... down to this
  const SHAPE_COVER = 0.8;      // share of a group's nodes inside its outline
  const SHAPE_CORE = 0.5;       // share of its nodes in the part drawn at full strength
  const SHAPE_FADE = 0.35;      // the patch fades out at this share of the outline's density
  const SHAPE_ALPHA = 0.3;      // opacity of a full-strength patch at opacity 1
  const SHAPE_SPREAD = 0.2;     // blur, as a share of the group's spread (root mean square distance to its middle),
  const SHAPE_GAP = 0.75;       // ... or of the usual gap between its nodes, if wider (small, loose groups)
  const SHAPE_MAX_BLUR = 0.07;  // ... and never more than this share of the map
  const SHAPE_EVERY_MS = 250;   // while the layout moves, the shapes are redone at least this often,
  const SHAPE_SHARE = 0.15;     // ... or more often if they take less than this share of the time
  const SHAPE_SAMPLE = 3000;    // nodes per group read to place the levels

  /** One pass of a box blur of radius `r` cells over the window [x0, x1] x [y0, y1] of the grid `a`
   *  (rows of `w` cells), through `b` and back into `a`; the grid is taken as 0 outside the window.
   *  Three passes are close to a Gaussian blur with a standard deviation of about r cells. */
  function boxBlur(a, b, w, x0, x1, y0, y1, r) {
    const scale = 1 / (2 * r + 1);
    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = x0; x <= x1 && x <= x0 + r; x++) sum += a[row + x];
      for (let x = x0; x <= x1; x++) {
        b[row + x] = sum * scale;
        if (x + r + 1 <= x1) sum += a[row + x + r + 1];
        if (x - r >= x0) sum -= a[row + x - r];
      }
    }
    for (let x = x0; x <= x1; x++) {
      let sum = 0;
      for (let y = y0; y <= y1 && y <= y0 + r; y++) sum += b[y * w + x];
      for (let y = y0; y <= y1; y++) {
        a[y * w + x] = sum * scale;
        if (y + r + 1 <= y1) sum += b[(y + r + 1) * w + x];
        if (y - r >= y0) sum -= b[(y - r) * w + x];
      }
    }
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
      this.groups = [];          // [{key, label, color, nodes, shape}], see setGroups
      this.shapes = null;        // the patches behind the groups, see computeShapes
      this.shapesDirty = true;   // the nodes moved or the groups changed since the patches were made
      this.shapesAt = 0;         // when they were made
      this.shapesCost = 0;       // and how long that took, in ms
      this.highlight = null;     // Set of nodes kept bright (search, legend), or null
      this.hovered = null;
      this.selected = null;
      this.insets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });  // canvas area covered by panels
      this.onHover = () => {};
      this.onSelect = () => {};
      this.onSettled = () => {};  // the layout stopped moving
      this.frame = 0;
      this.running = false;      // the simulation is being stepped
      this.layoutKey = null;     // where the settled positions are remembered (see restoreLayout)

      this.linkForce = forceSpring();
      this.chargeForce = forceRepel().nodeRadius((n) => n.size * this.settings.nodeScale);
      this.farForce = forceFar();
      this.groupForce = forceGroup();
      this.xForce = d3.forceX(0);
      this.yForce = d3.forceY(0);
      this.simulation = d3.forceSimulation()
        .force("link", this.linkForce)
        .force("charge", this.chargeForce)
        .force("far", this.farForce)
        .force("group", this.groupForce)
        .force("x", this.xForce)
        .force("y", this.yForce)
        .stop();   // stepped by run(), not by d3's own timer

      this.zoom = d3.zoom().scaleExtent([0.03, 14]).on("zoom", (e) => {
        this.transform = e.transform;
        this.requestDraw();
      });
      const drag = d3.drag()
        .container(canvas)
        // The subject is a wrapper without x/y, so event.x/y stay in canvas pixels.
        .subject((e) => { const node = this.nodeAt(e.x, e.y); return node ? { node } : null; })
        .on("start", (e) => {
          if (!e.active && this.settings.physics) {
            this.simulation.alphaTarget(0.25);
            this.run();
          }
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
      this.shapesDirty = true;
      this.applySettings();
      if (this.selected && !this.selected.visible) this.select(null);
      this.colorsChanged();
      if (reheat) this.reheat(0.4);
    }

    /** The groups named on the map and drawn as patches: [{key, label, color, nodes, shape}].
     *  `nodes` may include hidden ones (only the visible count); `shape: false` names a group
     *  without drawing its patch. The group pull (settings.group) follows node.group instead. */
    setGroups(groups) {
      this.groups = groups;
      this.shapesDirty = true;
      this.requestDraw();
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
      this.farForce.strength(s.far);
      this.groupForce.strength(s.group);
      this.xForce.strength(s.center);
      this.yForce.strength(s.center);
      this.simulation.velocityDecay(s.damping);
      this.requestDraw();
    }

    set(key, value) {
      this.settings[key] = value;
      if (key === "physics") {
        if (value) this.reheat(0.3);   // when switched off, run() stops by itself on its next frame
        return;
      }
      if (["shapes", "shapeEdges", "nodeScale"].includes(key)) this.shapesDirty = true;
      this.applySettings();
      if (["center", "repel", "repelRadius", "far", "group", "linkStrength", "linkDistance", "damping"].includes(key)) this.reheat(0.5);
    }

    reheat(alpha = 1) {
      if (!this.settings.physics) return;
      this.simulation.alpha(Math.max(this.simulation.alpha(), alpha));
      this.run();
    }

    /** Sets how much the layout still has to move (1 is a full rearrangement) and runs it. */
    startAt(alpha) {
      this.simulation.alpha(alpha);
      this.run();
    }

    /** Steps the simulation, frame by frame, until it cools down. */
    run() {
      if (this.running || !this.settings.physics) return;
      this.running = true;
      const sim = this.simulation;
      let ticked = 0;   // when the ticks of the last frame ended
      const step = () => {
        if (!this.settings.physics) {
          this.running = false;
          this.requestDraw();
          return;
        }
        const start = performance.now();
        // What the last frame spent besides ticking: drawing it and waiting for the next one.
        const rest = ticked ? start - ticked : 0;
        const budget = rest > 2 * TICK_BUDGET_MS ? Math.min(MAX_TICK_BUDGET_MS, rest) : TICK_BUDGET_MS;
        let ticks = 0;
        do {
          sim.tick();
          ticks++;
        } while (ticks < MAX_TICKS_PER_FRAME && sim.alpha() >= sim.alphaMin() && performance.now() - start < budget);
        ticked = performance.now();
        this.shapesDirty = true;
        if (sim.alpha() < sim.alphaMin()) {
          this.running = false;
          this.draw();
          this.saveLayout();
          this.onSettled();
          return;
        }
        this.draw();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    /** Starts from the positions remembered under `key`, if there are any for these nodes,
     *  and remembers the settled ones there from now on. Returns whether it found them. */
    restoreLayout(key) {
      this.layoutKey = key;
      try {
        const saved = JSON.parse(localStorage.getItem(key));
        if (!saved || saved.length !== this.nodes.length * 2) return false;
        this.nodes.forEach((n, i) => { n.x = saved[2 * i]; n.y = saved[2 * i + 1]; });
        return true;
      } catch (error) {
        return false;   // no storage (private window) or a damaged entry: just lay it out again
      }
    }

    saveLayout() {
      // Only the map without the group pull is remembered: the next visit opens with the pull off.
      if (!this.layoutKey || this.settings.group > 0) return;
      try {
        localStorage.setItem(this.layoutKey, JSON.stringify(this.nodes.flatMap((n) => [Math.round(n.x), Math.round(n.y)])));
      } catch (error) { /* storage full or blocked: the layout is simply not remembered */ }
    }

    pin(node, sx, sy) {
      node.fx = this.transform.invertX(sx);
      node.fy = this.transform.invertY(sy);
      if (!this.settings.physics) { node.x = node.fx; node.y = node.fy; }
      this.shapesDirty = true;
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

      // The patches of the groups, behind everything else. While the layout moves they are redone as
      // often as they take SHAPE_SHARE of the time (every frame for a few hundred nodes), and at least
      // every SHAPE_EVERY_MS; once it settles, right away.
      if (s.shapes && this.groups.length) {
        const wait = this.running ? Math.min(SHAPE_EVERY_MS, this.shapesCost / SHAPE_SHARE) : 0;
        if (this.shapesDirty && performance.now() - this.shapesAt >= wait) {
          const start = performance.now();
          this.computeShapes();
          this.shapesCost = performance.now() - start;
        }
        this.drawShapes();
      }

      // Links, one path per thickness level and color. A frame draws at most MOVING_LINKS or
      // SETTLED_LINKS of those on screen (estimated from the share of nodes on screen), as an even sample.
      let shown = 0;
      for (const n of this.visibleNodes) if (inView(n)) shown++;
      const onScreen = this.visibleLinks.length * shown / this.visibleNodes.length;
      const sample = Math.max(1, Math.ceil(onScreen / (this.running ? MOVING_LINKS : SETTLED_LINKS)));
      if (s.linkWidth > 0) {
        const stroke = (alpha, on, stride = 1) => {
          for (const { level, color, links } of this.linkGroups) {
            ctx.strokeStyle = color || INK;
            const px = s.linkWidth * LINK_LEVELS[level].width * dpr;   // the width asked for, in device pixels
            const width = px < HAIRLINE_MAX ? Math.min(px, HAIRLINE) : px;
            ctx.lineWidth = width / dpr / t.k;
            // A link with its own color carries meaning, so it is drawn stronger than the plain ones.
            ctx.globalAlpha = Math.min(0.95, alpha * LINK_LEVELS[level].alpha * (color ? COLORED_LINK_BOOST : 1)
              * Math.sqrt(stride) * (px / width));
            ctx.beginPath();
            for (let i = 0; i < links.length; i += stride) {
              const l = links[i];
              const a = l.source, b = l.target;
              if ((!inView(a) && !inView(b)) || !on(a, b)) continue;
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
            }
            ctx.stroke();
          }
        };
        // Fainter when zoomed out, where thousands of links overlap and would wash out the nodes.
        // linkOpacity scales them all except those of the node under the pointer, which stay even at 0.
        const base = s.linkOpacity * (bright ? 0.03 : Math.max(0.045, Math.min(0.3, 0.16 * t.k)));
        if (base > 0) stroke(base, () => true, sample);
        if (near) stroke(0.75, (a, b) => a === anchor || b === anchor);
        else if (bright && s.linkOpacity > 0) stroke(0.3 * s.linkOpacity, (a, b) => bright.has(a) && bright.has(b));
      }

      // Nodes, one path per color. A thin ring in the surface color separates overlapping ones.
      // Nodes too small on screen to show their shape are squares of the same area.
      const ring = t.k > 0.5 && sample === 1;
      const square = SQUARE_BELOW / t.k;   // world radius below which a node is drawn as a square
      const paint = (keep, alpha) => {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = SURFACE;
        ctx.lineWidth = Math.min(1, HAIRLINE / dpr) / t.k;
        for (const [color, nodes] of this.batches) {
          ctx.fillStyle = color;
          ctx.beginPath();
          for (const n of nodes) {
            if (!inView(n) || !keep(n)) continue;
            const r = this.radius(n);
            if (r < square) {
              const half = r * 0.886;   // half the side of a square with the area of the circle
              ctx.rect(n.x - half, n.y - half, 2 * half, 2 * half);
            } else {
              ctx.moveTo(n.x + r, n.y);
              ctx.arc(n.x, n.y, r, 0, 6.2832);
            }
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
      const { ctx, transform: t, settings: s } = this;
      if (s.imageOpacity <= 0) return;
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
        ctx.globalAlpha = (bright && !bright.has(n) ? DIM : 1) * s.imageOpacity;
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, n.y, inner, 0, 6.2832);
        ctx.clip();
        ctx.drawImage(image, sx, sy, side, side, n.x - inner, n.y - inner, inner * 2, inner * 2);
        ctx.restore();
      }
    }

    /** Writes `label` with a halo in the surface color, as thick as the font asks. */
    text(label, x, y, alpha, size, weight, color) {
      const { ctx } = this;
      ctx.font = `${weight} ${size}px ${FONT}`;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(2, Math.min(6, size * 0.28));
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
        this.text(strong || long ? n.label : n.shortLabel, t.applyX(n.x), y, alpha, s.labelSize, strong ? 600 : 400, strong ? INK : INK_SOFT);
      };
      // The names around the node under the pointer don't follow labelOpacity, like its links.
      if (near) {
        const anchor = this.hovered || this.selected;
        label(anchor, 1, true);
        for (const n of near) if (inView(n)) label(n, 0.9, false);
      }
      const alpha = fade * 0.9 * s.labelOpacity;
      if (alpha > 0 && s.maxLabels > 0 && !(this.running && this.visibleNodes.length > MOVING_LABELS)) {
        let count = 0;
        for (const n of this.bySize) {
          if (!n.visible || !inView(n)) continue;
          if (bright && !bright.has(n)) continue;
          label(n, alpha, false);
          if (++count >= s.maxLabels) break;
        }
      }
      ctx.globalAlpha = 1;
    }

    drawGroupLabels() {
      const { ctx, transform: t, settings: s } = this;
      // They are a map legend: clearest when zoomed out, out of the way when reading nodes.
      const alpha = Math.max(0, Math.min(1, 1.15 - t.k * 0.45)) * s.groupLabelOpacity;
      if (alpha <= 0.02) return;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.font = `600 ${s.groupLabelSize}px ${FONT}`;
      const placed = [];
      for (const g of this.groups) {
        // Where the group's patch is densest; without patches, at the middle of its visible nodes.
        let x = 0, y = 0;
        if (this.shapes && g.peak && g.shape !== false) {
          [x, y] = g.peak;
        } else {
          let count = 0;
          for (const n of g.nodes) if (n.visible) { x += n.x; y += n.y; count++; }
          if (!count) continue;
          x /= count; y /= count;
        }
        const sx = t.applyX(x), sy = t.applyY(y);
        const w = ctx.measureText(g.label).width / 2 + 6;
        if (sx + w < 0 || sx - w > this.width || sy < -s.groupLabelSize || sy > this.height + s.groupLabelSize) continue;
        if (placed.some((p) => Math.abs(p.x - sx) < p.w + w && Math.abs(p.y - sy) < s.groupLabelSize * 1.45)) continue;
        placed.push({ x: sx, y: sy, w });
        this.text(g.label, sx, sy, alpha, s.groupLabelSize, 600, INK);
      }
      ctx.globalAlpha = 1;
    }

    /** Makes the patches behind the groups (see SHAPE_* above): one grid for all of them, a blurred
     *  density per group, and one image where every cell takes the colors of the groups present
     *  there, mixed by how strong each one is. The outlines are traced only once the layout rests. */
    computeShapes() {
      this.shapesDirty = false;
      this.shapesAt = performance.now();
      this.shapes = null;
      const s = this.settings;
      const sets = [];
      for (const g of this.groups) {
        g.peak = null;
        if (g.shape === false) continue;
        const members = g.nodes.filter((n) => n.visible);
        if (members.length) sets.push({ g, members });
      }
      if (!sets.length) return;

      // The grid covers the visible members with room around them for the widest blur.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const { members } of sets) {
        for (const n of members) {
          if (n.x < x0) x0 = n.x;
          if (n.x > x1) x1 = n.x;
          if (n.y < y0) y0 = n.y;
          if (n.y > y1) y1 = n.y;
        }
      }
      const maxBlur = SHAPE_MAX_BLUR * Math.max(x1 - x0, y1 - y0, 50);
      const pad = 3.2 * maxBlur;
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      const cells = Math.max(SHAPE_MIN_CELLS, Math.round(SHAPE_CELLS * Math.min(1, Math.sqrt(SHAPE_FULL_GROUPS / sets.length))));
      const cell = Math.max(x1 - x0, y1 - y0) / cells;
      const w = Math.ceil((x1 - x0) / cell) + 2, h = Math.ceil((y1 - y0) / cell) + 2;
      const size = w * h;
      const density = new Float32Array(size), scratch = new Float32Array(size);
      const weight = new Float32Array(size), red = new Float32Array(size), green = new Float32Array(size), blue = new Float32Array(size);
      const edges = [];
      const outline = s.shapeEdges && !this.running;
      // Grid value i sits at (x0 + (i % w) * cell, y0 + floor(i / w) * cell).
      const densityAt = (n) => {
        const gx = (n.x - x0) / cell, gy = (n.y - y0) / cell;
        const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, i = ix + iy * w;
        return (density[i] * (1 - fx) + density[i + 1] * fx) * (1 - fy) + (density[i + w] * (1 - fx) + density[i + w + 1] * fx) * fy;
      };

      for (const { g, members } of sets) {
        // The blur follows the group's own spread, so a tight group stays tight and one in two
        // places makes two patches. A small group spread thin gets at least its usual gap between
        // nodes (the side of the square each node gets in a disk as wide as the group), so its
        // nodes make one patch and not one dot each. Never thinner than its nodes nor wider than maxBlur.
        let mx = 0, my = 0, radius = 0;
        for (const n of members) { mx += n.x; my += n.y; radius += n.size; }
        mx /= members.length; my /= members.length;
        radius = radius / members.length * s.nodeScale;
        let spread = 0;
        for (const n of members) spread += (n.x - mx) ** 2 + (n.y - my) ** 2;
        spread = Math.sqrt(spread / members.length);
        const gap = spread * Math.sqrt(Math.PI / members.length);
        const blur = Math.min(maxBlur, Math.max(1.5 * cell, 1.2 * radius, SHAPE_SPREAD * spread, SHAPE_GAP * gap));
        const r = Math.max(1, Math.round(blur / cell));

        // The group's own window of the grid: its nodes plus the 3r cells the three passes reach.
        // Outside it the density is 0, so the work follows the group's size, not the map's.
        let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
        for (const n of members) {
          const gx = (n.x - x0) / cell, gy = (n.y - y0) / cell;
          if (gx < gx0) gx0 = gx;
          if (gx > gx1) gx1 = gx;
          if (gy < gy0) gy0 = gy;
          if (gy > gy1) gy1 = gy;
        }
        const reach = 3 * r + 2;
        const wx0 = Math.max(0, Math.floor(gx0) - reach), wx1 = Math.min(w - 1, Math.ceil(gx1) + reach);
        const wy0 = Math.max(0, Math.floor(gy0) - reach), wy1 = Math.min(h - 1, Math.ceil(gy1) + reach);

        // Each node spread over the four cells around it, then three box passes.
        for (let y = wy0; y <= wy1; y++) density.fill(0, y * w + wx0, y * w + wx1 + 1);
        for (const n of members) {
          const gx = (n.x - x0) / cell, gy = (n.y - y0) / cell;
          const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, i = ix + iy * w;
          density[i] += (1 - fx) * (1 - fy);
          density[i + 1] += fx * (1 - fy);
          density[i + w] += (1 - fx) * fy;
          density[i + w + 1] += fx * fy;
        }
        for (let pass = 0; pass < 3; pass++) boxBlur(density, scratch, w, wx0, wx1, wy0, wy1, r);

        // Levels read at the nodes: the outline holds SHAPE_COVER of them, the full-strength core SHAPE_CORE.
        const step = Math.max(1, Math.floor(members.length / SHAPE_SAMPLE));
        const levels = [];
        for (let k = 0; k < members.length; k += step) levels.push(densityAt(members[k]));
        levels.sort((a, b) => a - b);
        const edge = levels[Math.floor((1 - SHAPE_COVER) * (levels.length - 1))];
        const core = Math.max(edge * 1.25, levels[Math.floor((1 - SHAPE_CORE) * (levels.length - 1))]);
        const low = edge * SHAPE_FADE;

        const color = d3.rgb(g.color);
        let peak = -1, peakAt = 0;
        for (let y = wy0; y <= wy1; y++) {
          for (let i = y * w + wx0, end = y * w + wx1; i <= end; i++) {
            const v = density[i];
            if (v > peak) { peak = v; peakAt = i; }
            if (v <= low) continue;
            const t = Math.min(1, (v - low) / (core - low));
            const u = t * t * (3 - 2 * t);   // smoothstep: soft both at the rim and toward the core
            weight[i] += u;
            red[i] += u * color.r;
            green[i] += u * color.g;
            blue[i] += u * color.b;
          }
        }
        g.peak = [x0 + (peakAt % w) * cell, y0 + Math.floor(peakAt / w) * cell];

        if (outline) {
          // Traced on the window alone; d3.contours puts grid value i at i + 0.5.
          const ww = wx1 - wx0 + 1, wh = wy1 - wy0 + 1, part = new Float32Array(ww * wh);
          for (let y = 0; y < wh; y++) part.set(density.subarray((wy0 + y) * w + wx0, (wy0 + y) * w + wx1 + 1), y * ww);
          const [geometry] = d3.contours().size([ww, wh]).thresholds([edge])(part);
          const path = new Path2D();
          for (const polygon of geometry.coordinates) {
            for (const ring of polygon) {
              ring.forEach(([cx, cy], k) => {
                const px = x0 + (wx0 + cx - 0.5) * cell, py = y0 + (wy0 + cy - 0.5) * cell;
                if (k) path.lineTo(px, py); else path.moveTo(px, py);
              });
              path.closePath();
            }
          }
          edges.push({ color: g.color, path });
        }
      }

      // One image, a pixel per cell: the mixed color, and as opaque as the groups there are strong.
      const image = new ImageData(w, h);
      const px = image.data;
      for (let i = 0; i < size; i++) {
        const sum = weight[i];
        if (sum < 0.004) continue;
        px[4 * i] = red[i] / sum;
        px[4 * i + 1] = green[i] / sum;
        px[4 * i + 2] = blue[i] / sum;
        px[4 * i + 3] = Math.min(1, sum) * 255;
      }
      const canvas = this.shapeCanvas || (this.shapeCanvas = document.createElement("canvas"));
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").putImageData(image, 0, 0);
      // Pixel i covers [i, i + 1) of the image, so the image starts half a cell before x0.
      this.shapes = { canvas, x: x0 - cell / 2, y: y0 - cell / 2, width: w * cell, height: h * cell, edges };
    }

    drawShapes() {
      const { ctx, transform: t, settings: s, shapes } = this;
      if (!shapes || s.shapeOpacity <= 0) return;
      ctx.globalAlpha = Math.min(1, SHAPE_ALPHA * s.shapeOpacity);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(shapes.canvas, shapes.x, shapes.y, shapes.width, shapes.height);
      if (shapes.edges.length && s.shapeEdges) {
        ctx.globalAlpha = Math.min(1, 0.6 * s.shapeOpacity);
        ctx.lineWidth = 1.2 / t.k;
        ctx.lineJoin = "round";
        for (const { color, path } of shapes.edges) {
          ctx.strokeStyle = color;
          ctx.stroke(path);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  ForceGraph.DEFAULTS = DEFAULTS;
  window.ForceGraph = ForceGraph;
})();
