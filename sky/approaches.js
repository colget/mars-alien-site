// approaches.js -- near-Earth objects passing close to Earth.
// Data: JPL's Close-Approach Data API, downloaded daily by
// scripts/update_small_bodies.py into sky/data/close-approaches.json.
import { fmtDay, jdToDate } from "./astro.js?v=4";

const AU_KM = 149597870.7;
const TDB_MINUS_UTC_DAYS = 69.184 / 86400;  // JPL times are TDB, which runs ~69 s ahead of UTC

/** Closest-approach time as a UTC Date, rounded to the nearest minute. */
function utcMinute(jd) {
  const ms = jdToDate(jd - TDB_MINUS_UTC_DAYS).getTime();
  return new Date(Math.round(ms / 60000) * 60000);
}
export const LUNAR_DISTANCE_KM = 384400;    // the average distance to the Moon

/** Load the daily file and turn each row into a tidy object. */
export async function loadApproaches() {
  let res;
  try { res = await fetch("/sky/data/close-approaches.json", { cache: "no-cache" }); }
  catch { throw new Error("couldn't load the close-approach data"); }
  if (res.status === 404) throw new Error("the close-approach data hasn't been downloaded yet");
  if (!res.ok) throw new Error(`close-approach data returned HTTP ${res.status}`);
  const file = await res.json();

  // Orbits (when the robot managed to fetch them): designation -> elements in radians
  const orbits = new Map();
  const of = file.orbits?.fields || [];
  for (const row of file.orbits?.data || []) {
    const o = Object.fromEntries(of.map((f, k) => [f, parseFloat(row[k])]));
    const deg = Math.PI / 180;
    if ([o.e, o.q, o.i, o.om, o.w, o.tp].every(Number.isFinite)) {
      orbits.set(row[0], { e: o.e, q: o.q, i: o.i * deg, om: o.om * deg, w: o.w * deg, tp: o.tp });
    }
  }

  const list = (file.data || []).map((row) => {
    const r = Object.fromEntries(file.fields.map((f, k) => [f, row[k]]));
    return {
      orbit: orbits.get(r.des) || null,
      des: r.des,
      name: cleanName(r.fullname || r.des),
      jd: parseFloat(r.jd),
      distAU: parseFloat(r.dist),
      speedKmS: parseFloat(r.v_rel),
      h: parseFloat(r.h),
      diameterKm: r.diameter === null ? null : parseFloat(r.diameter),
      timeUncertain: /^\d+_/.test(r.t_sigma_f || ""),   // "2_05:10" = uncertain by days
    };
  });
  return { updated: file.updated, distMaxAU: file.distMaxAU, list };
}

/** "       (2026 TZ)" -> "2026 TZ";  "433 Eros (A898 PA)" -> "433 Eros" */
function cleanName(full) {
  const s = full.trim();
  if (/^\(.*\)$/.test(s)) return s.slice(1, -1);
  if (/^\d+\s+[A-Za-z]/.test(s)) return s.replace(/\s*\([^)]*\)$/, "");
  return s;
}

// ---------------------------------------------------------------- plain-English formatting

export const toLunarDistances = (au) => (au * AU_KM) / LUNAR_DISTANCE_KM;

export function formatLD(au) {
  const ld = toLunarDistances(au);
  return ld < 10 ? ld.toFixed(1) : String(Math.round(ld));
}

export function formatKm(km) {
  if (km >= 1e6) return `${(km / 1e6).toFixed(1)} million km`;
  const rounded = Number(km.toPrecision(2));
  return `${rounded.toLocaleString("en-GB")} km`;
}

/**
 * Size from brightness. An asteroid's absolute magnitude H says how bright it
 * is, not how big: a small shiny rock and a bigger dark one can look the same.
 * So we give a range, for surfaces between dark (5% of light reflected) and
 * bright (25%):  diameter (km) = 1329 / sqrt(reflectivity) x 10^(-H / 5)
 */
export function sizeRangeMetres(h) {
  const d = (albedo) => (1329 / Math.sqrt(albedo)) * 10 ** (-h / 5) * 1000;
  return [d(0.25), d(0.05)];
}

function formatLength(m) {
  if (m >= 1000) return `${Number((m / 1000).toPrecision(2))} km`;
  return `${Number(m.toPrecision(2))} m`;
}

