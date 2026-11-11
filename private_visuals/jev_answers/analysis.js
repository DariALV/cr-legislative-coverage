// Analysis tab of the Jev answers viewer (#69). Works on the pairs that survive the page filters
// (window.JEV_CTX, set by app.js) and only on the ones with detail answers. Aggregation is
// probability-weighted: every pair adds its probabilities (soft counts) and means use expected values.
//
// Shared definitions (per pair, from the 6-option position of each actor):
//   mention m = 1 - P(not_mentioned); favor f = P(in_favor) + P(strongly_in_favor);
//   against a = P(against) + P(strongly_against); lean = (-2 P(s.against) - P(against) + P(in_favor) + 2 P(s.in_favor)) / 2.
//   An actor's lean on a set of pairs is sum(lean) / sum(m), from -1 (firmly against) to +1.
// News stance: expected score 0..4 mapped to -1..+1 (critical..favorable).
(() => {
  let C = null;
  const st = {
    section: "parties", min: 5, cell: null, voteSet: "all", rankOutlet: "all", rankBy: "stance",
    x: "news", y: "stance", color: "proponent", polarSort: "actors", bill: null, committee: null,
  };
  const SECTIONS = [
    ["parties", "Partidos"], ["votes", "Votos vs prensa"], ["outlets", "Medios"], ["bills", "Expedientes"],
    ["proponents", "Proponentes y comisiones"], ["cross", "Cruces"], ["polemic", "Polémicos"], ["timeline", "Línea temporal"],
  ];
  const VOTING = ["pueblo_soberano", "liberacion_nacional", "frente_amplio", "unidad_social_cristiana", "agenda_ciudadana"];
  const DIV = ["#c2334d", "#e98a9b", "#b4b9c3", "#7cc7a8", "#0f8a5f"];

  // ---------- small helpers ----------
  const sum = (xs) => xs.reduce((s, x) => s + x, 0);
  const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
  const pctf = (x) => (x == null ? "—" : `${Math.round(x * 100)} %`);
  const sg = (x, d = 2) => (x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(d).replace(".", ",")}`);
  const dec = (x, d = 2) => (x == null ? "—" : x.toFixed(d).replace(".", ","));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  // Diverging color for a value in -1..1 (gray at 0).
  function divColor(v) {
    if (v == null || Number.isNaN(v)) return "var(--soft)";
    const t = clamp(v, -1, 1);
    const [r1, g1, b1] = [180, 185, 195];
    const end = t < 0 ? [194, 51, 77] : [15, 138, 95];
    const k = Math.min(1, Math.abs(t) * 1.6);
    const c = [0, 1, 2].map((i) => Math.round([r1, g1, b1][i] + (end[i] - [r1, g1, b1][i]) * k));
    return `rgb(${c.join(",")})`;
  }
  // Sequential (one hue) for 0..1.
  const seqColor = (v) => (v == null ? "var(--soft)" : `rgba(59, 111, 224, ${0.06 + clamp(v, 0, 1) * 0.84})`);
  const inkOn = (v, signed) => (Math.abs(v ?? 0) > (signed ? 0.45 : 0.55) ? "#fff" : "var(--ink)");
  const actorName = (k) => C.L.actorShort[k] || k;
  const actorColor = (k) => C.L.actorColors[k] || "#9aa1ad";
  const billLabel = (n) => `${n} · ${C.bills[n]?.name || ""}`;
  const short = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const tipAttr = (html) => `data-tip="${C.esc(html)}"`;
  const tlb = (num) => `<button class="tl-btn" data-timeline="${num}" title="Ver su línea temporal" aria-label="Línea temporal de ${num}"><svg><use href="#i-timeline"/></svg></button>`;

  // ---------- per-pair soft answers (cached on the pair object) ----------
  function soft(p) {
    if (p._soft) return p._soft;
    const d = p.det;
    const sp = d.stance.slice(2);
    const st = sum(sp) || 1;
    const actors = {};
    for (const k of C.ACTORS) {
      const a = d[k];
      const t = sum(a) || 1;
      const pr = a.map((x) => x / t);
      actors[k] = { m: 1 - pr[0], f: pr[4] + pr[5], a: pr[1] + pr[2], n: pr[3], lean: (-2 * pr[1] - pr[2] + pr[4] + 2 * pr[5]) / 2 };
    }
    const n = p.n.a;
    p._soft = {
      stance: (p.st - 2) / 2,
      crit: (sp[0] + sp[1]) / st,
      fav: (sp[3] + sp[4]) / st,
      cen: p.cen,
      actors,
      press: n.press_release != null ? n.press_release / 100 : null,
      image: n.assembly_image ? (n.assembly_image[0] / 100 - 2) / 2 : null,
    };
    return p._soft;
  }

  // ---------- aggregates ----------
  function billAggregates(det, kept) {
    const map = new Map();
    const get = (num) => {
      if (!map.has(num)) {
        map.set(num, {
          num, b: C.bills[num], pairs: [], all: 0, explicit: 0, probSum: 0, outlets: {}, days: new Set(),
          actors: Object.fromEntries(C.ACTORS.map((k) => [k, { m: 0, f: 0, a: 0, lean: 0 }])),
        });
      }
      return map.get(num);
    };
    for (const p of kept) {
      const g = get(p.b.num);
      g.all++;
      if (p.ex >= C.S.thr) g.explicit++;
      g.probSum += C.val(p);
    }
    for (const p of det) {
      const g = get(p.b.num);
      const s = soft(p);
      g.pairs.push(p);
      g.days.add(p.n.day);
      const o = (g.outlets[p.n.outlet] ||= { n: 0, stance: 0 });
      o.n++;
      o.stance += s.stance;
      for (const k of C.ACTORS) {
        const a = s.actors[k], t = g.actors[k];
        t.m += a.m; t.f += a.f; t.a += a.a; t.lean += a.lean;
      }
    }
    const out = [];
    for (const g of map.values()) {
      const ps = g.pairs;
      if (!ps.length) continue;
      const ss = ps.map((p) => soft(p));
      g.n = ps.length;
      g.newsCount = new Set(ps.map((p) => p.n.i)).size;
      g.stance = mean(ss.map((s) => s.stance));
      g.crit = mean(ss.map((s) => s.crit));
      g.fav = mean(ss.map((s) => s.fav));
      g.cen = mean(ss.map((s) => s.cen));
      const sd = Math.sqrt(mean(ss.map((s) => (s.stance - g.stance) ** 2)));
      g.disp = sd;
      const F = sum(C.ACTORS.map((k) => g.actors[k].f));
      const A = sum(C.ACTORS.map((k) => g.actors[k].a));
      g.F = F; g.A = A;
      g.polar = F + A >= 1 ? (2 * Math.min(F, A)) / (F + A) : null;
      g.press = mean(ps.map((p) => soft(p).press).filter((x) => x != null));
      g.newdev = mean(ps.map((p) => p.det.new_development / 100));
      g.conflict = mean(ps.map((p) => p.det.conflict_frame / 100));
      g.content = mean(ps.map((p) => p.det.explains_content / 100));
      g.explicitShare = g.all ? g.explicit / g.all : null;
      g.prob = g.all ? g.probSum / g.all / 100 : null;
      g.nOutlets = Object.keys(g.outlets).length;
      g.nDays = g.days.size;
      const dates = ps.map((p) => p.n.day).sort();
      g.first = dates[0];
      g.last = dates.at(-1);
      for (const k of C.ACTORS) {
        const t = g.actors[k];
        t.leanMean = t.m >= 0.5 ? t.lean / t.m : null;
      }
      const prop = C.D.proponents[g.num];
      g.proponent = prop ? prop[0] : null;
      out.push(g);
    }
    return out;
  }

  // ---------- section: parties ----------
  function newsMatrix(det) {
    const K = C.ACTORS;
    const cells = {};
    for (const i of K) for (const j of K) cells[i + "|" + j] = { opp: 0, agr: 0, both: 0, w: 0 };
    for (const p of det) {
      const A = soft(p).actors;
      for (let x = 0; x < K.length; x++) {
        for (let y = x + 1; y < K.length; y++) {
          const a = A[K[x]], b = A[K[y]];
          const opp = a.f * b.a + a.a * b.f;
          const agr = a.f * b.f + a.a * b.a;
          for (const key of [K[x] + "|" + K[y], K[y] + "|" + K[x]]) {
            const c = cells[key];
            c.opp += opp; c.agr += agr; c.w += a.m * b.m;
            if (a.m >= 0.5 && b.m >= 0.5) c.both++;
          }
        }
      }
    }
    return cells;
  }

  function voteMatrix() {
    const S = C.S;
    const votes = C.D.votes.filter((v) => (st.voteSet === "all" || v[6]) && (!S.from || v[2] >= S.from) && (!S.to || v[2] <= S.to));
    const pos = (t) => {
      if (!t || t[0] + t[1] === 0) return null;
      return t[0] > t[1] ? 1 : t[1] > t[0] ? -1 : 0;
    };
    const cells = {};
    for (const i of VOTING) for (const j of VOTING) cells[i + "|" + j] = { same: 0, opp: 0 };
    for (const v of votes) {
      const P = Object.fromEntries(VOTING.map((k) => [k, pos(v[7][k])]));
      for (const i of VOTING) for (const j of VOTING) {
        if (i === j || P[i] == null || P[j] == null || P[i] === 0 || P[j] === 0) continue;
        cells[i + "|" + j][P[i] === P[j] ? "same" : "opp"]++;
      }
    }
    return { cells, n: votes.length };
  }

  function matrixHtml(keys, valueOf, tipOf, clickOf) {
    return `<table class="mx"><thead><tr><th></th>${keys.map((k) => `<th><span class="dot" style="background:${actorColor(k)}"></span>${actorName(k)}</th>`).join("")}</tr></thead>
      <tbody>${keys.map((i) => `<tr><th><span class="dot" style="background:${actorColor(i)}"></span>${actorName(i)}</th>${keys.map((j) => {
        if (i === j) return `<td class="diag"></td>`;
        const v = valueOf(i, j);
        const signed = v == null ? null : 1 - 2 * v; // agreement +1, opposition -1
        return `<td style="background:${divColor(signed)};color:${inkOn(signed, true)}" ${tipAttr(tipOf(i, j))} ${clickOf ? `data-cell="${i}|${j}"` : ""}
          class="${st.cell === i + "|" + j ? "sel" : ""}">${v == null ? "·" : Math.round(v * 100)}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function sectionParties(det, aggs) {
    const nm = newsMatrix(det);
    const share = (c) => (c.opp + c.agr >= 0.5 ? c.opp / (c.opp + c.agr) : null);
    const vm = voteMatrix();
    const vshare = (c) => (c.same + c.opp ? c.opp / (c.same + c.opp) : null);

    // Actor overview: how often each actor shows up and which side it takes.
    const over = C.ACTORS.map((k) => {
      let m = 0, f = 0, a = 0, n = 0, lean = 0;
      for (const p of det) { const x = soft(p).actors[k]; m += x.m; f += x.f; a += x.a; n += x.n; lean += x.lean; }
      return { k, m, f, a, n, lean: m >= 0.5 ? lean / m : null, rate: det.length ? m / det.length : 0 };
    });
    const maxM = Math.max(1, ...over.map((o) => o.m));
    const overview = `<div class="a-card"><h3>Presencia y lado de cada actor</h3>
      <p class="a-note">Cuántas veces aparece cada actor con una posición sobre el expediente (suma de probabilidades) y cómo se reparte esa posición.</p>
      <div class="actor-over">${over.map((o) => `
        <div class="ao-row">
          <span class="ao-name"><span class="dot" style="background:${actorColor(o.k)}"></span>${C.L.actors[o.k]}</span>
          <span class="ao-m" ${tipAttr(`<b>${dec(o.m, 0)}</b> menciones · ${pctf(o.rate)} de los pares`)}><i style="width:${(o.m / maxM) * 100}%"></i></span>
          <span class="ao-split" ${tipAttr(`En contra <b>${dec(o.a, 0)}</b> · neutral <b>${dec(o.n, 0)}</b> · a favor <b>${dec(o.f, 0)}</b>`)}>
            <i style="flex:${o.a};background:${DIV[0]}"></i><i style="flex:${o.n};background:${DIV[2]}"></i><i style="flex:${o.f};background:${DIV[4]}"></i>
          </span>
          <span class="ao-lean" style="color:${divColor(o.lean)}">${sg(o.lean)}</span>
        </div>`).join("")}</div>
      <div class="legend-row"><span><i style="background:${DIV[0]}"></i>En contra</span><span><i style="background:${DIV[2]}"></i>Neutral o dividido</span><span><i style="background:${DIV[4]}"></i>A favor</span><span>· número: inclinación media (−1 a +1)</span></div>
    </div>`;

    const newsCard = `<div class="a-card"><h3>Según las noticias: % en bandos opuestos</h3>
      <p class="a-note">Para cada par de actores, de las veces que las noticias les atribuyen una posición sobre el mismo expediente, qué parte los pone en lados contrarios (rojo) o del mismo lado (verde). Clic en una celda para ver los expedientes.</p>
      ${matrixHtml(C.ACTORS, (i, j) => share(nm[i + "|" + j]), (i, j) => {
        const c = nm[i + "|" + j];
        return `${actorName(i)} vs ${actorName(j)}: <b>${pctf(share(c))}</b> opuestos · ${dec(c.opp, 1)} opuestos / ${dec(c.agr, 1)} alineados · ${c.both} pares con los dos mencionados`;
      }, true)}</div>`;
    const voteCard = `<div class="a-card"><h3>Según las votaciones: % en bandos opuestos</h3>
      <p class="a-note">Posición mayoritaria de cada fracción en cada votación del período (${C.nf(vm.n)} votaciones${C.S.from || C.S.to ? ", con el filtro de fechas" : ""}). Las mociones cuentan acá, porque miden si votan juntos, no si apoyan el proyecto.</p>
      <div class="seg small" data-ctl="voteSet">${[["all", "Todas"], ["fondo", "Solo de fondo"]].map(([k, l]) => `<button data-v="${k}" aria-pressed="${st.voteSet === k}">${l}</button>`).join("")}</div>
      ${matrixHtml(VOTING, (i, j) => vshare(vm.cells[i + "|" + j]), (i, j) => {
        const c = vm.cells[i + "|" + j];
        return `${actorName(i)} vs ${actorName(j)}: <b>${pctf(vshare(c))}</b> votaron distinto · ${c.opp} distinto / ${c.same} igual`;
      }, false)}</div>`;

    let detail = "";
    if (st.cell) {
      const [i, j] = st.cell.split("|");
      const rows = aggs.map((g) => {
        let opp = 0, agr = 0;
        for (const p of g.pairs) {
          const a = soft(p).actors[i], b = soft(p).actors[j];
          opp += a.f * b.a + a.a * b.f; agr += a.f * b.f + a.a * b.a;
        }
        return { g, opp, agr, li: g.actors[i].leanMean, lj: g.actors[j].leanMean };
      }).filter((r) => r.opp + r.agr >= 0.3);
      const top = (key) => [...rows].sort((a, b) => b[key] - a[key]).slice(0, 10);
      const list = (rs, key, title) => `<div><h4>${title}</h4><ul class="a-list">${rs.length ? rs.map((r) => `
        <li data-bill="${r.g.num}"><span class="num">${r.g.num}${tlb(r.g.num)}</span><span class="nm">${C.esc(short(r.g.b?.name || "", 90))}</span>
          <span class="mini">${actorName(i)} <b style="color:${divColor(r.li)}">${sg(r.li, 1)}</b> · ${actorName(j)} <b style="color:${divColor(r.lj)}">${sg(r.lj, 1)}</b></span>
          <b class="v">${dec(r[key], 1)}</b></li>`).join("") : `<li class="none">Nada con los filtros actuales.</li>`}</ul></div>`;
      detail = `<div class="a-card"><h3>${C.L.actors[i]} vs ${C.L.actors[j]} <button class="btn ghost" data-ctl="cellClose">${C.icon("x")}Cerrar</button></h3>
        <div class="two">${list(top("opp"), "opp", "Donde más chocan")}${list(top("agr"), "agr", "Donde más coinciden")}</div></div>`;
    }
    return `<div class="two">${newsCard}${voteCard}</div>${detail}${overview}`;
  }

  // ---------- section: votes vs press ----------
  function sectionVotes(aggs) {
    const byBill = new Map(aggs.map((g) => [g.num, g]));
    const sub = C.D.votes.filter((v) => v[6] && byBill.has(v[1]));
    const groups = new Map();
    for (const v of sub) {
      if (!groups.has(v[1])) groups.set(v[1], []);
      groups.get(v[1]).push(v);
    }
    const stats = Object.fromEntries(VOTING.map((k) => [k, { agree: 0, disagree: 0, silent: 0 }]));
    const rows = [];
    for (const [num, vs] of groups) {
      const g = byBill.get(num);
      const cells = VOTING.map((k) => {
        const t = vs.reduce((acc, v) => { const x = v[7][k] || [0, 0, 0]; return [acc[0] + x[0], acc[1] + x[1], acc[2] + x[2]]; }, [0, 0, 0]);
        const vote = t[0] + t[1] === 0 ? null : t[0] > t[1] ? 1 : t[1] > t[0] ? -1 : 0;
        const a = g.actors[k];
        const press = a.leanMean;
        let verdict = "";
        if (vote == null || vote === 0) verdict = "";
        else if (press == null) { verdict = "silent"; stats[k].silent++; }
        else if (Math.abs(press) < 0.2) verdict = "neutral";
        else if (Math.sign(press) === vote) { verdict = "ok"; stats[k].agree++; }
        else { verdict = "bad"; stats[k].disagree++; }
        return { k, t, vote, press, m: a.m, verdict };
      });
      rows.push({ g, vs, cells });
    }
    rows.sort((a, b) => b.g.n - a.g.n);
    const cards = VOTING.map((k) => {
      const s = stats[k], tot = s.agree + s.disagree;
      return `<div class="kpi"><span class="dot" style="background:${actorColor(k)}"></span><div><div class="k">${C.L.actors[k]}</div>
        <div class="v">${tot ? pctf(s.agree / tot) : "—"}</div><div class="s">${s.agree} coinciden · ${s.disagree} no · ${s.silent} sin mención</div></div></div>`;
    }).join("");
    const verdictIcon = { ok: `<span class="vd ok" title="La prensa coincide con el voto">✓</span>`, bad: `<span class="vd bad" title="La prensa le atribuye lo contrario">✗</span>`, neutral: `<span class="vd" title="La prensa lo pinta neutral">≈</span>`, silent: `<span class="vd" title="La prensa no le atribuye posición">·</span>`, "": "" };
    return `<div class="a-card"><h3>¿La prensa refleja cómo vota cada partido?</h3>
      <p class="a-note">Votaciones de fondo (primer y segundo debate, ratificaciones, acuerdos) de los expedientes que pasan los filtros. El voto es la mayoría de la fracción sumando sus votaciones de fondo; la prensa es la inclinación media que las noticias le atribuyen (cuenta si |inclinación| ≥ 0,2 y hay al menos media mención).</p>
      <div class="kpis">${cards}</div></div>
      <div class="a-card"><h3>Expediente por expediente <span class="a-count">${rows.length}</span></h3>
      ${rows.length ? `<div class="scroll-x"><table class="vt"><thead><tr><th>Expediente</th><th>Votaciones</th>${VOTING.map((k) => `<th><span class="dot" style="background:${actorColor(k)}"></span>${actorName(k)}</th>`).join("")}</tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="bt" data-bill="${r.g.num}"><span class="num">${r.g.num}${tlb(r.g.num)}</span> ${C.esc(short(r.g.b?.name || "", 80))}<div class="mini">${r.g.n} pares con detalle</div></td>
        <td class="mini">${r.vs.map((v) => `<div ${tipAttr(C.esc(v[4]))}>${v[2]} · ${C.esc(v[3])} · <b>${C.esc(v[5])}</b></div>`).join("")}</td>
        ${r.cells.map((c) => `<td><div class="vc">
          <span class="vbadge ${c.vote === 1 ? "for" : c.vote === -1 ? "ag" : ""}" ${tipAttr(`Votos: ${c.t[0]} a favor · ${c.t[1]} en contra · ${c.t[2]} ausentes`)}>${c.vote == null ? "—" : c.vote === 1 ? "A favor" : c.vote === -1 ? "En contra" : "Dividido"} <small>${c.t[0]}–${c.t[1]}</small></span>
          <span class="pbadge" style="background:${divColor(c.press)};color:${inkOn(c.press, true)}" ${tipAttr(`Prensa: inclinación <b>${sg(c.press)}</b> · ${dec(c.m, 1)} menciones`)}>${c.press == null ? "no dice" : sg(c.press, 1)}</span>
          ${verdictIcon[c.verdict]}</div></td>`).join("")}</tr>`).join("")}
      </tbody></table></div>` : `<p class="a-note">Ningún expediente con votación de fondo pasa los filtros.</p>`}</div>`;
  }

  // ---------- section: outlets ----------
  function sectionOutlets(det, kept, aggs) {
    const outs = Object.keys(C.OUTLETS).filter((o) => C.S.outlets.has(o));
    const by = Object.fromEntries(outs.map((o) => [o, det.filter((p) => p.n.outlet === o)]));
    const newsBy = Object.fromEntries(outs.map((o) => {
      const m = new Map();
      kept.forEach((p) => { if (p.n.outlet === o) m.set(p.n.i, p.n); });
      return [o, [...m.values()]];
    }));
    const mpair = (o, f) => (by[o].length ? mean(by[o].map(f)) : null);
    const mnews = (o, f) => { const xs = newsBy[o].filter((n) => n.a.main_frame).map(f); return xs.length ? mean(xs) : null; };
    const groups = [
      ["Volumen", [
        ["Noticias", (o) => newsBy[o].length, "count"],
        ["Pares con detalle", (o) => by[o].length, "count"],
        ["Expedientes distintos", (o) => new Set(by[o].map((p) => p.b.num)).size, "count"],
      ]],
      ["Tono", [
        ["Postura media", (o) => mpair(o, (p) => soft(p).stance), "signed"],
        ["Crítica", (o) => mpair(o, (p) => soft(p).crit), "share"],
        ["Favorable", (o) => mpair(o, (p) => soft(p).fav), "share"],
        ["Imagen de la Asamblea", (o) => mnews(o, (n) => (n.a.assembly_image[0] / 100 - 2) / 2), "signed"],
        ["Centralidad (0–2)", (o) => mpair(o, (p) => p.cen / 2), "share", (v) => dec(v * 2)],
      ]],
      ["Tipo de pieza", [
        ...C.GENRES.map((g) => [C.L.genre[g], (o) => (newsBy[o].length ? mean(newsBy[o].map((n) => n.genreProbs[C.GENRES.indexOf(g)] / 100)) : null), "share"]),
        ["Comunicado de prensa", (o) => mnews(o, (n) => n.a.press_release / 100), "share"],
        ["Titular engañoso", (o) => mnews(o, (n) => n.a.headline_misleading / 100), "share"],
      ]],
      ["Encuadre dominante", C.FRAMES.map((f, i) => [C.L.main_frame[f], (o) => mnews(o, (n) => n.a.main_frame[i] / 100), "share"])],
      ["Etapa que reporta", C.STAGES.map((s, i) => [C.L.stage[s], (o) => mpair(o, (p) => p.det.stage[i] / 100), "share"])],
      ["Voces citadas", C.VOICES.map((v) => [C.L.voices[v], (o) => mpair(o, (p) => p.det[v] / 100), "share"])],
      ["Rasgos de la cobertura", C.FEATURES.map((f) => [C.L.features[f], (o) => mpair(o, (p) => p.det[f] / 100), "share"])],
      ["Menciona al actor", C.ACTORS.map((k) => [C.L.actors[k], (o) => mpair(o, (p) => soft(p).actors[k].m), "share"])],
      ["Inclinación que le atribuye", C.ACTORS.map((k) => [C.L.actors[k], (o) => {
        let m = 0, l = 0;
        by[o].forEach((p) => { const a = soft(p).actors[k]; m += a.m; l += a.lean; });
        return m >= 0.5 ? l / m : null;
      }, "signed"])],
    ];
    const profile = `<div class="a-card"><h3>Perfil de cada medio</h3>
      <p class="a-note">Promedio de las probabilidades de Jev por medio. Cada fila se colorea respecto de su propio máximo; las filas con signo van de rojo (−) a verde (+).</p>
      <div class="scroll-x"><table class="hm"><thead><tr><th></th>${outs.map((o) => `<th style="color:${C.OUTLETS[o].color}">${C.OUTLETS[o].name}</th>`).join("")}</tr></thead><tbody>
      ${groups.map(([title, rows]) => `<tr class="grp"><th colspan="${outs.length + 1}">${title}</th></tr>${rows.map(([label, f, kind, fmt]) => {
        const vals = outs.map((o) => f(o));
        const max = Math.max(1e-9, ...vals.filter((v) => v != null).map(Math.abs));
        return `<tr><th>${C.esc(label)}</th>${vals.map((v, i) => {
          const bg = kind === "signed" ? divColor(v == null ? null : v / Math.max(0.25, max)) : seqColor(v == null ? null : v / max);
          const txt = v == null ? "—" : kind === "count" ? C.nf(v) : kind === "signed" ? sg(v) : fmt ? fmt(v) : pctf(v);
          const sv = kind === "signed" ? (v ?? 0) / Math.max(0.25, max) : (v ?? 0) / max;
          return `<td style="background:${bg};color:${inkOn(sv, kind === "signed")}" ${tipAttr(`${C.OUTLETS[outs[i]].name} · ${C.esc(label)}: <b>${txt}</b>`)}>${txt}</td>`;
        }).join("")}</tr>`;
      }).join("")}`).join("")}</tbody></table></div></div>`;

    // Relative bias: outlet stance minus the other outlets' stance on the same bills.
    const bias = outs.map((o) => {
      let w = 0, d = 0, bills = 0;
      for (const g of aggs) {
        const me = g.outlets[o];
        if (!me) continue;
        const others = Object.entries(g.outlets).filter(([k]) => k !== o);
        const on = sum(others.map(([, x]) => x.n));
        if (!on) continue;
        const ostance = sum(others.map(([, x]) => x.stance)) / on;
        d += (me.stance / me.n - ostance) * me.n;
        w += me.n;
        bills++;
      }
      return { o, v: w ? d / w : null, bills };
    });
    const bmax = Math.max(0.05, ...bias.map((b) => Math.abs(b.v ?? 0)));
    const biasCard = `<div class="a-card"><h3>¿Más crítico o más favorable que los demás?</h3>
      <p class="a-note">En los expedientes que cubren al menos dos medios: postura del medio menos la postura media de los otros sobre los mismos expedientes.</p>
      <div class="dbars">${bias.map((b) => `<div class="db" ${tipAttr(`${C.OUTLETS[b.o].name}: <b>${sg(b.v, 3)}</b> en ${b.bills} expedientes compartidos`)}>
        <span class="lbl">${C.OUTLETS[b.o].name}</span>
        <span class="axis"><i style="${(b.v ?? 0) < 0 ? `right:50%;width:${(Math.abs(b.v ?? 0) / bmax) * 50}%;background:${DIV[0]}` : `left:50%;width:${((b.v ?? 0) / bmax) * 50}%;background:${DIV[4]}`}"></i></span>
        <b>${sg(b.v, 3)}</b></div>`).join("")}</div>
      <div class="legend-row"><span>← más crítico</span><span style="margin-left:auto">más favorable →</span></div></div>`;

    // Weekly coverage per outlet (line chart).
    const weeks = new Map();
    const wk = (day) => { const d = new Date(day + "T00:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
    for (const o of outs) for (const n of newsBy[o]) {
      const w = wk(n.day);
      if (!weeks.has(w)) weeks.set(w, {});
      weeks.get(w)[o] = (weeks.get(w)[o] || 0) + 1;
    }
    const ws = [...weeks.keys()].sort();
    const series = outs.map((o) => ({ key: o, label: C.OUTLETS[o].name, color: C.OUTLETS[o].color, values: ws.map((w) => weeks.get(w)[o] || 0) }));
    const lineCard = `<div class="a-card"><h3>Noticias por semana</h3>${lineChart(ws, series, { yLabel: "noticias" })}</div>`;
    return `${profile}<div class="two">${biasCard}${lineCard}</div>`;
  }

  // ---------- generic SVG charts ----------
  function lineChart(xs, series, opts = {}) {
    if (!xs.length) return `<p class="a-note">Sin datos.</p>`;
    const W = 560, H = 230, L = 36, R = 10, T = 10, B = 26;
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const x = (i) => L + (xs.length === 1 ? 0 : (i / (xs.length - 1)) * (W - L - R));
    const y = (v) => T + (1 - v / max) * (H - T - B);
    const ticks = [0, max / 2, max].map((v) => Math.round(v));
    const months = xs.map((d, i) => [d, i]).filter(([d], i) => i === 0 || d.slice(5, 7) !== xs[i - 1].slice(5, 7));
    const hits = xs.map((d, i) => `<rect x="${x(i) - (W - L - R) / xs.length / 2}" y="${T}" width="${(W - L - R) / Math.max(1, xs.length - 1)}" height="${H - T - B}" fill="transparent"
      ${tipAttr(`Semana del ${d}<br>${series.map((s) => `<span style="color:${s.color}">━</span> <b>${s.values[i]}</b> ${s.label}`).join("<br>")}`)}/>`).join("");
    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}">
      ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 6}" y="${y(t) + 3}" class="ax" text-anchor="end">${t}</text>`).join("")}
      ${months.map(([d, i]) => `<text x="${x(i)}" y="${H - 8}" class="ax">${new Date(d + "T00:00:00").toLocaleDateString("es-CR", { month: "short" })}</text>`).join("")}
      ${series.map((s) => `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>`).join("")}
      ${hits}</svg>
      <div class="legend-row">${series.map((s) => `<span><i class="ln" style="background:${s.color}"></i>${s.label}</span>`).join("")}</div>`;
  }

  // ---------- section: bills (rankings) ----------
  function sectionBills(det, kept) {
    const outletFilter = st.rankOutlet;
    const detF = outletFilter === "all" ? det : det.filter((p) => p.n.outlet === outletFilter);
    const keptF = outletFilter === "all" ? kept : kept.filter((p) => p.n.outlet === outletFilter);
    const aggs = billAggregates(detF, keptF).filter((g) => g.newsCount >= st.min);
    const metric = st.rankBy;
    const valueOf = (g) => (metric === "stance" ? g.stance : g.actors[metric].leanMean);
    const ranked = aggs.filter((g) => valueOf(g) != null);
    const crit = [...ranked].sort((a, b) => valueOf(a) - valueOf(b)).slice(0, 15);
    const fav = [...ranked].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 15);
    const covered = [...aggs].sort((a, b) => b.newsCount - a.newsCount).slice(0, 15);
    const maxN = Math.max(1, ...covered.map((g) => g.newsCount));
    const row = (g, v) => `<li data-bill="${g.num}" ${tipAttr(`${C.esc(g.b?.name || "")}<br><b>${sg(v)}</b> · ${g.newsCount} noticias · ${g.nOutlets} medios`)}>
      <span class="num">${g.num}${tlb(g.num)}</span><span class="nm">${C.esc(short(g.b?.name || "", 80))}</span>
      <span class="divbar"><i style="${v < 0 ? `right:50%;width:${Math.abs(v) * 50}%;background:${DIV[0]}` : `left:50%;width:${v * 50}%;background:${DIV[4]}`}"></i></span>
      <b class="v" style="color:${divColor(v)}">${sg(v)}</b><span class="n">${g.newsCount}</span></li>`;
    const metricLabel = metric === "stance" ? "postura de la noticia" : `inclinación de ${C.L.actors[metric]}`;
    return `<div class="a-card a-controls">
        <label>Medio <select data-ctl="rankOutlet"><option value="all">Todos</option>${Object.keys(C.OUTLETS).map((o) => `<option value="${o}"${st.rankOutlet === o ? " selected" : ""}>${C.OUTLETS[o].name}</option>`).join("")}</select></label>
        <label>Según <select data-ctl="rankBy"><option value="stance">Postura de la noticia</option>${C.ACTORS.map((k) => `<option value="${k}"${st.rankBy === k ? " selected" : ""}>Lo que dice ${C.L.actors[k]}</option>`).join("")}</select></label>
        <span class="a-note">${ranked.length} expedientes con ≥ ${st.min} noticias${metric !== "stance" ? " y al menos media mención del actor" : ""}.</span>
      </div>
      <div class="two">
        <div class="a-card"><h3>Más criticados <span class="a-sub">${metricLabel}</span></h3><ul class="a-list rank">${crit.map((g) => row(g, valueOf(g))).join("") || `<li class="none">Nada.</li>`}</ul></div>
        <div class="a-card"><h3>Más favorecidos <span class="a-sub">${metricLabel}</span></h3><ul class="a-list rank">${fav.map((g) => row(g, valueOf(g))).join("") || `<li class="none">Nada.</li>`}</ul></div>
      </div>
      <div class="a-card"><h3>Más cubiertos</h3><ul class="a-list cov-list">${covered.map((g) => `<li data-bill="${g.num}">
        <span class="num">${g.num}${tlb(g.num)}</span><span class="nm">${C.esc(short(g.b?.name || "", 80))}</span>
        <span class="nbar"><i style="width:${(g.newsCount / maxN) * 100}%"></i></span><b class="v">${g.newsCount}</b>
        <span class="tag stance" style="--sc:${divColor(g.stance)}">${sg(g.stance)}</span>
        <span class="mini">${pctf(g.explicitShare)} explícitas</span></li>`).join("")}</ul></div>`;
  }

  // ---------- section: proponents and committees ----------
  function sectionProponents(det, aggs) {
    const byParty = new Map();
    for (const g of aggs) {
      const k = g.proponent || "Sin proponente";
      if (!byParty.has(k)) byParty.set(k, []);
      byParty.get(k).push(g);
    }
    const parties = [...byParty.entries()].sort((a, b) => b[1].length - a[1].length);
    const pname = (k) => C.L.actors[k] || k;
    const actorLeanOn = (gs, k) => {
      let m = 0, l = 0;
      gs.forEach((g) => { m += g.actors[k].m; l += g.actors[k].lean; });
      return m >= 0.5 ? l / m : null;
    };
    const table = `<div class="a-card"><h3>Cobertura según el partido proponente</h3>
      <p class="a-note">Partido del primer firmante al presentar el expediente (o el Poder Ejecutivo). A la derecha, la inclinación que las noticias le atribuyen a cada actor sobre los proyectos de ese proponente: así se ve, por ejemplo, qué dice el PPSO de los proyectos del FA.</p>
      <div class="scroll-x"><table class="hm pt"><thead><tr><th>Proponente</th><th>Expedientes</th><th>Noticias</th><th>Noticias / exp.</th><th>Postura</th><th>Crítica</th><th>Centralidad</th>
        ${C.ACTORS.map((k) => `<th><span class="dot" style="background:${actorColor(k)}"></span>${actorName(k)}</th>`).join("")}</tr></thead><tbody>
      ${parties.map(([k, gs]) => {
        const news = sum(gs.map((g) => g.newsCount));
        const stc = mean(gs.flatMap((g) => g.pairs.map((p) => soft(p).stance)));
        const cr = mean(gs.flatMap((g) => g.pairs.map((p) => soft(p).crit)));
        const ce = mean(gs.flatMap((g) => g.pairs.map((p) => p.cen)));
        return `<tr><th>${C.L.actorColors[k] ? `<span class="dot" style="background:${actorColor(k)}"></span>` : ""}${C.esc(pname(k))}</th>
          <td>${gs.length}</td><td>${C.nf(news)}</td><td>${dec(news / gs.length, 1)}</td>
          <td style="background:${divColor(stc * 2)};color:${inkOn(stc * 2, true)}">${sg(stc)}</td><td>${pctf(cr)}</td><td>${dec(ce)}</td>
          ${C.ACTORS.map((a) => { const v = actorLeanOn(gs, a); return `<td style="background:${divColor(v)};color:${inkOn(v, true)}" ${tipAttr(`${C.L.actors[a]} sobre proyectos de ${C.esc(pname(k))}: <b>${sg(v)}</b>`)}>${v == null ? "·" : sg(v, 1)}</td>`; }).join("")}</tr>`;
      }).join("")}</tbody></table></div></div>`;

    // Committees: a bill counts in every organ it went through during the period.
    const byOrgan = new Map();
    for (const g of aggs) {
      for (const [oi] of C.D.committees[g.num] || []) {
        if (!byOrgan.has(oi)) byOrgan.set(oi, new Set());
        byOrgan.get(oi).add(g);
      }
    }
    const organs = [...byOrgan.entries()].map(([oi, set]) => {
      const gs = [...set];
      const ps = gs.flatMap((g) => g.pairs);
      return {
        oi, name: C.D.organs[oi][0], kind: C.D.organs[oi][1], gs, news: sum(gs.map((g) => g.newsCount)),
        stance: mean(ps.map((p) => soft(p).stance)), polar: mean(gs.map((g) => g.polar).filter((x) => x != null)),
      };
    }).sort((a, b) => b.news - a.news);
    const maxNews = Math.max(1, ...organs.map((o) => o.news));
    const sel = organs.find((o) => o.oi === st.committee);
    const comm = `<div class="a-card"><h3>Por comisión <span class="a-sub">órganos por los que pasaron los expedientes en el período</span></h3>
      <ul class="a-list comm">${organs.map((o) => `<li data-organ="${o.oi}" class="${st.committee === o.oi ? "sel" : ""}">
        <span class="nm">${C.esc(short(o.name, 70))}<span class="mini"> · ${C.esc(o.kind.toLowerCase())}</span></span>
        <span class="nbar"><i style="width:${(o.news / maxNews) * 100}%"></i></span><b class="v">${C.nf(o.news)}</b>
        <span class="mini">${o.gs.length} exp.</span>
        <span class="tag stance" style="--sc:${divColor(o.stance * 2)}">${sg(o.stance)}</span>
        <span class="mini" ${tipAttr("Polarización media de sus expedientes (0 = un solo bando, 1 = bandos parejos)")}>pol. ${dec(o.polar)}</span></li>`).join("")}</ul>
      ${sel ? `<h4>${C.esc(sel.name)}</h4><ul class="a-list">${sel.gs.sort((a, b) => b.newsCount - a.newsCount).map((g) => `<li data-bill="${g.num}"><span class="num">${g.num}${tlb(g.num)}</span><span class="nm">${C.esc(short(g.b?.name || "", 90))}</span><b class="v">${g.newsCount}</b><span class="tag stance" style="--sc:${divColor(g.stance * 2)}">${sg(g.stance)}</span></li>`).join("")}</ul>` : `<p class="a-note">Clic en una comisión para ver sus expedientes.</p>`}</div>`;
    return table + comm;
  }

  // ---------- section: cross variables ----------
  const VARS = {
    news: ["Noticias", (g) => g.newsCount, "log"],
    outlets: ["Medios que lo cubren", (g) => g.nOutlets],
    days: ["Días con cobertura", (g) => g.nDays, "log"],
    stance: ["Postura media", (g) => g.stance],
    crit: ["% crítica", (g) => g.crit],
    fav: ["% favorable", (g) => g.fav],
    polar: ["Polarización (actores)", (g) => g.polar],
    disp: ["Dispersión de la postura", (g) => g.disp],
    cen: ["Centralidad media", (g) => g.cen],
    explicit: ["% menciones explícitas", (g) => g.explicitShare],
    prob: ["Probabilidad media", (g) => g.prob],
    press: ["% comunicados", (g) => g.press],
    newdev: ["% hecho nuevo", (g) => g.newdev],
    conflict: ["% pleito político", (g) => g.conflict],
    content: ["% explica contenido", (g) => g.content],
  };
  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    const mx = mean(xs), my = mean(ys);
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
    return b && c ? a / Math.sqrt(b * c) : null;
  }
  const ranks = (xs) => {
    const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(xs.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const spearman = (xs, ys) => pearson(ranks(xs), ranks(ys));

  function sectionCross(aggs) {
    const gs = aggs.filter((g) => g.newsCount >= st.min);
    const keys = Object.keys(VARS);
    const pairsOf = (kx, ky) => gs.map((g) => [VARS[kx][1](g), VARS[ky][1](g), g]).filter(([a, b]) => a != null && b != null);
    const pts = pairsOf(st.x, st.y);
    const tx = (k, v) => (VARS[k][2] === "log" ? Math.log10(v) : v);
    const xs = pts.map((p) => tx(st.x, p[0])), ys = pts.map((p) => tx(st.y, p[1]));
    const r = pearson(xs, ys), rho = spearman(pts.map((p) => p[0]), pts.map((p) => p[1]));

    const W = 720, H = 420, L = 50, R = 16, T = 14, B = 40;
    const ext = (a) => { let lo = Math.min(...a), hi = Math.max(...a); if (lo === hi) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.05; return [lo - pad, hi + pad]; };
    const [x0, x1] = xs.length ? ext(xs) : [0, 1];
    const [y0, y1] = ys.length ? ext(ys) : [0, 1];
    const X = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
    const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const tickVals = (lo, hi, k) => Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
    const fmtT = (k, v) => (VARS[k][2] === "log" ? C.nf(Math.round(10 ** v)) : Math.abs(v) < 10 ? dec(v) : C.nf(Math.round(v)));
    const colorOf = (g) => {
      if (st.color === "proponent") return g.proponent && C.L.actorColors[g.proponent] ? C.L.actorColors[g.proponent] : "#9aa1ad";
      if (st.color === "status") return { law: "#0f8a5f", "in progress": "#3b6fe0", archived: "#9aa1ad" }[g.b?.status] || "#c9cdd4";
      const top = Object.entries(g.outlets).sort((a, b) => b[1].n - a[1].n)[0];
      return top ? C.OUTLETS[top[0]].color : "#9aa1ad";
    };
    const legend = st.color === "proponent"
      ? [...C.ACTORS.map((k) => [C.L.actors[k], actorColor(k)]), ["Otro o sin proponente", "#9aa1ad"]]
      : st.color === "status" ? [["Ley", "#0f8a5f"], ["En trámite", "#3b6fe0"], ["Archivado", "#9aa1ad"]]
      : Object.values(C.OUTLETS).map((o) => [o.name, o.color]);
    const svg = `<svg class="chart-svg scatter" viewBox="0 0 ${W} ${H}">
      ${tickVals(x0, x1).map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}" class="grid"/><text x="${X(v)}" y="${H - B + 14}" class="ax" text-anchor="middle">${fmtT(st.x, v)}</text>`).join("")}
      ${tickVals(y0, y1).map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 6}" y="${Y(v) + 3}" class="ax" text-anchor="end">${fmtT(st.y, v)}</text>`).join("")}
      <text x="${(L + W - R) / 2}" y="${H - 6}" class="ax-t" text-anchor="middle">${VARS[st.x][0]}${VARS[st.x][2] === "log" ? " (escala log)" : ""}</text>
      <text x="12" y="${(T + H - B) / 2}" class="ax-t" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">${VARS[st.y][0]}${VARS[st.y][2] === "log" ? " (log)" : ""}</text>
      ${pts.map(([a, b, g], i) => `<circle cx="${X(xs[i])}" cy="${Y(ys[i])}" r="${clamp(2.5 + Math.sqrt(g.newsCount) * 0.9, 3, 16)}" fill="${colorOf(g)}" fill-opacity=".72" stroke="#fff" stroke-width="1.5"
        data-bill="${g.num}" ${tipAttr(`<b>${g.num}</b> ${C.esc(short(g.b?.name || "", 90))}<br>${VARS[st.x][0]}: <b>${fmtT(st.x, tx(st.x, a))}</b> · ${VARS[st.y][0]}: <b>${fmtT(st.y, tx(st.y, b))}</b><br>${g.newsCount} noticias`)}/>`).join("")}
    </svg>`;
    const sel = (ctl, cur) => `<select data-ctl="${ctl}">${keys.map((k) => `<option value="${k}"${cur === k ? " selected" : ""}>${VARS[k][0]}</option>`).join("")}</select>`;

    // Spearman matrix over every pair of variables.
    const corr = `<div class="scroll-x"><table class="mx corr"><thead><tr><th></th>${keys.map((k) => `<th class="rot"><span>${VARS[k][0]}</span></th>`).join("")}</tr></thead><tbody>
      ${keys.map((a) => `<tr><th>${VARS[a][0]}</th>${keys.map((b) => {
        if (a === b) return `<td class="diag"></td>`;
        const pp = pairsOf(a, b);
        const v = spearman(pp.map((p) => p[0]), pp.map((p) => p[1]));
        return `<td data-xy="${b}|${a}" style="background:${divColor(v)};color:${inkOn(v, true)}" class="${st.x === b && st.y === a ? "sel" : ""}" ${tipAttr(`${VARS[a][0]} vs ${VARS[b][0]}: ρ = <b>${dec(v)}</b> (${pp.length} expedientes)`)}>${v == null ? "·" : Math.round(v * 100) / 100}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>`;
    return `<div class="a-card a-controls">
        <label>Eje X ${sel("x", st.x)}</label><label>Eje Y ${sel("y", st.y)}</label>
        <label>Color <select data-ctl="color">${[["proponent", "Partido proponente"], ["status", "Estado del expediente"], ["outlet", "Medio que más lo cubre"]].map(([k, l]) => `<option value="${k}"${st.color === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <span class="a-note">${pts.length} expedientes con ≥ ${st.min} noticias · Pearson r = <b>${dec(r)}</b> · Spearman ρ = <b>${dec(rho)}</b></span>
      </div>
      <div class="a-card">${svg}<div class="legend-row">${legend.map(([l, c]) => `<span><i style="background:${c};border-radius:50%"></i>${C.esc(l)}</span>`).join("")}<span>· tamaño: noticias</span></div></div>
      <div class="a-card"><h3>Correlaciones entre todas las variables <span class="a-sub">Spearman, por expediente; clic para graficar</span></h3>${corr}</div>`;
  }

  // ---------- section: polemic ----------
  function sectionPolemic(aggs) {
    const gs = aggs.filter((g) => g.newsCount >= st.min && (st.polarSort === "disp" || g.polar != null));
    const key = st.polarSort === "disp" ? "disp" : "polar";
    gs.sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1) || b.newsCount - a.newsCount);
    const top = gs.slice(0, 30);
    const camp = (g) => {
      const sides = C.ACTORS.map((k) => ({ k, ...g.actors[k] })).filter((a) => a.m >= 0.5);
      const total = Math.max(1, sum(sides.map((s) => s.f + s.a)));
      const left = sides.filter((s) => s.a > 0.05).sort((a, b) => b.a - a.a);
      const right = sides.filter((s) => s.f > 0.05).sort((a, b) => b.f - a.f);
      const seg = (s, v, side) => `<i style="flex:${v};background:${actorColor(s.k)}" ${tipAttr(`${C.L.actors[s.k]} ${side}: <b>${dec(v, 1)}</b> (inclinación ${sg(s.leanMean)})`)}>${v / total > 0.12 ? actorName(s.k) : ""}</i>`;
      return `<div class="camps"><div class="side l" style="width:${(sum(left.map((s) => s.a)) / total) * 50}%">${left.map((s) => seg(s, s.a, "en contra")).join("")}</div>
        <span class="mid"></span><div class="side r" style="width:${(sum(right.map((s) => s.f)) / total) * 50}%">${right.map((s) => seg(s, s.f, "a favor")).join("")}</div></div>`;
    };
    const outletDots = (g) => `<div class="odots"><span class="zero"></span>${Object.entries(g.outlets).map(([o, x]) => {
      const v = x.stance / x.n;
      return `<i style="left:${50 + v * 50}%;background:${C.OUTLETS[o].color}" ${tipAttr(`${C.OUTLETS[o].name}: postura <b>${sg(v)}</b> en ${x.n} noticias`)}></i>`;
    }).join("")}</div>`;
    return `<div class="a-card a-controls">
        <label>Ordenar por <select data-ctl="polarSort"><option value="actors"${st.polarSort === "actors" ? " selected" : ""}>Bandos entre actores</option><option value="disp"${st.polarSort === "disp" ? " selected" : ""}>Dispersión de la postura entre noticias</option></select></label>
        <span class="a-note">Polarización = 2·min(a favor, en contra) / (a favor + en contra), sumando lo que las noticias atribuyen a todos los actores: 1 = dos bandos parejos, 0 = un solo bando. La dispersión es la desviación estándar de la postura de las noticias.</span>
      </div>
      <div class="a-card"><div class="pol-head"><span>Expediente</span><span>← en contra · bandos · a favor →</span><span>Postura por medio</span><span>Pol.</span><span>Disp.</span></div>
      <ul class="a-list pol">${top.map((g) => `<li data-bill="${g.num}">
        <div class="nm"><span class="num">${g.num}${tlb(g.num)}</span> ${C.esc(short(g.b?.name || "", 80))}<div class="mini">${g.newsCount} noticias · ${g.nOutlets} medios</div></div>
        ${camp(g)}${outletDots(g)}<b class="v">${dec(g.polar)}</b><b class="v">${dec(g.disp)}</b></li>`).join("") || `<li class="none">Nada con los filtros actuales.</li>`}</ul></div>`;
  }

  // ---------- section: timeline ----------
  // Universe: bills with pairs over the threshold (under the page filters) plus every bill with SIL
  // activity in the period (data.active), covered or not. Candidates under the threshold show in gray.
  const MILESTONES = [
    [/^PRESENTACI[OÓ]N/, "Presentación"],
    [/^ASIGNACI[OÓ]N A COMISI/, "A comisión"],
    [/^DICTAMEN/, "Dictamen"],
    [/^VOTACI[OÓ]N \(COMISI/, "Votación en comisión"],
    [/^(VOTACI[OÓ]N )?PRIMER DEBATE/, "1.er debate"],
    [/^(VOTACI[OÓ]N )?SEGUNDO DEBATE/, "2.º debate"],
    [/CONSULTA DE CONSTITUCIONALIDAD/, "Consulta a la Sala IV"],
    [/A CASA PRESIDENCIAL|DECRETO LEGISLATIVO SANCIONADO/, "Al Ejecutivo"],
    [/VETO/, "Veto"],
    [/^PUBLICACI[OÓ]N DE LA LEY/, "Ley publicada"],
    [/^ARCHIVO (DEL )?EXPEDIENTE/, "Archivado"],
  ];
  const milestoneOf = (desc) => (MILESTONES.find(([re]) => re.test(desc)) || [null, null])[1];
  const TL_FILTERS = [["all", "Todos"], ["covered", "Con cobertura"], ["uncovered", "Sin cobertura"], ["voted", "Con votaciones"]];
  const TL_SORTS = [["news", "Más noticias"], ["activity", "Más actividad en el SIL"], ["last", "Actividad más reciente"], ["number", "Número"]];
  const tl = { q: "", filter: "all", sort: "news", shown: 300, partiesOpen: true };
  let TL = null; // { items, byNum, d0, d1 }
  let votesByBill = null;

  function period() {
    const days = C.news.map((n) => n.day).sort();
    return [C.S.from || days[0], C.S.to || days.at(-1)];
  }
  const weekOf = (day) => { const d = new Date(day + "T00:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

  function timelineUniverse(kept, base) {
    if (!votesByBill) {
      votesByBill = new Map();
      for (const v of C.D.votes) { if (!votesByBill.has(v[1])) votesByBill.set(v[1], []); votesByBill.get(v[1]).push(v); }
    }
    const [from, to] = period();
    const inP = (d) => d >= from && d <= to + "~";
    const m = new Map();
    const get = (num) => {
      if (!m.has(num)) m.set(num, { num, b: C.bills[num], above: [], below: [], newsSet: new Set() });
      return m.get(num);
    };
    for (const p of kept) { const g = get(p.b.num); g.above.push(p); g.newsSet.add(p.n.i); }
    for (const n of C.D.active) get(n);
    if (st.bill && C.bills[st.bill]) get(st.bill);
    for (const p of base) {
      const g = m.get(p.b.num);
      const v = C.val(p);
      if (g && v >= 10 && v < C.S.thr) g.below.push(p);
    }
    for (const g of m.values()) {
      g.news = g.newsSet.size;
      g.steps = (C.D.steps[g.num] || []).filter((s) => inP(s[0]));
      g.votes = (votesByBill.get(g.num) || []).filter((v) => inP(v[2]));
      const dates = [...g.steps.map((s) => s[0]), ...g.votes.map((v) => v[2]), ...g.above.map((p) => p.n.day)].sort();
      g.last = dates.at(-1) || "";
      g.hay = C.norm(`${g.num} ${g.b?.name || ""}`);
    }
    return { items: [...m.values()], byNum: m, from, to };
  }

  function tlFiltered() {
    const q = C.norm(tl.q.trim());
    let xs = TL.items.filter((g) =>
      (!q || g.hay.includes(q)) &&
      (tl.filter === "all" || (tl.filter === "covered" && g.news > 0) || (tl.filter === "uncovered" && g.news === 0) || (tl.filter === "voted" && g.votes.length > 0)));
    const by = {
      news: (a, b) => b.news - a.news || b.below.length - a.below.length || b.steps.length - a.steps.length,
      activity: (a, b) => (b.steps.length + b.votes.length) - (a.steps.length + a.votes.length) || b.news - a.news,
      last: (a, b) => b.last.localeCompare(a.last),
      number: (a, b) => b.num - a.num,
    }[tl.sort];
    return xs.sort(by);
  }

  function spark(g) {
    const W = 220, H = 16;
    const t0 = new Date(TL.from + "T00:00:00").getTime(), t1 = new Date(TL.to + "T23:59:59").getTime();
    const nW = Math.max(1, Math.ceil((t1 - t0) / (7 * 864e5)));
    const bins = new Array(nW).fill(0);
    for (const p of g.above) bins[clamp(Math.floor((new Date(p.n.day).getTime() - t0) / (7 * 864e5)), 0, nW - 1)]++;
    const max = Math.max(1, ...bins);
    const bw = W / nW;
    const ticks = [...g.steps.map((s) => s[0]), ...g.votes.map((v) => v[2])].map((d) => ((new Date(d).getTime() - t0) / (t1 - t0)) * W);
    return `<svg class="spark" viewBox="0 0 ${W} ${H + 4}" preserveAspectRatio="none">
      ${bins.map((c, i) => (c ? `<rect x="${i * bw + 0.5}" y="${H - (c / max) * H}" width="${Math.max(1, bw - 1)}" height="${(c / max) * H}" fill="var(--mid)"/>` : "")).join("")}
      ${ticks.map((x) => `<rect x="${clamp(x, 0, W - 1)}" y="${H + 1}" width="1.2" height="3" fill="var(--ink-3)"/>`).join("")}
      <line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line-strong)" stroke-width="1"/></svg>`;
  }

  function tlListHtml() {
    const xs = tlFiltered();
    const items = xs.slice(0, tl.shown).map((g) => `
      <li data-tl="${g.num}" class="${g.num === st.bill ? "sel" : ""}" tabindex="-1">
        <div class="r1"><span class="num">${g.num}</span>
          <span class="cnt ${g.news ? "" : "zero"}">${g.news ? `${g.news} noticia${g.news > 1 ? "s" : ""}` : "sin cobertura"}</span></div>
        <div class="nm">${C.esc(g.b?.name || "")}</div>
        ${spark(g)}
        <div class="mini">${g.steps.length} paso${g.steps.length === 1 ? "" : "s"} · ${g.votes.length} votación${g.votes.length === 1 ? "" : "es"}${g.below.length ? ` · ${g.below.length} bajo umbral` : ""}${g.last ? ` · último ${g.last.slice(5)}` : ""}</div>
      </li>`).join("");
    const more = xs.length > tl.shown ? `<button class="more" data-ctl="tlMore">Mostrar ${Math.min(300, xs.length - tl.shown)} más</button>` : "";
    return { html: (items || `<li class="none">Ningún expediente coincide.</li>`) + more, count: xs.length };
  }

  function renderTlList() {
    const el = document.getElementById("tl-items");
    if (!el) return;
    const { html, count } = tlListHtml();
    el.innerHTML = html;
    document.getElementById("tl-count").textContent = `${C.nf(count)} expedientes`;
  }

  function tlChart(g) {
    const W = 1000, L = 104, R = 16;
    const t0 = new Date(TL.from + "T00:00:00").getTime(), t1 = new Date(TL.to + "T23:59:59").getTime();
    const X = (iso) => L + clamp((new Date(iso.length === 10 ? iso + "T12:00:00" : iso).getTime() - t0) / (t1 - t0), 0, 1) * (W - L - R);
    const det = g.above.filter((p) => p.det).sort((a, b) => a.n.date.localeCompare(b.n.date));
    const noDet = g.above.filter((p) => !p.det);

    // Lanes, top to bottom.
    const yS = 16, hS = det.length ? 150 : 34;
    const yB = yS + hS + 22, hB = 34;
    const yW = yB + hB + 22, hW = 46;
    const comms = (C.D.committees[g.num] || []).filter(([, a, z]) => (z || "9999") >= TL.from && (a || "0") <= TL.to);
    const yT = yW + hW + 26;
    const ms = [];
    const seen = new Set();
    for (const s of g.steps) {
      const label = milestoneOf(s[2]);
      if (!label || seen.has(label + s[0])) continue;
      seen.add(label + s[0]);
      ms.push({ date: s[0], label, step: s });
    }
    // Stagger milestone labels over rows so they do not overlap.
    const rows = [];
    for (const mm of ms.sort((a, b) => a.date.localeCompare(b.date))) {
      const x = X(mm.date), w = mm.label.length * 7 + 12;
      const flip = x + w > W - R;
      const startX = flip ? x - w : x;
      let r = rows.findIndex((end) => end < startX);
      if (r === -1) { r = rows.length; rows.push(0); }
      rows[r] = flip ? x + 4 : x + w;
      mm.row = r; mm.x = x; mm.flip = flip;
    }
    const hMs = Math.max(1, rows.length) * 17 + 8;
    const yC = yT + hMs + 8, hC = comms.length * 18;
    const yV = yC + hC + (comms.length ? 10 : 0), hV = g.votes.length ? 30 : 0;
    const H = yV + hV + 30;

    const months = [];
    for (let d = new Date(t0); d.getTime() <= t1; d.setMonth(d.getMonth() + 1, 1)) months.push(new Date(d));
    const grid = months.map((mo) => {
      const iso = mo.toISOString().slice(0, 10);
      return `<line x1="${X(iso)}" x2="${X(iso)}" y1="${yS - 4}" y2="${H - 22}" class="grid"/><text x="${X(iso) + 3}" y="${H - 8}" class="ax">${mo.toLocaleDateString("es-CR", { month: "short", year: "2-digit" })}</text>`;
    }).join("");
    const laneLabel = (y, txt) => `<text x="${L - 10}" y="${y}" class="ax lane" text-anchor="end">${txt}</text>`;

    // 1. Stance of the covering news.
    const Ys = (v) => yS + (1 - (v + 1) / 2) * hS;
    let stance;
    if (det.length) {
      const roll = det.map((p) => {
        const t = new Date(p.n.date).getTime();
        const win = det.filter((q) => Math.abs(new Date(q.n.date).getTime() - t) <= 7 * 864e5);
        return `${X(p.n.date)},${Ys(mean(win.map((q) => soft(q).stance)))}`;
      });
      stance = `${laneLabel(Ys(1) + 4, "favorable")}${laneLabel(Ys(0) + 4, "neutral")}${laneLabel(Ys(-1) + 4, "crítica")}
        <line x1="${L}" x2="${W - R}" y1="${Ys(0)}" y2="${Ys(0)}" class="zero"/>
        ${roll.length > 1 ? `<polyline points="${roll.join(" ")}" fill="none" stroke="var(--ink)" stroke-opacity=".5" stroke-width="2"/>` : ""}
        ${det.map((p) => { const s = soft(p); return `<circle cx="${X(p.n.date)}" cy="${Ys(s.stance)}" r="${3.5 + p.cen * 2.5}" fill="${C.OUTLETS[p.n.outlet]?.color || "#999"}" fill-opacity=".85" stroke="#fff" stroke-width="1.5" data-pair="${p.idx}"
          ${tipAttr(`${C.esc(C.OUTLETS[p.n.outlet]?.name)} · ${p.n.day}<br><b>${C.esc(short(p.n.title, 110))}</b><br>Postura ${sg(s.stance)} · centralidad ${dec(p.cen)} · prob. ${C.fp(C.val(p))}`)}/>`; }).join("")}
        ${noDet.map((p) => `<circle cx="${X(p.n.date)}" cy="${Ys(0)}" r="4" fill="#fff" stroke="${C.OUTLETS[p.n.outlet]?.color}" stroke-width="2" data-pair="${p.idx}" ${tipAttr(`Sin detalle · ${C.esc(short(p.n.title, 100))}`)}/>`).join("")}`;
    } else {
      stance = `${laneLabel(yS + 20, "postura")}<text x="${(L + W) / 2}" y="${yS + 21}" class="ax-t" text-anchor="middle">Ninguna noticia pasa el umbral de ${C.fp(C.S.thr)} con los filtros actuales</text>
        ${noDet.map((p) => `<circle cx="${X(p.n.date)}" cy="${yS + 8}" r="4" fill="#fff" stroke="${C.OUTLETS[p.n.outlet]?.color}" stroke-width="2" data-pair="${p.idx}" ${tipAttr(`Sin detalle · ${C.esc(short(p.n.title, 100))}`)}/>`).join("")}`;
    }

    // 2. Candidates under the threshold.
    const Yb = (v) => yB + hB - ((v - 10) / Math.max(1, C.S.thr - 10)) * hB;
    const below = `${laneLabel(yB + hB / 2 + 4, "bajo umbral")}
      <line x1="${L}" x2="${W - R}" y1="${yB + hB}" y2="${yB + hB}" class="grid"/>
      ${g.below.length ? g.below.map((p) => `<circle cx="${X(p.n.date)}" cy="${Yb(C.val(p))}" r="3.5" fill="#9aa1ad" fill-opacity=".55" data-pair="${p.idx}"
        ${tipAttr(`Bajo el umbral: prob. <b>${C.fp(C.val(p))}</b> · ${C.esc(C.OUTLETS[p.n.outlet]?.name)} · ${p.n.day}<br>${C.esc(short(p.n.title, 110))}`)}/>`).join("")
        : `<text x="${L + 6}" y="${yB + hB / 2 + 4}" class="ax">ninguna candidata entre 0,10 y el umbral</text>`}`;

    // 3. Weekly coverage, stacked by outlet; under-threshold candidates in light gray on top.
    const weeks = new Map();
    for (const p of g.above) { const w = weekOf(p.n.day); const o = weeks.get(w) || {}; o[p.n.outlet] = (o[p.n.outlet] || 0) + 1; weeks.set(w, o); }
    for (const p of g.below) { const w = weekOf(p.n.day); const o = weeks.get(w) || {}; o._below = (o._below || 0) + 1; weeks.set(w, o); }
    const wmax = Math.max(1, ...[...weeks.values()].map((o) => sum(Object.values(o))));
    const bw = Math.max(3, (W - L - R) / ((t1 - t0) / (7 * 864e5)) - 2);
    const cov = `${laneLabel(yW + hW / 2 + 4, "noticias / sem.")}
      <line x1="${L}" x2="${W - R}" y1="${yW + hW}" y2="${yW + hW}" class="grid"/>
      ${[...weeks.entries()].map(([w, o]) => {
        let y = yW + hW;
        const x = X(w);
        return [...Object.keys(C.OUTLETS), "_below"].filter((k) => o[k]).map((k) => {
          const h = (o[k] / wmax) * hW;
          y -= h;
          const color = k === "_below" ? "#d6d9df" : C.OUTLETS[k].color;
          return `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(1, h - 1)}" fill="${color}" ${tipAttr(`Semana del ${w}: <b>${o[k]}</b> ${k === "_below" ? "bajo el umbral" : C.OUTLETS[k].name}`)}/>`;
        }).join("");
      }).join("")}`;

    // 4. Procedure: milestones with labels, other steps as ticks, committees, votes.
    const minor = g.steps.filter((s) => !milestoneOf(s[2]));
    const proc = `${laneLabel(yT + 12, "trámite")}
      ${minor.map((s) => `<line x1="${X(s[0])}" x2="${X(s[0])}" y1="${yT}" y2="${yT + 8}" stroke="var(--ink-3)" stroke-opacity=".5" stroke-width="1.5" ${tipAttr(`${s[0]} · ${C.esc(s[1])}<br>${C.esc(s[2])}`)}/>`).join("")}
      ${ms.map((mm) => { const y = yT + 13 + mm.row * 17; return `<g ${tipAttr(`${mm.date} · ${C.esc(mm.step[1])}<br><b>${C.esc(mm.step[2])}</b>`)}>
        <line x1="${mm.x}" x2="${mm.x}" y1="${yT}" y2="${y + 2}" stroke="var(--accent)" stroke-width="1.5"/>
        <circle cx="${mm.x}" cy="${y - 2}" r="3" fill="var(--accent)"/>
        <text x="${mm.flip ? mm.x - 6 : mm.x + 6}" y="${y + 2}" class="ms" text-anchor="${mm.flip ? "end" : "start"}">${mm.label}</text></g>`; }).join("")}
      ${comms.map(([oi, a, z], i) => {
        const xa = X(a && a > TL.from ? a : TL.from), xz = X(z && z < TL.to ? z : TL.to), y = yC + i * 18;
        const name = C.D.organs[oi][0];
        return `<g ${tipAttr(`${C.esc(name)}<br>${a || "?"} → ${z || "sigue"}`)}><rect x="${xa}" y="${y}" width="${Math.max(4, xz - xa)}" height="14" rx="4" fill="var(--accent)" fill-opacity=".14" stroke="var(--accent)" stroke-opacity=".35"/>
          <text x="${xa + 6}" y="${y + 10.5}" class="cm">${C.esc(short(name, Math.max(6, Math.floor((xz - xa) / 6))))}</text></g>`;
      }).join("")}
      ${comms.length ? laneLabel(yC + 11, "comisiones") : ""}
      ${g.votes.length ? laneLabel(yV + 15, "votaciones") : ""}
      ${g.votes.map((v) => {
        const x = X(v[2]), y = yV + 11, r = v[6] ? 7 : 4.5;
        const ok = /aprob/i.test(v[5]);
        return `<g ${tipAttr(`${v[2]} · <b>${C.esc(v[3])}</b> · ${C.esc(v[5])}<br>${C.esc(short(v[4], 140))}<br>${VOTING.filter((k) => v[7][k]).map((k) => `${actorName(k)} ${v[7][k][0]}–${v[7][k][1]}`).join(" · ")}`)}>
          <path d="M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z" fill="${ok ? DIV[4] : DIV[0]}" fill-opacity="${v[6] ? 1 : 0.5}" stroke="#fff"/>
          ${v[6] ? (x + v[3].length * 7 + 24 > W - R
            ? `<text x="${x - 9}" y="${y + 4}" class="ms" text-anchor="end">${C.esc(v[3])} ${ok ? "✓" : "✗"}</text>`
            : `<text x="${x + 9}" y="${y + 4}" class="ms">${C.esc(v[3])} ${ok ? "✓" : "✗"}</text>`) : ""}</g>`;
      }).join("")}`;

    return `<svg class="chart-svg tl" viewBox="0 0 ${W} ${H}">${grid}${stance}${below}${cov}${proc}</svg>
      <div class="legend-row">${Object.values(C.OUTLETS).map((o) => `<span><i style="background:${o.color};border-radius:50%"></i>${o.name}</span>`).join("")}
        <span><i style="background:#9aa1ad;border-radius:50%"></i>bajo umbral</span>
        <span>· tamaño: centralidad · línea: promedio de ±7 días · ◆ votación (grande = de fondo; verde aprobada, roja rechazada)</span></div>`;
  }

  function tlParties(g) {
    const det = g.above.filter((p) => p.det).sort((a, b) => a.n.date.localeCompare(b.n.date));
    if (!det.length) return `<p class="a-note">Sin noticias con detalle: no hay posiciones de los partidos que mostrar.</p>`;
    const W = 1000, L = 104, R = 16, rowA = 22;
    const t0 = new Date(TL.from + "T00:00:00").getTime(), t1 = new Date(TL.to + "T23:59:59").getTime();
    const X = (iso) => L + clamp((new Date(iso).getTime() - t0) / (t1 - t0), 0, 1) * (W - L - R);
    const H = rowA * C.ACTORS.length + 8;
    const lanes = C.ACTORS.map((k, i) => {
      const y = 4 + i * rowA;
      return `<text x="${L - 10}" y="${y + 14}" class="ax lane" text-anchor="end">${actorName(k)}</text>
        <line x1="${L}" x2="${W - R}" y1="${y + rowA / 2}" y2="${y + rowA / 2}" class="grid"/>
        ${det.map((p) => {
          const a = soft(p).actors[k];
          if (a.m < 0.3) return "";
          const v = a.lean / a.m;
          return `<rect x="${X(p.n.date) - 4}" y="${y + 3}" width="8" height="${rowA - 6}" rx="2" fill="${divColor(v)}" fill-opacity="${0.35 + a.m * 0.65}" data-pair="${p.idx}"
            ${tipAttr(`${C.L.actors[k]} · ${p.n.day}: <b>${sg(v)}</b> (mención ${dec(a.m)})<br>${C.esc(short(p.n.title, 100))}`)}/>`;
        }).join("")}`;
    }).join("");
    const agg = Object.fromEntries(C.ACTORS.map((k) => [k, { m: 0, f: 0, a: 0, lean: 0 }]));
    det.forEach((p) => C.ACTORS.forEach((k) => { const a = soft(p).actors[k], t = agg[k]; t.m += a.m; t.f += a.f; t.a += a.a; t.lean += a.lean; }));
    const rowsHtml = C.ACTORS.map((k) => {
      const a = agg[k], lm = a.m >= 0.5 ? a.lean / a.m : null;
      return `<div class="ao-row short"><span class="ao-name"><span class="dot" style="background:${actorColor(k)}"></span>${C.L.actors[k]}</span>
        <span class="ao-split" ${tipAttr(`En contra <b>${dec(a.a, 1)}</b> · a favor <b>${dec(a.f, 1)}</b> · menciones ${dec(a.m, 1)} de ${det.length}`)}><i style="flex:${a.a};background:${DIV[0]}"></i><i style="flex:${Math.max(0, a.m - a.a - a.f)};background:${DIV[2]}"></i><i style="flex:${a.f};background:${DIV[4]}"></i><i style="flex:${Math.max(0.01, det.length - a.m)};background:var(--soft)"></i></span>
        <span class="ao-lean" style="color:${divColor(lm)}">${lm == null ? "no dice" : sg(lm)}</span></div>`;
    }).join("");
    return `<svg class="chart-svg tl" viewBox="0 0 ${W} ${H}">${lanes}</svg>
      <div class="legend-row"><span><i style="background:${DIV[0]}"></i>en contra</span><span><i style="background:${DIV[2]}"></i>neutral</span><span><i style="background:${DIV[4]}"></i>a favor</span><span>· opacidad: qué tan seguro es que la noticia lo menciona</span></div>
      <div class="actor-over" style="margin-top:14px">${rowsHtml}</div>`;
  }

  function tlChronology(g) {
    const ev = [
      ...g.steps.map((s) => ({ d: s[0], kind: "step", s })),
      ...g.votes.map((v) => ({ d: v[2], kind: "vote", v })),
      ...g.above.map((p) => ({ d: p.n.date, kind: "news", p })),
      ...g.below.map((p) => ({ d: p.n.date, kind: "below", p })),
    ].sort((a, b) => b.d.localeCompare(a.d));
    if (!ev.length) return `<p class="a-note">Nada en el período.</p>`;
    return `<ul class="chrono">${ev.map((e) => {
      const day = e.d.slice(0, 10);
      if (e.kind === "step") {
        const ms = milestoneOf(e.s[2]);
        return `<li class="ev step${ms ? " ms" : ""}"><span class="d">${day}</span><span class="ic">${ms ? "●" : "·"}</span><span class="tx">${ms ? `<b>${ms}</b> · ` : ""}${C.esc(e.s[2])}<span class="mini"> · ${C.esc(e.s[1])}</span></span></li>`;
      }
      if (e.kind === "vote") {
        const v = e.v, ok = /aprob/i.test(v[5]);
        return `<li class="ev vote"><span class="d">${day}</span><span class="ic" style="color:${ok ? DIV[4] : DIV[0]}">◆</span><span class="tx"><b>${C.esc(v[3])}</b> · ${C.esc(v[5])}
          <span class="mini"> · ${VOTING.filter((k) => v[7][k]).map((k) => `${actorName(k)} ${v[7][k][0]}–${v[7][k][1]}`).join(" · ")}</span><div class="mini">${C.esc(short(v[4], 200))}</div></span></li>`;
      }
      const p = e.p, o = C.OUTLETS[p.n.outlet];
      const right = e.kind === "news" && p.det
        ? `<span class="tag stance" style="--sc:${divColor(soft(p).stance * 2)}">${sg(soft(p).stance)}</span>`
        : `<span class="tag">${C.fp(C.val(p))}</span>`;
      return `<li class="ev ${e.kind}" data-pair="${p.idx}"><span class="d">${day}</span><span class="ic" style="color:${e.kind === "below" ? "#9aa1ad" : o?.color}">${e.kind === "below" ? "○" : "●"}</span>
        <span class="tx"><span class="who" style="color:${e.kind === "below" ? "var(--ink-3)" : o?.color}">${C.esc(o?.name || p.n.outlet)}</span> ${C.esc(p.n.title)}${e.kind === "below" ? `<span class="mini"> · bajo el umbral</span>` : ""}</span>${right}</li>`;
    }).join("")}</ul>`;
  }

  function tlMainHtml() {
    const g = TL.byNum.get(st.bill);
    if (!g) return `<div class="a-card"><p class="a-note">Elegí un expediente de la lista.</p></div>`;
    const b = g.b || {};
    const prop = C.D.proponents[g.num];
    const det = g.above.filter((p) => p.det);
    const stc = det.length ? mean(det.map((p) => soft(p).stance)) : null;
    return `<div class="a-card">
        <div class="tl-head"><span class="num">${g.num}</span><a href="${C.BILL_URL}${g.num}" target="_blank" rel="noopener">${C.esc(b.name || "")}</a></div>
        <div class="tags">${b.status ? `<span class="tag">${C.esc(C.statusLabel(b.status))}</span>` : ""}${b.kind ? `<span class="tag">${C.esc(b.kind)}</span>` : ""}
          ${prop ? `<span class="tag">Proponente: ${C.esc(C.L.actors[prop[0]] || prop[0])}${prop[2] > 1 ? ` y ${prop[2] - 1} más` : ""}</span>` : ""}
          <span class="tag ${g.news ? "accent" : "warn"}">${g.news ? `${g.news} noticias` : "sin cobertura"}</span>
          ${g.below.length ? `<span class="tag">${g.below.length} bajo umbral</span>` : ""}
          <span class="tag">${g.steps.length} pasos · ${g.votes.length} votaciones en el período</span>
          ${stc != null ? `<span class="tag stance" style="--sc:${divColor(stc * 2)}">Postura media ${sg(stc)}</span>` : ""}
          ${g.news ? `<button class="tag linkish" data-ctl="openNews">Ver sus noticias →</button>` : ""}</div>
        <h3 style="margin-top:6px">Cobertura y trámite</h3>
        ${tlChart(g)}
      </div>
      <details class="a-card tl-parties" ${tl.partiesOpen ? "open" : ""}><summary><h3>Partidos y Ejecutivo según las noticias</h3></summary>${tlParties(g)}</details>
      <div class="a-card"><h3>Cronología <span class="a-sub">pasos del SIL, votaciones y noticias, de lo más reciente a lo más viejo</span></h3>${tlChronology(g)}</div>`;
  }

  function renderTlMain() {
    const el = document.getElementById("tl-main");
    if (el) el.innerHTML = tlMainHtml();
    document.querySelectorAll("#tl-items li[data-tl]").forEach((li) => li.classList.toggle("sel", +li.dataset.tl === st.bill));
  }

  function sectionTimeline(kept, base) {
    TL = timelineUniverse(kept, base);
    if (!st.bill || !TL.byNum.has(st.bill)) st.bill = tlFiltered()[0]?.num ?? null;
    const { html, count } = tlListHtml();
    return `<div class="tl-layout">
      <aside class="a-card tl-side">
        <label class="search"><svg><use href="#i-search"/></svg><input type="search" data-ctl="tlq" value="${C.esc(tl.q)}" placeholder="Número o nombre…" autocomplete="off"></label>
        <div class="chips">${TL_FILTERS.map(([k, l]) => `<button class="chip opt" data-tlf="${k}" aria-pressed="${tl.filter === k}">${l}</button>`).join("")}</div>
        <div class="tl-sortrow"><span id="tl-count">${C.nf(count)} expedientes</span>
          <select data-ctl="tlSort">${TL_SORTS.map(([k, l]) => `<option value="${k}"${tl.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <ul class="tl-items" id="tl-items">${html}</ul>
        <p class="mini" style="margin:8px 0 0">↑ ↓ para pasar de expediente. Barras: noticias por semana; marcas abajo: pasos y votaciones.</p>
      </aside>
      <div class="tl-main" id="tl-main">${tlMainHtml()}</div>
    </div>`;
  }

  function selectBill(num, scrollList) {
    st.bill = num;
    renderTlMain();
    if (scrollList) document.querySelector(`#tl-items li[data-tl="${num}"]`)?.scrollIntoView({ block: "nearest" });
  }

  // ---------- render ----------
  let lastKept = [];
  let lastBase = [];
  function render(kept, base) {
    C = window.JEV_CTX;
    lastKept = kept;
    lastBase = base || kept;
    const det = kept.filter((p) => p.det);
    const aggs = billAggregates(det, kept);
    const body = {
      parties: () => sectionParties(det, aggs),
      votes: () => sectionVotes(aggs),
      outlets: () => sectionOutlets(det, kept, aggs),
      bills: () => sectionBills(det, kept),
      proponents: () => sectionProponents(det, aggs),
      cross: () => sectionCross(aggs),
      polemic: () => sectionPolemic(aggs),
      timeline: () => sectionTimeline(kept, lastBase),
    }[st.section]();
    const el = document.getElementById("analysis");
    el.innerHTML = `
      <div class="a-nav">
        <div class="a-tabs">${SECTIONS.map(([k, l]) => `<button data-sec="${k}" aria-pressed="${st.section === k}">${l}</button>`).join("")}</div>
        ${st.section !== "timeline" ? `<label class="a-min" ${tipAttr("Mínimo de noticias para que un expediente entre en rankings, cruces y polémicos")}>Mín. noticias <input type="number" min="1" max="200" value="${st.min}" data-ctl="min"></label>` : ""}
      </div>
      <p class="a-scope">${C.nf(det.length)} pares con detalle de ${C.nf(kept.length)} que pasan los filtros · ${C.nf(aggs.length)} expedientes con cobertura · ponderado por probabilidad.
        ${C.S.mention !== "explicit" ? `<button class="linkish" data-ctl="onlyExplicit">Ver solo menciones explícitas</button>` : ""}</p>
      ${body}`;
  }

  // Opens a bill's timeline from anywhere on the page.
  function showTimeline(num) {
    C = window.JEV_CTX;
    st.section = "timeline";
    st.bill = num;
    tl.q = "";
    tl.filter = "all";
    C.goTo("analysis");
    requestAnimationFrame(() => {
      root().scrollIntoView({ block: "start" });
      document.querySelector(`#tl-items li[data-tl="${num}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  // ---------- events (delegated once) ----------
  function rerender() { render(lastKept, lastBase); }
  const root = () => document.getElementById("analysis");
  addEventListener("load", () => {
    const el = root();
    el.addEventListener("click", (e) => {
      const t = e.target;
      const sec = t.closest("[data-sec]");
      if (sec) { st.section = sec.dataset.sec; return rerender(); }
      const seg = t.closest("[data-ctl='voteSet'] button");
      if (seg) { st.voteSet = seg.dataset.v; return rerender(); }
      const cell = t.closest("[data-cell]");
      if (cell) { st.cell = st.cell === cell.dataset.cell ? null : cell.dataset.cell; return rerender(); }
      if (t.closest("[data-ctl='cellClose']")) { st.cell = null; return rerender(); }
      const xy = t.closest("[data-xy]");
      if (xy) { [st.x, st.y] = xy.dataset.xy.split("|"); return rerender(); }
      const organ = t.closest("[data-organ]");
      if (organ) { const oi = +organ.dataset.organ; st.committee = st.committee === oi ? null : oi; return rerender(); }
      const tlf = t.closest("[data-tlf]");
      if (tlf) {
        tl.filter = tlf.dataset.tlf;
        tl.shown = 300;
        el.querySelectorAll("[data-tlf]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tlf === tl.filter)));
        return renderTlList();
      }
      if (t.closest("[data-ctl='tlMore']")) { tl.shown += 300; return renderTlList(); }
      const item = t.closest("[data-tl]");
      if (item) return selectBill(+item.dataset.tl, false);
      if (t.closest("[data-ctl='openNews']")) return C.goTo("bill", String(st.bill));
      if (t.closest("[data-ctl='onlyExplicit']")) { C.S.mention = "explicit"; return C.refresh(); }
      const pair = t.closest("[data-pair]");
      if (pair) return C.openPanel(C.pairs[+pair.dataset.pair]);
      const bill = t.closest("[data-bill]");
      if (bill && !t.closest("a")) return showTimeline(+bill.dataset.bill);
    });
    el.addEventListener("toggle", (e) => {
      if (e.target.classList?.contains("tl-parties")) tl.partiesOpen = e.target.open;
    }, true);
    el.addEventListener("input", (e) => {
      if (e.target.dataset.ctl !== "tlq") return;
      tl.q = e.target.value;
      tl.shown = 300;
      renderTlList();
    });
    el.addEventListener("change", (e) => {
      const ctl = e.target.dataset.ctl;
      if (!ctl || ctl === "tlq") return;
      if (ctl === "tlSort") { tl.sort = e.target.value; return renderTlList(); }
      if (ctl === "min") st.min = Math.max(1, +e.target.value || 1);
      else st[ctl] = e.target.value;
      rerender();
    });
    // Arrow keys move through the bill list while the timeline is open.
    addEventListener("keydown", (e) => {
      if (st.section !== "timeline" || root().hidden || !TL) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const tgt = e.target instanceof Element ? e.target : document.body;
      if (tgt.closest("select, textarea") || (tgt.tagName === "INPUT" && tgt.dataset.ctl !== "tlq")) return;
      if (document.getElementById("panel")?.classList.contains("open")) return;
      const xs = tlFiltered().slice(0, tl.shown);
      if (!xs.length) return;
      e.preventDefault();
      const i = xs.findIndex((g) => g.num === st.bill);
      const next = xs[clamp(i + (e.key === "ArrowDown" ? 1 : -1), 0, xs.length - 1)];
      selectBill(next.num, true);
    });
  });

  window.JEV_ANALYSIS = { render, showTimeline };
})();
