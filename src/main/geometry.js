'use strict';
/*
 * Multi-monitor geometry: the cat lives in the union of all displays.
 * Coordinates are global DIPs (same space as Electron's `screen` API).
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function inside(r, p, m = 0) {
  return p.x >= r.x + m && p.x <= r.x + r.width - m && p.y >= r.y + m && p.y <= r.y + r.height - m;
}

function clampInto(r, p, m = 0) {
  const mx = Math.min(m, r.width / 2 - 1), my = Math.min(m, r.height / 2 - 1);
  return { x: clamp(p.x, r.x + mx, r.x + r.width - mx), y: clamp(p.y, r.y + my, r.y + r.height - my) };
}

class Geo {
  constructor() {
    this.displays = [];
  }

  // displays: [{ id, bounds, workArea, primary }]
  set(displays) {
    this.displays = displays.map((d) => ({ id: d.id, bounds: { ...d.bounds }, work: { ...(d.workArea || d.bounds) }, primary: !!d.primary }));
    if (!this.displays.some((d) => d.primary) && this.displays.length) this.displays[0].primary = true;
  }

  get primary() { return this.displays.find((d) => d.primary) || this.displays[0]; }

  displayAt(p) {
    return this.displays.find((d) => inside(d.bounds, p)) || null;
  }

  nearestDisplay(p) {
    let best = null, bd = Infinity;
    for (const d of this.displays) {
      const q = clampInto(d.bounds, p);
      const dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  inAny(p, m = 0) {
    return m > 0 ? this.inUnion('bounds', p, m) : this.displays.some((d) => inside(d.bounds, p, m));
  }

  inWork(p, m = 0) {
    return m > 0 ? this.inUnion('work', p, m) : this.displays.some((d) => inside(d.work, p, m));
  }

  // Is p inside the *union* of the rects, at least m away from its outer edges?
  // (A shared edge between two monitors is not an edge: no dead zone there.)
  inUnion(key, p, m = 0) {
    const ins = (q) => this.displays.some((d) => inside(d[key], q, 0));
    if (!ins(p)) return false;
    if (!m) return true;
    return ins({ x: p.x - m, y: p.y }) && ins({ x: p.x + m, y: p.y }) && ins({ x: p.x, y: p.y - m }) && ins({ x: p.x, y: p.y + m });
  }

  clampTo(key, p, m) {
    if (this.inUnion(key, p, m)) return { x: p.x, y: p.y };
    // project into the nearest display (inset by m, so the result is always valid)
    let best = null, bd = Infinity;
    for (const d of this.displays) {
      const q = clampInto(d[key], p, m);
      const dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (dd < bd) { bd = dd; best = q; }
    }
    return best || { x: p.x, y: p.y };
  }

  // Nearest point inside the work areas (kept m away from the outer edges).
  clampWork(p, m = 0) { return this.clampTo('work', p, m); }

  clampBounds(p, m = 0) { return this.clampTo('bounds', p, m); }

  // Random point in a work area. With `near`, pick within `radius` of it (same display preferred).
  randomPoint(m, near, radius) {
    if (!this.displays.length) return { x: 400, y: 400 };
    if (near && radius) {
      const d = this.displayAt(near) || this.nearestDisplay(near);
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2, r = radius * (0.35 + 0.65 * Math.random());
        const p = { x: near.x + Math.cos(a) * r, y: near.y + Math.sin(a) * r * 0.7 };
        if (inside(d.work, p, m)) return p;
      }
      return clampInto(d.work, { x: near.x + (Math.random() - 0.5) * radius, y: near.y }, m);
    }
    const total = this.displays.reduce((s, d) => s + d.work.width * d.work.height, 0);
    let k = Math.random() * total;
    let d = this.displays[0];
    for (const dd of this.displays) { k -= dd.work.width * dd.work.height; if (k <= 0) { d = dd; break; } }
    return this.randomIn(d, m);
  }

  randomIn(d, m) {
    const w = d.work;
    const mx = Math.min(m, w.width / 2 - 1), my = Math.min(m, w.height / 2 - 1);
    return { x: w.x + mx + Math.random() * (w.width - 2 * mx), y: w.y + my + Math.random() * (w.height - 2 * my) };
  }

  // Does the straight line a→b stay inside the union (and clear of its outer
  // edges / inside corners by `m`)? Endpoints themselves may sit near an edge.
  segmentInside(a, b, m = 6) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(2, Math.ceil(len / 12));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const q = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      const nearEnd = Math.min(k, 1 - k) * len < m * 2;
      if (!(nearEnd ? this.inAny(q, -1) : this.inUnion('bounds', q, m))) return false;
    }
    return true;
  }

  // Shared edge between two displays: returns a crossing point (on the edge) or null.
  crossing(A, B, nearP, m) {
    const a = A.bounds, b = B.bounds;
    const tol = 3;
    // vertical shared edge
    let x = null;
    if (Math.abs(a.x + a.width - b.x) <= tol) x = b.x;
    else if (Math.abs(b.x + b.width - a.x) <= tol) x = a.x;
    if (x != null) {
      const lo = Math.max(a.y, b.y) + m, hi = Math.min(a.y + a.height, b.y + b.height) - m;
      if (hi > lo) return { x, y: clamp(nearP.y, lo, hi) };
    }
    let y = null;
    if (Math.abs(a.y + a.height - b.y) <= tol) y = b.y;
    else if (Math.abs(b.y + b.height - a.y) <= tol) y = a.y;
    if (y != null) {
      const lo = Math.max(a.x, b.x) + m, hi = Math.min(a.x + a.width, b.x + b.width) - m;
      if (hi > lo) return { x: clamp(nearP.x, lo, hi), y };
    }
    return null;
  }

  // Waypoints from `from` to `to`, crossing between monitors at shared edges.
  route(from, to, m = 30) {
    if (this.segmentInside(from, to)) return [to];
    const A = this.displayAt(from) || this.nearestDisplay(from);
    const B = this.displayAt(to) || this.nearestDisplay(to);
    if (!A || !B || A === B) return [to];
    // BFS over display adjacency
    const prev = new Map([[A, null]]);
    const q = [A];
    while (q.length) {
      const d = q.shift();
      if (d === B) break;
      for (const e of this.displays) {
        if (prev.has(e)) continue;
        if (this.crossing(d, e, from, m)) { prev.set(e, d); q.push(e); }
      }
    }
    if (!prev.has(B)) return [to];
    const chain = [];
    for (let d = B; d; d = prev.get(d)) chain.unshift(d);
    const pts = [];
    let cur = from;
    for (let i = 0; i < chain.length - 1; i++) {
      const c = this.crossing(chain[i], chain[i + 1], i === chain.length - 2 ? to : cur, m);
      if (c) { pts.push(c); cur = c; }
    }
    pts.push(to);
    return pts;
  }
}

module.exports = { Geo, inside, clampInto };
