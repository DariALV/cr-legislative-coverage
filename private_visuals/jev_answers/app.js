// Jev answers viewer (#69). Data: window.JEV_ANSWERS from data.js (built by build_data.py) and
// Spanish labels from labels.js. Everything is filtered in the browser: pairs are the unit, and
// the two views group the surviving pairs by news or by bill. Cards are added in batches while
// scrolling so thousands of results stay light.
(() => {
  const BATCH = 25;
  const PREVIEW = 5;
  const BILL_URL = "https://delfino.cr/asamblea/proyecto/";
  const $ = (id) => document.getElementById(id);
  const D = window.JEV_ANSWERS;
  const L = window.JEV_LABELS;
  if (!D) { $("nodata").hidden = false; $("summary-box").hidden = true; return; }

  const Q = D.questions;
  const OUTLETS = L.outlets;
  const ACTORS = Object.keys(L.actors);
  const VOICES = Object.keys(L.voices);
  const FEATURES = Object.keys(L.features);
  const STAGES = Q.stage.options;
  const FRAMES = Q.main_frame.options;
  const GENRES = D.meta.genre_options;
  const POSITIONS = Q[ACTORS[0]].options;
  const STANCE_COLORS = ["var(--neg-2)", "var(--neg-1)", "var(--neu)", "var(--pos-1)", "var(--pos-2)"];
  const POSITION_COLORS = {
    not_mentioned: "", strongly_against: "var(--neg-2)", against: "var(--neg-1)",
    neutral_or_divided: "var(--neu)", in_favor: "var(--pos-1)", strongly_in_favor: "var(--pos-2)",
  };

  // ---------- helpers ----------
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (id) => `<svg><use href="#i-${id}"/></svg>`;
  const nf = (n) => n.toLocaleString("es-CR");
  const fp = (v) => (v / 100).toFixed(2).replace(".", ",");
  const band = (v) => (v >= 80 ? "hi" : v >= 50 ? "mid" : "lo");
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("es-CR", { day: "numeric", month: "short", year: "numeric" });
  const argmax = (arr) => arr.reduce((best, v, i) => (v > arr[best] ? i : best), 0);
  const outletOf = (k) => OUTLETS[k] || { name: k, color: "var(--ink-3)" };

  // ---------- data model ----------
  const news = D.news.map((n, i) => {
    const a = n.a || {};
    return {
      i, outlet: n.o, title: n.t, date: n.d, day: n.d.slice(0, 10), url: n.u, cut: n.c, a,
      genre: GENRES[argmax(n.g)], genreProbs: n.g,
      frame: a.main_frame ? FRAMES[argmax(a.main_frame)] : null,
      image: a.assembly_image ? Math.round(a.assembly_image[0] / 100) : null,
      press: a.press_release ?? null,
      norm: norm(n.t),
      pairs: [],
    };
  });
  const bills = {};
  for (const [num, b] of Object.entries(D.bills)) {
    bills[num] = { num: +num, name: b[0], status: b[1], kind: b[2], proposed: b[3], norm: norm(b[0]), pairs: [] };
  }
  const missingBill = (num) => (bills[num] = { num, name: "(expediente sin datos)", status: "", kind: "", proposed: "", norm: "", pairs: [] });

  const pairs = D.pairs.map(([ni, b, rank, ex, im, dl, named, det], idx) => {
    const p = { idx, n: news[ni], b: bills[b] || missingBill(b), rank, ex, im, max: Math.max(ex, im), dl: !!dl, named: !!named, det: det || null };
    if (p.det) {
      const d = p.det;
      p.cen = d.centrality[0] / 100;
      p.cenCat = Math.min(2, Math.max(0, Math.round(p.cen)));
      p.st = d.stance[0] / 100;
      p.stCat = Math.min(4, Math.max(0, Math.round(p.st)));
      p.stage = STAGES[argmax(d.stage)];
      p.actors = {};
      for (const k of ACTORS) p.actors[k] = POSITIONS[argmax(d[k])];
    }
    p.n.pairs.push(p);
    p.b.pairs.push(p);
    return p;
  });
  const delfinoLinks = pairs.filter((p) => p.dl);

  // ---------- state ----------
  const defaults = () => ({
    view: "news", q: "", thr: 50, mode: "max", outlets: new Set(Object.keys(OUTLETS)), from: "", to: "",
    genres: new Set(), mention: "all", delfino: "all", press: "all", stages: new Set(), cens: new Set(),
    stances: new Set(), frames: new Set(), images: new Set(), voices: new Set(), features: new Set(),
    actors: Object.fromEntries(ACTORS.map((k) => [k, "any"])), sort: { news: "prob", bill: "news" },
  });
  const S = defaults();
  const isAnalysis = () => S.view === "analysis";
  const val = (p) => (S.mode === "ex" ? p.ex : S.mode === "im" ? p.im : p.max);

  // ---------- filtering ----------
  const pairDetailActive = () =>
    S.stages.size || S.cens.size || S.stances.size || S.voices.size || S.features.size ||
    ACTORS.some((k) => S.actors[k] !== "any");
  const newsDetailActive = () => S.frames.size || S.images.size || S.press !== "all";

  function actorMatches(pos, want) {
    if (want === "any") return true;
    if (want === "mentioned") return pos !== "not_mentioned";
    if (want === "favor") return pos === "in_favor" || pos === "strongly_in_favor";
    if (want === "against") return pos === "against" || pos === "strongly_against";
    return pos === "neutral_or_divided";
  }

  // Every filter except the threshold (and the Delfino mode, which depends on it).
  function passesBase(p) {
    const n = p.n;
    if (!S.outlets.has(n.outlet)) return false;
    if (S.from && n.day < S.from) return false;
    if (S.to && n.day > S.to) return false;
    if (S.genres.size && !S.genres.has(n.genre)) return false;
    if (S.qn && !(n.norm.includes(S.qn) || p.b.norm.includes(S.qn) || String(p.b.num).includes(S.qn))) return false;
    if (newsDetailActive()) {
      if (!n.frame) return false;
      if (S.frames.size && !S.frames.has(n.frame)) return false;
      if (S.images.size && !S.images.has(n.image)) return false;
      if (S.press === "yes" && n.press < 50) return false;
      if (S.press === "no" && n.press >= 50) return false;
    }
    if (pairDetailActive()) {
      if (!p.det) return false;
      if (S.stages.size && !S.stages.has(p.stage)) return false;
      if (S.cens.size && !S.cens.has(p.cenCat)) return false;
      if (S.stances.size && !S.stances.has(p.stCat)) return false;
      if (S.voices.size && ![...S.voices].some((v) => p.det[v] >= 50)) return false;
      for (const f of S.features) if (p.det[f] < 50) return false;
      for (const k of ACTORS) if (!actorMatches(p.actors[k], S.actors[k])) return false;
    }
    return true;
  }

  function passesThreshold(p) {
    const above = val(p) >= S.thr;
    if (S.delfino === "missed") return p.dl && !above;
    if (!above) return false;
    if (S.mention === "explicit" && p.ex < S.thr) return false;
    if (S.mention === "implicit_only" && !(p.im >= S.thr && p.ex < S.thr)) return false;
    if (S.delfino === "in" && !p.dl) return false;
    if (S.delfino === "jev_only" && (p.n.outlet !== "delfino" || p.dl)) return false;
    return true;
  }

  // ---------- sorting ----------
  const SORTS = {
    news: [
      ["prob", "Mayor probabilidad"], ["date_desc", "Más recientes"], ["date_asc", "Más antiguas"],
      ["count", "Más expedientes"], ["centrality", "Mayor centralidad"], ["stance_asc", "Más críticas"], ["stance_desc", "Más favorables"],
    ],
    bill: [
      ["news", "Más noticias"], ["outlets", "Más medios"], ["prob", "Mayor probabilidad"], ["date_desc", "Noticia más reciente"],
      ["stance_asc", "Cobertura más crítica"], ["stance_desc", "Cobertura más favorable"], ["number", "Número de expediente"],
    ],
  };
  const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const nullsLast = (a, b, f) => (a == null) - (b == null) || f(a, b);

  function sortGroups(groups) {
    const key = S.sort[S.view];
    const by = {
      prob: (a, b) => b.best - a.best,
      date_desc: (a, b) => b.date.localeCompare(a.date),
      date_asc: (a, b) => a.date.localeCompare(b.date),
      count: (a, b) => b.items.length - a.items.length || b.best - a.best,
      news: (a, b) => b.items.length - a.items.length || b.best - a.best,
      outlets: (a, b) => b.outlets - a.outlets || b.items.length - a.items.length,
      centrality: (a, b) => nullsLast(a.cen, b.cen, (x, y) => y - x),
      stance_asc: (a, b) => nullsLast(a.st, b.st, (x, y) => x - y),
      stance_desc: (a, b) => nullsLast(a.st, b.st, (x, y) => y - x),
      number: (a, b) => b.key - a.key,
    }[key];
    groups.sort(by);
  }

  function group(list) {
    const map = new Map();
    for (const p of list) {
      const k = S.view === "news" ? p.n.i : p.b.num;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    }
    const groups = [];
    for (const [key, items] of map) {
      items.sort(S.view === "news" ? (a, b) => val(b) - val(a) : (a, b) => b.n.date.localeCompare(a.n.date));
      const withDet = items.filter((p) => p.det);
      groups.push({
        key, items,
        best: Math.max(...items.map(val)),
        date: S.view === "news" ? items[0].n.date : items.reduce((m, p) => (p.n.date > m ? p.n.date : m), ""),
        outlets: new Set(items.map((p) => p.n.outlet)).size,
        cen: withDet.length ? Math.max(...withDet.map((p) => p.cen)) : null,
        st: withDet.length ? mean(withDet.map((p) => p.st)) : null,
      });
    }
    sortGroups(groups);
    return groups;
  }

  // ---------- rendering: shared bits ----------
  function probBars(p) {
    const row = (lbl, v) => v < 0
      ? `<div class="prob"><span>${lbl}</span><span class="tag">no fue candidato</span><b></b></div>`
      : `<div class="prob ${band(v)}"><span>${lbl}</span><span class="bar"><i style="width:${v}%"></i><span class="thr-mark" style="left:${S.thr}%"></span></span><b>${fp(v)}</b></div>`;
    return `<div class="probs">${row("Expl.", p.ex)}${row("Impl.", p.im)}</div>`;
  }

  function pairTags(p, forNews) {
    const t = [];
    if (p.det) {
      t.push(`<span class="tag">${L.centrality[p.cenCat]}</span>`);
      t.push(`<span class="tag stance" style="--sc:${STANCE_COLORS[p.stCat]}">${L.stance[p.stCat]}</span>`);
      if (p.stage !== "not_stated") t.push(`<span class="tag">${L.stage[p.stage]}</span>`);
    } else if (p.ex >= 0) {
      t.push(`<span class="tag warn" title="El detalle solo se pidió para pares ≥ 0,5">sin detalle</span>`);
    }
    if (p.ex >= 0 && p.ex < S.thr && p.im >= S.thr) t.push(`<span class="tag">solo implícito</span>`);
    if (p.named) t.push(`<span class="tag accent" title="La noticia trae el número del expediente">nombrado</span>`);
    if (p.dl) t.push(`<span class="tag delfino" title="Delfino enlaza esta noticia con el expediente">Delfino</span>`);
    if (p.dl && val(p) < S.thr) t.push(`<span class="tag miss">Jev lo deja fuera</span>`);
    if (forNews && p.b.status) t.push(`<span class="tag">${esc(statusLabel(p.b.status))}</span>`);
    return t.join("");
  }
  const tlButton = (num, label) => `<button class="tl-btn${label ? " wide" : ""}" data-timeline="${num}" title="Ver su línea temporal">${icon("timeline")}${label ? "Línea temporal" : ""}</button>`;
  const statusLabel = (s) => ({ "in progress": "en trámite", archived: "archivado", law: "ley" }[s] || s);

  function billRow(p) {
    const b = p.b;
    return `<li class="row-item${val(p) < S.thr ? " below" : ""}" tabindex="0" data-pair="${p.idx}">
      <span class="num">${b.num}${tlButton(b.num)}</span>
      <div class="name"><strong title="${esc(b.name)}">${esc(b.name)}</strong><div class="tags">${pairTags(p, true)}</div></div>
      ${probBars(p)}
    </li>`;
  }

  function newsRow(p) {
    const n = p.n, o = outletOf(n.outlet);
    return `<li class="row-item news-row${val(p) < S.thr ? " below" : ""}" tabindex="0" data-pair="${p.idx}" style="--c:${o.color}">
      <div><div class="who">${esc(o.name)}</div><div class="tag" style="display:inline-block;margin-top:3px">${new Date(n.date).toLocaleDateString("es-CR", { day: "numeric", month: "short" })}</div></div>
      <div class="name"><strong title="${esc(n.title)}">${esc(n.title)}</strong><div class="tags">${pairTags(p, false)}</div></div>
      ${probBars(p)}
    </li>`;
  }

  function moreButton(el, items, rowFn, label) {
    const rest = items.length - PREVIEW;
    if (rest <= 0) return;
    const btn = document.createElement("button");
    btn.className = "more";
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = `${icon("chevron")}<span>Ver ${label(items.length)}</span>`;
    let extra = null;
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") === "true";
      if (!open) {
        if (!extra) {
          extra = document.createElement("ul");
          extra.className = "rows";
          extra.style.cssText = "border-top:0;margin-top:0";
          extra.innerHTML = items.slice(PREVIEW).map(rowFn).join("");
          el.querySelector(".rows").after(extra);
        }
        extra.hidden = false;
        btn.querySelector("span").textContent = `Mostrar solo ${PREVIEW}`;
      } else {
        extra.hidden = true;
        btn.querySelector("span").textContent = `Ver ${label(items.length)}`;
        if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
      }
      btn.setAttribute("aria-expanded", String(!open));
    });
    el.appendChild(btn);
  }

  function newsCard(g) {
    const n = news[g.key], o = outletOf(n.outlet);
    const el = document.createElement("article");
    el.className = "card";
    el.style.setProperty("--c", o.color);
    const tags = [
      `<span class="tag">${L.genre[n.genre]}</span>`,
      n.frame ? `<span class="tag" title="Encuadre dominante">${L.main_frame[n.frame]}</span>` : "",
      n.press >= 50 ? `<span class="tag warn">Comunicado</span>` : "",
      n.a.headline_misleading >= 50 ? `<span class="tag warn">Titular engañoso</span>` : "",
      n.cut ? `<span class="tag" title="Jev leyó solo los primeros ${nf(D.meta.max_news_chars || 15000)} caracteres">texto recortado</span>` : "",
    ].join("");
    el.innerHTML = `
      <div class="card-head">
        <div>
          <div class="meta">
            <span class="outlet" style="--c:${o.color}">${icon("news")}${esc(o.name)}</span>
            <span class="date">${icon("calendar")}${fmtDate(n.date)}</span>
            ${tags}
          </div>
          <h2 class="title"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>${icon("external")}</h2>
        </div>
        <div class="best ${band(g.best)}"><div class="num">${fp(g.best)}</div><div class="lbl">${g.items.length} expediente${g.items.length > 1 ? "s" : ""}</div></div>
      </div>
      <ul class="rows">${g.items.slice(0, PREVIEW).map(billRow).join("")}</ul>`;
    moreButton(el, g.items, billRow, (k) => `los ${k} expedientes`);
    return el;
  }

  function billCard(g) {
    const b = bills[g.key];
    const el = document.createElement("article");
    el.className = "card";
    el.style.setProperty("--c", "var(--accent)");
    const per = {};
    g.items.forEach((p) => (per[p.n.outlet] = (per[p.n.outlet] || 0) + 1));
    const ordered = Object.keys(OUTLETS).filter((k) => per[k]);
    const stCat = g.st == null ? null : Math.min(4, Math.max(0, Math.round(g.st)));
    el.innerHTML = `
      <div class="card-head">
        <div>
          <div class="meta">
            ${b.status ? `<span class="tag">${esc(statusLabel(b.status))}</span>` : ""}
            ${b.kind ? `<span class="tag">${esc(b.kind)}</span>` : ""}
            ${b.proposed ? `<span class="date">${icon("calendar")}Presentado ${fmtDate(b.proposed)}</span>` : ""}
            ${stCat != null ? `<span class="tag stance" style="--sc:${STANCE_COLORS[stCat]}" title="Postura promedio de las noticias con detalle">${L.stance[stCat]} en promedio</span>` : ""}
          </div>
          <h2 class="title"><span class="num">${b.num}</span><a href="${BILL_URL}${b.num}" target="_blank" rel="noopener">${esc(b.name)}</a>${icon("external")}</h2>
          <div style="margin-top:8px">${tlButton(b.num, true)}</div>
          <div class="cov">${ordered.map((k) => `<i style="--c:${OUTLETS[k].color};flex:${per[k]}"></i>`).join("")}</div>
          <div class="cov-legend">${ordered.map((k) => `<span style="--c:${OUTLETS[k].color}"><i></i>${OUTLETS[k].name} ${per[k]}</span>`).join("")}</div>
        </div>
        <div class="best mid"><div class="num" style="color:var(--ink)">${g.items.length}</div><div class="lbl">noticia${g.items.length > 1 ? "s" : ""}</div></div>
      </div>
      <ul class="rows">${g.items.slice(0, PREVIEW).map(newsRow).join("")}</ul>`;
    moreButton(el, g.items, newsRow, (k) => `las ${k} noticias`);
    return el;
  }

  // ---------- list ----------
  let groups = [];
  let shown = 0;
  const nearEnd = () => $("sentinel").getBoundingClientRect().top < innerHeight + 900;
  function renderMore() {
    if (shown >= groups.length) return;
    const frag = document.createDocumentFragment();
    const make = S.view === "news" ? newsCard : billCard;
    groups.slice(shown, shown + BATCH).forEach((g) => frag.appendChild(make(g)));
    shown += BATCH;
    $("list").appendChild(frag);
    if (nearEnd()) requestAnimationFrame(renderMore);
  }

  // ---------- summary charts ----------
  function hbars(title, rows, total, opts = {}) {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return `<div class="chart"><h4>${title}<span>${opts.note || ""}</span></h4>${rows.map((r) => `
      <button class="hbar${r.on ? " on" : ""}${opts.static ? " static" : ""}" ${r.act ? `data-act="${r.act}"` : ""}
        data-tip="<b>${nf(r.count)}</b> ${esc(opts.unit || "")} · ${esc(r.label)}${total ? ` · ${Math.round((r.count / total) * 100)} %` : ""}">
        <span class="lbl">${esc(r.label)}</span>
        <span class="track"><i style="width:${(r.count / max) * 100}%;--c:${r.color || "var(--mid)"}"></i></span>
        <span class="val">${nf(r.count)}</span>
      </button>`).join("")}</div>`;
  }

  function renderCharts(base, kept) {
    // Probability histogram over pairs that pass every filter but the threshold.
    const bins = new Array(18).fill(0);
    for (const p of base) {
      const v = val(p);
      if (v >= 10) bins[Math.min(17, Math.floor((v - 10) / 5))]++;
    }
    const hmax = Math.max(1, ...bins);
    const hist = `<div class="chart"><h4>Probabilidad (${{ max: "máx.", ex: "explícita", im: "implícita" }[S.mode]})<span>${nf(base.length)} pares</span></h4>
      <div class="hist">${bins.map((c, i) => {
        const lo = 10 + i * 5;
        return `<i class="${lo >= S.thr ? "pass" : ""}" style="height:${Math.max(1, (c / hmax) * 100)}%" data-tip="<b>${nf(c)}</b> pares entre ${fp(lo)} y ${fp(lo + 5)}"></i>`;
      }).join("")}</div>
      <div class="hist-axis"><span>0,10</span><span>0,50</span><span>1,00</span></div>
      <p class="hist-note">En azul, lo que pasa el umbral de ${fp(S.thr)}.</p></div>`;

    const newsSet = new Map();
    kept.forEach((p) => newsSet.set(p.n.i, p.n));
    const ns = [...newsSet.values()];
    const det = kept.filter((p) => p.det);
    const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); if (k != null) m[k] = (m[k] || 0) + 1; return m; }, {});

    const byOutlet = count(ns, (n) => n.outlet);
    const outletRows = Object.keys(OUTLETS).filter((k) => byOutlet[k]).map((k) => ({
      label: OUTLETS[k].name, count: byOutlet[k], color: OUTLETS[k].color, act: `outlet:${k}`,
      on: S.outlets.size === 1 && S.outlets.has(k),
    }));
    const byCen = count(det, (p) => p.cenCat);
    const byStance = count(det, (p) => p.stCat);
    const byStage = count(det, (p) => p.stage);
    const byFrame = count(ns, (n) => n.frame);
    const byGenre = count(ns, (n) => n.genre);
    const billCounts = count(kept, (p) => p.b.num);
    const topBills = Object.entries(billCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const explicitN = kept.filter((p) => p.ex >= S.thr).length;

    $("charts").innerHTML = [
      hist,
      hbars("Noticias por medio", outletRows, ns.length, { unit: "noticias" }),
      hbars("Expedientes más cubiertos", topBills.map(([num, c]) => ({
        label: `${num} · ${bills[num].name}`, count: c, act: `bill:${num}`, color: "var(--accent)",
      })), 0, { unit: "pares" }),
      hbars("Postura", L.stance.map((l, i) => ({ label: l, count: byStance[i] || 0, color: STANCE_COLORS[i], act: `stance:${i}`, on: S.stances.has(i) })), det.length, { unit: "pares", note: "con detalle" }),
      hbars("Centralidad", L.centrality.map((l, i) => ({ label: l, count: byCen[i] || 0, act: `cen:${i}`, on: S.cens.has(i) })), det.length, { unit: "pares", note: "con detalle" }),
      hbars("Etapa según la noticia", STAGES.map((k) => ({ label: L.stage[k], count: byStage[k] || 0, act: `stage:${k}`, on: S.stages.has(k) })), det.length, { unit: "pares", note: "con detalle" }),
      hbars("Encuadre de la noticia", FRAMES.map((k) => ({ label: L.main_frame[k], count: byFrame[k] || 0, act: `frame:${k}`, on: S.frames.has(k) })), ns.length, { unit: "noticias" }),
      hbars("Género", GENRES.map((k) => ({ label: L.genre[k], count: byGenre[k] || 0, act: `genre:${k}`, on: S.genres.has(k) })), ns.length, { unit: "noticias" }),
      hbars("Tipo de mención", [
        { label: "Explícita", count: explicitN, act: "mention:explicit", on: S.mention === "explicit" },
        { label: "Solo implícita", count: kept.length - explicitN, act: "mention:implicit_only", on: S.mention === "implicit_only" },
      ], kept.length, { unit: "pares" }),
    ].join("");
  }

  function chartAction(act) {
    const [kind, v] = act.split(":");
    const toggle = (set, x) => (set.has(x) ? set.delete(x) : set.add(x));
    if (kind === "outlet") {
      S.outlets = S.outlets.size === 1 && S.outlets.has(v) ? new Set(Object.keys(OUTLETS)) : new Set([v]);
    } else if (kind === "bill") {
      S.view = "bill"; S.q = v; $("q").value = v;
    } else if (kind === "stance") toggle(S.stances, +v);
    else if (kind === "cen") toggle(S.cens, +v);
    else if (kind === "stage") toggle(S.stages, v);
    else if (kind === "frame") toggle(S.frames, v);
    else if (kind === "genre") toggle(S.genres, v);
    else if (kind === "mention") S.mention = S.mention === v ? "all" : v;
    syncControls();
    apply();
  }

  // ---------- header stats ----------
  function renderStats(kept) {
    const nNews = new Set(kept.map((p) => p.n.i)).size;
    const nBills = new Set(kept.map((p) => p.b.num)).size;
    const withDet = kept.filter((p) => p.det).length;
    const hit = delfinoLinks.filter((p) => val(p) >= S.thr).length;
    $("stats").innerHTML = [
      ["Noticias", nf(nNews), `de ${nf(D.meta.news_run)}`],
      ["Expedientes", nf(nBills), ""],
      ["Pares", nf(kept.length), ""],
      ["Con detalle", nf(withDet), kept.length ? `${Math.round((withDet / kept.length) * 100)} %` : ""],
      ["Enlaces de Delfino que pasan", `${delfinoLinks.length ? Math.round((hit / delfinoLinks.length) * 100) : 0} %`, `${nf(hit)}/${nf(delfinoLinks.length)}`],
    ].map(([k, v, s]) => `<div class="stat"><dt>${k}</dt><dd>${v}${s ? `<small>${s}</small>` : ""}</dd></div>`).join("");
  }

  // ---------- active filter pills ----------
  function activePills() {
    const pills = [];
    const add = (label, undo) => pills.push({ label, undo });
    const all = Object.keys(OUTLETS);
    if (S.outlets.size !== all.length) add(`Medios: ${[...S.outlets].map((k) => OUTLETS[k].name).join(", ") || "ninguno"}`, () => (S.outlets = new Set(all)));
    if (S.q) add(`Busca «${S.q}»`, () => { S.q = ""; $("q").value = ""; });
    if (S.from || S.to) add(`Fechas ${S.from || "…"} a ${S.to || "…"}`, () => { S.from = S.to = ""; });
    if (S.genres.size) add(`Género: ${[...S.genres].map((k) => L.genre[k]).join(", ")}`, () => S.genres.clear());
    if (S.mention !== "all") add(S.mention === "explicit" ? "Mención explícita" : "Solo implícitas", () => (S.mention = "all"));
    if (S.delfino !== "all") add({ in: "En Delfino", jev_only: "Jev sí, Delfino no", missed: "Delfino sí, Jev no" }[S.delfino], () => (S.delfino = "all"));
    if (S.press !== "all") add(S.press === "yes" ? "Comunicados" : "Sin comunicados", () => (S.press = "all"));
    if (S.frames.size) add(`Encuadre: ${[...S.frames].map((k) => L.main_frame[k]).join(", ")}`, () => S.frames.clear());
    if (S.images.size) add(`Imagen de la Asamblea: ${[...S.images].map((k) => L.assembly_image[k]).join(", ")}`, () => S.images.clear());
    if (S.stages.size) add(`Etapa: ${[...S.stages].map((k) => L.stage[k]).join(", ")}`, () => S.stages.clear());
    if (S.cens.size) add(`Centralidad: ${[...S.cens].map((k) => L.centrality[k]).join(", ")}`, () => S.cens.clear());
    if (S.stances.size) add(`Postura: ${[...S.stances].sort().map((k) => L.stance[k]).join(", ")}`, () => S.stances.clear());
    if (S.voices.size) add(`Voces: ${[...S.voices].map((k) => L.voices[k]).join(" o ")}`, () => S.voices.clear());
    if (S.features.size) add(`Rasgos: ${[...S.features].map((k) => L.features[k]).join(" y ")}`, () => S.features.clear());
    const wantLabel = { mentioned: "mencionado", favor: "a favor", against: "en contra", neutral: "neutral" };
    for (const k of ACTORS) if (S.actors[k] !== "any") add(`${L.actors[k]}: ${wantLabel[S.actors[k]]}`, () => (S.actors[k] = "any"));
    return pills;
  }

  function renderActive() {
    const pills = activePills();
    $("active").innerHTML = pills.map((p, i) => `<button class="pill" data-i="${i}">${esc(p.label)}${icon("x")}</button>`).join("") +
      (pills.length > 1 ? `<button class="pill clear" data-i="all">Quitar todos</button>` : "");
    $("active").onclick = (e) => {
      const b = e.target.closest(".pill");
      if (!b) return;
      if (b.dataset.i === "all") pills.forEach((p) => p.undo());
      else pills[+b.dataset.i].undo();
      syncControls();
      apply();
    };
    const advanced = pills.length - (S.q ? 1 : 0) - (S.outlets.size !== Object.keys(OUTLETS).length ? 1 : 0);
    $("filter-count").hidden = advanced <= 0;
    $("filter-count").textContent = advanced;
  }

  // ---------- apply ----------
  function apply() {
    S.qn = norm(S.q.trim());
    const base = pairs.filter(passesBase);
    const kept = base.filter(passesThreshold);
    renderStats(kept);
    renderActive();
    const analysis = isAnalysis();
    for (const id of ["summary-box", "list", "sentinel", "result-line"]) $(id).hidden = analysis;
    $("analysis").hidden = !analysis;
    $("sort").parentElement.hidden = analysis;
    if (analysis) {
      groups = [];
      $("list").innerHTML = "";
      $("empty").hidden = true;
      window.JEV_ANALYSIS?.render(kept, base);
      return;
    }
    groups = group(kept);
    $("list").innerHTML = "";
    shown = 0;
    renderMore();
    $("empty").hidden = groups.length > 0;
    renderCharts(base, kept);
    const sortLabel = Object.fromEntries(SORTS[S.view])[S.sort[S.view]].toLowerCase();
    const detNote = pairDetailActive() || newsDetailActive() ? " · solo pares con detalle (≥ 0,50 en la corrida)" : "";
    $("result-line").innerHTML = groups.length
      ? `<b>${nf(groups.length)}</b> ${S.view === "news" ? "noticias" : "expedientes"} · <b>${nf(kept.length)}</b> pares · orden: ${sortLabel}${detNote}`
      : "";
  }

  // ---------- filter drawer ----------
  function chipGroup(id, entries, isOn) {
    return `<div class="chips" data-group="${id}">${entries.map(([k, label]) =>
      `<button class="chip opt" data-k="${k}" aria-pressed="${isOn(k)}">${esc(label)}</button>`).join("")}</div>`;
  }

  function renderFilters() {
    const dates = news.map((n) => n.day).sort();
    const radio = (id, opts, cur) => chipGroup(id, opts, (k) => k === cur);
    $("filters-grid").innerHTML = `
      <div class="fgroup"><h3>Fechas</h3><div class="row">
        <input type="date" id="f-from" min="${dates[0]}" max="${dates.at(-1)}" value="${S.from}">
        <span style="color:var(--ink-3)">a</span>
        <input type="date" id="f-to" min="${dates[0]}" max="${dates.at(-1)}" value="${S.to}">
      </div></div>
      <div class="fgroup"><h3>Género</h3>${chipGroup("genres", GENRES.map((k) => [k, L.genre[k]]), (k) => S.genres.has(k))}</div>
      <div class="fgroup"><h3>Tipo de mención</h3>${radio("mention", [["all", "Todas"], ["explicit", "Explícita"], ["implicit_only", "Solo implícita"]], S.mention)}</div>
      <div class="fgroup"><h3>Cruce con Delfino <span class="note">enlaces del sitio de Delfino</span></h3>${radio("delfino", [
        ["all", "Todos"], ["in", "En Delfino"], ["jev_only", "Jev sí, Delfino no"], ["missed", "Delfino sí, Jev no"]], S.delfino)}</div>
      <div class="fgroup"><h3>Etapa <span class="note">detalle</span></h3>${chipGroup("stages", STAGES.map((k) => [k, L.stage[k]]), (k) => S.stages.has(k))}</div>
      <div class="fgroup"><h3>Postura <span class="note">detalle</span></h3>${chipGroup("stances", L.stance.map((l, i) => [i, l]), (k) => S.stances.has(+k))}</div>
      <div class="fgroup"><h3>Centralidad <span class="note">detalle</span></h3>${chipGroup("cens", L.centrality.map((l, i) => [i, l]), (k) => S.cens.has(+k))}</div>
      <div class="fgroup"><h3>Encuadre de la noticia <span class="note">detalle</span></h3>${chipGroup("frames", FRAMES.map((k) => [k, L.main_frame[k]]), (k) => S.frames.has(k))}</div>
      <div class="fgroup"><h3>Imagen de la Asamblea <span class="note">detalle</span></h3>${chipGroup("images", L.assembly_image.map((l, i) => [i, l]), (k) => S.images.has(+k))}</div>
      <div class="fgroup"><h3>Comunicado de prensa <span class="note">detalle</span></h3>${radio("press", [["all", "Todos"], ["yes", "Sí"], ["no", "No"]], S.press)}</div>
      <div class="fgroup"><h3>Voces citadas <span class="note">alguna de</span></h3>${chipGroup("voices", VOICES.map((k) => [k, L.voices[k]]), (k) => S.voices.has(k))}</div>
      <div class="fgroup"><h3>Rasgos de la cobertura <span class="note">todos a la vez</span></h3>${chipGroup("features", FEATURES.map((k) => [k, L.features[k]]), (k) => S.features.has(k))}</div>
      <div class="fgroup"><h3>Posición atribuida <span class="note">detalle</span></h3><div class="actors">${ACTORS.map((k) => `
        <span>${L.actors[k]}</span>
        <select data-actor="${k}">${[["any", "Cualquiera"], ["mentioned", "Mencionado"], ["favor", "A favor"], ["against", "En contra"], ["neutral", "Neutral o dividido"]]
          .map(([v, l]) => `<option value="${v}"${S.actors[k] === v ? " selected" : ""}>${l}</option>`).join("")}</select>`).join("")}
      </div></div>
      <div class="fgroup" style="align-self:end"><button class="btn ghost" id="f-reset">${icon("x")}Restablecer todo</button></div>`;
  }

  $("filters-grid").addEventListener("click", (e) => {
    if (e.target.closest("#f-reset")) {
      const d = defaults();
      Object.assign(S, d, { view: S.view, sort: S.sort });
      $("q").value = "";
      syncControls();
      return apply();
    }
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const groupId = chip.parentElement.dataset.group;
    const k = chip.dataset.k;
    const radios = { mention: 1, delfino: 1, press: 1 };
    if (radios[groupId]) S[groupId] = k;
    else {
      const set = S[groupId];
      const key = ["stances", "cens", "images"].includes(groupId) ? +k : k;
      set.has(key) ? set.delete(key) : set.add(key);
    }
    renderFilters();
    apply();
  });
  $("filters-grid").addEventListener("change", (e) => {
    if (e.target.id === "f-from") S.from = e.target.value;
    else if (e.target.id === "f-to") S.to = e.target.value;
    else if (e.target.dataset.actor) S.actors[e.target.dataset.actor] = e.target.value;
    apply();
  });

  // ---------- side panel ----------
  const qTitle = (k) => esc(Q[k]?.text || "");
  function distRows(probs, labels, opts = {}) {
    const top = argmax(probs);
    return `<div class="dist">${probs.map((v, i) => `
      <div class="d${i === top ? " lead" : ""}" style="--c:${opts.colors ? opts.colors[i] : "var(--mid)"}">
        <span>${esc(labels[i])}</span><span class="bar"><i style="width:${v}%"></i></span><b>${fp(v)}</b>
      </div>`).join("")}</div>`;
  }
  function scale(probs, labels, colors) {
    return `<div class="scale">${probs.map((v, i) => `<i style="background:${colors[i]};opacity:${0.18 + (v / 100) * 0.82}" data-tip="${esc(labels[i])}: <b>${fp(v)}</b>">${v >= 12 ? fp(v) : ""}</i>`).join("")}</div>
      <div class="scale-lbl"><span>${esc(labels[0])}</span><span>${esc(labels.at(-1))}</span></div>`;
  }
  function flag(label, v, key) {
    return `<div class="flag${v >= 50 ? " yes" : ""}" title="${qTitle(key)}">${icon("check")}<span>${esc(label)}</span><b>${fp(v)}</b></div>`;
  }

  function openPanel(p) {
    const n = p.n, b = p.b, o = outletOf(n.outlet), d = p.det, a = n.a;
    const gate = (k, v) => v < 0
      ? `<div class="g"><div class="k">${k}</div><div class="v" style="color:var(--ink-3)">—</div><div class="k">no estuvo entre los candidatos</div></div>`
      : `<div class="g ${band(v)}"><div class="k">${k}</div><div class="v">${fp(v)}</div><span class="bar"><i style="width:${v}%"></i><span class="thr-mark" style="left:${S.thr}%"></span></span></div>`;
    let html = `
      <div class="meta">
        <span class="outlet" style="--c:${o.color}">${icon("news")}${esc(o.name)}</span>
        <span class="date">${icon("calendar")}${fmtDate(n.date)}</span>
      </div>
      <h2 class="p-title"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></h2>
      <div class="p-bill"><span class="num">${b.num}</span><div><a class="n" href="${BILL_URL}${b.num}" target="_blank" rel="noopener">${esc(b.name)}</a>
        <div class="tags">${b.status ? `<span class="tag">${esc(statusLabel(b.status))}</span>` : ""}${b.kind ? `<span class="tag">${esc(b.kind)}</span>` : ""}
        ${p.dl ? `<span class="tag delfino">Enlazado por Delfino</span>` : ""}${p.named ? `<span class="tag accent">Número en el texto</span>` : ""}
        ${p.rank ? `<span class="tag">Puesto ${p.rank} del ranker</span>` : ""}${tlButton(b.num, true)}</div></div></div>
      <section class="p-sec"><h3>Puerta</h3><div class="gate">
        <div title="${qTitle("explicit")}">${gate("Explícita", p.ex)}</div>
        <div title="${qTitle("implicit")}">${gate("Implícita", p.im)}</div>
      </div></section>`;

    if (d) {
      html += `<section class="p-sec"><h3>Cobertura del expediente</h3>
        <div class="qhead" title="${qTitle("centrality")}">Centralidad<span>${(d.centrality[0] / 100).toFixed(2).replace(".", ",")} de 2</span></div>
        ${distRows(d.centrality.slice(2), L.centrality)}
        <div class="qhead" title="${qTitle("stance")}">Postura de la noticia<span>${(d.stance[0] / 100).toFixed(2).replace(".", ",")} de 4</span></div>
        ${scale(d.stance.slice(2), L.stance, STANCE_COLORS)}
        <div class="qhead" title="${qTitle("stage")}">Etapa según la noticia</div>
        ${distRows(d.stage, STAGES.map((k) => L.stage[k]))}
      </section>
      <section class="p-sec"><h3>Posición atribuida</h3><div class="actor-grid">${ACTORS.map((k) => {
        const pos = p.actors[k], pr = d[k][POSITIONS.indexOf(pos)];
        return `<span title="${qTitle(k)}">${L.actors[k]}</span>
          <span class="pos${pos === "not_mentioned" ? " none" : ""}" style="--pc:${POSITION_COLORS[pos]}">${L.position[pos]}</span><b>${fp(pr)}</b>`;
      }).join("")}</div></section>
      <section class="p-sec"><h3>Voces citadas</h3><div class="flags">${VOICES.map((k) => flag(L.voices[k], d[k], k)).join("")}</div></section>
      <section class="p-sec"><h3>Rasgos</h3><div class="flags">${FEATURES.map((k) => flag(L.features[k], d[k], k)).join("")}</div></section>`;
    } else {
      html += `<section class="p-sec"><div class="nodetail">Sin respuestas de detalle: en la corrida el detalle solo se pidió para los pares con probabilidad ≥ ${fp((D.meta.threshold || 0.5) * 100)}.</div></section>`;
    }

    html += `<section class="p-sec"><h3>La noticia</h3>
      <div class="qhead" title="${qTitle("genre")}">Género</div>${distRows(n.genreProbs, GENRES.map((k) => L.genre[k]))}`;
    if (a.main_frame) {
      html += `<div class="qhead" title="${qTitle("main_frame")}">Encuadre dominante</div>${distRows(a.main_frame, FRAMES.map((k) => L.main_frame[k]))}
        <div class="qhead" title="${qTitle("assembly_image")}">Imagen de la Asamblea</div>${scale(a.assembly_image.slice(2), L.assembly_image, STANCE_COLORS)}
        <div class="flags" style="margin-top:12px">${flag(L.news_flags.press_release, a.press_release, "press_release")}${flag(L.news_flags.headline_misleading, a.headline_misleading, "headline_misleading")}</div>`;
    }
    html += `</section>`;

    const sib = [...n.pairs].sort((x, y) => val(y) - val(x));
    if (sib.length > 1) {
      html += `<section class="p-sec"><h3>Otros expedientes de esta noticia</h3><ul class="siblings">${sib.map((s) =>
        `<li data-pair="${s.idx}" class="${s === p ? "cur" : ""}"><span class="num">${s.b.num}${tlButton(s.b.num)}</span><span>${esc(s.b.name)}</span><b class="${band(val(s))}" style="color:var(--sc)">${val(s) < 0 ? "—" : fp(val(s))}</b></li>`).join("")}</ul></section>`;
    }

    $("panel-body").innerHTML = html;
    $("panel-body").scrollTop = 0;
    $("panel").classList.add("open");
    $("panel").setAttribute("aria-hidden", "false");
    $("scrim").hidden = false;
    document.body.classList.add("locked");
  }
  function closePanel() {
    $("panel").classList.remove("open");
    $("panel").setAttribute("aria-hidden", "true");
    $("scrim").hidden = true;
    document.body.classList.remove("locked");
  }
  const openFrom = (e) => {
    const row = e.target.closest("[data-pair]");
    if (!row || e.target.closest("a")) return;
    openPanel(pairs[+row.dataset.pair]);
  };
  // Any timeline button on the page opens the bill's chart in the analysis tab.
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-timeline]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    closePanel();
    window.JEV_ANALYSIS?.showTimeline(+b.dataset.timeline);
  }, true);
  $("list").addEventListener("click", openFrom);
  $("list").addEventListener("keydown", (e) => { if (e.key === "Enter") openFrom(e); });
  $("panel-body").addEventListener("click", openFrom);
  $("panel-close").addEventListener("click", closePanel);
  $("scrim").addEventListener("click", closePanel);
  addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });

  // ---------- tooltip ----------
  const tip = $("tip");
  document.addEventListener("pointermove", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) { tip.hidden = true; return; }
    tip.innerHTML = t.dataset.tip;
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY + 16}px`;
  });

  // ---------- controls ----------
  function syncControls() {
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === S.view)));
    $("sort").innerHTML = (SORTS[S.view] || []).map(([k, l]) => `<option value="${k}"${S.sort[S.view] === k ? " selected" : ""}>${l}</option>`).join("");
    document.querySelectorAll("#outlets .chip").forEach((c) => c.setAttribute("aria-pressed", String(S.outlets.has(c.dataset.outlet))));
    document.querySelectorAll("#mode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === S.mode)));
    $("thr").value = S.thr / 100;
    $("thr-val").textContent = fp(S.thr);
    if (!$("filters").hidden) renderFilters();
  }

  const counts = {};
  news.forEach((n) => (counts[n.outlet] = (counts[n.outlet] || 0) + 1));
  $("outlets").innerHTML = Object.entries(OUTLETS).filter(([k]) => counts[k]).map(([k, o]) =>
    `<button class="chip" data-outlet="${k}" aria-pressed="true" style="--c:${o.color}" title="Alt + clic: solo este medio"><i></i>${o.name}<span>${nf(counts[k])}</span></button>`).join("");
  $("outlets").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const k = chip.dataset.outlet;
    if (e.altKey || e.ctrlKey || e.metaKey) S.outlets = new Set([k]);
    else if (S.outlets.has(k)) S.outlets.delete(k);
    else S.outlets.add(k);
    syncControls();
    apply();
  });

  document.querySelector(".tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (!t || t.dataset.view === S.view) return;
    S.view = t.dataset.view;
    syncControls();
    apply();
  });
  let qTimer;
  $("q").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { S.q = e.target.value; apply(); }, 200);
  });
  $("thr").addEventListener("input", (e) => { $("thr-val").textContent = fp(Math.round(e.target.value * 100)); });
  $("thr").addEventListener("change", (e) => { S.thr = Math.round(e.target.value * 100); apply(); });
  $("mode").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    S.mode = b.dataset.mode;
    syncControls();
    apply();
  });
  $("sort").addEventListener("change", (e) => { S.sort[S.view] = e.target.value; apply(); });
  $("toggle-filters").addEventListener("click", (e) => {
    const open = $("filters").hidden;
    $("filters").hidden = !open;
    e.currentTarget.setAttribute("aria-expanded", String(open));
    if (open) renderFilters();
  });
  $("toggle-summary").addEventListener("click", (e) => {
    const open = e.currentTarget.getAttribute("aria-expanded") === "true";
    e.currentTarget.setAttribute("aria-expanded", String(!open));
    $("charts").hidden = open;
  });
  $("charts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b) chartAction(b.dataset.act);
  });

  const toTop = $("to-top");
  addEventListener("scroll", () => { toTop.hidden = scrollY < 900; if (nearEnd()) renderMore(); }, { passive: true });
  addEventListener("resize", () => { if (nearEnd()) renderMore(); }, { passive: true });
  toTop.addEventListener("click", () => scrollTo({ top: 0 }));

  // Shared with analysis.js.
  window.JEV_CTX = {
    D, L, Q, S, news, bills, pairs, val, openPanel, ACTORS, VOICES, FEATURES, STAGES, FRAMES, GENRES, POSITIONS,
    OUTLETS, STANCE_COLORS, norm, esc, icon, nf, fp, fmtDate, argmax, outletOf, statusLabel, BILL_URL,
    goTo(view, q) { S.view = view; S.q = q ?? S.q; $("q").value = S.q; syncControls(); apply(); scrollTo({ top: 0 }); },
    refresh: () => apply(),
  };

  const m = D.meta;
  $("subtitle").textContent = `${m.model} · ${nf(m.news_run)} noticias en la corrida · ${nf(pairs.length)} pares con probabilidad ≥ ${fp(m.floor * 100)} · US$${m.cost_usd}`;
  syncControls();
  apply();
  // Deep link from other pages (the bills graph): #bill=<number> opens the by-bill view on it.
  const linked = /^#bill=(\d+)$/.exec(location.hash);
  if (linked) window.JEV_CTX.goTo("bill", linked[1]);
})();
