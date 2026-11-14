// Shared sidebar of the local pages, with the Settings dialog (style and mode). Each page has <aside class="side" data-page="..."></aside> and loads this script
// right after it. Optional attributes on the aside:
//   data-subnav="id"         empty <nav id="id" class="nav-sub"> under the current page, filled by the page itself
//   data-card-title / -text  small status card above the theme picker
// Every page is served by private_visuals/server.py (8766, or another --port), so links stay on the same origin.
(() => {
  const side = document.currentScript.previousElementSibling;
  if (!side || !side.classList.contains("side")) return;
  const here = side.dataset.page;
  const visuals = location.origin;

  const ICONS = {
    explorer: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    jev: '<path d="M4 6h16M4 12h10M4 18h7"/><path d="m15 17 2 2 4-4"/>',
    graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><path d="m8.3 7 7.4.8M7 8.4l1.4 7.2M16.4 10l-5.6 6.2"/>',
    evolution: '<path d="M4 19h16"/><path d="M5 15l4-5 3 3 6-7"/><path d="M15 6h3v3"/>',
    embeddings: '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/>',
    eval: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
    brand: '<path d="M3 21h18M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    fold: '<path d="m15 6-6 6 6 6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;

  // [key, short label, full name (tooltip), url]
  const PAGES = [
    ["explorer", "Explorador", "Explorador del corpus", `${visuals}/db_explorer/`],
    ["jev", "Visor de Jev", "Visor de las respuestas de Jev", `${visuals}/jev_answers/`],
    ["graph", "Grafos", "Grafos de expedientes, diputados y prensa", `${visuals}/graph/`],
    ["evolution", "Ranker (GA)", "Evolución del ranker con el algoritmo genético", `${visuals}/evolution_replay/`],
    ["embeddings", "Embeddings", "Cruce de noticias y expedientes por embeddings", `${visuals}/embedding_cross/`],
    ["eval", "Evaluación", "Evaluación a ciegas de Jev", `${visuals}/jev_eval/`],
  ];

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const { subnav, cardTitle, cardText } = side.dataset;
  const items = PAGES.map(([key, label, full, href]) => {
    const current = key === here;
    const link = `<a class="nav-item" href="${href}" title="${full}"${current ? ' aria-current="page"' : ""}>${svg(key)}<span class="label">${label}</span></a>`;
    return link + (current && subnav ? `<nav class="nav-sub" id="${esc(subnav)}" aria-label="Secciones de ${full}"></nav>` : "");
  }).join("");

  side.innerHTML = `
    <div class="brand">
      <span class="brand-mark">${svg("brand")}</span>
      <div><div class="brand-name">Cobertura legislativa</div><div class="brand-sub">Páginas locales</div></div>
    </div>
    <nav class="nav" aria-label="Páginas"><div class="nav-label">Páginas</div>${items}</nav>
    <div class="side-foot">
      ${cardTitle ? `<div class="side-card real"><strong>${esc(cardTitle)}</strong>${esc(cardText || "")}</div>` : ""}
      <button type="button" class="nav-item settings-btn" title="Ajustes: estilo y modo">${svg("gear")}<span class="label">Ajustes</span></button>
      <div class="side-tools">
        <div class="segmented theme-pick" role="group" aria-label="Tema de la página">
          <button type="button" data-theme-choice="system" title="Como el sistema">${svg("monitor")}<span class="sr">Como el sistema</span></button>
          <button type="button" data-theme-choice="light" title="Claro">${svg("sun")}<span class="sr">Claro</span></button>
          <button type="button" data-theme-choice="dark" title="Oscuro">${svg("moon")}<span class="sr">Oscuro</span></button>
        </div>
        <button type="button" class="icon-btn collapse-btn" title="Plegar o desplegar la barra" aria-label="Plegar o desplegar la barra">${svg("fold")}</button>
      </div>
    </div>`;

  // Folded sidebar (icons only), remembered across pages of the same origin.
  const KEY = "lc-side";
  const setCompact = (on) => {
    if (on) document.documentElement.dataset.side = "compact"; else delete document.documentElement.dataset.side;
    side.querySelector(".collapse-btn").setAttribute("aria-pressed", String(on));
    dispatchEvent(new Event("resize"));  // canvases and charts refit to the new width
  };
  let compact = false;
  try { compact = localStorage.getItem(KEY) === "1"; } catch { /* not remembered */ }
  setCompact(compact);
  side.querySelector(".collapse-btn").addEventListener("click", () => {
    compact = !compact;
    try { localStorage.setItem(KEY, compact ? "1" : "0"); } catch { /* not remembered */ }
    setCompact(compact);
  });

  // Settings: style and mode. The style list (with preview colors) comes from theme.js (LC.STYLES); theme.js
  // handles the clicks on data-style-choice / data-theme-choice and fires "themechange".
  const dialog = document.createElement("dialog");
  dialog.className = "settings";
  dialog.setAttribute("aria-labelledby", "settings-title");
  document.body.appendChild(dialog);
  const renderSettings = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    const current = window.LC.style(), mode = window.LC.mode();
    dialog.innerHTML = `
      <div class="settings-head">
        <h2 id="settings-title">Ajustes</h2>
        <button type="button" class="icon-btn settings-close" aria-label="Cerrar">${svg("close")}</button>
      </div>
      <h3 class="settings-label">Modo</h3>
      <div class="segmented settings-mode" role="group" aria-label="Modo">
        ${[["system", "monitor", "Como el sistema"], ["light", "sun", "Claro"], ["dark", "moon", "Oscuro"]].map(([v, ic, l]) =>
          `<button type="button" data-theme-choice="${v}" aria-pressed="${v === mode}">${svg(ic)}<span>${l}</span></button>`).join("")}
      </div>
      <h3 class="settings-label">Estilo</h3>
      <div class="style-grid">
        ${window.LC.STYLES.map((st) => {
          const [bg, surface, accent, ...tiles] = dark ? st.dark : st.light;
          return `<button type="button" class="style-card" data-style-choice="${st.id}" aria-pressed="${st.id === current}">
            <span class="style-preview" style="background:${bg}">
              <span class="style-surface" style="background:${surface}"><i style="background:${accent}"></i>${tiles.map((c) => `<b style="background:${c}"></b>`).join("")}</span>
            </span>
            <span class="style-name">${esc(st.name)}${st.id === "oficial" ? ' <em class="style-tag">por defecto</em>' : ""}</span>
            <span class="style-desc">${esc(st.description)}</span>
          </button>`;
        }).join("")}
      </div>`;
  };
  side.querySelector(".settings-btn").addEventListener("click", () => { renderSettings(); dialog.showModal(); });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest(".settings-close")) dialog.close();
  });
  document.addEventListener("themechange", () => { if (dialog.open) renderSettings(); });
})();
