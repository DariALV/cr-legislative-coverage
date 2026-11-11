// What the press views share (#69): the table of substantive pairs (one row per news item and
// bill) from build_graph.py, with the outlet, the week, the stage of the bill according to the
// news and the topic of the bill. Topics are folded into the most covered ones plus "other".
(function () {
  "use strict";
  const D = window.GRAPH_BILLS;
  if (!D || !D.press) {
    window.GraphPress = null;
    return;
  }
  const { PALETTE, sentence } = window.GraphUI;
  const F = Object.fromEntries(D.fields.map((name, i) => [name, i]));
  const TOP_TOPICS = 10;
  const NEUTRAL = "#7d7c75";   // "other" topics, "not stated" and nodes that carry no color

  // Outlets keep the hue they have in the Jev viewer, stepped for the dark surface.
  const OUTLETS = {
    crhoy: { name: "CRHoy", color: PALETTE[7] },
    nacion: { name: "La Nación", color: PALETTE[0] },
    delfino: { name: "Delfino", color: PALETTE[1] },
    elmundo: { name: "El Mundo", color: PALETTE[5] },
    semanario: { name: "Semanario Universidad", color: PALETTE[6] },
  };
  const STAGES = {
    filing: "Presentado", committee: "Comisión", first_debate: "Primer debate", second_debate: "Segundo debate",
    constitutional_court: "Sala IV", veto_or_signing: "Sanción o veto", archived_or_rejected: "Archivado o rechazado",
    not_stated: "No se dice",
  };

  const GENRES = { news_report: "Noticia", opinion: "Opinión", interview: "Entrevista", analysis: "Análisis" };
  const FRAMES = {
    policy: "Política pública", conflict: "Conflicto", economic: "Económico", responsibility: "Responsabilidad",
    human_interest: "Interés humano", morality: "Moral",
  };

  const outlets = D.press.outlets.map((key, id) => ({ id, key, ...(OUTLETS[key] || { name: key, color: NEUTRAL }) }));
  const stages = D.press.stages.map((key, id) => ({
    id, key, name: STAGES[key] || key, color: key === "not_stated" ? NEUTRAL : PALETTE[id], unstated: key === "not_stated",
  }));
  // Genre and main frame of the news item (Jev's `genre` and `main_frame`); a news item without
  // an answer goes to a last, gray item.
  const coded = (keys, names, column) => {
    const items = (keys || []).map((key, id) => ({ id, key, name: names[key] || key, color: PALETTE[id] }));
    if (D.press.news.some((row) => !(row[column] >= 0))) items.push({ id: items.length, key: "unknown", name: "Sin dato", color: NEUTRAL });
    return items;
  };
  const genres = coded(D.press.genres, GENRES, 2), frames = coded(D.press.frames, FRAMES, 3);
  const codeOf = (value, items) => (value >= 0 ? value : items.length - 1);

  // ---------- weeks ----------
  // Weeks run Monday to Sunday; the first one starts on the Monday on or before the first news.
  const DAY = 864e5;
  const utc = (iso) => Date.UTC(+iso.slice(0, 4), iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const firstDay = utc(D.press.news[0][0]), lastDay = utc(D.press.news[D.press.news.length - 1][0]);
  const start = firstDay - ((new Date(firstDay).getUTCDay() + 6) % 7) * DAY;
  const weekOf = (iso) => Math.floor((utc(iso) - start) / (7 * DAY));
  const weeks = d3.range(weekOf(D.press.news[D.press.news.length - 1][0]) + 1).map((w) => {
    const from = Math.max(start + w * 7 * DAY, firstDay), to = Math.min(start + w * 7 * DAY + 6 * DAY, lastDay);
    return { id: w, from: new Date(from), to: new Date(to), days: Math.round((to - from) / DAY) + 1 };
  });
  const dayMonth = (date) => date.toLocaleDateString("es-CR", { day: "numeric", month: "long", timeZone: "UTC" });
  const weekLabel = (w) => {
    const { from, to, days } = weeks[w];
    const range = from.getUTCMonth() === to.getUTCMonth() ? `${from.getUTCDate()} al ${dayMonth(to)}` : `${dayMonth(from)} al ${dayMonth(to)}`;
    return `Semana del ${range}${days < 7 ? ` (solo ${days} días)` : ""}`;
  };
  /** Position of a date on the week axis, where week w sits at w (its middle day). */
  const weekPosition = (date) => (date.getTime() - start) / (7 * DAY) - 0.5;

  // ---------- pairs ----------
  // `mentions` has every pair, passing mentions included; `pairs` only the substantive ones,
  // which is what the views count unless they say otherwise.
  const mentions = D.press.pairs.map(([news, node, stage, substantive = 1]) => {
    const [date, outlet, genre, frame] = D.press.news[news];
    return {
      news, node, stage, substantive: !!substantive, outlet, genre: codeOf(genre, genres), frame: codeOf(frame, frames),
      week: weekOf(date), topic: D.nodes[node][F.topic],
    };
  });
  const pairs = mentions.filter((p) => p.substantive);

  // ---------- topic groups ----------
  // The most covered topics keep the color they have on the bills map. The palette has eight
  // hues, so past eight topics two of them share one: the layers walk the palette in its own
  // order (whose neighbors are the ones checked for contrast), starting where the repeated hues
  // end up farthest apart.
  const volume = d3.rollup(pairs, (list) => list.length, (p) => p.topic);
  const top = [...volume.keys()].sort((a, b) => volume.get(b) - volume.get(a)).slice(0, TOP_TOPICS);
  const bySlot = d3.group(top, (t) => D.topics[t].color);   // each slot's topics, most covered first
  const walk = (first) => {
    const order = [];
    for (let pass = 0; order.length < top.length; pass++) {
      for (let step = 0; step < PALETTE.length; step++) {
        const topic = (bySlot.get((first + step) % PALETTE.length) || [])[pass];
        if (topic != null) order.push(topic);
      }
    }
    return order;
  };
  const spread = (order) => d3.min(order, (a, i) => d3.min(order, (b, j) =>
    (j > i && D.topics[a].color === D.topics[b].color ? j - i : Infinity)));
  const order = d3.range(PALETTE.length).map(walk).reduce((best, o) => (spread(o) > spread(best) ? o : best));
  const groups = order.map((topic, id) => ({
    id, topic, name: D.topics[topic].name, short: D.topics[topic].name.split(" · ")[0], color: PALETTE[D.topics[topic].color],
  }));
  const rest = [...volume.keys()].filter((t) => !top.includes(t));
  if (rest.length) {
    groups.push({ id: groups.length, topic: null, name: `Otros ${rest.length} temas`, short: "Otros", color: NEUTRAL, other: true });
  }
  const groupOfTopic = new Map(order.map((topic, id) => [topic, id]));
  for (const p of mentions) p.group = groupOfTopic.has(p.topic) ? groupOfTopic.get(p.topic) : groups.length - 1;

  /** The fields of a bill the press views show. */
  const bill = (node) => {
    const row = D.nodes[node];
    return { node, number: row[F.number], name: sentence(row[F.name]), topic: row[F.topic], substantive: row[F.substantive], stance: row[F.stance] };
  };
  /** Bills of `list` (pairs) with how many pairs each has, most covered first. */
  const topBills = (list, limit) => [...d3.rollup(list, (v) => v.length, (p) => p.node)]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit).map(([node, count]) => ({ ...bill(node), count }));

  const period = `${dayMonth(new Date(firstDay))} al ${dayMonth(new Date(lastDay))} de ${new Date(lastDay).getUTCFullYear()}`;
  window.GraphPress = { outlets, stages, genres, frames, groups, pairs, mentions, weeks, weekLabel, weekPosition, bill, topBills, period, NEUTRAL };
})();
