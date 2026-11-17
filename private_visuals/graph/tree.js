// Tree tabs (#71): the similarity tree that the site draws at the end of each bill and news page, from any root
// and with every parameter at hand, to choose the site's values. tree.html shows bills and tree_news.html news
// (body[data-kind]). The local server builds the tree (graph/tree_api.py, the export's own build_tree), so with
// the "published" pool and the export's values it is the site's tree, node for node; the page then chooses the
// parents with its own depth discount, cuts the list (minimum similarity, how many) and lays it out.
//
// Layouts: "forces" is the site's (site/src/scripts/itemGraph.ts, as of its 15:27 version): the radial drawing
// without crossings only as the start, forces that never cool down (d3's alpha fixed) and a loop that stops once
// nothing moves, a charge between every pair with no reach limit, stiff tree links, loops that barely pull, a
// gravity toward the middle, nodes kept off other nodes' lines (pushing the line back as much, so the graph does
// not turn), a force that takes out any spin of the whole graph, walls that keep every node in the box, a halo
// around each circle; plus an elasticity that turns links into rods. "radial" is that radial drawing, still; the
// tidy layouts are d3.tree, top-down, left-right or radial. The distance from the root can follow the levels, the
// links' lengths (by similarity) or the similarity to the root.
//
// Every setting is kept in the browser, one entry per tab; "Restablecer" goes back to the site's values (the
// export's for the tree, itemGraph.ts's for the drawing). "Copiar ajustes" puts them on the clipboard in the
// shape of those two files' constants.
(function () {
  "use strict";
  const { $, nf, esc, norm, cut, fmt, token, cat, CATS, outletColor, STANCE, stanceBin, bindPanelToggle, showTip, hideTip } = window.GraphUI;
  const KIND = document.body.dataset.kind === "news" ? "news" : "bills";
  const BILLS = KIND === "bills";
  const API = "api/tree/";
  const STORE = `graph:tree:${KIND}`;
  const SITE = "https://darialv.github.io/cr-legislative-coverage";
  const OUTLETS = { crhoy: "CRHoy", nacion: "La Nación", delfino: "Delfino", elmundo: "El Mundo CR", semanario: "Semanario Universidad" };
  const GENRES = { news_report: "Noticia", opinion: "Opinión", interview: "Entrevista", analysis: "Análisis" };
  const POOL_LABELS = BILLS
    ? { published: "Publicados (sitio)", all: "Todo el corpus" }
    : { published: "Publicadas (sitio)", coverage: "Con expediente", assembly: "Filtro de la Asamblea", all: "Todo el corpus" };
  const canvas = $("graph"), context = canvas.getContext("2d");

  // ---------- settings ----------
  // The site's values: the tree's from the export (they arrive with the index), the drawing's from itemGraph.ts
  // and lib/itemGraph.ts. `group` says what a change redoes: "server" asks for a new tree, "tree" recomputes the
  // parents and the cut, "layout" the places, "forces" the physics, "look" only redraws.
  // Bands: the site's five (lib/itemGraph.ts), closest first; below the fourth cut is the fifth.
  const SITE_LOOK = BILLS ? { minSim: 0.5, band1: 0.75, band2: 0.65, band3: 0.55, band4: 0.45 }
    : { minSim: 0.55, band1: 0.88, band2: 0.79, band3: 0.61, band4: 0.5 };
  const BAND_NAMES = ["muy parecido", "parecido", "misma área", "poco parecido", "sin relación clara"];
  // The site's --sim-1..5 (ItemGraph.astro): blues that lighten, then grays; reversed in dark.
  const BAND_COLORS = { light: ["#1c5cab", "#4f8fdc", "#94bdec", "#a9a7a0", "#cfcdc6"], dark: ["#86b6ef", "#3987e5", "#1f5fae", "#5a5954", "#3d3c38"] };
  // Fixed as on the site (itemGraph.ts), no longer in the panel: the cosines between which a link's length moves
  // (outside they are clamped), the spread of the gap at contrast 1 (6 to 80 around 43), the room per sibling on a
  // parent's ring and per node on a level's ring, the sideways stretch of the radial drawing in a wide box, the
  // link force's iterations, the charge's minimum distance, the collision's strength, the node-line clearance.
  const FIXED = {
    lenRange: BILLS ? [0.55, 0.95] : [0.65, 0.97], gapSpread: 74, siblingPad: 6, ringSpacing: 26, maxStretch: 1.7,
    linkIterations: 3, distanceMin: 10, collideStrength: 0.8, clear: 7,
  };
  const CLEARANCE_MAX_NODES = 1500;   // the node-line clearance is O(links x nodes): off above this
  const BASE = {
    pool: "published", k: 10, floor: BILLS ? 0.55 : 0.65, w: 0.5, a: 1, duplicate: 0.97, cap: 150,
    nodes: 15, minSim: SITE_LOOK.minSim, loopRank: 0,
    layout: "forces", depthBy: "length", physics: true, levelGap: 60, rootScale: 900, siblingGap: 22,
    lengthBase: 43, contrast: 3,
    treeStrength: 1, loopStrength: 0.05, elasticity: 1, rigidLoops: false,
    charge: -70, chargeFalloff: 1, chargeReach: 3000, collidePad: 3, clearStrength: 0.5, damping: 0.6,
    gravity: 0, gravityFrom: 0, gravityGrowth: 0.05, rootGravity: 0, rootGravityFrom: 0, rootGravityGrowth: 0, walls: true,
    colorBy: "simRoot", palette: "bands", reverse: false,
    band1: SITE_LOOK.band1, band2: SITE_LOOK.band2, band3: SITE_LOOK.band3, band4: SITE_LOOK.band4, rootAccent: true,
    sizeBy: "desc", sizeMin: 3.5, sizePer: 1.3, sizeMax: 20,
    drawLinks: true, linkWidthBy: "sim", linkWidth: 1, linkColor: "muted", linkOpacity: 0.45, loopOpacity: 0.25, loopDash: false,
    hoverMode: "neighbors", dim: 0.18, halo: 2.5,
    labels: "hover", labelCount: 12, labelSize: 11, labelChars: 48, labelText: BILLS ? "both" : "title",
    listSort: "order", help: true,
  };
  let S = { ...BASE };
  let root = null;   // id of the root item
  const history = [];

  // Controls by section. type: range (min, max, step), select (options [value, label]), switch. `when` hides a
  // control unless it holds; `pct` shows a 0-1 value as a percentage; `help` is the line under it (in Spanish,
  // like the page), hidden with the panel's "Explicaciones" switch; `allAtMax` reads "todos" at the maximum.
  const opts = (o) => Object.entries(o);
  const CONTINUOUS = { bands: "Franjas del sitio", viridis: "Viridis", cividis: "Cividis", magma: "Magma", plasma: "Plasma", turbo: "Turbo", warm: "Cálida", cool: "Fría", seq: "Del tema" };
  const COLOR_MODES = {
    simRoot: "Parecido con la raíz", simParent: "Parecido con el padre", depth: "Profundidad", order: "Orden de entrada",
    desc: "Descendientes", branch: "Rama (hijo de la raíz)",
    ...(BILLS ? { status: "Estado", type: "Tipo de expediente", year: "Año de presentación", news: "Noticias con cobertura", published: "Publicado en el sitio" }
      : { outlet: "Medio", month: "Mes", genre: "Género", tone: "Tono hacia su expediente", coverage: "Con expediente", published: "Publicada en el sitio" }),
  };
  const isContinuous = (mode) => ["simRoot", "simParent", "depth", "order", "desc", "year", "news", "month"].includes(mode);
  const bands = () => S.palette === "bands" && (S.colorBy === "simRoot" || S.colorBy === "simParent");
  const site = (bills, news) => `Sitio: ${BILLS ? bills : news}.`;
  const NOUN = BILLS ? "expediente" : "noticia";
  const SECTIONS = [
    { title: "Árbol", hint: "Los cambios de conjunto, K, piso, w, copias y tope piden un árbol nuevo al servidor; los demás son instantáneos.", controls: [
      { key: "pool", label: "Conjunto", type: "select", options: () => (INDEX ? INDEX.pools : Object.keys(POOL_LABELS)).map((p) => [p, POOL_LABELS[p]]), group: "server",
        help: BILLS ? "De dónde salen los nodos. «Publicados» son los 1.126 del sitio; «Todo el corpus», los 5.898 expedientes."
          : "De dónde salen los nodos. «Publicadas»: las 2.620 del sitio. «Con expediente»: con cobertura sustantiva de algún expediente. «Filtro de la Asamblea»: las que pasan el filtro de Jev. «Todo el corpus»: las 29.875 (la primera carga tarda ~20 s)." },
      { key: "k", label: "Vecinos por elemento (K)", type: "range", min: 1, max: 50, step: 1, group: "server",
        help: `Cada ${NOUN} queda unido a sus K más parecidos, y el árbol solo crece por esas uniones. Con K más alto entran nodos más lejanos y cada uno tiene más padres posibles. ${site("10", "10")}` },
      { key: "floor", label: "Piso de parecido de las uniones", type: "range", min: 0.3, max: 0.95, step: 0.01, group: "server",
        help: `Una unión cuenta solo si el parecido (coseno) de la pareja llega a este piso. Más alto: árbol más chico y más seguro. ${site("0,55", "0,65")}` },
      { key: "w", label: "Qué entra primero (w)", type: "range", min: 0, max: 1, step: 0.05, group: "server",
        help: "Entra el candidato con mejor w × (su mejor unión con alguien que ya está) + (1 − w) × (su parecido con la raíz). En 0 entra lo más parecido a la raíz; en 1, lo más unido al árbol aunque se aleje del tema. Sitio: 0,5." },
      ...(BILLS ? [] : [{ key: "duplicate", label: "Copias fuera desde", type: "range", min: 0.85, max: 1.001, step: 0.005, group: "server",
        help: "Una noticia que se parece al menos esto a otra ya presente es la misma nota en otro medio y se salta. Al máximo («nunca») no se salta ninguna. Sitio: 0,97." }]),
      { key: "cap", label: "Tope del árbol", type: "range", min: 10, max: 500, step: 1, group: "server", allAtMax: true,
        help: `Cuántos nodos puede tener el árbol. Al máximo («todos») entra todo lo que se alcanza por uniones; con miles de nodos conviene apagar «Dibujar los enlaces» o usar «Radial quieta». ${site("150", "150")}` },
      { key: "a", label: "De quién cuelga (a)", type: "range", min: 0.3, max: 1, step: 0.01, group: "tree",
        help: "Cada nodo cuelga del nodo ya presente (unido a él) que maximiza a^profundidad × parecido. Con 1 cuelga de su más parecido y salen cadenas; más bajo prefiere padres cerca de la raíz y salen estrellas. No cambia qué nodos entran. Sitio: 1." },
      { key: "nodes", label: "Nodos a la vista", type: "range", min: 1, max: 500, step: 1, group: "tree", allAtMax: true,
        help: `Cuántos se dibujan, en orden de entrada: los primeros son los más cercanos a la raíz. Al máximo, todos los del árbol. ${site("15", "15")}` },
      { key: "minSim", label: "Parecido mínimo con la raíz", type: "range", min: 0.2, max: 0.95, step: 0.01, group: "tree",
        help: `Oculta los nodos que se parecen menos que esto a la raíz, con todo lo que cuelga de ellos. ${site("0,50", "0,55")}` },
      { key: "loopRank", label: "Bucles", type: "range", min: 0, max: 5, step: 1, group: "tree",
        help: "Además del árbol, une las parejas en que cada uno está entre los N más parecidos del otro. 0 = sin bucles, como el sitio." },
    ] },
    { title: "Forma", controls: [
      { key: "layout", label: "Disposición", type: "select", group: "layout", options: () => opts({ forces: "Fuerzas (como el sitio)", radial: "Radial quieta", "tidy-radial": "Árbol radial (d3)", "tidy-down": "Árbol hacia abajo", "tidy-right": "Árbol hacia la derecha" }),
        help: "Fuerzas: los nodos se acomodan solos, como en el sitio. Radial quieta: cada rama en su porción del círculo, sin cruces ni movimiento. Árbol (d3): dibujo jerárquico ordenado, con la raíz al centro, arriba o a la izquierda." },
      { key: "depthBy", label: "Distancia a la raíz", type: "select", group: "layout", when: () => S.layout !== "forces", options: () => opts({ length: "Largo de los enlaces", level: "Nivel", root: "Parecido con la raíz" }),
        help: "Qué tan lejos queda un nodo de la raíz: la suma de los largos de los enlaces del camino, su nivel (cuántos saltos) o cuánto le falta para parecerse del todo a la raíz." },
      { key: "levelGap", label: "Separación entre niveles", type: "range", min: 20, max: 200, step: 2, group: "layout", when: () => S.layout !== "forces" && S.depthBy === "level",
        help: "Distancia entre un nivel y el siguiente." },
      { key: "rootScale", label: "Escala del parecido", type: "range", min: 200, max: 3000, step: 50, group: "layout", when: () => S.layout !== "forces" && S.depthBy === "root",
        help: "Un nodo con parecido 0,6 con la raíz queda a 0,4 × esta distancia de ella." },
      { key: "siblingGap", label: "Separación entre hermanos", type: "range", min: 6, max: 80, step: 1, group: "layout", when: () => S.layout === "tidy-down" || S.layout === "tidy-right",
        help: "Espacio entre nodos vecinos del mismo nivel." },
      { key: "lengthBase", label: "Largo de los enlaces", type: "range", min: 5, max: 200, step: 1, group: "layout", when: () => S.layout === "forces" || S.depthBy === "length",
        help: "Espacio promedio entre dos nodos unidos, sin contar sus círculos. Sitio: 43." },
      { key: "contrast", label: "Cuánto cambia el largo con el parecido", type: "range", min: 0, max: 16, step: 0.25, group: "layout", when: () => S.layout === "forces" || S.depthBy === "length",
        help: "Los más parecidos se acercan y los menos parecidos se alejan; este número dice cuánto. En 0 todos los enlaces miden lo mismo. Sitio: ×3." },
    ] },
    { title: "Fuerzas", when: () => S.layout === "forces", hint: "Las fuerzas no se apagan con el tiempo: la animación se detiene sola cuando nada se mueve (o a los 15 s). «Reanimar» la vuelve a correr; «Desde el radial» pone cada nodo en su lugar sin cruces y deja que se acomode; «Encuadrar» vuelve a centrar.", controls: [
      { key: "physics", label: "Física", type: "switch", group: "forces", help: "Apagada, los nodos se quedan donde están (se pueden arrastrar igual, la raíz también)." },
      { key: "elasticity", label: "Elasticidad de los enlaces", type: "range", min: 0, max: 1, step: 0.05, pct: true, group: "forces",
        help: "100 %: los enlaces son resortes que se estiran, como en el sitio. 0 %: varillas que siempre miden su largo." },
      { key: "rigidLoops", label: "Bucles también rígidos", type: "switch", group: "forces", when: () => S.elasticity < 1 && S.loopRank > 0, help: "Les aplica la misma rigidez a los bucles." },
      { key: "treeStrength", label: "Fuerza de los enlaces", type: "range", min: 0, max: 2, step: 0.05, group: "forces",
        help: "Con cuánta fuerza cada enlace del árbol lleva a sus dos nodos hacia su largo. Sitio: 1." },
      { key: "loopStrength", label: "Fuerza de los bucles", type: "range", min: 0, max: 1, step: 0.01, group: "forces", when: () => S.loopRank > 0,
        help: "Lo mismo para los bucles; baja para que no deformen el árbol. Sitio: 0,05." },
      { key: "charge", label: "Repulsión", type: "range", min: -400, max: 0, step: 5, group: "forces",
        help: "Todos los nodos se empujan entre sí; más negativa, más aire entre ramas y grupos. Es el empuje entre dos nodos a 50 unidades (más o menos dos nodos unidos). Sitio: −70." },
      { key: "chargeFalloff", label: "Cómo decae con la distancia", type: "range", min: 0.25, max: 3, step: 0.05, group: "forces",
        help: "El empuje entre dos nodos va como 1/distancia elevado a este número (a 50 unidades es siempre el de «Repulsión»). 1: a 10 unidades empuja 10 veces más que a 100, como el sitio y d3. 2: 100 veces más, como la gravedad real: separa bien lo pegado y casi no empuja entre grupos lejanos (grafo más compacto). Menos de 1: los grupos lejanos se empujan más (grafo más abierto). Por encima de 1, más cerca de cierta distancia (unas 15 unidades con 1,5, 20 con 2, 28 con 3) el empuje ya no crece, para que los nodos no reboten. Sitio: 1." },
      { key: "chargeReach", label: "Alcance de la repulsión", type: "range", min: 50, max: 3000, step: 10, group: "forces", noLimitAtMax: true,
        help: "Más allá de esta distancia dos nodos no se empujan. Al máximo, sin límite, como el sitio." },
      { key: "collidePad", label: "Espacio entre nodos", type: "range", min: 0, max: 20, step: 0.5, group: "forces",
        help: "Espacio mínimo entre los bordes de dos círculos. Sitio: 3." },
      { section: "Gravedad hacia el centro" },
      { key: "gravity", label: "Gravedad hacia el centro", type: "range", min: 0, max: 20, step: 0.1, group: "forces",
        help: "Fuerza fija hacia el centro para cada nodo más lejos que «Desde qué distancia»; se suma al aumento de abajo. Sitio: 0 (allá la fuerza solo crece con la distancia)." },
      { key: "gravityFrom", label: "Desde qué distancia", type: "range", min: 0, max: 2000, step: 10, group: "forces",
        help: "Dentro de este radio no hay gravedad; afuera empieza. En unidades del dibujo (1 unidad = 1 px con zoom 1; un grafo de 150 nodos mide unas 600–1.000). Sitio: 0." },
      { key: "gravityGrowth", label: "Aumento por unidad de distancia", type: "range", min: 0, max: 0.5, step: 0.005, group: "forces",
        help: "Cuánto crece la fuerza por cada unidad más afuera del inicio, como «N por cm»: con 0,05, un nodo a 100 unidades del inicio recibe 5 de fuerza (más la fija). En un recuadro más ancho que alto tira menos hacia los lados. Sitio: 0,05." },
      { section: "Gravedad de la raíz" },
      { key: "rootGravity", label: "Gravedad de la raíz", type: "range", min: 0, max: 20, step: 0.1, group: "forces",
        help: "Lo mismo, pero solo para la raíz, y se suma a la de arriba: fuerza fija hacia el centro cuando la raíz está más lejos que «Desde qué distancia (raíz)». Sitio: 0 (allá la raíz no tiene tirón propio)." },
      { key: "rootGravityFrom", label: "Desde qué distancia (raíz)", type: "range", min: 0, max: 2000, step: 10, group: "forces",
        help: "Radio alrededor del centro dentro del cual la raíz no siente su gravedad propia. Sitio: 0." },
      { key: "rootGravityGrowth", label: "Aumento por unidad (raíz)", type: "range", min: 0, max: 1, step: 0.005, group: "forces",
        help: "Cuánto crece la fuerza sobre la raíz por cada unidad más afuera: con 0,1, a 100 unidades recibe 10 (más la fija). Con valores altos la raíz queda clavada en el centro y las ramas la siguen. Sitio: 0." },
      { section: "Cuadro" },
      { key: "walls", label: "Paredes del cuadro", type: "switch", group: "forces",
        help: "Ningún nodo sale del cuadro (lo que se ve con zoom 0,4); el que se pasa vuelve, con más fuerza cuanto más lejos. Como el sitio. Apagalas en árboles grandes, que no caben." },
      { section: "Otras" },
      { key: "clearStrength", label: "Apartar nodos de líneas ajenas", type: "range", min: 0, max: 2, step: 0.05, group: "forces",
        help: `Aleja a cada nodo de las líneas que no son suyas, para que una línea no parezca terminar en un nodo que solo cruza. Se apaga sola con más de ${CLEARANCE_MAX_NODES.toLocaleString("es-CR")} nodos (es lenta). Sitio: 0,5.` },
      { key: "damping", label: "Fricción", type: "range", min: 0.05, max: 0.95, step: 0.01, group: "forces",
        help: "Cuánto se frena el movimiento en cada paso: más alta, se calma antes. Sitio: 0,6." },
      { buttons: true },
    ] },
    { title: "Color", legend: true, controls: [
      { key: "colorBy", label: "Color por", type: "select", group: "look", options: () => opts(COLOR_MODES), help: "Qué dice el color de cada nodo." },
      { key: "palette", label: "Paleta", type: "select", group: "look", when: () => isContinuous(S.colorBy), options: () => opts(CONTINUOUS).filter(([k]) => k !== "bands" || S.colorBy === "simRoot" || S.colorBy === "simParent"),
        help: "Colores para valores que van de menos a más. «Franjas del sitio» usa las cinco franjas de las fichas." },
      { key: "reverse", label: "Invertir la paleta", type: "switch", group: "look", when: () => isContinuous(S.colorBy) && S.palette !== "bands" },
      ...BAND_NAMES.slice(0, 4).map((name, i) => ({ key: `band${i + 1}`, label: `«${name}» desde`, type: "range", min: 0.2, max: 0.99, step: 0.01, group: "look", when: bands,
        help: i === 0 ? `Dónde empieza cada franja, de la más parecida a la menos; debajo del último corte va «${BAND_NAMES[4]}». ${site("0,75 / 0,65 / 0,55 / 0,45", "0,88 / 0,79 / 0,61 / 0,50")}` : "" })),
      { key: "rootAccent", label: "Raíz en ámbar", type: "switch", group: "look", help: "Si no, la raíz lleva el color que le toca (siempre conserva su anillo)." },
    ] },
    { title: "Tamaño", controls: [
      { key: "sizeBy", label: "Tamaño por", type: "select", group: "layout", options: () => opts({ desc: "Descendientes (sitio)", children: "Hijos directos", simRoot: "Parecido con la raíz", fixed: "Fijo", ...(BILLS ? { news: "Noticias con cobertura" } : {}) }),
        help: "Qué dice el tamaño. Descendientes: cuántos nodos cuelgan de él, directa o indirectamente." },
      { key: "sizeMin", label: "Radio mínimo", type: "range", min: 1, max: 15, step: 0.5, group: "layout", help: "Radio de los nodos más chicos." },
      { key: "sizePer", label: "Crecimiento", type: "range", min: 0, max: 6, step: 0.1, group: "layout", when: () => S.sizeBy !== "fixed", help: "Cuánto crece el radio con el valor (con la raíz cuadrada, para que el área sea proporcional)." },
      { key: "sizeMax", label: "Radio máximo", type: "range", min: 3, max: 50, step: 1, group: "layout", when: () => S.sizeBy !== "fixed", help: "Tope del radio." },
    ] },
    { title: "Enlaces", controls: [
      { key: "drawLinks", label: "Dibujar los enlaces", type: "switch", group: "look", help: "Apagado no se dibujan las líneas (en las fuerzas siguen tirando). Alivia mucho con miles de nodos." },
      { key: "linkWidthBy", label: "Grosor", type: "select", group: "look", when: () => S.drawLinks, options: () => opts({ sim: "Según el parecido (sitio)", fixed: "Fijo" }), help: "Fijo, o más grueso cuanto más se parece la pareja." },
      { key: "linkWidth", label: "Grosor (escala)", type: "range", min: 0.1, max: 5, step: 0.1, group: "look", when: () => S.drawLinks },
      { key: "linkColor", label: "Color", type: "select", group: "look", when: () => S.drawLinks, options: () => opts({ muted: "Gris (sitio)", child: "Del nodo hijo", sim: "Según el parecido" }),
        help: "Gris; el color del nodo que cuelga; o la paleta elegida en Color según el parecido de la pareja." },
      { key: "linkOpacity", label: "Opacidad del árbol", type: "range", min: 0, max: 1, step: 0.05, group: "look", when: () => S.drawLinks },
      { key: "loopOpacity", label: "Opacidad de los bucles", type: "range", min: 0, max: 1, step: 0.05, group: "look", when: () => S.drawLinks && S.loopRank > 0 },
      { key: "loopDash", label: "Bucles punteados", type: "switch", group: "look", when: () => S.drawLinks && S.loopRank > 0, help: "Para distinguirlos de los enlaces del árbol." },
      { section: "Al pasar el puntero" },
      { key: "hoverMode", label: "Resaltar", type: "select", group: "look", options: () => opts({ neighbors: "Vecinos (sitio)", path: "Camino a la raíz", subtree: "Lo que cuelga", none: "Nada" }),
        help: "Al pasar el puntero por un nodo o elegirlo, qué queda resaltado: sus vecinos, el camino hasta la raíz o todo lo que cuelga de él." },
      { key: "dim", label: "Opacidad de lo demás", type: "range", min: 0, max: 1, step: 0.02, group: "look", when: () => S.hoverMode !== "none", help: "Qué tanto se ve lo que no queda resaltado. Sitio: 0,18." },
      { key: "halo", label: "Halo", type: "range", min: 0, max: 8, step: 0.5, group: "look",
        help: "Borde del color del fondo alrededor de cada círculo: una línea que pasa por detrás de un nodo se ve cortada. Sitio: 2,5." },
    ] },
    { title: "Etiquetas", controls: [
      { key: "labels", label: "Mostrar", type: "select", group: "look", options: () => opts({ none: "Ninguna", hover: "Solo al pasar", top: "Las más parecidas", all: "Todas" }),
        help: "Qué nodos llevan el nombre al lado. «Todas» dibuja solo las que caen en pantalla." },
      { key: "labelCount", label: "Cuántas", type: "range", min: 1, max: 150, step: 1, group: "look", when: () => S.labels === "top", help: "Las más parecidas a la raíz, más la raíz." },
      { key: "labelText", label: "Texto", type: "select", group: "look", when: () => S.labels !== "none", options: () => opts(BILLS ? { both: "Número y nombre", id: "Número", name: "Nombre" } : { title: "Título", outlet: "Medio y fecha", both: "Medio y título" }) },
      { key: "labelSize", label: "Tamaño", type: "range", min: 7, max: 24, step: 0.5, group: "look", when: () => S.labels !== "none" },
      { key: "labelChars", label: "Largo máximo", type: "range", min: 10, max: 160, step: 2, group: "look", when: () => S.labels !== "none", help: "En letras; lo que sobra se corta con «…»." },
    ] },
    { title: "Lista de nodos", list: true, closed: true, controls: [
      { key: "listSort", label: "Orden", type: "select", group: "list", options: () => opts({ order: "Orden de entrada", simRoot: "Parecido con la raíz", simParent: "Parecido con el padre", depth: "Profundidad", desc: "Descendientes" }),
        help: "Clic en una fila para elegir el nodo. Muestra los primeros 300." },
    ] },
  ];
  const CONTROLS = SECTIONS.flatMap((s) => s.controls).filter((c) => c.key);
  const CONTROL = Object.fromEntries(CONTROLS.map((c) => [c.key, c]));

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || "null");
      if (!saved || typeof saved !== "object") return;
      for (const [key, value] of Object.entries(saved.settings || {})) if (key in BASE && typeof value === typeof BASE[key]) S[key] = value;
      if (typeof saved.root === "string") root = saved.root;
    } catch (error) { /* no storage or a damaged entry: the defaults stay */ }
  }
  let saveTimer = 0;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify({ settings: S, root })); } catch (error) { /* not remembered */ }
    }, 200);
  }

  // ---------- data ----------
  let INDEX = null, F = {}, ITEMS = [], POS = new Map(), SEARCH = [];
  let TREE = null;   // {rows, cands, loops, skipped, ms}
  let parentOf = [], parentSim = [], depthOf = [];
  const months = [];

  async function fetchJson(url) {
    const response = await fetch(url);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  async function loadIndex() {
    status(`Cargando el conjunto «${POOL_LABELS[S.pool]}»…${S.pool === "all" && !BILLS ? " La primera vez tarda ~20 s." : ""}`);
    INDEX = await fetchJson(`${API}index?kind=${KIND}&pool=${S.pool}`);
    F = Object.fromEntries(INDEX.fields.map((f, i) => [f, i]));
    ITEMS = INDEX.items;
    POS = new Map(ITEMS.map((it, i) => [String(it[F.id]), i]));
    SEARCH = ITEMS.map((it) => norm(BILLS ? `${it[F.id]} ${it[F.name]}` : `${it[F.title]} ${OUTLETS[it[F.outlet]] || it[F.outlet]} ${it[F.author]} ${it[F.bill] ?? ""}`));
    months.length = 0;
    if (!BILLS) months.push(...[...new Set(ITEMS.map((it) => it[F.date].slice(0, 7)))].sort());
    const d = INDEX.defaults;
    Object.assign(BASE, { k: d.k, floor: d.floor, w: d.w, a: d.a, duplicate: d.duplicate ?? 0.97, cap: d.cap });
    if (!root || !POS.has(root)) root = defaultRoot();
  }
  function defaultRoot() {
    const wanted = BILLS ? ["23414"] : ITEMS.filter((it) => it[F.id].startsWith("f1552f3a")).map((it) => it[F.id]);
    for (const id of wanted) if (POS.has(id)) return id;
    let best = 0;   // the item with the most coverage, so the first tree is not empty
    for (let i = 0; i < ITEMS.length; i++) if (BILLS ? ITEMS[i][F.news] > ITEMS[best][F.news] : ITEMS[i][F.bill] && !ITEMS[best][F.bill]) best = i;
    return String(ITEMS[best][F.id]);
  }

  let requestSeq = 0;
  async function loadTree() {
    const seq = ++requestSeq;
    status("Armando el árbol…");
    const q = new URLSearchParams({ kind: KIND, pool: S.pool, root, k: S.k, floor: S.floor, w: S.w, a: S.a, cap: S.cap });
    q.set("duplicate", BILLS || S.duplicate > 1 ? "none" : S.duplicate);
    try {
      const tree = await fetchJson(`${API}build?${q}`);
      if (seq !== requestSeq) return;
      // "Nodos a la vista" at its maximum means all of them: it stays so when the tree grows.
      if (TREE && S.nodes >= TREE.rows.length - 1) S.nodes = Math.max(S.nodes, tree.rows.length - 1);
      TREE = tree;
      status("");
      reparent();
      rebuild(true);
    } catch (error) {
      if (seq === requestSeq) status(`No se pudo armar el árbol: ${error.message}`, true);
    }
  }

  /** Every node's parent with the page's discount: the earlier node it is linked to that maximizes
   *  a^depth(parent) * similarity, in order of entry and keeping the first of equals, as build_tree does. */
  function reparent() {
    const rows = TREE.rows;
    parentOf = [-1]; parentSim = [0]; depthOf = [0];
    for (let i = 1; i < rows.length; i++) {
      const c = TREE.cands[i];
      let best = rows[i][1], bestSim = rows[i][3], bestScore = -Infinity;
      for (let j = 0; j < c.length; j += 2) {
        const score = Math.pow(S.a, depthOf[c[j]]) * c[j + 1];
        if (score > bestScore) { bestScore = score; best = c[j]; bestSim = c[j + 1]; }
      }
      parentOf[i] = best; parentSim[i] = bestSim; depthOf[i] = depthOf[best] + 1;
    }
  }

  // ---------- nodes and links on screen ----------
  let nodes = [], links = [], byRow = new Map(), passing = 0, loopCount = 0;
  let drawOrder = [];   // least similar to the root first, the root last: the closest end up on top
  const placed = new Map();   // item position -> {x, y}: places kept while the root stays
  let placedRoot = null;
  const item = (n) => ITEMS[n.item];
  const idOf = (n) => String(item(n)[F.id]);

  function rebuild(newTree) {
    if (!TREE) return;
    if (placedRoot !== root) { placed.clear(); placedRoot = root; }
    const rows = TREE.rows;
    const kept = new Array(rows.length).fill(false);
    kept[0] = true;
    passing = 0;
    const shown = [0];
    for (let i = 1; i < rows.length; i++) {
      kept[i] = rows[i][2] >= S.minSim - 1e-9 && kept[parentOf[i]];
      if (!kept[i]) continue;
      passing++;
      if (shown.length <= S.nodes) shown.push(i);
    }
    byRow = new Map();
    nodes = shown.map((row, order) => {
      const n = { row, order, item: rows[row][0], parentRow: parentOf[row], simRoot: rows[row][2], simParent: parentSim[row], depth: depthOf[row],
        kids: [], desc: 0, r: S.sizeMin, x: 0, y: 0, vx: 0, vy: 0, branch: -1 };
      byRow.set(row, n);
      return n;
    });
    for (const n of nodes.slice(1)) byRow.get(n.parentRow).kids.push(n);
    for (const n of nodes.slice().reverse()) n.desc = n.kids.reduce((sum, c) => sum + c.desc + 1, 0);
    for (const n of nodes.slice(1)) n.branch = n.parentRow === 0 ? n.row : byRow.get(n.parentRow).branch;
    links = nodes.slice(1).map((n) => ({ source: byRow.get(n.parentRow), target: n, sim: n.simParent, loop: false, length: 0 }));
    loopCount = 0;
    if (S.loopRank > 0) {
      const L = TREE.loops;
      for (let i = 0; i < L.length; i += 4) {
        if (L[i + 3] > S.loopRank) continue;
        const a = byRow.get(L[i]), b = byRow.get(L[i + 1]);
        if (!a || !b || a.parentRow === b.row || b.parentRow === a.row) continue;
        links.push({ source: a, target: b, sim: L[i + 2], loop: true, length: 0 }); loopCount++;
      }
    }
    sizeNodes();
    setLengths();
    targets = places();
    for (const n of nodes) {
      const known = placed.get(n.item), parent = byRow.get(n.parentRow), place = targets.get(n);
      if (known) { n.x = known.x; n.y = known.y; }
      else if (parent && S.layout === "forces") { const from = targets.get(parent); n.x = parent.x + place.x - from.x; n.y = parent.y + place.y - from.y; }
      else if (parent && placed.get(parent.item)) { n.x = parent.x; n.y = parent.y; }
      else { n.x = place.x; n.y = place.y; }
    }
    if (!placed.get(nodes[0].item)) { nodes[0].x = 0; nodes[0].y = 0; }   // free, as on the site: it starts in the middle
    simulation.nodes(nodes);
    linkForce.links(links);
    applyForces();
    if (selected) selected = nodes.find((n) => n.item === selected.item) || null;
    hovered = null;
    // Start already untangled (the site does 60 ticks), within a time budget for big trees.
    const warm = performance.now();
    if (newTree) for (let i = 0; i < 60 && S.layout === "forces" && S.physics && performance.now() - warm < 400; i++) tick();
    drawOrder = nodes.slice(1).sort((a, b) => a.simRoot - b.simRoot);
    drawOrder.push(nodes[0]);
    describe();
    renderLegend();
    renderList();
    renderCard();
    nodesSlider();
    start(newTree ? 1 : 0.5);
  }

  function sizeNodes() {
    for (const n of nodes) {
      const v = S.sizeBy === "desc" ? Math.sqrt(n.desc) : S.sizeBy === "children" ? Math.sqrt(n.kids.length)
        : S.sizeBy === "simRoot" ? Math.max(0, (n.simRoot - S.minSim) / Math.max(0.01, 1 - S.minSim)) * 6
          : S.sizeBy === "news" ? Math.sqrt(item(n)[F.news] || 0) : 0;
      n.r = Math.min(S.sizeMax, S.sizeMin + S.sizePer * v);
      if (S.sizeBy === "fixed") n.r = S.sizeMin;
    }
  }

  // ---------- lengths and places ----------
  // The site's rule: the gap between two linked circles goes from long (the pair at the low end of lenRange) to
  // short (the high end), spread around lengthBase by contrast x gapSpread; never below 2.
  const gapFor = (sim) => {
    const [low, high] = FIXED.lenRange, t = Math.min(1, Math.max(0, (high - sim) / (high - low)));
    return Math.max(2, S.lengthBase + S.contrast * (t - 0.5) * FIXED.gapSpread);
  };
  /** Every link's length: radii plus the gap for its similarity; a tree link is raised so that all the children
   *  of a parent with three or more fit on a ring around it (the site's rule). */
  function setLengths() {
    const ring = new Map();
    for (const n of nodes) {
      if (n.kids.length < 3) continue;
      ring.set(n, n.kids.reduce((sum, c) => sum + 2 * c.r + FIXED.siblingPad, 0) / (2 * Math.PI));
    }
    for (const l of links) {
      const own = gapFor(l.sim) + l.source.r + l.target.r;
      l.length = l.loop ? own : Math.max(own, ring.get(l.source) || 0);
    }
  }
  /** Distance of each node from the root along the depth axis, by S.depthBy. */
  function distances(minRing) {
    const out = new Map([[nodes[0], 0]]);
    const perLevel = [];
    for (const n of nodes) perLevel[n.depth] = (perLevel[n.depth] || 0) + 1;
    const roomy = perLevel.map((count) => (minRing ? (count * FIXED.ringSpacing) / (2 * Math.PI) : 0));
    for (const n of nodes.slice(1)) {
      const p = byRow.get(n.parentRow);
      const d = S.depthBy === "level" && S.layout !== "forces" ? n.depth * S.levelGap
        : S.depthBy === "root" && S.layout !== "forces" ? (1 - n.simRoot) * S.rootScale
          : out.get(p) + gapFor(n.simParent) + p.r + n.r;
      out.set(n, Math.max(d, roomy[n.depth] || 0));
    }
    return out;
  }
  let targets = new Map();
  function places() {
    if (!nodes.length) return new Map();
    if (S.layout === "forces" || S.layout === "radial") return radialPlaces();
    return tidyPlaces();
  }
  /** The site's radial drawing: each subtree in a wedge as wide as its share of nodes, so no line crosses. */
  function radialPlaces() {
    const distance = distances(true);
    const size = new Map(nodes.map((n) => [n, n.desc + 1]));
    const stretch = view.width && view.height ? Math.min(FIXED.maxStretch, Math.max(1, Math.sqrt(view.width / view.height))) : 1;
    const out = new Map([[nodes[0], { x: 0, y: 0 }]]);
    // Without recursion: with a = 1 a chain can be thousands of levels deep.
    const stack = [[nodes[0], -Math.PI / 2, (3 * Math.PI) / 2]];
    while (stack.length) {
      const [parent, from, to] = stack.pop();
      const total = parent.kids.reduce((sum, c) => sum + size.get(c), 0);
      let angle = from;
      for (const c of parent.kids) {
        const width = ((to - from) * size.get(c)) / total, middle = angle + width / 2, r = distance.get(c);
        out.set(c, { x: r * Math.cos(middle) * stretch, y: r * Math.sin(middle) });
        stack.push([c, angle, angle + width]);
        angle += width;
      }
    }
    return out;
  }
  function tidyPlaces() {
    const h = d3.hierarchy(nodes[0], (n) => n.kids);
    const distance = distances(false);
    const out = new Map();
    if (S.layout === "tidy-radial") {
      d3.tree().size([2 * Math.PI, 1]).separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth))(h);
      h.each((d) => {
        const r = distance.get(d.data), angle = d.x - Math.PI / 2;
        out.set(d.data, { x: r * Math.cos(angle), y: r * Math.sin(angle) });
      });
    } else {
      d3.tree().nodeSize([S.siblingGap + 2 * S.sizeMin, 1]).separation((a, b) => ((a.parent === b.parent ? 1 : 1.5) * (a.data.r + b.data.r + S.siblingGap)) / (2 * S.sizeMin + S.siblingGap))(h);
      h.each((d) => {
        const along = distance.get(d.data);
        out.set(d.data, S.layout === "tidy-down" ? { x: d.x, y: along } : { x: along, y: d.x });
      });
    }
    return out;
  }

  // ---------- forces ----------
  // The site's constants for its live layout (itemGraph.ts).
  const ALPHA_ON = 0.3;                                  // d3's alpha, never decayed: the forces never fade
  const REST = { mean: 0.005, max: 0.08 }, REST_FRAMES = 20, MAX_RUN_MS = 15000;   // px per tick on screen
  const MAX_TICKS_PER_FRAME = 8, TICK_BUDGET_MS = 8;
  const BOX_ZOOM = 0.4, BOUND = { pull: 0.1, soft: 20, margin: 0.94 }, FIT_PAD = 18, ZOOM_MAX = 1.5;
  /** The free part of the canvas (without the panel and the title), in px. */
  function freeArea() {
    const pad = insets();
    return { width: Math.max(100, view.width - pad.left - pad.right), height: Math.max(100, view.height - pad.top - pad.bottom), pad };
  }
  /** Gravity toward the middle: past gravityFrom, a pull of gravity + gravityGrowth x (distance - gravityFrom). With
   *  the site's values (0, 0, 0.05) it is d3's forceX/forceY at 0.05, the site's; weaker sideways in a wide box
   *  (and up and down in a tall one), so the graph spreads to the box's shape. The root gets, on top, a pull of
   *  its own with the same rule and its own three values (0 on the site). */
  function forceGravity() {
    let list = [];
    const force = (alpha) => {
      const { width, height } = freeArea(), aspect = height / width;
      const sx = Math.min(1, Math.max(0.3, aspect)), sy = Math.min(1, Math.max(0.3, 1 / aspect));
      const pull = (n, fixed, from, growth) => {
        const u = n.x * sx, v = n.y * sy, d = Math.hypot(u, v);
        if (d <= from || d < 1e-9) return;
        const k = ((fixed + growth * (d - from)) * alpha) / d;
        n.vx -= u * k; n.vy -= v * k;
      };
      for (const n of list) pull(n, S.gravity, S.gravityFrom, S.gravityGrowth);
      const root = list.find((n) => n.row === 0);
      if (root && (S.rootGravity || S.rootGravityGrowth)) pull(root, S.rootGravity, S.rootGravityFrom, S.rootGravityGrowth);
    };
    force.initialize = (l) => { list = l; };
    return force;
  }
  /** Half the box's width and height in layout units: what the free area shows at BOX_ZOOM. */
  const boxHalf = () => {
    const { width, height } = freeArea();
    return { x: Math.max(50, ((width / 2 - FIT_PAD) / BOX_ZOOM) * BOUND.margin), y: Math.max(50, ((height / 2 - FIT_PAD) / BOX_ZOOM) * BOUND.margin) };
  };
  /** Every node back inside the box, harder the farther out (does not fade). The site's push, capped at the excess
   *  itself: the same up to 180 units out, and no overshoot when thousands of nodes start far outside the box
   *  (uncapped, the push grows with the square of the excess and the layout blew up). */
  function forceHome() {
    let list = [];
    const force = () => {
      if (!S.walls) return;
      const { x: bx, y: by } = boxHalf();
      for (const n of list) {
        const ex = Math.abs(n.x) + n.r - bx, ey = Math.abs(n.y) + n.r - by;
        if (ex > 0) n.vx -= Math.sign(n.x) * Math.min(ex, BOUND.pull * ex * (1 + ex / BOUND.soft));
        if (ey > 0) n.vy -= Math.sign(n.y) * Math.min(ey, BOUND.pull * ey * (1 + ey / BOUND.soft));
      }
    };
    force.initialize = (l) => { list = l; };
    return force;
  }
  /** Takes out of the velocities any turning of the whole graph around its middle (left alone, a slow spin never
   *  died out and kept the loop from resting). */
  function forceNoSpin() {
    let list = [];
    const force = () => {
      if (list.length < 3) return;
      let cx = 0, cy = 0;
      for (const n of list) { cx += n.x; cy += n.y; }
      cx /= list.length; cy /= list.length;
      let torque = 0, inertia = 0;
      for (const n of list) { const rx = n.x - cx, ry = n.y - cy; torque += rx * n.vy - ry * n.vx; inertia += rx * rx + ry * ry; }
      if (inertia < 1) return;
      const w = torque / inertia;
      for (const n of list) { n.vx += w * (n.y - cy); n.vy -= w * (n.x - cx); }
    };
    force.initialize = (l) => { list = l; };
    return force;
  }
  function forceClearance() {
    let list = [];
    const force = (alpha) => {
      if (!S.clearStrength || list.length > CLEARANCE_MAX_NODES) return;
      for (const l of links) {
        const a = l.source, b = l.target, dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
        if (length2 < 1) continue;
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
        for (const n of list) {
          if (n === a || n === b) continue;
          const room = n.r + FIXED.clear;
          if (n.x < x0 - room || n.x > x1 + room || n.y < y0 - room || n.y > y1 + room) continue;
          const t = ((n.x - a.x) * dx + (n.y - a.y) * dy) / length2;
          if (t <= 0 || t >= 1) continue;
          let ox = n.x - (a.x + t * dx), oy = n.y - (a.y + t * dy), d = Math.sqrt(ox * ox + oy * oy);
          if (d >= room) continue;
          if (d < 1e-3) { ox = -dy; oy = dx; d = Math.sqrt(length2); }
          const push = ((room - d) / d) * S.clearStrength * alpha;
          n.vx += ox * push; n.vy += oy * push;
          // The line takes the opposite push, split by where the node is along it, so the pushes add up to zero
          // (unbalanced, they kept the whole graph turning).
          a.vx -= ox * push * (1 - t); a.vy -= oy * push * (1 - t);
          b.vx -= ox * push * t; b.vy -= oy * push * t;
        }
      }
    };
    force.initialize = (l) => { list = l; };
    return force;
  }
  const linkForce = d3.forceLink([]).distance((l) => l.length).strength((l) => (l.loop ? S.loopStrength : S.treeStrength));
  // Repulsion: d3's forceManyBody (the site's), same Barnes-Hut quadtree and same handling of coincident nodes, with
  // the push going as 1 / distance^chargeFalloff instead of always 1 / distance. Scaled so that the push at
  // CHARGE_REFERENCE units is the same whatever the exponent; at exponent 1 it is d3's force exactly.
  // Closer than a floor the push stays as at the floor (d3's distanceMin does that for exponent 1 only: copied as is,
  // it let the push grow without bound below 10 units for exponents above 1). With a steep exponent the push near
  // the floor changes so fast with distance that one step overshoots and nodes bounce, so above exponent 1 the floor
  // rises to where the push's slope (exponent x push / distance, per step) falls to 1 / CHARGE_STABILITY: about 15
  // units at 1.5, 20 at 2 and 28 at 3 with the site's charge (10, d3's, at exponent 1). Measured with 150 bills
  // and the site's values: with 4 the layout calms down at exponents 1.5 to 3 (mean speed 0.04 after 2,500 steps,
  // 0.01-0.02 at exponent 1), the closest push stays about exponent 1's; with 2 it still jittered at 3 (0.09).
  const CHARGE_REFERENCE = 50, CHARGE_STABILITY = 4;
  function forceRepulsion() {
    let list = [], random = Math.random, node = null, alpha = 0, theta2 = 0.81, min2 = 100, minPow = 10, max2 = Infinity, strength = -30, falloff = 1, reference = 1;
    const jiggle = () => (random() - 0.5) * 1e-6;
    // Push factor for a squared distance l, applied to the vector toward the other node (of length sqrt(l)): below
    // the floor, the push of the floor (d3's own expression at exponent 1).
    const factor = (l) => {
      if (l < min2) return falloff === 1 ? 1 / Math.sqrt(min2 * l) : reference / (minPow * Math.sqrt(l));
      return falloff === 1 ? 1 / l : reference * Math.pow(l, -(falloff + 1) / 2);
    };
    function accumulate(quad) {
      let value = 0, weight = 0, x = 0, y = 0;
      if (quad.length) {
        for (let i = 0; i < 4; ++i) {
          const q = quad[i];
          if (!q) continue;
          const c = Math.abs(q.value);
          if (c) { value += q.value; weight += c; x += c * q.x; y += c * q.y; }
        }
        quad.x = x / weight; quad.y = y / weight;
      } else {
        let q = quad;
        quad.x = q.data.x; quad.y = q.data.y;
        do value += strength; while ((q = q.next));
      }
      quad.value = value;
    }
    function apply(quad, x1, _, x2) {
      if (!quad.value) return true;
      let x = quad.x - node.x, y = quad.y - node.y, w = x2 - x1, l = x * x + y * y;
      if ((w * w) / theta2 < l) {   // far enough: the whole quadrant as one mass
        if (l < max2) {
          if (x === 0) { x = jiggle(); l += x * x; }
          if (y === 0) { y = jiggle(); l += y * y; }
          const f = quad.value * alpha * factor(l);
          node.vx += x * f; node.vy += y * f;
        }
        return true;
      } else if (quad.length || l >= max2) return;
      if (quad.data !== node || quad.next) {
        if (x === 0) { x = jiggle(); l += x * x; }
        if (y === 0) { y = jiggle(); l += y * y; }
      }
      do if (quad.data !== node) {
        const f = strength * alpha * factor(l);
        node.vx += x * f; node.vy += y * f;
      } while ((quad = quad.next));
    }
    const force = (a) => {
      if (!strength || !list.length) return;
      alpha = a;
      const tree = d3.quadtree(list, (n) => n.x, (n) => n.y).visitAfter(accumulate);
      for (node of list) tree.visit(apply);
    };
    force.initialize = (l, r) => { list = l; random = r || Math.random; };
    /** strength, minimum and maximum distance, Barnes-Hut theta, exponent, alpha (to place the stable floor). */
    force.set = (o) => {
      strength = o.strength; max2 = o.distanceMax * o.distanceMax;
      theta2 = o.theta * o.theta; falloff = o.falloff; reference = Math.pow(CHARGE_REFERENCE, o.falloff - 1);
      const stable = Math.pow(CHARGE_STABILITY * o.falloff * Math.abs(o.strength) * o.alpha * reference, 1 / (o.falloff + 1));
      const floor = o.falloff > 1 ? Math.max(o.distanceMin, stable) : o.distanceMin;
      min2 = floor * floor; minPow = Math.pow(floor, o.falloff);
      force.floor = floor;
      return force;
    };
    return force;
  }
  const chargeForce = forceRepulsion();
  const collideForce = d3.forceCollide((n) => n.r + S.collidePad);
  // The collision is the dearest force in big trees (~75 ms per step with 30,000 nodes): above
  // CLEARANCE_MAX_NODES it runs one step in three.
  let ticks = 0;
  const collideSometimes = (alpha) => { if (nodes.length <= CLEARANCE_MAX_NODES || ticks % 3 === 0) collideForce(alpha); };
  collideSometimes.initialize = (list, random) => collideForce.initialize(list, random);
  const simulation = d3.forceSimulation([]).stop()
    .alpha(ALPHA_ON).alphaDecay(0).alphaMin(0)
    .force("link", linkForce).force("charge", chargeForce).force("collide", collideSometimes)
    .force("clearance", forceClearance()).force("gravity", forceGravity()).force("home", forceHome()).force("no-spin", forceNoSpin());
  function applyForces() {
    simulation.velocityDecay(S.damping);
    linkForce.iterations(FIXED.linkIterations).strength(linkForce.strength()).distance(linkForce.distance());
    // No reach limit, as on the site (and Obsidian). Above CLEARANCE_MAX_NODES the repulsion is approximated more
    // coarsely (Barnes-Hut theta 2 instead of d3's 0.9): 3 to 5 times faster with 6,000 to 30,000 nodes.
    chargeForce.set({ strength: S.charge, distanceMin: FIXED.distanceMin, distanceMax: S.chargeReach >= CONTROL.chargeReach.max ? Infinity : S.chargeReach,
      theta: nodes.length > CLEARANCE_MAX_NODES ? 2 : 0.9, falloff: S.chargeFalloff, alpha: ALPHA_ON });
    collideForce.radius((n) => n.r + S.collidePad).strength(FIXED.collideStrength);
  }
  /** Elasticity below 100 %: after each tick, links are pulled back toward their length (rods at 0 %), moving more
   *  the end with fewer nodes hanging from it and never a fixed node; loops first, so they give in a cycle. */
  function constrain() {
    if (S.elasticity >= 1) return;
    const keep = 1 - S.elasticity;
    const ordered = S.rigidLoops ? [...links.filter((l) => l.loop), ...links.filter((l) => !l.loop)] : links.filter((l) => !l.loop);
    for (let pass = 0; pass < 3; pass++) {
      for (const l of ordered) {
        const a = l.source, b = l.target, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6;
        const error = ((d - l.length) / d) * keep;
        const fa = a.fx != null ? 0 : b.fx != null ? 1 : (b.desc + 1) / (a.desc + b.desc + 2);
        const fb = 1 - fa;
        if (a.fx == null) { a.x += dx * error * fa; a.y += dy * error * fa; }
        if (b.fx == null) { b.x -= dx * error * fb; b.y -= dy * error * fb; }
      }
    }
  }
  function tick() { ticks++; simulation.tick(); constrain(); }

  // ---------- view ----------
  const view = { x: 0, y: 0, zoom: 1, width: 0, height: 0, user: false };
  // How far the camera can pull back (with the wheel, and when framing a big tree): a tree of all the news, laid
  // out radially, spans hundreds of thousands of units.
  const ZOOM_MIN = 0.0005;
  function insets() {
    const open = !$("panel").classList.contains("closed");
    const right = open ? canvas.getBoundingClientRect().right - $("panel").getBoundingClientRect().left : 0;
    return { top: 64, right: Math.max(0, right), bottom: 12, left: 12 };
  }
  function resize() {
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(2, devicePixelRatio || 1);
    view.width = rect.width; view.height = rect.height;
    canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function fit(instant) {
    if (!nodes.length || !view.width) return false;
    if (S.walls && S.layout === "forces") {   // the site's view: centered on the middle of the box, showing every circle
      const { width, height, pad } = freeArea();
      let reachX = 1, reachY = 1;
      for (const n of nodes) { reachX = Math.max(reachX, Math.abs(n.x) + n.r); reachY = Math.max(reachY, Math.abs(n.y) + n.r); }
      const zoom = Math.min(ZOOM_MAX, Math.max(BOX_ZOOM, Math.min((width / 2 - FIT_PAD) / reachX, (height / 2 - FIT_PAD) / reachY)));
      const cx = -((pad.left - pad.right) / 2) / zoom, cy = -((pad.top - pad.bottom) / 2) / zoom;
      const ease = instant ? 1 : 0.12, dx = cx - view.x, dy = cy - view.y, dz = zoom - view.zoom;
      view.x += dx * ease; view.y += dy * ease; view.zoom += dz * ease;
      return Math.abs(dx * view.zoom) > 0.5 || Math.abs(dy * view.zoom) > 0.5 || Math.abs(dz) > 0.002;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); }
    const pad = insets(), w = view.width - pad.left - pad.right - 24, h = view.height - pad.top - pad.bottom - 24;
    const zoom = Math.min(2.5, Math.max(ZOOM_MIN, Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0))));
    // The center of the free area, in world units, sits on the center of the box.
    const cx = (x0 + x1) / 2 - ((pad.left - pad.right) / 2) / zoom, cy = (y0 + y1) / 2 - ((pad.top - pad.bottom) / 2) / zoom;
    const ease = instant ? 1 : 0.12, dx = cx - view.x, dy = cy - view.y, dz = zoom - view.zoom;
    view.x += dx * ease; view.y += dy * ease; view.zoom += dz * ease;
    return Math.abs(dx * view.zoom) > 0.5 || Math.abs(dy * view.zoom) > 0.5 || Math.abs(dz) > 0.002;
  }
  const toScreen = (n) => [view.width / 2 + (n.x - view.x) * view.zoom, view.height / 2 + (n.y - view.y) * view.zoom];
  const toWorld = (px, py) => [view.x + (px - view.width / 2) / view.zoom, view.y + (py - view.height / 2) / view.zoom];

  // ---------- colors ----------
  function paletteFn() {
    const p = S.palette === "bands" ? "viridis" : S.palette;
    const f = p === "seq" ? d3.interpolateLab(token("--seq-low"), token("--seq-high"))
      : { viridis: d3.interpolateViridis, cividis: d3.interpolateCividis, magma: d3.interpolateMagma, plasma: d3.interpolatePlasma,
        turbo: d3.interpolateTurbo, warm: d3.interpolateWarm, cool: d3.interpolateCool }[p];
    const squeeze = p === "seq" ? (t) => t : (t) => 0.05 + 0.9 * t;
    return (t) => f(squeeze(S.reverse ? 1 - t : t));
  }
  /** {value(n), domain [low, high], format} for continuous modes; value null = no data. */
  function continuous(mode) {
    const visible = nodes.slice(1);
    // Loops, not Math.min(...values): a tree can have 30,000 nodes.
    const span = (values) => { let lo = Infinity, hi = -Infinity; for (const x of values) if (x != null) { lo = Math.min(lo, x); hi = Math.max(hi, x); } return lo <= hi ? [lo, hi] : [0, 1]; };
    const top = (values) => Math.max(1, span(values)[1]);
    switch (mode) {
      case "simRoot": return { value: (n) => n.simRoot, domain: span(visible.map((n) => n.simRoot)), format: (v) => fmt(v.toFixed(2)) };
      case "simParent": return { value: (n) => (n.row ? n.simParent : null), domain: span(visible.map((n) => n.simParent)), format: (v) => fmt(v.toFixed(2)) };
      case "depth": return { value: (n) => n.depth, domain: [0, top(nodes.map((n) => n.depth))], format: (v) => `nivel ${Math.round(v)}` };
      case "order": return { value: (n) => n.order, domain: [0, Math.max(1, nodes.length - 1)], format: (v) => `${Math.round(v)}.º` };
      case "desc": return { value: (n) => Math.log1p(n.desc), domain: [0, top(nodes.map((n) => Math.log1p(n.desc)))], format: (v) => nf(Math.round(Math.expm1(v))) };
      case "year": {
        const y = (n) => { const d = item(n)[F.date]; return d ? +d.slice(0, 4) : null; };
        return { value: y, domain: span(nodes.map(y)), format: (v) => String(Math.round(v)) };
      }
      case "news": return { value: (n) => Math.log1p(item(n)[F.news] || 0), domain: [0, top(nodes.map((n) => Math.log1p(item(n)[F.news] || 0)))], format: (v) => nf(Math.round(Math.expm1(v))) };
      case "month": {
        const m = (n) => months.indexOf(item(n)[F.date].slice(0, 7));
        return { value: m, domain: [0, Math.max(1, months.length - 1)], format: (v) => monthLabel(Math.round(v)) };
      }
    }
    return null;
  }
  const monthLabel = (i) => (months[i] ? new Date(`${months[i]}-15T12:00:00`).toLocaleDateString("es-CR", { month: "short", year: "numeric" }) : "");
  /** {group(n), legend: [{key, label, color}]} for categorical modes. */
  function categorical(mode) {
    const none = { key: "none", label: "Sin dato", color: token("--data-none") };
    const byCount = (key, label) => {
      const counts = new Map();
      for (const n of nodes.slice(1)) { const k = key(n); counts.set(k, (counts.get(k) || 0) + 1); }
      const top = [...counts.entries()].filter(([k]) => k !== "" && k != null).sort((a, b) => b[1] - a[1]);
      const kept = new Map(top.slice(0, CATS - 1).map(([k], i) => [k, cat(i)]));
      return {
        group: (n) => { const k = key(n); return k === "" || k == null ? "none" : kept.has(k) ? k : "other"; },
        legend: [...top.slice(0, CATS - 1).map(([k]) => ({ key: k, label: label(k), color: kept.get(k) })),
          ...(top.length >= CATS ? [{ key: "other", label: "Otros", color: token("--data-neutral") }] : []), none],
      };
    };
    switch (mode) {
      case "branch": return byCount((n) => (n.row ? n.branch : ""), (row) => { const n = byRow.get(row); return n ? cut(nameOf(n), 40) : "?"; });
      case "status": return {
        group: (n) => item(n)[F.status] || "none",
        legend: [{ key: "En trámite", label: "En trámite", color: token("--progress") }, { key: "Archivado", label: "Archivado", color: token("--archived") },
          { key: "Convertido en ley", label: "Convertido en ley", color: token("--law") }, none],
      };
      case "type": return byCount((n) => item(n)[F.type], (k) => k);
      case "published": return {
        group: (n) => (item(n)[F.published] ? "yes" : "no"),
        legend: [{ key: "yes", label: BILLS ? "Publicado" : "Publicada", color: token("--accent") }, { key: "no", label: "Fuera del sitio", color: token("--data-neutral") }],
      };
      case "outlet": return {
        group: (n) => item(n)[F.outlet],
        legend: Object.entries(OUTLETS).map(([key, label]) => ({ key, label, color: outletColor(key) })),
      };
      case "genre": return {
        group: (n) => item(n)[F.genre] || "none",
        legend: [...Object.entries(GENRES).map(([key, label], i) => ({ key, label, color: cat(i) })), none],
      };
      case "tone": return {
        group: (n) => (item(n)[F.stance] == null ? "none" : String(stanceBin(item(n)[F.stance]))),
        legend: [...[8, 7, 6, 5, 4, 3, 2, 1, 0].map((b) => ({ key: String(b), label: b >= 6 ? "A favor" + (b === 8 ? " (fuerte)" : "") : b <= 2 ? "En contra" + (b === 0 ? " (fuerte)" : "") : b === 4 ? "Neutral" : b === 5 ? "Algo a favor" : "Algo en contra", color: STANCE(b) })), none],
      };
      case "coverage": return {
        group: (n) => (item(n)[F.bill] != null ? "bill" : item(n)[F.assembly] ? "assembly" : "none"),
        legend: [{ key: "bill", label: "Con expediente", color: token("--accent") }, { key: "assembly", label: "Asamblea sin expediente", color: cat(2) }, { key: "none", label: "Otra", color: token("--data-neutral") }],
      };
    }
    return null;
  }
  let colorOf = () => token("--data-neutral"), groupOf = null;
  const bandColors = () => BAND_COLORS[d3.hsl(token("--canvas")).l > 0.5 ? "light" : "dark"];
  const isolated = new Set();
  function prepareColors() {
    groupOf = null;
    const mode = S.colorBy;
    if ((mode === "simRoot" || mode === "simParent") && S.palette === "bands") {
      const colors = bandColors(), cuts = [S.band1, S.band2, S.band3, S.band4];
      const band = (v) => { const i = cuts.findIndex((c) => v >= c - 1e-9); return i < 0 ? 4 : i; };
      groupOf = (n) => band(mode === "simRoot" ? n.simRoot : n.simParent);
      colorOf = (n) => colors[groupOf(n)];
      return;
    }
    const c = continuous(mode);
    if (c) {
      const p = paletteFn(), [lo, hi] = c.domain;
      colorOf = (n) => { const v = c.value(n); return v == null ? token("--data-none") : p(hi > lo ? (v - lo) / (hi - lo) : 0.5); };
      return;
    }
    const k = categorical(mode);
    const colors = new Map(k.legend.map((l) => [l.key, l.color]));
    groupOf = k.group;
    colorOf = (n) => colors.get(groupOf(n)) || token("--data-neutral");
  }
  const fillOf = (n) => (n.row === 0 && S.rootAccent ? token("--warn") : colorOf(n));
  /** Colors of every node for the current mode, kept on the node (n.fill) until the next change. */
  function paint() {
    prepareColors();
    for (const n of nodes) n.fill = fillOf(n);
  }
  const isOff = (n) => isolated.size > 0 && groupOf && n.row !== 0 && !isolated.has(String(groupOf(n)));

  // ---------- text ----------
  const outletName = (key) => OUTLETS[key] || key;
  const dateText = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
  function nameOf(n) {
    const it = item(n);
    return BILLS ? `${it[F.id]} · ${it[F.name]}` : it[F.title];
  }
  function labelOf(n) {
    const it = item(n);
    const text = BILLS ? (S.labelText === "id" ? String(it[F.id]) : S.labelText === "name" ? it[F.name] : `${it[F.id]} ${it[F.name]}`)
      : S.labelText === "outlet" ? `${outletName(it[F.outlet])} ${dateText(it[F.date])}` : S.labelText === "both" ? `${outletName(it[F.outlet])}: ${it[F.title]}` : it[F.title];
    return cut(text, S.labelChars);
  }
  function metaOf(n) {
    const it = item(n);
    return BILLS ? [it[F.status], it[F.type], it[F.date] ? `presentado ${dateText(it[F.date])}` : "", `${nf(it[F.news] || 0)} noticias`].filter(Boolean).join(" · ")
      : [outletName(it[F.outlet]), dateText(it[F.date]), GENRES[it[F.genre]] || "", it[F.bill] != null ? `exp. ${it[F.bill]}` : ""].filter(Boolean).join(" · ");
  }
  const cos = (v) => fmt(v.toFixed(2));

  // ---------- drawing ----------
  let hovered = null, selected = null;
  function focusSet(focus) {
    if (!focus || S.hoverMode === "none") return null;
    const near = new Set([focus]), lit = new Set();
    if (S.hoverMode === "neighbors") {
      for (const l of links) if (l.source === focus || l.target === focus) { near.add(l.source); near.add(l.target); lit.add(l); }
    } else if (S.hoverMode === "path") {
      for (let n = focus; n && n.row !== 0;) { const p = byRow.get(n.parentRow); near.add(p); lit.add(links.find((l) => !l.loop && l.target === n)); n = p; }
    } else {
      const stack = [focus];
      while (stack.length) { const n = stack.pop(); for (const c of n.kids) { near.add(c); stack.push(c); } }
      for (const l of links) if (!l.loop && near.has(l.source) && near.has(l.target)) lit.add(l);
    }
    return { near, lit };
  }
  // Big trees (thousands of nodes): colors are computed once per change (n.fill, see paint), only what falls on
  // screen is drawn, and lines and circles of the same style go out as one path each.
  const BATCH_FROM = 600;
  function draw() {
    context.clearRect(0, 0, view.width, view.height);
    if (!nodes.length) return;
    const focus = hovered || selected || (dragging ? pressed : null);
    const f = focusSet(focus);
    const scale = Math.min(1.4, Math.max(0.5, view.zoom));
    const W = view.width, H = view.height;
    const pos = new Map();
    for (const n of nodes) pos.set(n, toScreen(n));
    if (S.drawLinks) drawLinks(f, pos, scale, W, H);
    const halo = token("--canvas");
    if (nodes.length > BATCH_FROM) {
      // Halos first, then the circles grouped by color and opacity.
      const groups = new Map();
      if (S.halo > 0) { context.globalAlpha = 1; context.fillStyle = halo; context.beginPath(); }
      for (const n of drawOrder) {
        const [x, y] = pos.get(n), r = Math.max(1.5, n.r * view.zoom);
        if (x + r < -10 || y + r < -10 || x - r > W + 10 || y - r > H + 10) continue;
        if (S.halo > 0) { context.moveTo(x + r + S.halo, y); context.arc(x, y, r + S.halo, 0, Math.PI * 2); }
        const alpha = f && !f.near.has(n) ? S.dim : isOff(n) ? 0.15 : 1, key = n.fill + "|" + alpha;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(x, y, r);
      }
      if (S.halo > 0) context.fill();
      for (const [key, list] of groups) {
        const [color, alpha] = key.split("|");
        context.globalAlpha = +alpha; context.fillStyle = color; context.beginPath();
        for (let i = 0; i < list.length; i += 3) { context.moveTo(list[i] + list[i + 2], list[i + 1]); context.arc(list[i], list[i + 1], list[i + 2], 0, Math.PI * 2); }
        context.fill();
      }
    } else {
      for (const n of drawOrder) {
        const [x, y] = pos.get(n), r = Math.max(1.5, n.r * view.zoom);
        if (S.halo > 0) {
          context.globalAlpha = 1;
          context.beginPath(); context.arc(x, y, r + S.halo, 0, Math.PI * 2);
          context.fillStyle = halo; context.fill();
        }
        context.globalAlpha = f && !f.near.has(n) ? S.dim : isOff(n) ? 0.15 : 1;
        context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2);
        context.fillStyle = n.fill; context.fill();
      }
    }
    // Rings: the root always (so it stands out whatever colors the others), the focused or chosen node on top.
    context.globalAlpha = 1; context.strokeStyle = token("--ink");
    for (const n of [nodes[0], focus, selected]) {
      if (!n) continue;
      const [x, y] = pos.get(n) || toScreen(n), r = Math.max(1.5, n.r * view.zoom), ring = n.row === 0 && n !== focus && n !== selected;
      context.lineWidth = ring ? 2 : 2.5;
      context.beginPath(); context.arc(x, y, r + (ring ? 2 : 0), 0, Math.PI * 2); context.stroke();
    }
    drawLabels(f, focus, pos, W, H);
  }
  function drawLinks(f, pos, scale, W, H) {
    const linkPal = S.linkColor === "sim" ? paletteFn() : null, [low, high] = FIXED.lenRange;
    const muted = token("--ink-3");
    const groups = new Map(), lit = [];
    context.lineCap = "round";
    for (const l of links) {
      const [x1, y1] = pos.get(l.source), [x2, y2] = pos.get(l.target);
      if ((x1 < 0 && x2 < 0) || (y1 < 0 && y2 < 0) || (x1 > W && x2 > W) || (y1 > H && y2 > H)) continue;
      const width = S.linkWidthBy === "sim" ? 0.5 + 1.2 * Math.max(0, (l.sim - 0.55) / 0.4) : 1;
      if (f && f.lit.has(l)) { lit.push([x1, y1, x2, y2, width]); continue; }
      const color = S.linkColor === "child" ? l.target.fill
        : linkPal ? linkPal(Math.round(Math.max(0, Math.min(1, (l.sim - low) / (high - low))) * 20) / 20) : muted;
      const base = l.loop ? S.loopOpacity : S.linkOpacity;
      const alpha = f ? Math.min(base, S.dim / 3) : isOff(l.source) || isOff(l.target) ? base * 0.25 : base;
      const key = [color, alpha, Math.round(width * S.linkWidth * scale * 10) / 10, l.loop && S.loopDash ? 1 : 0].join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(x1, y1, x2, y2);
    }
    for (const [key, list] of groups) {
      const [color, alpha, width, dash] = key.split("|");
      context.strokeStyle = color; context.globalAlpha = +alpha; context.lineWidth = +width;
      context.setLineDash(dash === "1" ? [4, 4] : []);
      context.beginPath();
      for (let i = 0; i < list.length; i += 4) { context.moveTo(list[i], list[i + 1]); context.lineTo(list[i + 2], list[i + 3]); }
      context.stroke();
    }
    context.setLineDash([]);
    context.strokeStyle = token("--accent"); context.globalAlpha = 0.9;
    for (const [x1, y1, x2, y2, width] of lit) {
      context.lineWidth = Math.max(1.6, width * S.linkWidth) * scale;
      context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
    }
    context.globalAlpha = 1;
  }
  const LABELS_MAX = 2500;   // "all": at most this many on screen at once, the most similar first
  function drawLabels(f, focus, pos, W, H) {
    let chosen = [];
    if (S.labels === "all") chosen = drawOrder;
    else if (S.labels === "top") chosen = drawOrder.slice(-(S.labelCount + 1));
    if (S.labels !== "none" && focus) chosen = [...new Set([...chosen, ...(f ? [...f.near] : [focus])])];
    if (!chosen.length) return;
    context.font = "600 " + S.labelSize + "px " + (token("--font") || "sans-serif");
    context.textBaseline = "middle";
    context.lineJoin = "round";
    let drawn = 0;
    for (let i = chosen.length - 1; i >= 0 && drawn < LABELS_MAX; i--) {
      const n = chosen[i], [x, y] = pos.get(n) || toScreen(n);
      if (x < -300 || y < -20 || x > W + 20 || y > H + 20) continue;
      const r = Math.max(1.5, n.r * view.zoom), text = labelOf(n);
      context.globalAlpha = f && !f.near.has(n) ? S.dim : 1;
      context.lineWidth = 3; context.strokeStyle = token("--canvas"); context.strokeText(text, x + r + 4, y);
      context.fillStyle = n === focus ? token("--ink") : token("--ink-2"); context.fillText(text, x + r + 4, y);
      drawn++;
    }
    context.globalAlpha = 1;
  }

  // ---------- loop ----------
  let running = false;
  const moveToTargets = () => {
    let moving = false;
    for (const n of nodes) {
      if (n === pressed && dragging) continue;
      const t = targets.get(n);
      if (!t) continue;
      const dx = t.x - n.x, dy = t.y - n.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.3) { n.x += dx * 0.18; n.y += dy * 0.18; moving = true; } else { n.x = t.x; n.y = t.y; }
    }
    return moving;
  };
  // What a frame costs (physics + drawing, ms), shown in the subtitle so one can tell when to hide the links.
  const cost = { physics: 0, draw: 0, shown: 0 };
  const ease = (old, now) => (old ? old * 0.8 + now * 0.2 : now);
  function showCost() {
    const box = $("cost");
    if (!box || performance.now() - cost.shown < 400) return;
    cost.shown = performance.now();
    box.textContent = ` · cuadro ${nf(Math.round(cost.physics + cost.draw))} ms (física ${nf(Math.round(cost.physics))}, dibujo ${nf(Math.round(cost.draw))})`;
  }
  /** Whether the nodes are about still: their mean and top speed on screen, in px per tick, under REST. */
  function still() {
    let top = 0, sum = 0;
    for (const n of nodes) { const v = Math.max(Math.abs(n.vx), Math.abs(n.vy)) * view.zoom; sum += v; if (v > top) top = v; }
    return top < REST.max && sum / Math.max(1, nodes.length) < REST.mean;
  }
  let stillFrames = 0, runUntil = 0;
  function frame() {
    let busy = false;
    const frameStart = performance.now();
    if (S.layout === "forces") {
      if (S.physics) {
        let steps = 0;
        do { tick(); steps++; }
        while (steps < MAX_TICKS_PER_FRAME && performance.now() - frameStart < TICK_BUDGET_MS);
        stillFrames = !dragging && still() ? stillFrames + 1 : 0;
        busy = stillFrames < REST_FRAMES && (dragging || performance.now() < runUntil);
      }
    } else {
      busy = moveToTargets();
    }
    const moving = !view.user && !dragging ? fit(false) : false;
    for (const n of nodes) placed.set(n.item, { x: n.x, y: n.y });
    const drawStart = performance.now();
    draw();
    cost.physics = ease(cost.physics, drawStart - frameStart);
    cost.draw = ease(cost.draw, performance.now() - drawStart);
    showCost();
    if (busy || moving || dragging) requestAnimationFrame(frame);
    else running = false;
  }
  /** Runs the layout until it rests again (after a change or a drag), at most MAX_RUN_MS. */
  function start() {
    stillFrames = 0;
    runUntil = performance.now() + MAX_RUN_MS;
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  // ---------- pointer ----------
  let pressed = null, dragging = false, panning = null, pressX = 0, pressY = 0;
  function nodeAt(e) {
    const rect = canvas.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      const [x, y] = toScreen(n), d = Math.hypot(x - px, y - py), reach = Math.max(n.r * view.zoom, 5) + 3;
      if (d < reach && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }
  canvas.addEventListener("pointerdown", (e) => {
    pressX = e.clientX; pressY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    const n = nodeAt(e);
    if (n) pressed = n;
    else panning = { x: view.x, y: view.y };
  });
  canvas.addEventListener("pointermove", (e) => {
    const moved = Math.hypot(e.clientX - pressX, e.clientY - pressY);
    if (pressed) {   // any node, the root too
      if (!dragging && moved > 5) {
        dragging = true;
        start();
      }
      if (dragging) {
        const rect = canvas.getBoundingClientRect(), [wx, wy] = toWorld(e.clientX - rect.left, e.clientY - rect.top);
        if (S.layout === "forces" && S.physics) { pressed.fx = wx; pressed.fy = wy; }
        else { pressed.x = wx; pressed.y = wy; targets.set(pressed, { x: wx, y: wy }); if (!running) draw(); }
        hovered = pressed; hideTip();
        return;
      }
    }
    if (panning && moved > 3) {
      view.user = true;
      view.x = panning.x - (e.clientX - pressX) / view.zoom; view.y = panning.y - (e.clientY - pressY) / view.zoom;
      if (!running) draw();
      return;
    }
    if (pressed) return;
    const n = nodeAt(e);
    if (n !== hovered) { hovered = n; canvas.style.cursor = n ? "pointer" : ""; if (!running) draw(); }
    if (n) showTip(`<b>${esc(cut(nameOf(n), 140))}</b><span>${esc(metaOf(n))}</span><span>${n.row ? `parecido con la raíz ${cos(n.simRoot)} · con su padre ${cos(n.simParent)} · nivel ${n.depth}` : "raíz"}</span>`, e);
    else hideTip();
  });
  canvas.addEventListener("pointerup", (e) => {
    const n = pressed, moved = Math.hypot(e.clientX - pressX, e.clientY - pressY);
    pressed = null; panning = null;
    if (dragging) {
      dragging = false;
      if (n) { n.fx = null; n.fy = null; }
      start();
      return;
    }
    if (moved > 5) return;
    selected = n || null;
    renderCard(); renderList();
    if (!running) draw();
  });
  canvas.addEventListener("pointerleave", () => { if (!dragging && hovered) { hovered = null; hideTip(); if (!running) draw(); } });
  canvas.addEventListener("dblclick", (e) => { const n = nodeAt(e); if (n && n.row !== 0) setRoot(idOf(n)); });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
    const [wx, wy] = toWorld(px, py), factor = Math.exp(-e.deltaY * 0.0015);
    view.zoom = Math.min(8, Math.max(ZOOM_MIN, view.zoom * factor));
    view.x = wx - (px - view.width / 2) / view.zoom; view.y = wy - (py - view.height / 2) / view.zoom;
    view.user = true;
    if (!running) draw();
  }, { passive: false });

  // ---------- panel ----------
  const sliderMax = (c) => (c.key === "cap" && INDEX ? Math.max(10, INDEX.items.length - 1) : c.key === "nodes" && TREE ? Math.max(1, TREE.rows.length - 1) : c.max);
  const valueText = (c, v) => (c.pct ? `${Math.round(v * 100)} %` : c.key === "duplicate" && v > 1 ? "nunca"
    : c.noLimitAtMax && v >= c.max ? "sin límite"
    : c.allAtMax && v >= sliderMax(c) ? `todos (${nf(sliderMax(c))})` : c.allAtMax ? nf(v) : fmt(v));
  const helpHtml = (c) => (c.help ? `<p class="help" data-help="${c.key}"${c.when && !c.when() ? " hidden" : ""}>${c.help}</p>` : "");
  function controlHtml(c) {
    if (c.section) return `<h4 class="subhead">${c.section}</h4>`;
    if (c.buttons) return `<div class="buttons"><button data-action="reheat">Reanimar</button><button data-action="radial">Desde el radial</button><button data-action="fit">Encuadrar</button></div>`;
    const hidden = c.when && !c.when() ? " hidden" : "";
    if (c.type === "switch") return `<label class="switch" data-row="${c.key}"${hidden}><span>${c.label}</span><input type="checkbox" data-key="${c.key}"${S[c.key] ? " checked" : ""}><i></i></label>` + helpHtml(c);
    if (c.type === "select") return `<label class="field" data-row="${c.key}"${hidden}><span>${c.label}</span><select data-key="${c.key}">${c.options().map(([v, l]) => `<option value="${esc(v)}"${String(S[c.key]) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>` + helpHtml(c);
    return `<label class="slider" data-row="${c.key}"${hidden}><span>${c.label}<output data-out="${c.key}">${valueText(c, S[c.key])}</output></span><input type="range" data-key="${c.key}" min="${c.min}" max="${sliderMax(c)}" step="${c.step}" value="${S[c.key]}"></label>` + helpHtml(c);
  }
  function renderPanel() {
    const body = $("panel-body");
    const open = new Set([...body.querySelectorAll("details[open]")].map((d) => d.dataset.section));
    const first = !body.children.length;
    document.body.classList.toggle("no-help", !S.help);
    body.innerHTML = `
      <label class="switch help-switch"><span>Explicaciones</span><input type="checkbox" id="help-switch"${S.help ? " checked" : ""}><i></i></label>
      <details data-section="Raíz" open>
        <summary>Raíz</summary>
        <input id="q" type="search" placeholder="${BILLS ? "Buscar número o nombre…" : "Buscar título, medio, autor o expediente…"}" autocomplete="off" aria-label="Buscar la raíz">
        <div id="results" class="results"></div>
        <div id="root-now" class="root-now"></div>
        <div class="buttons"><button data-action="back">Atrás</button><button data-action="random">Al azar</button><button data-action="site">Como el sitio</button></div>
        <p class="hint">Doble clic en un nodo lo hace raíz. «Como el sitio» vuelve a los valores del sitio sin cambiar la raíz.</p>
      </details>
      ${SECTIONS.map((s) => `
      <details data-section="${s.title}"${(first ? !s.closed : open.has(s.title)) ? " open" : ""}${s.when && !s.when() ? " hidden" : ""}>
        <summary>${s.title}</summary>
        ${s.controls.map(controlHtml).join("")}
        ${s.hint ? `<p class="hint">${s.hint}</p>` : ""}
        ${s.legend ? `<div id="legend-box"></div>` : ""}
        ${s.list ? `<ul id="node-list" class="node-list"></ul>` : ""}
      </details>`).join("")}
      <details data-section="Exportar"${open.has("Exportar") ? " open" : ""}>
        <summary>Exportar</summary>
        <div class="buttons"><button data-action="copy">Copiar ajustes</button><button data-action="png">PNG</button><button data-action="reset">Restablecer</button></div>
        <p id="export-note" class="hint">«Copiar ajustes» copia los valores con la forma de las constantes de export_item_graphs.py y de itemGraph.ts. «Restablecer» vuelve a los valores del sitio en todo.</p>
      </details>`;
    renderRoot();
    renderLegend();
    renderList();
  }
  function refreshVisibility() {
    for (const c of CONTROLS) {
      const row = document.querySelector(`[data-row="${c.key}"]`), help = document.querySelector(`[data-help="${c.key}"]`);
      if (row) row.hidden = !!(c.when && !c.when());
      if (help) help.hidden = !!(c.when && !c.when());
    }
    for (const s of SECTIONS) {
      const box = document.querySelector(`details[data-section="${s.title}"]`);
      if (box) box.hidden = !!(s.when && !s.when());
    }
    const palette = document.querySelector('select[data-key="palette"]');
    if (palette) {
      palette.innerHTML = CONTROL.palette.options().map(([v, l]) => `<option value="${v}"${S.palette === v ? " selected" : ""}>${l}</option>`).join("");
      if (palette.value !== S.palette) S.palette = palette.value;
    }
  }
  function syncInputs() {
    for (const c of CONTROLS) {
      const input = document.querySelector(`[data-key="${c.key}"]`);
      if (!input) continue;
      if (c.type === "switch") input.checked = !!S[c.key];
      else { if (c.type === "range") input.max = sliderMax(c); input.value = S[c.key]; }
      const out = document.querySelector(`[data-out="${c.key}"]`);
      if (out) out.textContent = valueText(c, S[c.key]);
    }
    refreshVisibility();
  }
  function nodesSlider() {
    for (const key of ["nodes", "cap"]) {
      const input = document.querySelector(`[data-key="${key}"]`), out = document.querySelector(`[data-out="${key}"]`);
      if (!input) continue;
      input.max = sliderMax(CONTROL[key]);
      input.value = S[key];
      if (out) out.textContent = valueText(CONTROL[key], S[key]);
    }
  }

  let serverTimer = 0;
  function changed(key) {
    const c = CONTROL[key];
    saveSettings();
    refreshVisibility();
    switch (c.group) {
      case "server":
        if (key === "pool") { isolated.clear(); reloadPool(); return; }
        clearTimeout(serverTimer); serverTimer = setTimeout(loadTree, 250); return;
      case "tree":
        if (!TREE) return;
        if (key === "a") reparent();
        rebuild(false); return;
      case "layout":
        if (!nodes.length) return;
        sizeNodes(); setLengths(); targets = places(); linkForce.distance(linkForce.distance()); applyForces();
        if (key === "layout" || key === "depthBy") view.user = false;
        start(0.7); return;
      case "forces":
        applyForces();
        start(0.5); return;
      case "list": renderList(); return;
      default:
        if (key === "colorBy") isolated.clear();
        renderLegend(); renderList(); if (!running) draw();
    }
  }
  $("panel-body").addEventListener("input", (e) => {
    const key = e.target.dataset.key;
    if (!key || e.target.type !== "range") return;
    S[key] = +e.target.value;
    const out = document.querySelector(`[data-out="${key}"]`);
    if (out) out.textContent = valueText(CONTROL[key], S[key]);
    changed(key);
  });
  $("panel-body").addEventListener("change", (e) => {
    if (e.target.id === "help-switch") {
      S.help = e.target.checked;
      document.body.classList.toggle("no-help", !S.help);
      saveSettings();
      return;
    }
    const key = e.target.dataset.key;
    if (!key || e.target.type === "range") return;
    S[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    changed(key);
  });
  $("panel-body").addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    const pick = e.target.closest("[data-pick]")?.dataset.pick;
    const focus = e.target.closest("[data-focus]")?.dataset.focus;
    if (pick) { setRoot(pick); $("q").value = ""; $("results").innerHTML = ""; return; }
    if (focus != null) { selected = nodes.find((n) => String(n.row) === focus) || null; renderCard(); renderList(); centerOn(selected); return; }
    if (!action) return;
    if (action === "reheat") { view.user = false; start(); }
    if (action === "radial") { for (const n of nodes) { const t = targets.get(n); if (t && n.row) { n.x = t.x; n.y = t.y; } } view.user = false; start(1); }
    if (action === "fit") { view.user = false; start(0); }
    if (action === "back" && history.length) setRoot(history.pop(), false);
    if (action === "random") setRoot(String(ITEMS[Math.floor(Math.random() * ITEMS.length)][F.id]));
    if (action === "site") resetTo(siteValues());
    if (action === "reset") resetTo({ ...BASE });
    if (action === "copy") copySettings();
    if (action === "png") savePng();
  });
  function siteValues() {
    const out = { ...S };
    // Everything the site fixes; what is only this page's (other layouts, labels, list, links hidden) stays.
    for (const key of ["pool", "k", "floor", "w", "a", "duplicate", "cap", "nodes", "minSim", "loopRank", "layout", "physics", "lengthBase", "contrast",
      "treeStrength", "loopStrength", "elasticity", "charge", "chargeFalloff", "chargeReach", "collidePad", "clearStrength", "damping", "gravity", "gravityFrom", "gravityGrowth", "rootGravity", "rootGravityFrom", "rootGravityGrowth", "walls", "sizeBy", "sizeMin", "sizePer", "sizeMax",
      "colorBy", "palette", "band1", "band2", "band3", "band4", "rootAccent", "linkWidthBy", "linkWidth", "linkColor", "linkOpacity", "loopOpacity", "hoverMode", "dim", "halo"]) out[key] = BASE[key];
    return out;
  }
  function resetTo(values) {
    const poolChanged = values.pool !== S.pool;
    S = values;
    isolated.clear();
    saveSettings();
    syncInputs();
    view.user = false;
    if (poolChanged) reloadPool(); else loadTree();
  }
  function centerOn(n) {
    if (!n) return;
    view.user = true; view.x = n.x; view.y = n.y;
    if (!running) draw();
  }

  // ---------- root ----------
  $("panel").addEventListener("input", (e) => {
    if (e.target.id !== "q") return;
    const words = norm(e.target.value.trim()).split(/\s+/).filter(Boolean);
    if (!words.length) { $("results").innerHTML = ""; return; }
    const found = [];
    for (let i = 0; i < ITEMS.length && found.length < 20; i++) if (words.every((w) => SEARCH[i].includes(w))) found.push(i);
    $("results").innerHTML = found.length ? found.map((i) => {
      const it = ITEMS[i];
      return `<button data-pick="${esc(it[F.id])}">${BILLS ? `<b>${it[F.id]}</b> ${esc(cut(it[F.name], 110))}` : `<b>${esc(cut(it[F.title], 100))}</b> · ${esc(outletName(it[F.outlet]))} ${dateText(it[F.date])}`}</button>`;
    }).join("") : `<p class="hint">Nada en «${esc(POOL_LABELS[S.pool])}».</p>`;
  });
  $("panel").addEventListener("keydown", (e) => {
    if (e.target.id === "q" && e.key === "Enter") { const first = $("results").querySelector("[data-pick]"); if (first) first.click(); }
  });
  function setRoot(id, remember = true) {
    if (!POS.has(id) || id === root) return;
    if (remember && root) history.push(root);
    root = id;
    selected = null; hovered = null; isolated.clear();
    view.user = false;
    saveSettings();
    renderRoot();
    loadTree();
  }
  function renderRoot() {
    const box = $("root-now");
    if (!box || !root || !POS.has(root)) return;
    const it = ITEMS[POS.get(root)];
    box.innerHTML = BILLS ? `Raíz: <b>${it[F.id]}</b> ${esc(cut(it[F.name], 120))}` : `Raíz: <b>${esc(cut(it[F.title], 120))}</b><br>${esc(outletName(it[F.outlet]))} · ${dateText(it[F.date])}`;
    const back = document.querySelector('[data-action="back"]');
    if (back) back.disabled = !history.length;
  }

  // ---------- legend, list and card ----------
  function renderLegend() {
    const box = $("legend-box");
    if (!box || !nodes.length) return;
    paint();
    if (groupOf) {
      const counts = new Map();
      for (const n of nodes.slice(1)) { const k = String(groupOf(n)); counts.set(k, (counts.get(k) || 0) + 1); }
      let items;
      if ((S.colorBy === "simRoot" || S.colorBy === "simParent") && S.palette === "bands") {
        const cuts = [S.band1, S.band2, S.band3, S.band4], colors = bandColors();
        items = BAND_NAMES.map((name, i) => ({ key: i, color: colors[i],
          label: `${name} (${i === 0 ? `${cos(cuts[0])} o más` : i === 4 ? `menos de ${cos(cuts[3])}` : `${cos(cuts[i])}–${cos(cuts[i - 1])}`})` }));
      } else items = categorical(S.colorBy).legend;
      items = items.filter((i) => counts.get(String(i.key)));
      box.innerHTML = `<div class="legend">${items.map((i) => `<button class="legend-item${isolated.has(String(i.key)) ? " on" : ""}${isolated.size && !isolated.has(String(i.key)) ? " off" : ""}" data-iso="${esc(i.key)}"><span class="swatch" style="background:${i.color}"></span><span class="legend-label" title="${esc(i.label)}">${esc(i.label)}</span><span class="legend-count">${nf(counts.get(String(i.key)))}</span></button>`).join("")}${isolated.size ? `<button class="link-button" data-iso-clear>Quitar selección</button>` : ""}</div><p class="hint">Clic en una fila para resaltar ese grupo.</p>`;
    } else {
      const c = continuous(S.colorBy), p = paletteFn();
      const stops = d3.range(0, 1.0001, 0.1).map((t) => p(t)).join(", ");
      box.innerHTML = `<div class="gradient" style="background: linear-gradient(90deg, ${stops})"></div><div class="gradient-ends"><span>${esc(c.format(c.domain[0]))}</span><span>${esc(c.format(c.domain[1]))}</span></div>`;
    }
  }
  document.addEventListener("click", (e) => {
    const iso = e.target.closest("[data-iso]");
    if (iso) { const k = iso.dataset.iso; if (isolated.has(k)) isolated.delete(k); else isolated.add(k); renderLegend(); if (!running) draw(); return; }
    if (e.target.closest("[data-iso-clear]")) { isolated.clear(); renderLegend(); if (!running) draw(); }
  });
  const LIST_MAX = 300;
  function renderList() {
    const box = $("node-list");
    if (!box || !nodes.length) return;
    const key = { order: (n) => n.order, simRoot: (n) => -n.simRoot, simParent: (n) => -n.simParent, depth: (n) => n.depth, desc: (n) => -n.desc }[S.listSort];
    const list = nodes.slice().sort((a, b) => key(a) - key(b) || a.order - b.order).slice(0, LIST_MAX);
    if (selected && !list.includes(selected)) list.push(selected);
    box.innerHTML = list.map((n) => `<li><button data-focus="${n.row}"${n === selected ? ' class="on"' : ""} title="${esc(nameOf(n))}"><span class="swatch" style="background:${n.fill}"></span><span>${esc(BILLS ? nameOf(n) : item(n)[F.title])}</span><i>${n.row ? cos(S.listSort === "simParent" ? n.simParent : n.simRoot) : "raíz"}</i></button></li>`).join("");
  }
  function renderCard() {
    const card = $("card");
    if (!selected) { card.hidden = true; return; }
    const n = selected, it = item(n), parent = byRow.get(n.parentRow);
    const loops = links.filter((l) => l.loop && (l.source === n || l.target === n)).map((l) => (l.source === n ? l.target : l.source));
    const entry = (m, value) => `<li><button data-card-focus="${m.row}"><span class="swatch" style="background:${m.fill}"></span><b>${esc(cut(nameOf(m), 70))}</b><i>${cos(value)}</i></button></li>`;
    const id = it[F.id];
    const links_ = [
      it[F.published] ? `<a href="${SITE}/${BILLS ? "expediente" : "noticia"}/${id}/" target="_blank" rel="noopener">Ficha en el sitio</a>` : "",
      `<a href="../db_explorer/#/${BILLS ? "bill" : "news"}/${id}" target="_blank">Explorador</a>`,
      !BILLS && it[F.url] ? `<a href="${esc(it[F.url])}" target="_blank" rel="noopener">Nota original</a>` : "",
    ].filter(Boolean).join("");
    card.innerHTML = `
      <button class="card-close" aria-label="Cerrar">×</button>
      <div class="card-number">${n.row === 0 ? "Raíz" : `${n.order}.º en entrar · nivel ${n.depth}`}</div>
      <h2>${esc(BILLS ? `${id} · ${it[F.name]}` : it[F.title])}</h2>
      <dl>
        ${BILLS ? `<dt>Estado</dt><dd>${esc(it[F.status] || "—")}</dd><dt>Tipo</dt><dd>${esc(it[F.type] || "—")}</dd><dt>Presentado</dt><dd>${dateText(it[F.date]) || "—"}</dd><dt>Noticias</dt><dd>${nf(it[F.news] || 0)}</dd>`
          : `<dt>Medio</dt><dd>${esc(outletName(it[F.outlet]))}</dd><dt>Fecha</dt><dd>${dateText(it[F.date])}</dd><dt>Género</dt><dd>${esc(GENRES[it[F.genre]] || "—")}</dd><dt>Autor</dt><dd>${esc(it[F.author] || "—")}</dd><dt>Expediente</dt><dd>${it[F.bill] ?? "—"}</dd>`}
        ${n.row ? `<dt>Con la raíz</dt><dd>${cos(n.simRoot)}</dd><dt>Con su padre</dt><dd>${cos(n.simParent)}</dd>` : ""}
        <dt>Descendientes</dt><dd>${nf(n.desc)}</dd>
      </dl>
      <div class="card-actions">${n.row ? `<button data-card-root>Hacer raíz</button>` : ""}</div>
      <div class="card-links">${links_}</div>
      ${parent ? `<h3>Cuelga de</h3><ul class="similar">${entry(parent, n.simParent)}</ul>` : ""}
      ${n.kids.length ? `<h3>Le cuelgan (${n.kids.length})</h3><ul class="similar">${n.kids.map((c) => entry(c, c.simParent)).join("")}</ul>` : ""}
      ${loops.length ? `<h3>Bucles</h3><ul class="similar">${loops.map((m) => entry(m, links.find((l) => l.loop && ((l.source === n && l.target === m) || (l.target === n && l.source === m))).sim)).join("")}</ul>` : ""}`;
    card.hidden = false;
  }
  $("card").addEventListener("click", (e) => {
    if (e.target.closest(".card-close")) { selected = null; renderCard(); renderList(); if (!running) draw(); return; }
    if (e.target.closest("[data-card-root]") && selected) { setRoot(idOf(selected)); return; }
    const f = e.target.closest("[data-card-focus]");
    if (f) { selected = byRow.get(+f.dataset.cardFocus) || null; renderCard(); renderList(); centerOn(selected); }
  });

  // ---------- export ----------
  function copySettings() {
    const c100 = (v) => Math.round(v * 100);
    const text = [
      "# export_item_graphs.py",
      `K = ${S.k}`, `A_DEPTH = ${S.a}`, `W_EDGE = ${S.w}`, `FLOORS["${KIND}"] = ${S.floor}`,
      ...(BILLS ? [] : [`DUPLICATE = ${S.duplicate > 1 ? "None" : S.duplicate}`]),
      `MAX_NODES = ${S.cap}`, `LOOP_RANK = ${S.loopRank}  # 0 = sin bucles en la página`,
      "",
      "// site/src/lib/itemGraph.ts",
      `${KIND}: { bands: [${[S.band1, S.band2, S.band3, S.band4].map(c100).join(", ")}], minSim: { value: ${c100(S.minSim)} }, nodes: ${S.nodes} }`,
      "",
      "// site/src/scripts/itemGraph.ts",
      `LINK_BY_SIMILARITY.gap = [${S.lengthBase - FIXED.gapSpread / 2}, ${S.lengthBase + FIXED.gapSpread / 2}]; CONTRAST = ${S.contrast}  // largo base ${S.lengthBase}`,
      `SIZE = { min: ${S.sizeMin}, perRoot: ${S.sizePer}, max: ${S.sizeMax} }  // por ${S.sizeBy}`,
      `FORCES = { treeStrength: ${S.treeStrength}, loopStrength: ${S.loopStrength}, charge: ${S.charge}, gravity: ${S.gravityGrowth}, clearStrength: ${S.clearStrength} }  // repulsión 1/d^${S.chargeFalloff} (a ${CHARGE_REFERENCE} unidades = ${S.charge}), alcance ${S.chargeReach >= CONTROL.chargeReach.max ? "sin límite" : S.chargeReach}; gravedad fija ${S.gravity} desde ${S.gravityFrom}; raíz: fija ${S.rootGravity}, desde ${S.rootGravityFrom}, aumento ${S.rootGravityGrowth}; paredes ${S.walls ? "sí" : "no"}`,
      `collide = r + ${S.collidePad}; damping = ${S.damping}; elasticity = ${S.elasticity}`,
      `HALO = ${S.halo}; DIM_NODES = ${S.dim}; DIM_LINKS = ${Math.round((S.dim / 3) * 100) / 100}`,
      "",
      `// raíz ${root} (${S.pool}); disposición ${S.layout}; color ${S.colorBy} (${S.palette})`,
      "// todo: " + JSON.stringify(S),
    ].join("\n");
    const note = $("export-note");
    navigator.clipboard.writeText(text).then(() => { note.textContent = "Copiado."; note.classList.add("copied"); },
      () => { note.textContent = "No se pudo copiar; está en la consola."; console.log(text); });
  }
  function savePng() {
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `arbol-${KIND}-${root}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  // ---------- status ----------
  function status(text, error) {
    const box = $("missing");
    box.textContent = text;
    box.hidden = !text || (!error && nodes.length > 0);
    if (text && nodes.length) $("subtitle").textContent = text;
  }
  function describe() {
    const count = nodes.length - 1, noun = BILLS ? ["expediente", "expedientes"] : ["noticia", "noticias"];
    const parts = [`${nf(count)} ${count === 1 ? noun[0] : noun[1]} de ${nf(passing)} sobre el mínimo (${nf(TREE.rows.length - 1)} en el árbol)`];
    if (S.loopRank) parts.push(`${nf(loopCount)} bucles`);
    if (TREE.skipped) parts.push(`${nf(TREE.skipped)} copias fuera`);
    parts.push(`${POOL_LABELS[S.pool].toLowerCase()}`, `armado en ${nf(TREE.ms)} ms`);
    $("subtitle").textContent = parts.join(" · ");
    $("subtitle").append(Object.assign(document.createElement("span"), { id: "cost" }));
    cost.physics = cost.draw = cost.shown = 0;
    $("missing").hidden = count > 0;
    if (!count) { $("missing").hidden = false; $("missing").textContent = TREE.rows.length > 1 ? "Ningún nodo pasa el parecido mínimo: bajalo para ver más." : "Esta raíz no tiene vecinos sobre el piso."; }
  }

  async function reloadPool() {
    // The nodes on screen point into the old pool's items: they go before the new index arrives.
    nodes = []; links = []; drawOrder = []; TREE = null; selected = null; hovered = null;
    simulation.nodes([]); linkForce.links([]);
    $("card").hidden = true;
    try {
      await loadIndex();
      renderPanel(); syncInputs();
      await loadTree();
    } catch (error) {
      status(`No se pudo cargar el conjunto: ${error.message}. ¿Corre private_visuals/server.py con el python del .venv?`, true);
    }
  }

  window.treeCost = cost;   // for checking from the console
  window.treeRepulsion = forceRepulsion;   // to compare with d3.forceManyBody from the console
  /** From the console: ms per physics step and per drawing, without the animation (which a hidden tab pauses). */
  window.treeBench = (steps = 5) => {
    let t = performance.now();
    for (let i = 0; i < steps; i++) tick();
    const physics = (performance.now() - t) / steps;
    t = performance.now();
    for (let i = 0; i < steps; i++) draw();
    const drawMs = (performance.now() - t) / steps;
    // Each force timed once on its own, with the velocities put back afterwards (else the bench would add a second
    // dose of every force to the layout).
    const forces = {}, saved = nodes.map((n) => [n.vx, n.vy]);
    for (const name of ["link", "charge", "collide", "clearance", "gravity", "home", "no-spin"]) {
      t = performance.now();
      (name === "collide" ? collideForce : simulation.force(name))(ALPHA_ON);
      forces[name] = performance.now() - t;
    }
    nodes.forEach((n, i) => { n.vx = saved[i][0]; n.vy = saved[i][1]; });
    return { nodes: nodes.length, links: links.length, physics, draw: drawMs, forces,
      bad: nodes.filter((n) => !Number.isFinite(n.x) || !Number.isFinite(n.y)).length, root: nodes.length ? [Math.round(nodes[0].x), Math.round(nodes[0].y)] : null,
      speed: nodes.length ? { mean: +(nodes.reduce((sum, n) => sum + Math.hypot(n.vx, n.vy), 0) / nodes.length).toFixed(3), max: +Math.max(...nodes.slice(0, 2000).map((n) => Math.hypot(n.vx, n.vy))).toFixed(3) } : null };
  };

  // ---------- start ----------
  loadSettings();
  bindPanelToggle(() => { view.user = false; start(0); });
  resize();
  new ResizeObserver(() => { resize(); if (nodes.length) { targets = places(); start(0.2); } }).observe(canvas);
  document.addEventListener("themechange", () => { renderLegend(); renderList(); if (!running) draw(); });
  renderPanel();
  reloadPool();
})();
