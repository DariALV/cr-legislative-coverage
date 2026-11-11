// What the graph pages share: text helpers and the wiring of the common panel sections
// (appearance and force sliders, physics switch, buttons, tooltip). Each page adds its own
// filters, color modes and detail card.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);

  const nf = (n) => n.toLocaleString("es-CR");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const sentence = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
  const fmt = (v) => String(+(+v).toFixed(3)).replace(".", ",");
  const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : many}`;

  // Colors shared by the pages. Eight categorical hues stepped for the dark surface, in an order
  // whose neighbors stay apart for color-blind readers. Parties in the color people know them by;
  // the scale goes from against (red) through a neutral light gray to in favor (green).
  const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
  // Jev's stance on a bill, 0-100 (50 is neutral), in the nine steps of STANCE; most bills sit between 30 and 80.
  const stanceBin = (stance) => Math.round(Math.max(0, Math.min(1, (stance - 15) / 70)) * 8);
  const PARTY_COLORS = { PPSO: "#4db8e8", PLN: "#2fa84f", FA: "#f2c53d", PUSC: "#e04e4e", CAC: "#f08a3c" };
  // The actors whose position on a bill Jev reads from the news, keyed like its questions.
  const ACTORS = {
    pueblo_soberano: { short: "PPSO", name: "Pueblo Soberano", color: PARTY_COLORS.PPSO },
    liberacion_nacional: { short: "PLN", name: "Liberación Nacional", color: PARTY_COLORS.PLN },
    frente_amplio: { short: "FA", name: "Frente Amplio", color: PARTY_COLORS.FA },
    unidad_social_cristiana: { short: "PUSC", name: "Unidad Social Cristiana", color: PARTY_COLORS.PUSC },
    agenda_ciudadana: { short: "CAC", name: "Coalición Agenda Ciudadana", color: PARTY_COLORS.CAC },
    executive: { short: "Ejecutivo", name: "Poder Ejecutivo", color: "#e8e6df" },
  };
  const LEAN = 0.25;   // from here on a mean position (-1 to 1) counts as in favor or against
  const leanOf = (value) => (value >= LEAN ? "favor" : value <= -LEAN ? "against" : "neutral");
  const leanText = (value) => (value >= 0.6 ? "a favor" : value >= LEAN ? "más bien a favor"
    : value > -LEAN ? "dividido" : value > -0.6 ? "más bien en contra" : "en contra");
  const signed = (value) => `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(2).replace(".", ",")}`;
  const STANCE = d3.scaleLinear().domain([0, 4, 8]).range(["#d9435e", "#cfccc2", "#23a878"]).interpolate(d3.interpolateLab);
  /** Color of a position from -1 (against) to 1 (in favor), in nine steps. */
  const positionBin = (value) => Math.round((Math.max(-1, Math.min(1, value)) + 1) * 4);
  const positionColor = (value) => STANCE(positionBin(value));

  // The panel's controls, by section. `section` starts a subheading; `toggle` is a switch instead of
  // a slider; `needs` names a page feature (see bindPanel) without which the control is left out.
  const SLIDERS = {
    appearance: [
      { section: "Nodos" },
      { key: "nodeScale", label: "Tamaño de los nodos", min: 0.3, max: 4, step: 0.05 },
      { key: "imageOpacity", label: "Opacidad de las fotos", min: 0, max: 1, step: 0.05, needs: "images" },
      { section: "Enlaces" },
      { key: "linkWidth", label: "Grosor de los enlaces", min: 0, max: 4, step: 0.1 },
      { key: "linkOpacity", label: "Opacidad de los enlaces", min: 0, max: 3, step: 0.05 },
      { section: "Nombres de los nodos" },
      { key: "labelZoom", label: "Umbral del texto", min: 0.2, max: 6, step: 0.1 },
      { key: "labelSize", label: "Tamaño", min: 7, max: 28, step: 0.5 },
      { key: "labelOpacity", label: "Opacidad", min: 0, max: 1, step: 0.05 },
      { key: "maxLabels", label: "Cuántos a la vez", min: 0, max: 1500, step: 10 },
      { section: "Grupos", needs: "grouping" },
      { key: "groupLabels", label: "Nombres de los grupos", toggle: true, needs: "grouping" },
      { key: "groupLabelSize", label: "Tamaño de los nombres", min: 8, max: 40, step: 0.5, needs: "grouping" },
      { key: "groupLabelOpacity", label: "Opacidad de los nombres", min: 0, max: 1, step: 0.05, needs: "grouping" },
      { key: "shapeOpacity", label: "Opacidad de las figuras", min: 0, max: 3, step: 0.05, needs: "grouping" },
      { key: "shapeEdges", label: "Borde de las figuras", toggle: true, needs: "grouping" },
    ],
    forces: [
      { key: "center", label: "Fuerza central", min: 0, max: 0.15, step: 0.001 },
      { key: "repel", label: "Repulsión", min: 0, max: 3000, step: 10 },
      { key: "repelRadius", label: "Alcance de la repulsión", min: 20, max: 500, step: 5 },
      { key: "far", label: "Separación entre grupos", min: 0, max: 12, step: 0.1 },
      { key: "group", label: "Fuerza para juntar los grupos", min: 0, max: 0.3, step: 0.005, needs: "grouping" },
      { key: "linkStrength", label: "Fuerza de los enlaces", min: 0, max: 3, step: 0.05 },
      { key: "linkDistance", label: "Distancia de los enlaces", min: 2, max: 250, step: 1 },
      { key: "damping", label: "Fricción", min: 0.05, max: 0.9, step: 0.01 },
    ],
  };

  // ---------- remembered look ----------
  // The appearance settings that differ from the page's defaults are kept in the browser, one entry
  // per page. The forces are not: they move the layout, and the remembered layout assumes the defaults.
  const LOOK_KEYS = [...SLIDERS.appearance.filter((s) => s.key).map((s) => s.key), "shapes"];
  function loadLook(graph) {
    try {
      const saved = JSON.parse(localStorage.getItem(graph.lookKey));
      if (!saved || typeof saved !== "object") return;
      for (const key of LOOK_KEYS) {
        if (key in saved && typeof saved[key] === typeof graph.defaults[key]) graph.settings[key] = saved[key];
      }
      graph.shapesDirty = true;
      graph.applySettings();
    } catch (error) { /* no storage (private window) or a damaged entry: the defaults stay */ }
  }
  function saveLook(graph) {
    if (!graph.lookKey) return;
    try {
      const changed = LOOK_KEYS.filter((key) => graph.settings[key] !== graph.defaults[key]);
      if (changed.length) localStorage.setItem(graph.lookKey, JSON.stringify(Object.fromEntries(changed.map((key) => [key, graph.settings[key]]))));
      else localStorage.removeItem(graph.lookKey);
    } catch (error) { /* storage full or blocked: the look is simply not remembered */ }
  }
  /** Sets a setting from the panel and tells the page's other controls (see bindGrouping). */
  function setFromPanel(graph, key, value) {
    graph.set(key, value);
    if (LOOK_KEYS.includes(key)) saveLook(graph);
    document.dispatchEvent(new CustomEvent("graph-settings", { detail: { key } }));
  }

  /** Renders the sliders and wires the switches and buttons present on the page. `features`:
   *  `grouping` (the page fills node.group and graph.groups: group pull, names and shapes),
   *  `images` (some nodes carry a photo) and `look` (name under which the page remembers its look). */
  function bindPanel(graph, features = {}) {
    graph.lookKey = features.look ? `graph:look:${features.look}` : null;
    if (graph.lookKey) loadLook(graph);
    const control = (s) => (s.section ? `<h4 class="subhead">${s.section}</h4>`
      : s.toggle ? `<label class="switch"><span>${s.label}</span><input type="checkbox" data-key="${s.key}"${graph.settings[s.key] ? " checked" : ""}><i></i></label>`
        : `<label class="slider">
          <span>${s.label}<output id="out-${s.key}">${fmt(graph.settings[s.key])}</output></span>
          <input type="range" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${graph.settings[s.key]}">
        </label>`);
    for (const [box, controls] of Object.entries(SLIDERS)) {
      $(box).innerHTML = controls.filter((s) => !s.needs || features[s.needs]).map(control).join("");
      $(box).addEventListener("input", (e) => {
        const key = e.target.dataset.key;
        if (!key || e.target.type !== "range") return;
        setFromPanel(graph, key, +e.target.value);
        $(`out-${key}`).textContent = fmt(e.target.value);
      });
      $(box).addEventListener("change", (e) => {
        const key = e.target.dataset.key;
        if (key && e.target.type === "checkbox") setFromPanel(graph, key, e.target.checked);
      });
    }
    if ($("physics")) {
      $("physics").checked = graph.settings.physics;
      $("physics").addEventListener("change", (e) => graph.set("physics", e.target.checked));
    }
    $("reheat").addEventListener("click", () => graph.reheat(1));
    $("fit").addEventListener("click", () => graph.fit());
    // Back to the page's defaults, look and forces alike.
    $("reset").addEventListener("click", () => {
      for (const input of document.querySelectorAll("#panel input[data-key]")) {
        const key = input.dataset.key, value = graph.defaults[key];
        graph.settings[key] = value;
        if (input.type === "checkbox") input.checked = value;
        else { input.value = value; $(`out-${key}`).textContent = fmt(value); }
      }
      graph.settings.shapes = graph.defaults.shapes;
      graph.shapesDirty = true;
      saveLook(graph);
      graph.applySettings();
      document.dispatchEvent(new CustomEvent("graph-settings", { detail: { key: null } }));
      graph.reheat(1);
    });
    // The graph is framed in the space left by the title and, on wide screens, the open panel.
    graph.insets = () => {
      const open = innerWidth > 900 && !$("panel").classList.contains("closed");
      return { top: 56, right: open ? innerWidth - $("panel").getBoundingClientRect().left : 0, bottom: 0, left: 0 };
    };
    bindPanelToggle();
  }

  /** The button that folds the panel; `onToggle` runs after it opens or closes. */
  function bindPanelToggle(onToggle = () => {}) {
    $("panel-toggle").addEventListener("click", () => {
      const closed = $("panel").classList.toggle("closed");
      $("panel-toggle").setAttribute("aria-expanded", String(!closed));
      onToggle(closed);
    });
  }

  /** Shows `html` in the tooltip next to the pointer. */
  function showTip(html, e) {
    const tip = $("tip");
    tip.innerHTML = html;
    tip.hidden = false;
    tip.style.left = Math.max(8, Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)) + "px";
    tip.style.top = Math.max(8, Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 8)) + "px";
  }
  const hideTip = () => { $("tip").hidden = true; };

  /** Shows `render(node)` next to the pointer while it is over a node. */
  function bindTooltip(graph, render) {
    graph.onHover = (node, e) => {
      if (node) showTip(render(node), e); else hideTip();
    };
  }

  /** A legend whose rows switch members of `set` on and off; an empty set means "all of them".
   *  `items` are {key, label, color, count} and `onChange` runs after every click. */
  function isolateList(box, items, set, onChange) {
    const render = () => {
      box.innerHTML = items().map((item) => `
        <button class="legend-item${set.has(item.key) ? " on" : ""}${set.size && !set.has(item.key) ? " off" : ""}" data-key="${esc(item.key)}">
          <span class="swatch" style="background:${item.color}"></span>
          <span class="legend-label" title="${esc(item.label)}">${esc(item.label)}</span>
          <span class="legend-count">${nf(item.count)}</span>
        </button>`).join("")
        + (set.size ? `<button class="link-button" data-clear>Quitar selección</button>` : "");
    };
    box.addEventListener("click", (e) => {
      const item = e.target.closest("[data-key]");
      if (item) {
        const key = items().find((i) => String(i.key) === item.dataset.key).key;
        if (set.has(key)) set.delete(key); else set.add(key);
      } else if (e.target.closest("[data-clear]")) {
        set.clear();
      } else {
        return;
      }
      onChange();
      render();
    });
    render();
    return render;
  }

  // ---------- grouping ----------
  const SHAPE_GRAY = "#a3a197";   // patches of groups that are not what colors the nodes

  /** The "group by" picker and the "gather" and "shapes" switches of the Grupos section. The page's
   *  color modes double as the ways to group: each has `label`, `group(n)` and `legend` (a list, or a
   *  function giving one, of {key, label, short?, color}); the key "none" (no value) gets no name or shape.
   *  Options:
   *  - modes, colorMode() (key of the color mode in use), nodes() (all the nodes of the page);
   *  - groupBy: the key to start with, or "none";
   *  - strength: the group pull when gathering; gatherOnPick: picking a grouping switches the pull on;
   *  - hidden(), hiddenNote: no names or shapes while hidden() holds, unless the groups are gathered;
   *  - onChange(): after the grouping or the pull changes (say, to pick the layout cache).
   *  Returns {refresh, by, gathered}; call refresh() after the colors, the nodes or the filters change. */
  function bindGrouping(graph, o) {
    const legendOf = (mode) => (typeof mode.legend === "function" ? mode.legend() : mode.legend);
    const picker = $("group-by"), gather = $("gather"), shapes = $("shapes");
    let by = o.groupBy || "none";
    picker.innerHTML = `<option value="none">Nada</option>`
      + Object.entries(o.modes).map(([key, mode]) => `<option value="${key}">${esc(mode.label)}</option>`).join("");
    picker.value = by;
    const gathered = () => graph.settings.group > 0;

    /** Puts every node in its group and hands the engine the groups to name and draw.
     *  Returns whether any node changed group. */
    function apply() {
      const mode = by === "none" ? null : o.modes[by];
      const nodes = o.nodes();
      let changed = false;
      for (const n of nodes) {
        const group = mode ? mode.group(n) : undefined;
        if (n.group !== group) { n.group = group; changed = true; }
      }
      // Without a grouping, a color mode with `labels` still names its groups on the map, without shapes.
      const color = o.modes[o.colorMode()];
      const named = mode || (color.labels ? color : null);
      const hidden = !!(o.hidden && o.hidden() && !gathered());
      let groups = [];
      if (named && !hidden) {
        const members = new Map();
        for (const n of nodes) {
          const key = named.group(n);
          if (key === "none") continue;
          if (!members.has(key)) members.set(key, []);
          members.get(key).push(n);
        }
        const same = named === color;
        groups = legendOf(named).filter((item) => members.has(item.key)).map((item) => ({
          key: item.key, label: item.short || item.label, nodes: members.get(item.key),
          color: same ? item.color : SHAPE_GRAY, shape: !!mode,
        }));
      }
      graph.setGroups(groups);
      gather.disabled = shapes.disabled = !mode;
      gather.checked = gathered();
      shapes.checked = graph.settings.shapes;
      const note = $("group-note");
      if (note) {
        note.textContent = !mode ? "Elegí un atributo para nombrar los grupos en el mapa y dibujar una figura detrás de cada uno."
          : hidden ? o.hiddenNote || ""
            : (gathered() ? "Una fuerza junta a cada grupo: la distancia entre grupos no dice nada, sí la mezcla de colores adentro y qué nodos quedan en el borde. "
              : "Los grupos quedan donde los ponen las conexiones. ")
              + (named === color ? "Cada figura cubre la mayor parte de su grupo y se desvanece hacia los nodos sueltos."
                : "Las figuras van en gris porque los nodos se colorean por otro atributo.");
      }
      return changed;
    }

    function setPull(on) {
      const value = on ? o.strength : 0;
      graph.set("group", value);
      const slider = document.querySelector('#forces input[data-key="group"]');
      if (slider) { slider.value = value; $("out-group").textContent = fmt(value); }
      graph.reheat(0.8);
    }

    picker.addEventListener("change", () => {
      by = picker.value;
      if (by === "none" && gathered()) setPull(false);
      else if (by !== "none" && o.gatherOnPick && !gathered()) setPull(true);
      if (apply() && gathered()) graph.reheat(0.6);   // the nodes regroup
      if (o.onChange) o.onChange();
    });
    gather.addEventListener("change", () => {
      setPull(gather.checked);
      apply();
      if (o.onChange) o.onChange();
    });
    shapes.addEventListener("change", () => setFromPanel(graph, "shapes", shapes.checked));
    // The force slider and the reset button also move the pull.
    document.addEventListener("graph-settings", (e) => {
      if (e.detail.key !== "group" && e.detail.key !== null) return;
      apply();
      if (o.onChange) o.onChange();
    });
    return {
      refresh() { if (apply() && gathered()) graph.reheat(0.3); },
      by: () => by,
      gathered,
    };
  }

  window.GraphUI = {
    $, nf, esc, norm, sentence, cut, fmt, plural, bindPanel, bindPanelToggle, bindTooltip, showTip, hideTip, isolateList, bindGrouping,
    PALETTE, stanceBin, PARTY_COLORS, ACTORS, STANCE, positionBin, positionColor, leanOf, leanText, signed,
  };
})();