export function formatSize(a) {
  if (a.diameterKm) return `${formatLength(a.diameterKm * 1000)} across (measured)`;
  if (!Number.isFinite(a.h)) return "size unknown";
  const [low, high] = sizeRangeMetres(a.h);
  const [lo, hi] = [formatLength(low), formatLength(high)];
  // "9.4 m" and "21 m" -> "9.4–21 m"; mixed units keep both
  const unit = (s) => s.split(" ")[1];
  return unit(lo) === unit(hi) ? `about ${lo.split(" ")[0]}–${hi} across` : `about ${lo}–${hi} across`;
}

export function formatSpeed(kmS) {
  const kmh = Number((kmS * 3600).toPrecision(2)).toLocaleString("en-GB");
  return `${kmS < 10 ? kmS.toFixed(1) : Math.round(kmS)} km/s (${kmh} km/h)`;
}

const largestFirst = (a, b) =>
  (b.diameterKm ?? sizeRangeMetres(b.h)[1] / 1000) - (a.diameterKm ?? sizeRangeMetres(a.h)[1] / 1000);

// ---------------------------------------------------------------- rendering

const SHOW_FIRST = 8;

/**
 * Fill the "Close approaches" section for the visitor's window [jd0, jd1).
 * els = { summary, list, more, note }
 */
export function renderApproaches(data, { jd0, jd1, jdNow, windowLabel, onWatch }, els) {
  const inWindow = data.list.filter((a) => a.jd >= jd0 && a.jd < jd1).sort((a, b) => a.jd - b.jd);
  const limitLD = Math.round(toLunarDistances(data.distMaxAU) * 10) / 10;

  if (!inWindow.length) {
    els.summary.textContent = `No known near-Earth objects pass within ${limitLD} lunar distances of Earth in ${windowLabel}.`;
    return;
  }

  const closest = inWindow.reduce((best, a) => (a.distAU < best.distAU ? a : best));
  const largest = [...inWindow].sort(largestFirst)[0];
  els.summary.textContent =
    `${inWindow.length} known near-Earth objects pass within ${limitLD} lunar distances of Earth in ${windowLabel}. ` +
    `Closest: ${closest.name}, ${formatLD(closest.distAU)} lunar distances on ${fmtDay(closest.jd)}. ` +
    `Largest: ${largest.name}, ${formatSize(largest)} on ${fmtDay(largest.jd)}.`;

  const upcoming = inWindow.filter((a) => a.jd >= jdNow);
  const firstView = upcoming.slice(0, SHOW_FIRST);

  const draw = (items) => {
    els.list.replaceChildren(...items.map((a) => approachItem(a, jdNow, a === closest, a === largest, onWatch)));
  };
  draw(firstView.length ? firstView : inWindow.slice(-SHOW_FIRST));

  if (inWindow.length > firstView.length) {
    els.more.hidden = false;
    els.more.textContent = `Show all ${inWindow.length} in ${windowLabel}`;
    els.more.onclick = () => {
      draw(inWindow);
      els.more.hidden = true;
    };
  }
  if (data.updated) {
    els.note.textContent = `NASA/JPL close-approach data downloaded ${new Date(data.updated)
      .toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.`;
  }
}

function approachItem(a, jdNow, isClosest, isLargest, onWatch) {
  const li = document.createElement("li");
  if (a.jd < jdNow) li.className = "past";

  const when = document.createElement("div");
  when.className = "when";
  const day = document.createElement("time");
  const date = utcMinute(a.jd);
  day.dateTime = date.toISOString();
  day.textContent = fmtDay(a.jd);
  const time = document.createElement("small");
  time.textContent = a.timeUncertain
    ? "time uncertain"
    : `${date.toISOString().slice(11, 16)} UTC`;
  when.append(day, time);

  const what = document.createElement("div");
  const title = document.createElement("strong");
  const link = document.createElement("a");
  link.href = `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(a.des)}`;
  link.textContent = a.name;
  link.rel = "noopener";
  title.append(link);
  for (const [flag, label] of [[isClosest, "closest"], [isLargest, "largest"]]) {
    if (!flag) continue;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = label;
    title.append(" ", tag);
  }
  const detail = document.createElement("span");
  const km = formatKm(a.distAU * AU_KM);
  const verb = a.jd < jdNow ? "Passed" : "Passes";
  detail.textContent =
    `${verb} ${formatLD(a.distAU)} lunar distances away (${km}). ` +
    `${formatSize(a).replace(/^./, (c) => c.toUpperCase())}, moving at ${formatSpeed(a.speedKmS)}.`;
  what.append(title, detail);
  if (a.orbit && onWatch) {
    const watch = document.createElement("button");
    watch.type = "button";
    watch.className = "watch";
    watch.textContent = "Watch it pass on the map";
    watch.addEventListener("click", () => onWatch(a));
    what.append(watch);
  }

  li.append(when, what);
  return li;
}
