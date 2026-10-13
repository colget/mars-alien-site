// astro.js -- orbit maths shared by the home page and the sky tracker.
// A browser port of sky_tracker.py (github.com/colget/sky_tracker).
//
// Positions: heliocentric J2000 ecliptic coordinates in AU.
// Planets use JPL's approximate Keplerian elements (Standish, valid 1800-2050).
// Comets/asteroids use JPL Small-Body Database osculating elements (two-body).

export const K_GAUSS = 0.01720209895; // AU^1.5 / day
export const J2000 = 2451545.0;
const DEG = Math.PI / 180;

// a, e, I, L, long.peri, long.node, then rates per Julian century
const STANDISH = {
  Mercury: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593,
            0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  Venus:   [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255,
            0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  Earth:   [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0,
            0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  Mars:    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
            0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  Jupiter: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
            -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  Saturn:  [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
            -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  Uranus:  [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503,
            -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  Neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574,
            0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
};
export const PLANETS = Object.keys(STANDISH);

// ---------------------------------------------------------------- time
export const dateToJd = (d) => d.getTime() / 86400000 + 2440587.5;
export const jdToDate = (jd) => new Date((jd - 2440587.5) * 86400000);

/** 00:00 UTC on the 1st of this month -> 00:00 UTC on the 1st of the month after next. */
export function monthWindow(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 2, 1)) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDay = (jd) => { const d = jdToDate(jd); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

// ---------------------------------------------------------------- mechanics
/** Kepler's equation E - e sin E = M, Newton's method. */
function solveElliptic(M, e) {
  M = ((M + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = e > 0.8 ? Math.PI * Math.sign(M) : M + e * Math.sin(M);
  for (let k = 0; k < 40; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

/** Rotate orbit-plane (xp, yp) into the ecliptic frame. */
function toEcliptic(xp, yp, i, om, w) {
  const cw = Math.cos(w), sw = Math.sin(w), co = Math.cos(om), so = Math.sin(om);
  const ci = Math.cos(i), si = Math.sin(i);
  return [
    (co * cw - so * sw * ci) * xp + (-co * sw - so * cw * ci) * yp,
    (so * cw + co * sw * ci) * xp + (-so * sw + co * cw * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

function planetElements(name, jd) {
  const p = STANDISH[name], T = (jd - J2000) / 36525;
  const [a, e, inc, L, peri, node] = [0, 1, 2, 3, 4, 5].map((k) => p[k] + p[k + 6] * T);
  const M = ((L - peri + 180) % 360 + 360) % 360 - 180;
  return { a, e, i: inc * DEG, om: node * DEG, w: (peri - node) * DEG, M: M * DEG };
}

export function planetXYZ(name, jd) {
  const { a, e, i, om, w, M } = planetElements(name, jd);
  const E = solveElliptic(M, e);
  return toEcliptic(a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E), i, om, w);
}

export function planetOrbit(name, jd, n = 240) {
  const { a, e, i, om, w } = planetElements(name, jd);
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const E = (2 * Math.PI * k) / n;
    pts.push(toEcliptic(a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E), i, om, w));
  }
  return pts;
}

/** Small body from {e, q, i, om, w (radians), tp (JD)} -- ellipse, parabola or hyperbola. */
export function bodyXYZ(el, jd) {
  const t = jd - el.tp, { e, q } = el;
  let xp, yp;
  if (e < 0.9999) {
    const a = q / (1 - e);
    const E = solveElliptic((K_GAUSS / a ** 1.5) * t, e);
    xp = a * (Math.cos(E) - e); yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  } else if (e > 1.0001) {
    const a = q / (e - 1), M = (K_GAUSS / a ** 1.5) * t;
    let H = Math.sign(M) * Math.log((2 * Math.abs(M)) / e + 1.8);
    for (let k = 0; k < 50; k++) H -= (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
    xp = a * (e - Math.cosh(H)); yp = a * Math.sqrt(e * e - 1) * Math.sinh(H);
  } else { // Barker's equation
    const B = (K_GAUSS * t) / Math.sqrt(2 * q ** 3);
    const Y = Math.cbrt(1.5 * B + Math.sqrt(1 + 2.25 * B * B)), D = Y - 1 / Y;
    xp = q * (1 - D * D); yp = 2 * q * D;
  }
  return toEcliptic(xp, yp, el.i, el.om, el.w);
}

export function bodyOrbit(el, n = 360, rMax = 60) {
  const { e, q } = el, pts = [];
  if (e < 1) {
    const a = q / (1 - e);
    for (let k = 0; k <= n; k++) {
      const E = (2 * Math.PI * k) / n;
      pts.push(toEcliptic(a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E), el.i, el.om, el.w));
    }
  } else {
    const nuMax = e > 1 ? Math.acos(-1 / e) * 0.98 : Math.PI * 0.98;
    for (let k = 0; k <= n; k++) {
      const nu = -nuMax + (2 * nuMax * k) / n, r = (q * (1 + e)) / (1 + e * Math.cos(nu));
      if (r < rMax) pts.push(toEcliptic(r * Math.cos(nu), r * Math.sin(nu), el.i, el.om, el.w));
    }
  }
  return pts;
}

const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** r, delta (AU), elongation (deg), phase angle (rad), east-of-Sun (evening sky). */
export function geometry(P, E) {
  const G = [P[0] - E[0], P[1] - E[1], P[2] - E[2]];
  const r = norm(P), delta = norm(G), rE = norm(E);
  const elong = Math.acos(Math.max(-1, Math.min(1, -dot(G, E) / (delta * rE)))) / DEG;
  const phase = Math.acos(Math.max(-1, Math.min(1, dot(P, G) / (r * delta))));
  const diff = Math.atan2(G[1], G[0]) - Math.atan2(-E[1], -E[0]);
  const east = ((diff % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) < Math.PI;
  return { r, delta, elong, phase, east };
}

export function asteroidMag(H, G, r, delta, phase) {
  const th = Math.tan(phase / 2);
  const p1 = Math.exp(-3.33 * th ** 0.63), p2 = Math.exp(-1.87 * th ** 1.22);
  return H + 5 * Math.log10(r * delta) - 2.5 * Math.log10((1 - G) * p1 + G * p2);
}
export const cometMag = (M1, K1, r, delta) => M1 + 5 * Math.log10(delta) + K1 * Math.log10(r);

// ---------------------------------------------------------------- descriptions
export function skyPhrase(elong, east) {
  if (elong < 15) return "too close to the Sun to see";
  if (elong > 150) return "up most of the night";
  return east ? "in the evening sky" : "in the morning sky";
}
export function aidFor(mag) {
  if (mag < 6) return "naked eye";
  if (mag < 9) return "binoculars";
  if (mag < 13.5) return "small telescope";
  return "large telescope";
}

const argmax = (a) => a.reduce((bi, v, i) => (v > a[bi] ? i : bi), 0);
const argmin = (a) => a.reduce((bi, v, i) => (v < a[bi] ? i : bi), 0);

/** Sample the window and find the planet's events: [{jd, title, detail}] plus a "now" line. */
export function describePlanet(name, jds, iToday) {
  if (name === "Earth") return { events: [], now: "Home: everything else is seen from here" };
  const g = jds.map((jd) => geometry(planetXYZ(name, jd), planetXYZ("Earth", jd)));
  const el = g.map((x) => x.elong), last = jds.length - 1;
  const iMax = argmax(el), iMin = argmin(el), events = [];
  if (name === "Mercury" || name === "Venus") {
    if (iMax > 0 && iMax < last) {
      const sky = g[iMax].east ? "evening" : "morning";
      events.push({ jd: jds[iMax], title: "Greatest elongation", detail: `${Math.round(el[iMax])}° from the Sun, best in the ${sky} sky` });
    }
    if (iMin > 0 && iMin < last && el[iMin] < 10) {
      const kind = g[iMin].delta < g[iMin].r + 0.5 ? "Inferior" : "Superior";
      events.push({ jd: jds[iMin], title: `${kind} conjunction`, detail: "lost in the Sun's glare" });
    }
  } else if (el[iMax] > 170 && iMax > 0 && iMax < last) {
    events.push({ jd: jds[iMax], title: "Opposition", detail: "closest and brightest, up all night" });
  } else if (iMin > 0 && iMin < last && el[iMin] < 12) {
    events.push({ jd: jds[iMin], title: "Behind the Sun", detail: "hidden in the Sun's glare" });
  }
  const t = g[iToday];
  return { events, now: `Now ${skyPhrase(t.elong, t.east)}, ${t.delta.toFixed(2)} AU away` };
}

// ---------------------------------------------------------------- JPL small bodies
const COMET_MAG_LIMIT = 13.5, ASTEROID_MAG_LIMIT = 10.5, MAX_EACH = 5;

/** Same-origin proxy first (Cloudflare Pages Function, cached), then JPL directly. */
async function sbdbQuery(params) {
  const qs = new URLSearchParams(params).toString();
  const sources = [
    ["site proxy", `/api/sbdb?${qs}`],
    ["NASA direct", `https://ssd-api.jpl.nasa.gov/sbdb_query.api?${qs}`],
  ];
  const failures = [];
  for (const [label, url] of sources) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { throw new Error("reply wasn't JSON (proxy not running?)"); }
      if (!Array.isArray(json.fields)) throw new Error(json.message || json.error || "unexpected reply");
      return (json.data || []).map((row) => Object.fromEntries(json.fields.map((f, k) => [f, row[k]])));
    } catch (err) {
      failures.push(`${label}: ${err.message}`);
    }
  }
  throw new Error(failures.join("; "));
}

function cleanName(full) {
  let s = full.trim();
  if (/^\d+\s+[A-Za-z]/.test(s)) s = s.replace(/\s*\([^)]*\)$/, "");
  return s;
}

function makeElement(row) {
  const el = {};
  for (const k of ["e", "q", "i", "om", "w", "tp"]) {
    const v = parseFloat(row[k]);
    if (!Number.isFinite(v)) return null;
    el[k] = v;
  }
  el.i *= DEG; el.om *= DEG; el.w *= DEG;
  return el;
}

/** Fetch candidates, keep the brightest comets and asteroids in the window. */
export async function fetchSmallBodies(jds) {
  const cacheKey = `sky-sbdb-${Math.round(jds[0])}`;
  let rows;
  try { rows = JSON.parse(localStorage.getItem(cacheKey)); } catch { rows = null; }
  if (!rows || Date.now() - rows.at > 12 * 3600e3) {
    const [jd0, jd1] = [jds[0], jds[jds.length - 1]];
    const comets = await sbdbQuery({
      fields: "full_name,e,q,i,om,w,tp,M1,K1", "sb-kind": "c", "sb-xfrag": "1", "full-prec": "1",
      "sb-cdata": JSON.stringify({ AND: ["q|LT|3.5", "M1|DF", "K1|DF", `tp|RG|${(jd0 - 250).toFixed(1)}|${(jd1 + 250).toFixed(1)}`] }),
    });
    const asteroids = await sbdbQuery({
      fields: "full_name,e,q,i,om,w,tp,H,G", "sb-kind": "a", "full-prec": "1",
      "sb-cdata": JSON.stringify({ AND: ["H|LT|8", "e|LT|1"] }),
    });
    rows = { at: Date.now(), comets, asteroids };
    try { localStorage.setItem(cacheKey, JSON.stringify(rows)); } catch { /* storage full or blocked */ }
  }

  const earth = jds.map((jd) => planetXYZ("Earth", jd));
  const scored = [];
  const consider = (kind, row) => {
    const el = makeElement(row);
    if (!el) return;
    let magFn, limit;
    if (kind === "comet") {
      const M1 = parseFloat(row.M1), K1 = parseFloat(row.K1);
      magFn = (g) => cometMag(M1, K1, g.r, g.delta); limit = COMET_MAG_LIMIT;
    } else {
      const H = parseFloat(row.H), Gs = Number.isFinite(parseFloat(row.G)) ? parseFloat(row.G) : 0.15;
      magFn = (g) => asteroidMag(H, Gs, g.r, g.delta, g.phase); limit = ASTEROID_MAG_LIMIT;
    }
    const geo = jds.map((jd, k) => geometry(bodyXYZ(el, jd), earth[k]));
    const mags = geo.map(magFn);
    if (!mags.every(Number.isFinite)) return;
    const visible = mags.map((m, k) => (geo[k].elong > 20 ? m : Infinity));
    const best = Math.min(...visible);
    if (best > limit) return;
    scored.push({ kind, name: cleanName(row.full_name), el, geo, mags, best, magFn });
  };
  rows.comets.forEach((r) => consider("comet", r));
  rows.asteroids.forEach((r) => consider("asteroid", r));

  const pick = (kind) => scored.filter((b) => b.kind === kind).sort((a, b) => a.best - b.best).slice(0, MAX_EACH);
  return [...pick("comet"), ...pick("asteroid")].sort((a, b) => a.best - b.best);
}

export function describeBody(b, jds, iToday) {
  const last = jds.length - 1, events = [];
  const iPeak = argmin(b.mags);
  const el = b.geo.map((g) => g.elong), d = b.geo.map((g) => g.delta);
  const iMax = argmax(el), iClose = argmin(d);
  if (el[iMax] > 165 && iMax > 0 && iMax < last) events.push({ jd: jds[iMax], title: "Opposition", detail: "best placed, up all night" });
  if (b.el.tp >= jds[0] && b.el.tp <= jds[last]) events.push({ jd: b.el.tp, title: "Closest to the Sun", detail: `${b.el.q.toFixed(2)} AU` });
  if (iClose > 0 && iClose < last) events.push({ jd: jds[iClose], title: "Closest to Earth", detail: `${d[iClose].toFixed(2)} AU` });
  const t = b.geo[iToday];
  return {
    peak: `Brightest ${fmtDay(jds[iPeak])} at magnitude ${b.mags[iPeak].toFixed(1)}, ${aidFor(b.mags[iPeak])}`,
    events,
    now: `Now ${skyPhrase(t.elong, t.east)}`,
  };
}
