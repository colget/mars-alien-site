// orrery.js -- draws the solar system on a <canvas>, seen from above the ecliptic.
// x points to the spring equinox; y is flipped so "up" on screen is +y.

export const PLANET_COLOURS = {
  Mercury: "#b9a99a", Venus: "#e8c88a", Earth: "#86b6db", Mars: "#e0703f",
  Jupiter: "#d9a25f", Saturn: "#ead7a0", Uranus: "#9fd3d6", Neptune: "#7e95e0",
};
export const PLANET_SIZES = {
  Mercury: 3, Venus: 4.5, Earth: 4.5, Mars: 4, Jupiter: 7, Saturn: 6.5, Uranus: 5, Neptune: 5,
};
export const COMET_COLOURS = ["#a6e3b8", "#9adbe8", "#d3f08f", "#f2f2f2", "#b8c8ff"];
export const ASTEROID_COLOURS = ["#f0a9a0", "#c9b3f0", "#f2d27a", "#f5b97a", "#e6a8d8"];

const SAND = "242, 227, 205";

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Orrery {
  constructor(canvas, { labels = true, sightlines = false, starCount = 260 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.labels = labels;
    this.sightlines = sightlines;
    this.starCount = starCount;
    this.objects = [];
    this.lim = 2;
    this.font = '600 12px "Atkinson Hyperlegible", system-ui, sans-serif';
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = mulberry32(7);
    this.stars = Array.from({ length: this.starCount }, () => ({
      x: rnd() * this.w, y: rnd() * this.h, r: rnd() * 1.1 + 0.2, a: rnd() * 0.5 + 0.15,
    }));
    if (this.lastJd !== undefined) this.draw(this.lastJd);
  }

  setObjects(objects) { this.objects = objects; }
  setView(lim) { this.lim = lim; }

  /** AU -> screen pixels. */
  toScreen(p) {
    const scale = (Math.min(this.w, this.h) / 2) / this.lim;
    return [this.w / 2 + p[0] * scale, this.h / 2 - p[1] * scale];
  }

  draw(jd) {
    this.lastJd = jd;
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);

    for (const s of this.stars) {
      ctx.fillStyle = `rgba(${SAND}, ${s.a})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }

    // orbits, then the stretch each object covers in the chosen window
    ctx.lineWidth = 1;
    for (const o of this.objects) {
      if (!o.orbit) continue;
      ctx.strokeStyle = o.kind === "planet" ? `rgba(${SAND}, 0.13)` : hexA(o.color, 0.28);
      ctx.setLineDash(o.kind === "planet" ? [] : [4, 5]);
      this.path(o.orbit); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    for (const o of this.objects) {
      if (!o.segment) continue;
      ctx.strokeStyle = hexA(o.color, 0.42);
      this.path(o.segment); ctx.stroke();
    }

    // the Sun
    const [sx, sy] = this.toScreen([0, 0, 0]);
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 26);
    glow.addColorStop(0, "rgba(255, 226, 150, 0.95)");
    glow.addColorStop(0.35, "rgba(242, 178, 92, 0.45)");
    glow.addColorStop(1, "rgba(242, 178, 92, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sx, sy, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffe7a8";
    ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill();

    const positions = new Map(this.objects.map((o) => [o.id, o.pos(jd)]));
    const earth = positions.get("Earth");

    if (this.sightlines && earth) {
      const [ex, ey] = this.toScreen(earth);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      for (const o of this.objects) {
        if (o.kind === "planet") continue;
        const [x, y] = this.toScreen(positions.get(o.id));
        ctx.strokeStyle = hexA(o.color, 0.5);
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(x, y); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    ctx.font = this.font;
    ctx.textBaseline = "middle";
    const pad = 14;
    for (const o of this.objects) {
      const p = positions.get(o.id);
      const [x, y] = this.toScreen(p);
      const inside = x > pad && x < w - pad && y > pad && y < h - pad;
      if (!inside) { this.edgeMarker(o, x, y); continue; }
      if (o.kind === "comet") this.tail(o, p, x, y);
      ctx.fillStyle = o.color;
      ctx.beginPath(); ctx.arc(x, y, o.size, 0, Math.PI * 2); ctx.fill();
      if (o.id === "Saturn") {          // a hint of rings
        ctx.strokeStyle = hexA(o.color, 0.7); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(x, y, o.size * 2, o.size * 0.7, -0.4, 0, Math.PI * 2); ctx.stroke();
      }
      if (this.labels) {
        ctx.fillStyle = `rgba(${SAND}, 0.85)`;
        ctx.textAlign = x > w - 120 ? "right" : "left";
        ctx.fillText(o.name, x + (ctx.textAlign === "left" ? o.size + 6 : -o.size - 6), y - o.size - 4);
      }
    }
  }

  path(points) {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach((p, k) => {
      const [x, y] = this.toScreen(p);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
  }

  /** Small arrow at the edge pointing towards an object that's out of view. */
  edgeMarker(o, x, y) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2, ang = Math.atan2(y - cy, x - cx);
    const m = 18;
    const t = Math.min(
      Math.abs((Math.cos(ang) > 0 ? w - m - cx : m - cx) / (Math.cos(ang) || 1e-9)),
      Math.abs((Math.sin(ang) > 0 ? h - m - cy : m - cy) / (Math.sin(ang) || 1e-9)),
    );
    const ex = cx + Math.cos(ang) * t, ey = cy + Math.sin(ang) * t;
    ctx.save();
    ctx.translate(ex, ey); ctx.rotate(ang);
    ctx.fillStyle = o.color;
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (this.labels) {
      ctx.fillStyle = hexA(o.color, 0.9);
      ctx.textAlign = Math.cos(ang) > 0.3 ? "right" : Math.cos(ang) < -0.3 ? "left" : "center";
      const dx = Math.cos(ang) > 0.3 ? -14 : Math.cos(ang) < -0.3 ? 14 : 0;
      const dy = Math.abs(Math.cos(ang)) <= 0.3 ? (Math.sin(ang) > 0 ? -14 : 14) : 0;
      ctx.fillText(o.name, ex + dx, ey + dy);
    }
  }

  /** Anti-sunward tail, longer the closer the comet is to the Sun. */
  tail(o, p, x, y) {
    const r = Math.hypot(p[0], p[1], p[2]);
    const activity = Math.max(0, Math.min(1, (3 - r) / 2.4));
    if (activity <= 0) return;
    const len = (Math.min(this.w, this.h) * 0.09) * (0.25 + activity);
    const d = Math.hypot(p[0], p[1]) || 1;
    const ux = p[0] / d, uy = -p[1] / d;           // screen-space, away from the Sun
    const tx = x + ux * len, ty = y + uy * len;
    const g = this.ctx.createLinearGradient(x, y, tx, ty);
    g.addColorStop(0, hexA(o.color, 0.55 * activity + 0.15));
    g.addColorStop(1, hexA(o.color, 0));
    const wdt = o.size + 2;
    this.ctx.fillStyle = g;
    this.ctx.beginPath();
    this.ctx.moveTo(x - uy * wdt, y + ux * wdt);
    this.ctx.lineTo(tx - uy * wdt * 2.2, ty + ux * wdt * 2.2);
    this.ctx.lineTo(tx + uy * wdt * 2.2, ty - ux * wdt * 2.2);
    this.ctx.lineTo(x + uy * wdt, y - ux * wdt);
    this.ctx.closePath();
    this.ctx.fill();
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
