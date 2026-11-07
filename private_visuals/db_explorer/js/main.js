// Explorer for private_corpus.db: one section per entity (bills, deputies, organs, news), each with a
// list on the left and a detail pane on the right. Routing by hash:
//   #/bills  #/bill/23000   #/deputies  #/deputy/<person_id>   #/organs  #/organ/<code>   #/news  #/news/<id>
// Every reference to another entity is a link to its route (see util.link).
import { $, esc, icon, loading, emptyTab } from "./util.js";
import bills from "./bills.js";
import deputies from "./deputies.js";
import organs from "./organs.js";
import news from "./news.js";

const SECTIONS = [bills, deputies, organs, news];
const byList = Object.fromEntries(SECTIONS.map((s) => [s.listRoute, s]));
const byItem = Object.fromEntries(SECTIONS.map((s) => [s.route, s]));

let section = null;       // current section
let current = null;       // id of the open item (string)
let items = [];           // items rendered in the list, in order
let total = 0;
let token = 0;            // invalidates stale list loads
let busy = false;

const setToolbarH = () => document.documentElement.style.setProperty("--toolbar-h", document.querySelector(".toolbar").offsetHeight + "px");
addEventListener("resize", setToolbarH);

$("nav").innerHTML = SECTIONS.map((s) => `<a href="#/${s.listRoute}" data-s="${s.listRoute}">${s.label}</a>`).join("");

// ---------- routing ----------
async function route() {
  const [, kind = "", ...rest] = location.hash.replace(/^#/, "").split("/");
  const key = decodeURIComponent(rest.join("/"));
  const target = byItem[kind] || byList[kind] || bills;
  const id = byItem[kind] && key ? key : null;
  if (target !== section) await enter(target);
  if (id) openItem(id);
  else closeItem();
}

async function enter(s) {
  section = s;
  current = null;
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.s === s.listRoute));
  document.title = `${s.label} · Explorador del corpus`;
  $("toolbar").innerHTML = "";
  $("stats").innerHTML = "";
  $("list").innerHTML = "";
  $("result-line").textContent = "Cargando…";
  $("empty").hidden = true;
  $("detail").innerHTML = `<div class="placeholder">${icon(s.icon)}<p>${esc(s.placeholder)}</p></div>`;
  try {
    await s.init();
  } catch (e) {
    console.error(e);
    return fail();
  }
  if (section !== s) return;
  $("stats").innerHTML = s.stats().map(([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  $("toolbar").innerHTML = s.toolbar();
  s.bind($("toolbar"), refresh);
  setToolbarH();
  await refresh();
}

function fail() {
  $("layout").hidden = true;
  document.querySelector(".toolbar").hidden = true;
  $("error").hidden = false;
}

// ---------- list ----------
const nearEnd = () => $("sentinel").getBoundingClientRect().top < innerHeight + 600;

async function refresh() {
  const my = ++token;
  items = []; total = 0;
  $("list").innerHTML = "";
  const page = await section.page(0);
  if (my !== token) return;
  total = page.total;
  $("result-line").textContent = section.countLine(total);
  $("empty").hidden = total > 0;
  $("empty").querySelector("p").textContent = `Ningún resultado coincide con los filtros.`;
  append(page.items);
  while (items.length < total && nearEnd()) if (!(await more())) break;
}

function append(list) {
  items.push(...list);
  $("list").insertAdjacentHTML("beforeend", list.map((it) => section.row(it, String(section.idOf(it)) === current)).join(""));
}

async function more() {
  if (busy || items.length >= total) return false;
  busy = true;
  const my = token;
  try {
    const page = await section.page(items.length);
    if (my !== token) return false;
    append(page.items);
    return page.items.length > 0;
  } finally { busy = false; }
}

addEventListener("scroll", () => { if (section && nearEnd()) more(); }, { passive: true });

// ---------- detail ----------
function markActive() {
  document.querySelectorAll(".row.active").forEach((r) => r.classList.remove("active"));
  const row = current && document.querySelector(`.row[data-id="${CSS.escape(current)}"]`);
  if (row) { row.classList.add("active"); row.scrollIntoView({ block: "nearest" }); }
}

async function openItem(id) {
  current = String(id);
  markActive();
  $("layout").classList.add("show-detail");
  const pane = $("detail");
  const s = section;
  pane.innerHTML = loading(`Cargando…`);
  let data;
  try {
    data = await s.load(id);
  } catch (e) {
    console.error(e);
    if (current === String(id)) pane.innerHTML = emptyTab("empty", `No se encontró ${esc(s.nounOne)} ${esc(id)}.`);
    return;
  }
  if (current !== String(id) || section !== s) return;
  s.detail(pane, data);
  if (innerWidth <= 900) scrollTo({ top: 0 });
}

function closeItem() {
  current = null;
  $("layout").classList.remove("show-detail");
  markActive();
}

// j/k: next/previous item in the list.
function step(d) {
  const i = items.findIndex((it) => String(section.idOf(it)) === current);
  const next = items[i + d];
  if (next) location.hash = section.href(section.idOf(next));
}

addEventListener("keydown", (e) => {
  const q = $("q");
  if (e.key === "/" && q && document.activeElement !== q) { e.preventDefault(); q.focus(); q.select(); }
  if (e.key === "Escape" && document.activeElement === q) q.blur();
  if ((e.key === "j" || e.key === "k") && document.activeElement === document.body && current) step(e.key === "j" ? 1 : -1);
  // Enter in the search box: open the exact id if the section supports it (bill numbers).
  if (e.key === "Enter" && document.activeElement === q && section.exact) {
    const id = section.exact(q.value.trim());
    if (id != null) location.hash = section.href(id);
  }
});

addEventListener("hashchange", route);
setToolbarH();
route();

