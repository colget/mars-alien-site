// sky.js -- the sky tracker page.
import {
  PLANETS, dateToJd, jdToDate, fmtDay, monthWindow, planetXYZ, planetOrbit, bodyXYZ, bodyOrbit,
  geometry, skyPhrase, describePlanet, describeBody, fetchSmallBodies,
} from "./astro.js?v=3";
import { Orrery, PLANET_COLOURS, PLANET_SIZES, COMET_COLOURS, ASTEROID_COLOURS } from "./orrery.js?v=3";
import { loadApproaches, renderApproaches } from "./approaches.js?v=5";

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- the window
const now = new Date();
const jdNow = dateToJd(now);
const { start, end } = monthWindow(now);
const jd0 = dateToJd(start), jd1 = dateToJd(end);
const jds = [];
for (let jd = jd0; jd < jd1; jd += 0.5) jds.push(jd);
const iToday = jds.reduce((bi, jd, i) => (Math.abs(jd - jdNow) < Math.abs(jds[bi] - jdNow) ? i : bi), 0);
const segGrid = jds.filter((_, i) => i % 2 === 0);

const longDate = (d) => d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
$("window-note").textContent = `${longDate(start)} to ${longDate(new Date(end - 86400000))}`;

// ---------------------------------------------------------------- objects
const objects = new Map();   // id -> drawable object
for (const name of PLANETS) {
  objects.set(name, {
    id: name, name, kind: "planet", color: PLANET_COLOURS[name], size: PLANET_SIZES[name],
    pos: (jd) => planetXYZ(name, jd),
    orbit: planetOrbit(name, (jd0 + jd1) / 2),
    segment: segGrid.map((jd) => planetXYZ(name, jd)),
  });
}

// ---------------------------------------------------------------- selection (remembered per browser)
const DEFAULT = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn"];
let selected;
try { selected = new Set(JSON.parse(localStorage.getItem("sky-selection")) || DEFAULT); }
catch { selected = new Set(DEFAULT); }
let firstVisit = true;
try { firstVisit = localStorage.getItem("sky-selection") === null; } catch { /* storage blocked */ }
const saveSelection = () => { try { localStorage.setItem("sky-selection", JSON.stringify([...selected])); } catch { /* blocked */ } };

function pickRow(obj, nameHtml, notes) {
  const li = document.createElement("li");
  li.innerHTML = `<label><input type="checkbox"><span class="swatch"></span><span class="pick-name"></span><ul class="pick-notes"></ul></label>`;
  const box = li.querySelector("input");
  box.checked = selected.has(obj.id);
  box.addEventListener("change", () => {
    if (box.checked) selected.add(obj.id); else selected.delete(obj.id);
    saveSelection(); refreshScene(); if (zoomMode !== "custom") applyZoom(zoomMode);
  });
  li.querySelector(".swatch").style.background = obj.color;
  li.querySelector(".pick-name").innerHTML = nameHtml;
  const ul = li.querySelector(".pick-notes");
  for (const n of notes) {
    const item = document.createElement("li");
    item.textContent = n.text;
    if (n.event) item.className = "event";
    ul.append(item);
  }
  return li;
}

const eventNote = (ev) => ({ text: `${fmtDay(ev.jd)}: ${ev.title}, ${ev.detail}`, event: true });

for (const name of PLANETS) {
  const d = describePlanet(name, jds, iToday);
  $("planet-picks").append(pickRow(objects.get(name), name, [...d.events.map(eventNote), { text: d.now }]));
}

// ---------------------------------------------------------------- comets & asteroids
const escape = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

fetchSmallBodies(jds).then(({ bodies, updated }) => {
  const status = $("sb-status");
  if (updated) $("sb-updated").textContent = `NASA/JPL data downloaded ${longDate(new Date(updated))}.`;
  if (!bodies.length) {
    status.textContent = "Nothing bright enough for binoculars or a small telescope this month. Check back next month.";
    return;
  }
  status.remove();
  let c = 0, a = 0;
  for (const b of bodies) {
    const id = `sb:${b.name}`;
    const color = b.kind === "comet" ? COMET_COLOURS[c++ % COMET_COLOURS.length] : ASTEROID_COLOURS[a++ % ASTEROID_COLOURS.length];
    const obj = {
      id, name: b.name, kind: b.kind, color, size: 3.5,
      pos: (jd) => bodyXYZ(b.el, jd), orbit: bodyOrbit(b.el),
      segment: segGrid.map((jd) => bodyXYZ(b.el, jd)), magFn: b.magFn,
    };
    objects.set(id, obj);
    const d = describeBody(b, jds, iToday);
    $("body-picks").append(pickRow(obj, `${escape(b.name)} <span class="pick-kind">${b.kind}</span>`,
      [{ text: d.peak }, ...d.events.map(eventNote), { text: d.now }]));
  }
  // first visit: show the two brightest straight away
  if (firstVisit) {
    bodies.slice(0, 2).forEach((b) => selected.add(`sb:${b.name}`));
    document.querySelectorAll("#body-picks input").forEach((box, k) => { box.checked = k < 2; });
  }
  refreshScene();
  if (zoomMode !== "custom") applyZoom(zoomMode);
}).catch((err) => {
  const status = $("sb-status");
  status.className = "status error";
  status.textContent = `No comets or asteroids to show: ${err.message}. The planets still work.`;
});

