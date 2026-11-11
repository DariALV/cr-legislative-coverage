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

  const SLIDERS = {
    appearance: [
      { key: "nodeScale", label: "Tamaño de los nodos", min: 0.3, max: 4, step: 0.05 },
      { key: "linkWidth", label: "Grosor de los enlaces", min: 0, max: 4, step: 0.1 },
      { key: "labelZoom", label: "Umbral del texto", min: 0.2, max: 6, step: 0.1 },
    ],
    forces: [
      { key: "center", label: "Fuerza central", min: 0, max: 0.15, step: 0.001 },
      { key: "repel", label: "Repulsión", min: 0, max: 3000, step: 10 },
      { key: "repelRadius", label: "Alcance de la repulsión", min: 20, max: 500, step: 5 },
      { key: "linkStrength", label: "Fuerza de los enlaces", min: 0, max: 3, step: 0.05 },
      { key: "linkDistance", label: "Distancia de los enlaces", min: 2, max: 250, step: 1 },
      { key: "damping", label: "Fricción", min: 0.05, max: 0.9, step: 0.01 },
    ],
  };

  /** Renders the sliders and wires the switches and buttons present on the page. */
  function bindPanel(graph) {
    for (const [box, sliders] of Object.entries(SLIDERS)) {
      $(box).innerHTML = sliders.map((s) => `
        <label class="slider">
          <span>${s.label}<output id="out-${s.key}">${fmt(graph.settings[s.key])}</output></span>
          <input type="range" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${graph.settings[s.key]}">
        </label>`).join("");
      $(box).addEventListener("input", (e) => {
        const key = e.target.dataset.key;
        if (!key) return;
        graph.set(key, +e.target.value);
        $(`out-${key}`).textContent = fmt(e.target.value);
      });
    }
    for (const [id, key] of [["group-labels", "groupLabels"], ["physics", "physics"]]) {
      if (!$(id)) continue;
      $(id).checked = graph.settings[key];
      $(id).addEventListener("change", (e) => graph.set(key, e.target.checked));
    }
    $("reheat").addEventListener("click", () => graph.reheat(1));
    $("fit").addEventListener("click", () => graph.fit());
    $("reset").addEventListener("click", () => {
      for (const input of document.querySelectorAll("input[type=range][data-key]")) {
        const value = graph.defaults[input.dataset.key];
        input.value = value;
        graph.settings[input.dataset.key] = value;
        $(`out-${input.dataset.key}`).textContent = fmt(value);
      }
      graph.applySettings();
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

  window.GraphUI = {
    $, nf, esc, norm, sentence, cut, fmt, plural, bindPanel, bindPanelToggle, bindTooltip, showTip, hideTip, isolateList,
    PALETTE, stanceBin, PARTY_COLORS, ACTORS, STANCE, positionBin, positionColor, leanOf, leanText, signed,
  };
})();