// ---------------------------------------------------------------- close approaches
const monthName = (d) => d.toLocaleDateString(undefined, { month: "long", timeZone: "UTC" });
const windowLabel = `${monthName(start)} and ${monthName(new Date(end - 86400000))}`;
loadApproaches().then((data) => {
  renderApproaches(data, { jd0, jd1, jdNow, windowLabel },
    { summary: $("flybys-summary"), list: $("flyby-list"), more: $("flybys-more"), note: $("flybys-updated") });
}).catch((err) => {
  $("flybys-summary").textContent = `No close approaches to show: ${err.message}.`;
});

// ---------------------------------------------------------------- drawing
const orrery = new Orrery($("sky"), { sightlines: true, starCount: 420 });

function refreshScene() {
  orrery.setObjects([...objects.values()].filter((o) => selected.has(o.id)));
  buildReadout();
  orrery.draw(state.t);
}

// zoom presets
let zoomMode = "belt";
function fitLim() {
  let reach = 1.15;
  for (const o of objects.values()) {
    if (!selected.has(o.id)) continue;
    for (const p of o.segment) reach = Math.max(reach, Math.hypot(p[0], p[1]));
  }
  return reach * 1.12;
}
function applyZoom(mode) {
  zoomMode = mode;
  const lim = { inner: 1.9, belt: 3.7 }[mode] ?? fitLim();
  orrery.setView(lim);
  document.querySelectorAll("[data-zoom]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.zoom === mode)));
  orrery.draw(state.t);
}
document.querySelectorAll("[data-zoom]").forEach((b) => b.addEventListener("click", () => applyZoom(b.dataset.zoom)));

// wheel / pinch zoom
const canvas = $("sky");
function zoomBy(factor) {
  zoomMode = "custom";
  document.querySelectorAll("[data-zoom]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  orrery.setView(Math.min(60, Math.max(0.4, orrery.lim * factor)));
  orrery.draw(state.t);
}
canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomBy(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
const touches = new Map();
let pinchStart = null;
canvas.addEventListener("pointerdown", (e) => { touches.set(e.pointerId, e); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, e);
  if (touches.size === 2) {
    const [p, q] = [...touches.values()];
    const dist = Math.hypot(p.clientX - q.clientX, p.clientY - q.clientY);
    if (pinchStart) zoomBy(pinchStart / dist);
    pinchStart = dist;
  }
});
const endPointer = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinchStart = null; };
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

// ---------------------------------------------------------------- time
const state = { t: jdNow, playing: !reduceMotion, speed: 2 };
const scrub = $("scrub");
scrub.min = jd0; scrub.max = jd1; scrub.value = jdNow;

const playBtn = $("play");
function setPlaying(p) { state.playing = p; playBtn.textContent = p ? "Pause" : "Play"; }
setPlaying(state.playing);
playBtn.addEventListener("click", () => setPlaying(!state.playing));
$("speed").addEventListener("change", (e) => { state.speed = parseFloat(e.target.value); });
$("today").addEventListener("click", () => { state.t = jdNow; drawNow(); });
scrub.addEventListener("input", () => { state.t = parseFloat(scrub.value); drawNow(); });
document.addEventListener("keydown", (e) => {
  if (e.key === " " && !e.target.closest("button, input, select, textarea")) { e.preventDefault(); setPlaying(!state.playing); }
});

function drawNow() {
  orrery.draw(state.t);
  const d = jdToDate(state.t);
  $("date-main").textContent = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  $("date-sub").textContent = Math.abs(state.t - jdNow) < 0.5 ? "Today" : `${Math.round(state.t - jdNow) > 0 ? "+" : ""}${Math.round(state.t - jdNow)} days from today`;
  if (document.activeElement !== scrub) scrub.value = state.t;
}

// ---------------------------------------------------------------- readout table
let readoutRows = [];
function buildReadout() {
  const tbody = $("readout");
  tbody.innerHTML = "";
  readoutRows = [];
  for (const o of objects.values()) {
    if (!selected.has(o.id) || o.id === "Earth") continue;
    const tr = document.createElement("tr");
    tr.innerHTML = "<td></td><td></td><td></td><td></td>";
    tr.children[0].textContent = o.name;
    tbody.append(tr);
    readoutRows.push({ o, cells: tr.children });
  }
  updateReadout();
}
function updateReadout() {
  const E = planetXYZ("Earth", state.t);
  for (const { o, cells } of readoutRows) {
    const g = geometry(o.pos(state.t), E);
    cells[1].textContent = `${g.delta.toFixed(2)} AU`;
    cells[2].textContent = o.magFn ? o.magFn(g).toFixed(1) : "";
    cells[3].textContent = skyPhrase(g.elong, g.east).replace(/^in the /, "");
  }
}

// ---------------------------------------------------------------- loop
let last = performance.now(), sinceReadout = 0;
function frame(ts) {
  const dt = Math.min(0.1, (ts - last) / 1000);
  last = ts;
  if (state.playing) {
    state.t += state.speed * dt;
    if (state.t > jd1) state.t = jd0;
  }
  drawNow();
  sinceReadout += dt;
  if (sinceReadout > 0.25) { updateReadout(); sinceReadout = 0; }
  requestAnimationFrame(frame);
}

document.fonts.ready.then(() => {
  refreshScene();
  applyZoom("belt");
  requestAnimationFrame(frame);
});
