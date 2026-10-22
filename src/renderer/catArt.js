/*
 * Desktop Cat — procedural cat artwork.
 *
 * The cat is drawn from a small skeleton (body capsule, 4 two-bone legs,
 * bezier tail, 3/4-view head). Every pose returns the same skeleton shape,
 * so any two poses can be blended smoothly with lerpPose().
 *
 * Coordinates: origin = point on the ground under the cat, x forward
 * (the caller flips with ctx.scale(-1, 1) for facing left), y down.
 * One unit ≈ one pixel at scale 1. The cat is ~70 units long.
 *
 * No dependencies — runs in the Electron renderer and in a plain browser.
 */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const { sin, cos, abs, max, min, hypot, atan2, sqrt, PI } = Math;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const P = (x, y) => ({ x, y });
  const add = (a, dx, dy) => ({ x: a.x + dx, y: a.y + dy });
  const smooth = (k) => k * k * (3 - 2 * k);

  // ------------------------------------------------------------------ palettes
  const PALETTES = {
    white: {
      label: 'Snow white',
      fur: ['#ffffff', '#e9e8f1'], far: ['#e1e0ea', '#cfcedc'],
      line: '#74768c', detail: 'rgba(116,118,140,0.42)',
      ear: '#f8b2c1', nose: '#f095ac', mouth: '#5b2a3a',
    },
    cream: {
      label: 'Cream',
      fur: ['#fff7ea', '#f1dfc4'], far: ['#ead8bd', '#dcc6a6'],
      line: '#8a7458', detail: 'rgba(138,116,88,0.42)',
      ear: '#f6b0b8', nose: '#e98f9f', mouth: '#5b2a3a',
    },
    silver: {
      label: 'Silver',
      fur: ['#eef0f5', '#c9cdd8'], far: ['#c3c7d3', '#aeb3c2'],
      line: '#5c6274', detail: 'rgba(92,98,116,0.45)',
      ear: '#f2adbd', nose: '#d9899d', mouth: '#4b2532',
    },
    ginger: {
      label: 'Ginger',
      fur: ['#ffc58a', '#f19a4c'], far: ['#e9a463', '#d9853a'],
      line: '#8f4e1d', detail: 'rgba(143,78,29,0.45)',
      ear: '#f7a9a9', nose: '#e5787f', mouth: '#4b2128',
    },
    black: {
      label: 'Midnight',
      fur: ['#4a4b58', '#2b2c36'], far: ['#353642', '#22232b'],
      line: '#121218', detail: 'rgba(255,255,255,0.16)',
      ear: '#b97e8d', nose: '#b26f82', mouth: '#2a0f16',
    },
  };

  const EYE_COLORS = {
    blue: ['#6cb6ff', '#6cb6ff'],
    green: ['#8bd06a', '#8bd06a'],
    amber: ['#f3b443', '#f3b443'],
    odd: ['#6cb6ff', '#f3b443'], // heterochromia — common in white cats
  };

  // ------------------------------------------------------------------ skeleton
  function leg(rx, ry, fx, fy, L1, L2, bend, w, far) {
    return { root: P(rx, ry), foot: P(fx, fy), L1, L2, bend, w, far: far ? 1 : 0, detail: 0, claws: 0, nopaw: 0 };
  }

  function base() {
    return {
      ox: 0, oy: 0, rot: 0,
      S: P(13, -24), H: P(-13, -25), rc: 12.5, rr: 13.5, back: 1.4, sag: 1.4,
      head: { x: 25, y: -38, r: 15.5, rot: 0, turn: 0.15, chin: 0.5 },
      // order is fixed: far hind, far front, near hind, near front
      legs: [
        leg(-15, -20, -16, 0, 10.5, 10.5, 1, 8.2, true),
        leg(10, -19, 10, 0, 10, 10, -1, 7.3, true),
        leg(-11, -20, -11, 0, 10.5, 10.5, 1, 8.2, false),
        leg(15, -19, 15, 0, 10, 10, -1, 7.3, false),
      ],
      haunch: { x: -10, y: -20, rx: 0, ry: 0, rot: 0, detail: 0 },
      paws: [{ x: 0, y: -10, rx: 0, ry: 0 }, { x: 0, y: -10, rx: 0, ry: 0 }],
      tail: { p0: P(-24, -30), c1: P(-36, -32), c2: P(-42, -44), p3: P(-38, -58), w: 6.4, detail: 0 },
      ears: { flat: 0, droop: 0, perk: 0 },
      tuft: 0, // scruff tuft (held)
      shadow: { x: 0, rx: 30, ry: 4.5 },
    };
  }

  // Attach leg roots to the body ends (so legs follow body motion).
  function roots(p) {
    const L = p.legs;
    L[0].root = add(p.H, -2.5, p.rr * 0.42);
    L[2].root = add(p.H, 2, p.rr * 0.45);
    L[1].root = add(p.S, -3, p.rc * 0.48);
    L[3].root = add(p.S, 1.5, p.rc * 0.5);
  }

  // Tuck a leg away inside the body (used by sitting / lying poses).
  function tuck(l, at) {
    l.root = P(at.x, at.y);
    l.foot = P(at.x + 0.01, at.y + 0.01);
  }

  function setTail(p, R, a) {
    p.tail.p0 = R;
    p.tail.c1 = add(R, a[0], a[1]);
    p.tail.c2 = add(R, a[2], a[3]);
    p.tail.p3 = add(R, a[4], a[5]);
  }

  function mixTail(p, R, a, b, k) {
    const m = [];
    for (let i = 0; i < 6; i++) m[i] = lerp(a[i], b[i], k);
    setTail(p, R, m);
  }

  function swayTail(p, T, amp, speed, lash) {
    const s = sin(T * speed), s2 = sin(T * speed - 0.7);
    p.tail.p3.x += s * amp;
    p.tail.c2.x += s2 * amp * 0.45;
    if (lash) {
      const l = sin(T * 7.5);
      p.tail.p3.x += l * 8 * lash;
      p.tail.p3.y += cos(T * 7.5) * 2 * lash;
      p.tail.c2.x += sin(T * 7.5 - 0.8) * 3.5 * lash;
    }
  }

  function breath(p, T, amt) {
    const b = 1 + (amt || 0.018) * sin(T * 2.2);
    p.rc *= b; p.rr *= b;
  }

  function applyMood(p, m) {
    if (!m) return;
    if (m.thin) { p.rc *= 1 - 0.16 * m.thin; p.rr *= 1 - 0.2 * m.thin; p.sag -= 2 * m.thin; }
    p.ears.flat = max(p.ears.flat, m.flat || 0);
    p.ears.droop = max(p.ears.droop, m.droop || 0);
    p.ears.perk = max(p.ears.perk, m.perk || 0);
    if (m.puff) p.tail.w *= 1 + 0.75 * m.puff;
  }

  const TAIL_RELAX = [-12, -3, -20, -14, -16, -30];
  const TAIL_UP = [-5, -14, -6, -32, 5, -38];
  const TAIL_LOW = [-12, 2, -22, 6, -32, 4];

  // ------------------------------------------------------------------ poses
  // c = { t: seconds in pose, T: global seconds, phase: walk phase (rad), m: mood, k: misc }
  const POSES = {};

  POSES.stand = (c) => {
    const p = base();
    breath(p, c.T);
    roots(p);
    const R = add(p.H, -p.rr * 0.85, -p.rr * 0.3);
    mixTail(p, R, TAIL_RELAX, TAIL_UP, c.m.tailUp || 0);
    swayTail(p, c.T, 4, 1.6, c.m.lash);
    p.head.rot = 0.05 * sin(c.T * 0.5);
    return p;
  };

  POSES.walk = (c) => {
    const p = base();
    const ph = c.phase;
    const low = c.m.low || 0; // sneaking / stalking
    const bob = abs(sin(ph));
    p.S.y -= bob * 0.8 - 8 * low; p.H.y -= abs(cos(ph)) * 0.8 - 5 * low;
    p.head.y = p.S.y - 13.5 + 7 * low + 0.7 * sin(ph * 2);
    p.head.x = p.S.x + 12 + 2 * low;
    if (low) p.ears.perk = 0.4 * low;
    roots(p);
    const A = 7.5, lift = 5;
    const offs = [PI, 0, 0, PI];
    const baseX = [-16, 10, -11, 15];
    for (let i = 0; i < 4; i++) {
      const a = ph + offs[i];
      p.legs[i].foot = P(baseX[i] + A * sin(a), -lift * max(0, cos(a)));
    }
    const R = add(p.H, -p.rr * 0.85, -p.rr * 0.3);
    mixTail(p, R, TAIL_RELAX, TAIL_UP, c.m.tailUp == null ? 0.55 : c.m.tailUp);
    p.tail.p3.x += 3 * sin(ph);
    p.tail.c2.x += 1.5 * sin(ph - 0.5);
    swayTail(p, c.T, 0, 1, c.m.lash);
    return p;
  };

  POSES.run = (c) => {
    const p = base();
    const ph = c.phase;
    const s = sin(ph), k = cos(ph);
    p.S = P(15 + 3.5 * s, -24 - 2.5 * k);
    p.H = P(-15 - 3.5 * s, -25 + 2 * k);
    p.rc = 12; p.rr = 13;
    p.head.x = p.S.x + 12; p.head.y = p.S.y - 11; p.head.rot = 0.08;
    p.ears.flat = 0.25;
    roots(p);
    const A = 12, lift = 8;
    const offs = [PI + 0.4, 0.4, PI, 0];
    const baseX = [-17, 11, -13, 16];
    for (let i = 0; i < 4; i++) {
      const a = ph + offs[i];
      p.legs[i].foot = P(baseX[i] + A * sin(a), -lift * max(0, cos(a)));
    }
    const R = add(p.H, -p.rr * 0.85, -p.rr * 0.25);
    setTail(p, R, [-12, -3, -22, -6, -32, -10 + 5 * s]);
    p.shadow.rx = 34;
    return p;
  };

  POSES.sit = (c) => {
    const p = base();
    p.H = P(-8, -13.5); p.rr = 14.5;
    p.S = P(5, -32); p.rc = 11.5;
    p.back = 0.5; p.sag = 0;
    breath(p, c.T, 0.014);
    p.head = { x: 9, y: -49, r: 15.5, rot: 0.04 * sin(c.T * 0.6), turn: 0.35, chin: 0.6 };
    p.haunch = { x: -6, y: -11, rx: 12.5, ry: 10.5, rot: -0.35, detail: 0.9 };
    p.paws[0] = { x: 1, y: -2.6, rx: 6.2, ry: 3.4 };
    const L = p.legs;
    tuck(L[0], P(-8, -16));
    tuck(L[2], P(-8, -16));
    L[1].root = P(3, -27); L[1].foot = P(3.5, 0); L[1].L1 = L[1].L2 = 13.5;
    L[3].root = P(7.5, -27); L[3].foot = P(8.5, 0); L[3].L1 = L[3].L2 = 13.5;
    L[3].detail = 0.8;
    const R = P(-20, -8);
    setTail(p, R, [-13, 6, -6, 13, 20, 10]);
    p.tail.p3.y += 1.2 * sin(c.T * 2.2);
    p.tail.p3.x += 1.5 * sin(c.T * 1.1);
    p.tail.detail = 0.7;
    p.shadow.rx = 24;
    return p;
  };

  POSES.sitFront = (c) => {
    const p = base();
    p.H = P(0, -14); p.rr = 15;
    p.S = P(0, -30); p.rc = 12.5;
    p.back = 0; p.sag = 0;
    breath(p, c.T, 0.014);
    p.head = { x: 0, y: -47, r: 16, rot: 0.05 * sin(c.T * 0.7), turn: 1, chin: 0.65 };
    p.haunch = { x: 0, y: -10, rx: 0, ry: 0, rot: 0, detail: 0 };
    p.paws[0] = { x: -13.5, y: -2.4, rx: 5.6, ry: 3.2 };
    p.paws[1] = { x: 13.5, y: -2.4, rx: 5.6, ry: 3.2 };
    const L = p.legs;
    for (const l of L) l.far = 0;
    // hind legs become rounded thighs on both sides
    L[0].root = P(-10, -14); L[0].foot = P(-11.5, -4); L[0].L1 = 6; L[0].L2 = 6; L[0].w = 14; L[0].detail = 0.4; L[0].nopaw = 1;
    L[2].root = P(10, -14); L[2].foot = P(11.5, -4); L[2].L1 = 6; L[2].L2 = 6; L[2].w = 14; L[2].detail = 0.4; L[2].bend = -1; L[2].nopaw = 1;
    L[1].root = P(-5, -26); L[1].foot = P(-5.5, 0); L[1].L1 = L[1].L2 = 13; L[1].detail = 0.75; L[1].bend = 1;
    L[3].root = P(5, -26); L[3].foot = P(5.5, 0); L[3].L1 = L[3].L2 = 13; L[3].detail = 0.75; L[3].bend = -1;
    const R = P(11, -6);
    setTail(p, R, [13, 2, 19, -10, 14, -24]);
    swayTail(p, c.T, 3, 1.4, c.m.lash);
    p.shadow.rx = 22;
    return p;
  };

  POSES.loaf = (c) => {
    const p = base();
    p.S = P(10, -12.5); p.H = P(-11, -13.5); p.rc = 12; p.rr = 13.2;
    p.back = 0.6; p.sag = -1;
    breath(p, c.T, 0.02);
    p.head = { x: 20, y: -24, r: 15.2, rot: 0.03 * sin(c.T * 0.5), turn: 0.3, chin: 0.6 };
    for (const l of p.legs) tuck(l, P(0, -12));
    p.paws[0] = { x: 19, y: -2.2, rx: 5, ry: 2.6 };
    const R = P(-22, -6);
    setTail(p, R, [-10, 6, 0, 11, 22, 9]);
    p.tail.p3.x += 1.2 * sin(c.T * 1.3);
    p.tail.detail = 0.7;
    p.shadow.rx = 30;
    return p;
  };

  POSES.curl = (c) => {
    const p = base();
    p.S = P(5, -12.5); p.H = P(-7, -13); p.rc = 13.5; p.rr = 14.5;
    p.back = 0; p.sag = -2;
    const b = 1 + 0.035 * sin(c.T * 1.25);
    p.rc *= b; p.rr *= b;
    p.head = { x: 14, y: -11, r: 13.5, rot: 0.5, turn: 0.45, chin: 0.7 };
    p.ears.flat = 0.15;
    for (const l of p.legs) tuck(l, P(0, -12));
    p.paws[0] = { x: 21, y: -3, rx: 5, ry: 3 };
    const R = P(-19, -6);
    setTail(p, R, [-8, 13, 18, 14, 38, 6]);
    p.tail.p3.y += 0.6 * sin(c.T * 0.8);
    p.tail.detail = 0.9;
    p.shadow.rx = 26;
    return p;
  };

  POSES.lieSide = (c) => {
    const p = base();
    p.S = P(13, -9.5); p.H = P(-13, -10); p.rc = 10.5; p.rr = 11.5;
    p.back = 0.5; p.sag = 0;
    breath(p, c.T, 0.03);
    p.head = { x: 26, y: -12, r: 15, rot: 0.3, turn: 0.4, chin: 0.6 };
    const L = p.legs;
    L[1].root = P(12, -8); L[1].foot = P(27, -6);
    L[3].root = P(14, -6); L[3].foot = P(30, -3);
    L[0].root = P(-14, -8); L[0].foot = P(-30, -5);
    L[2].root = P(-12, -6); L[2].foot = P(-27, -2);
    for (const l of L) { l.L1 = 9; l.L2 = 9; }
    const tr = (c.m.tremble || 0) * sin(c.T * 30) * 0.6;
    L[3].foot.y += tr; L[2].foot.y -= tr;
    const R = P(-23, -8);
    setTail(p, R, [-10, 1, -20, 3, -30, 4]);
    p.tail.p3.y += 0.8 * sin(c.T * 0.9);
    p.shadow.rx = 36;
    return p;
  };

  // Held by the scruff — origin is the grip point (cursor). y grows downward.
  // Looks like a kitten carried by its mother: limp, legs dangling, tail tucked.
  POSES.held = (c) => {
    const p = base();
    const T = c.T;
    p.head = { x: 0, y: 10, r: 15.5, rot: 0.05 * sin(T * 1.7), turn: 1, chin: 0.75 };
    p.S = P(0, 28); p.H = P(0, 47); p.rc = 11.5; p.rr = 12.5;
    p.back = 0; p.sag = 0;
    p.ears.flat = 0.5;
    p.tuft = 1;
    const L = p.legs;
    for (const l of L) l.far = 0;
    const sw = (i) => 1.6 * sin(T * 2.4 + i * 1.4);
    L[1].root = P(-5, 31); L[1].foot = P(-6.5 + sw(1), 48); L[1].bend = 1;
    L[3].root = P(5, 31); L[3].foot = P(6.5 + sw(3), 48); L[3].bend = -1;
    L[0].root = P(-7, 52); L[0].foot = P(-8.5 + sw(0), 66); L[0].bend = -1;
    L[2].root = P(7, 52); L[2].foot = P(8.5 + sw(2), 66); L[2].bend = 1;
    for (const l of L) { l.L1 = 9; l.L2 = 9; }
    L[1].L1 = L[1].L2 = L[3].L1 = L[3].L2 = 9.5;
    L[1].detail = L[3].detail = 0.85;
    L[0].detail = L[2].detail = 0.6;
    const R = P(6, 55);
    setTail(p, R, [9, 10, 4, 19, -5, 12]);
    p.tail.p3.x += 1.2 * sin(T * 2);
    p.tail.detail = 0.85;
    p.shadow.rx = 0;
    p.rot = c.k || 0;
    return p;
  };

  POSES.pounce = (c) => {
    const p = base();
    p.S = P(16, -27); p.H = P(-14, -24); p.rc = 11.5; p.rr = 12.5;
    p.head = { x: 28, y: -37, r: 15, rot: 0.12, turn: 0.15, chin: 0.5 };
    p.ears.flat = 0.15;
    roots(p);
    const L = p.legs;
    L[1].foot = P(32, -16); L[3].foot = P(35, -19);
    L[0].foot = P(-31, -11); L[2].foot = P(-28, -8);
    const R = add(p.H, -p.rr * 0.85, -p.rr * 0.2);
    setTail(p, R, [-12, -2, -22, -2, -32, 2]);
    p.shadow.rx = 30;
    return p;
  };

  POSES.fall = (c) => {
    const p = base();
    p.S = P(13, -27); p.H = P(-13, -27); p.rc = 12; p.rr = 13;
    p.head = { x: 24, y: -40, r: 15.5, rot: -0.1, turn: 0.5, chin: 0.6 };
    p.ears.flat = 0.5;
    roots(p);
    const L = p.legs;
    const f = 1.5 * sin(c.T * 18);
    L[1].foot = P(19 + f, -6); L[3].foot = P(22 - f, -4);
    L[0].foot = P(-21 - f, -6); L[2].foot = P(-18 + f, -4);
    const R = add(p.H, -p.rr * 0.85, -p.rr * 0.3);
    setTail(p, R, [-10, -10, -14, -24, -6, -34]);
    p.tail.w *= 1.3;
    return p;
  };

  POSES.crouch = (c) => {
    const p = base();
    p.S = P(12, -14.5); p.H = P(-12, -17.5); p.rc = 11.5; p.rr = 13;
    p.back = 0.4;
    const wig = c.m.wiggle ? 1.6 * sin(c.T * 22) : 0;
    p.H.x += wig; p.H.y += abs(wig) * 0.3;
    p.head = { x: 25, y: -21, r: 15, rot: 0.06, turn: 0.2, chin: 0.5 };
    p.ears.perk = 0.4;
    roots(p);
    const L = p.legs;
    L[1].foot = P(16, 0); L[3].foot = P(20, 0);
    L[0].foot = P(-11 + wig, 0); L[2].foot = P(-7 + wig, 0);
    L[0].bend = L[2].bend = 1;
    const R = add(p.H, -p.rr * 0.85, -p.rr * 0.1);
    setTail(p, R, [-12, 2, -22, 4, -32, 1]);
    p.tail.p3.y += 3 * sin(c.T * 9);
    p.tail.p3.x += 1.5 * sin(c.T * 9 + 1);
    p.shadow.rx = 32;
    return p;
  };

  // Standing up on hind legs in profile (scratching post / reaching / begging).
  POSES.standUp = (c) => {
    const p = base();
    p.H = P(-4, -14); p.rr = 13; p.S = P(2, -39); p.rc = 11;
    p.back = 0.3; p.sag = 0;
    breath(p, c.T, 0.015);
    p.head = { x: 7, y: -54, r: 15.5, rot: -0.05, turn: 0.25, chin: 0.6 };
    p.haunch = { x: -4, y: -12, rx: 10.5, ry: 11.5, rot: -0.2, detail: 0.8 };
    const L = p.legs;
    L[0].root = P(-7, -10); L[0].foot = P(-4, 0); L[0].L1 = 7; L[0].L2 = 7;
    L[2].root = P(-2, -10); L[2].foot = P(2, 0); L[2].L1 = 7; L[2].L2 = 7;
    const k = c.m.scratch ? 1 : 0;
    const s1 = k ? 6 * sin(c.T * 11) : 0;
    L[1].root = P(3, -38); L[1].foot = P(15, -50 + s1); L[1].L1 = L[1].L2 = 8.5;
    L[3].root = P(6, -37); L[3].foot = P(17, -45 - s1); L[3].L1 = L[3].L2 = 8.5;
    L[1].bend = L[3].bend = 1;
    L[3].detail = 0.6;
    L[1].claws = L[3].claws = k;
    const R = P(-14, -9);
    setTail(p, R, [-10, 4, -20, 6, -30, 4]);
    swayTail(p, c.T, 2, 2, c.m.lash);
    p.shadow.rx = 22;
    return p;
  };

  POSES.beg = (c) => {
    const p = POSES.standUp(c);
    const L = p.legs;
    const b = 1.5 * sin(c.T * 3);
    L[1].foot = P(10, -37 + b); L[3].foot = P(13, -36 - b);
    L[1].bend = L[3].bend = -1;
    L[1].claws = L[3].claws = 0;
    p.head.turn = 0.65; p.head.rot = -0.08 + 0.06 * sin(c.T * 1.5);
    return p;
  };

  // Standing on hind legs facing the viewer, pawing at the glass.
  POSES.scratchFront = (c) => {
    const p = base();
    p.H = P(0, -15); p.rr = 13.5; p.S = P(0, -36); p.rc = 12;
    p.back = 0; p.sag = 0;
    p.head = { x: 0, y: -53, r: 16, rot: 0.06 * sin(c.T * 5.5), turn: 1, chin: 0.65 };
    p.ears.flat = 0.15;
    const L = p.legs;
    for (const l of L) l.far = 0;
    L[0].root = P(-7, -9); L[0].foot = P(-8, 0); L[0].L1 = L[0].L2 = 6; L[0].w = 9;
    L[2].root = P(7, -9); L[2].foot = P(8, 0); L[2].L1 = L[2].L2 = 6; L[2].w = 9; L[2].bend = -1;
    const a = c.T * 9;
    const yl = -68 + 22 * (0.5 + 0.5 * sin(a));
    const yr = -68 + 22 * (0.5 + 0.5 * sin(a + PI));
    L[1].root = P(-9, -40); L[1].foot = P(-21, yl); L[1].L1 = L[1].L2 = 12; L[1].bend = 1;
    L[3].root = P(9, -40); L[3].foot = P(21, yr); L[3].L1 = L[3].L2 = 12; L[3].bend = -1;
    L[1].claws = L[3].claws = 1;
    L[1].detail = L[3].detail = 0.7;
    const R = P(10, -12);
    setTail(p, R, [12, -2, 20, -14, 16, -28]);
    swayTail(p, c.T, 4, 3, 0.3);
    p.shadow.rx = 20;
    return p;
  };

  POSES.eat = (c) => {
    const p = base();
    p.S = P(12, -21); p.H = P(-13, -25); p.rc = 12; p.rr = 13.5;
    breath(p, c.T);
    const chew = c.m.chew ? 1.3 * sin(c.T * 12) : 0;
    p.head = { x: 25, y: -15 + chew, r: 15, rot: 0.55, turn: 0.2, chin: 0.5 };
    roots(p);
    p.legs[1].foot = P(12, 0); p.legs[3].foot = P(16, 0);
    const R = add(p.H, -p.rr * 0.85, -p.rr * 0.3);
    mixTail(p, R, TAIL_RELAX, TAIL_UP, 0.4);
    swayTail(p, c.T, 3, 1.3);
    return p;
  };

  POSES.squat = (c) => {
    const p = base();
    p.H = P(-12, -12); p.rr = 13.5; p.S = P(10, -22); p.rc = 11.5;
    p.ox = 0.45 * sin(c.T * 38);
    p.head = { x: 21, y: -35, r: 15, rot: -0.12, turn: 0.35, chin: 0.5 };
    roots(p);
    const L = p.legs;
    L[1].foot = P(10, 0); L[3].foot = P(14, 0);
    L[0].foot = P(-9, 0); L[2].foot = P(-5, 0);
    L[0].bend = L[2].bend = 1;
    const R = add(p.H, -p.rr * 0.8, -p.rr * 0.45);
    setTail(p, R, [-6, -16, -4, -34, 4, -44]);
    p.tail.p3.x += 0.8 * sin(c.T * 25);
    p.shadow.rx = 28;
    return p;
  };

  // Kicking litter backwards after pooping.
  POSES.cover = (c) => {
    const p = POSES.stand(c);
    const L = p.legs;
    const a = c.T * 11;
    L[0].foot = P(-17 - 9 * max(0, sin(a)), -3 * max(0, sin(a)));
    L[2].foot = P(-12 - 9 * max(0, sin(a + PI)), -3 * max(0, sin(a + PI)));
    p.head.rot = 0.2;
    p.head.turn = 0.05;
    return p;
  };

  POSES.stretch = (c) => {
    const p = base();
    p.S = P(13, -11.5); p.rc = 11; p.H = P(-12, -29); p.rr = 13;
    p.back = -1; p.sag = 0.5;
    p.head = { x: 25, y: -19, r: 15, rot: -0.25, turn: 0.3, chin: 0.5 };
    roots(p);
    const L = p.legs;
    L[1].foot = P(27, 0); L[3].foot = P(31, 0);
    L[1].root = add(p.S, 2, 4); L[3].root = add(p.S, 5, 4);
    L[0].foot = P(-15, 0); L[2].foot = P(-11, 0);
    L[0].L1 = L[2].L1 = 12; L[0].L2 = L[2].L2 = 12;
    const R = add(p.H, -p.rr * 0.8, -p.rr * 0.4);
    setTail(p, R, [-6, -14, -4, -30, 6, -38]);
    swayTail(p, c.T, 2, 2);
    return p;
  };

  POSES.groom = (c) => {
    const p = POSES.sit(c);
    const cyc = (c.t % 5) / 5;
    const L = p.legs;
    if (cyc < 0.6) {
      // lick paw
      const l = sin(c.t * 9);
      L[3].root = P(8, -30);
      L[3].foot = P(17, -40 + 2 * l);
      L[3].bend = 1;
      p.head.rot = 0.35 + 0.05 * l;
      p.head.x = 10; p.head.y = -50;
    } else {
      // wipe face with paw
      const w = sin(c.t * 6);
      L[3].root = P(8, -30);
      L[3].foot = P(18 + 2 * w, -52 - 5 * w);
      L[3].bend = 1;
      p.head.rot = 0.45 + 0.08 * w;
      p.head.x = 9; p.head.y = -49;
    }
    L[3].L1 = L[3].L2 = 9;
    L[3].detail = 0.7;
    return p;
  };

  POSES.roll = (c) => {
    const p = base();
    p.S = P(12, -11); p.H = P(-12, -11); p.rc = 11; p.rr = 12;
    p.back = -0.5; p.sag = -1;
    p.rot = 0.12 * sin(c.T * 2.2);
    p.head = { x: 25, y: -13, r: 15, rot: 1.0 + 0.1 * sin(c.T * 2.2), turn: 0.6, chin: 0.6 };
    const L = p.legs;
    const k = 2 * sin(c.T * 4);
    L[1].root = P(10, -15); L[1].foot = P(16 + k, -31);
    L[3].root = P(14, -15); L[3].foot = P(21 - k, -32);
    L[0].root = P(-15, -15); L[0].foot = P(-20 - k, -28);
    L[2].root = P(-11, -15); L[2].foot = P(-15 + k, -30);
    for (const l of L) { l.L1 = 9; l.L2 = 9; }
    L[1].bend = L[3].bend = 1; L[0].bend = L[2].bend = -1;
    const R = P(-22, -6);
    setTail(p, R, [-10, 2, -20, 4, -30, 2]);
    swayTail(p, c.T, 5, 3);
    p.shadow.rx = 32;
    return p;
  };

  POSES.arch = (c) => {
    const p = base();
    p.S = P(11, -30); p.H = P(-11, -30); p.rc = 12; p.rr = 13;
    p.back = -15; p.sag = -6;
    p.head = { x: 23, y: -33, r: 15.5, rot: 0.15, turn: 0.55, chin: 0.6 };
    p.ears.flat = 0.9;
    roots(p);
    const L = p.legs;
    for (const l of L) { l.L1 = 12.5; l.L2 = 12.5; l.bend *= 0.3; }
    L[1].foot = P(13, 0); L[3].foot = P(17, 0); L[0].foot = P(-19, 0); L[2].foot = P(-15, 0);
    const R = add(p.H, -p.rr * 0.7, -p.rr * 0.6);
    setTail(p, R, [-4, -14, -2, -30, 4, -42]);
    p.tail.w *= 1.9;
    p.tail.p3.x += 1.2 * sin(c.T * 20);
    p.shadow.rx = 30;
    return p;
  };

  POSES.dizzy = (c) => {
    const p = POSES.stand(c);
    p.rot = 0.1 * sin(c.T * 4.2);
    p.head.rot = 0.18 * sin(c.T * 4.2 + 1);
    p.head.turn = 0.6;
    return p;
  };

  POSES.shake = (c) => {
    const p = POSES.stand(c);
    const d = max(0, 1 - c.t / 0.9);
    p.rot = 0.09 * sin(c.t * 42) * d;
    p.head.rot = 0.35 * sin(c.t * 42 + 0.5) * d;
    p.ears.flat = 0.5 * d;
    return p;
  };

  // Holding the toy mouse proudly between the paws.
  POSES.catch = (c) => {
    const p = POSES.loaf(c);
    p.head = { x: 22, y: -26, r: 15.2, rot: -0.1, turn: 0.5, chin: 0.6 };
    p.paws[0] = { x: 23, y: -2.2, rx: 5.4, ry: 2.8 };
    p.paws[1] = { x: 16, y: -2.4, rx: 5, ry: 2.6 };
    return p;
  };

  POSES.box = (c) => {
    const p = POSES.sitFront(c);
    const peek = c.m.peek == null ? 1 : c.m.peek;
    p.oy = lerp(30, 12, peek);
    p.tail.p3 = add(p.tail.p0, 0, -2);
    p.tail.c1 = add(p.tail.p0, 0, -1);
    p.tail.c2 = add(p.tail.p0, 0, -1.5);
    p.shadow.rx = 0;
    return p;
  };

  POSES.ghost = (c) => {
    const p = POSES.stand(c);
    const L = p.legs;
    for (const l of L) l.foot.y -= 3 + 1.5 * sin(c.T * 3 + l.root.x);
    p.oy = -2 * sin(c.T * 2);
    p.shadow.rx = 0;
    return p;
  };

  // Swat overlay: near front paw strikes forward.
  function applySwat(p, k) {
    // k in 0..1 over the swat
    const L = p.legs[3];
    const a = sin(k * PI);
    L.foot = P(lerp(L.foot.x, L.foot.x + 16, a), lerp(L.foot.y, L.foot.y - 20, a));
    L.claws = a > 0.4 ? 1 : 0;
  }

  // ------------------------------------------------------------------ blending
  function lerpPoint(a, b, k) { return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) }; }

  function lerpPose(a, b, k) {
    if (k >= 1) return b;
    if (k <= 0) return a;
    const o = base();
    for (const key of ['ox', 'oy', 'rot', 'rc', 'rr', 'back', 'sag', 'tuft']) o[key] = lerp(a[key], b[key], k);
    o.S = lerpPoint(a.S, b.S, k);
    o.H = lerpPoint(a.H, b.H, k);
    for (const key of ['x', 'y', 'r', 'rot', 'turn', 'chin']) o.head[key] = lerp(a.head[key], b.head[key], k);
    for (let i = 0; i < 4; i++) {
      const la = a.legs[i], lb = b.legs[i], lo = o.legs[i];
      lo.root = lerpPoint(la.root, lb.root, k);
      lo.foot = lerpPoint(la.foot, lb.foot, k);
      for (const key of ['L1', 'L2', 'w', 'detail', 'claws', 'nopaw']) lo[key] = lerp(la[key], lb[key], k);
      lo.bend = k < 0.5 ? la.bend : lb.bend;
      lo.far = k < 0.5 ? la.far : lb.far;
    }
    for (const key of ['x', 'y', 'rx', 'ry', 'rot', 'detail']) o.haunch[key] = lerp(a.haunch[key], b.haunch[key], k);
    for (let i = 0; i < 2; i++) for (const key of ['x', 'y', 'rx', 'ry']) o.paws[i][key] = lerp(a.paws[i][key], b.paws[i][key], k);
    for (const key of ['p0', 'c1', 'c2', 'p3']) o.tail[key] = lerpPoint(a.tail[key], b.tail[key], k);
    o.tail.w = lerp(a.tail.w, b.tail.w, k);
    o.tail.detail = lerp(a.tail.detail, b.tail.detail, k);
    for (const key of ['flat', 'droop', 'perk']) o.ears[key] = lerp(a.ears[key], b.ears[key], k);
    o.shadow.rx = lerp(a.shadow.rx, b.shadow.rx, k);
    o.shadow.ry = lerp(a.shadow.ry, b.shadow.ry, k);
    return o;
  }

  function clonePose(p) { return JSON.parse(JSON.stringify(p)); }

  // ------------------------------------------------------------------ geometry
  function legIK(r, f, L1, L2, bend) {
    const dx = f.x - r.x, dy = f.y - r.y;
    const d = hypot(dx, dy);
    if (d < 0.001) return P(r.x, r.y);
    if (d >= L1 + L2 - 0.01) return P(r.x + dx * L1 / (L1 + L2), r.y + dy * L1 / (L1 + L2));
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = sqrt(max(0, L1 * L1 - a * a));
    const ux = dx / d, uy = dy / d;
    return P(r.x + ux * a - uy * h * bend, r.y + uy * a + ux * h * bend);
  }

  function bodyPath(ctx, p) {
    const S = p.S, H = p.H, rc = p.rc, rr = p.rr;
    const dx = S.x - H.x, dy = S.y - H.y;
    const len = hypot(dx, dy) || 0.001;
    const ux = dx / len, uy = dy / len;
    const nx = uy, ny = -ux;
    const an = atan2(ny, nx);
    const tS = P(S.x + nx * rc, S.y + ny * rc), tH = P(H.x + nx * rr, H.y + ny * rr);
    const bS = P(S.x - nx * rc, S.y - ny * rc), bH = P(H.x - nx * rr, H.y - ny * rr);
    const k = len * 0.36, dip = p.back, sag = p.sag;
    ctx.moveTo(tS.x, tS.y);
    ctx.bezierCurveTo(tS.x - ux * k - nx * dip, tS.y - uy * k - ny * dip, tH.x + ux * k - nx * dip, tH.y + uy * k - ny * dip, tH.x, tH.y);
    ctx.arc(H.x, H.y, rr, an, an - PI, true);
    ctx.bezierCurveTo(bH.x + ux * k - nx * sag, bH.y + uy * k - ny * sag, bS.x - ux * k - nx * sag, bS.y - uy * k - ny * sag, bS.x, bS.y);
    ctx.arc(S.x, S.y, rc, an + PI, an, true);
    ctx.closePath();
  }

  function earGeom(h, ears, side, T, twitch) {
    // side: -1 = near (left in 3/4 view), +1 = far
    const r = h.r, turn = h.turn;
    const fs = r * 0.3 * (1 - turn);
    const cx = side < 0 ? -0.5 * r + 0.35 * fs : 0.5 * r + 0.35 * fs;
    const cy = side < 0 ? -0.6 * r : -0.63 * r;
    const wScale = side > 0 ? lerp(0.82, 1, turn) : 1;
    const bw = 0.42 * r * wScale;
    const ht = 0.82 * r * (1 - 0.3 * ears.flat) * (1 + 0.08 * ears.perk);
    let tilt = side * (0.3 + 0.95 * ears.flat + 0.45 * ears.droop - 0.12 * ears.perk);
    tilt += (twitch || 0) * side;
    const ca = cos(tilt), sa = sin(tilt);
    const rotp = (x, y) => P(cx + x * ca - y * sa, cy + x * sa + y * ca);
    return {
      b1: rotp(-bw, 2), tip: rotp(side * 0.08 * r, -ht), b2: rotp(bw, 2),
      c1: rotp(-bw * 0.95, -ht * 0.55), c2: rotp(bw * 0.95, -ht * 0.55),
      i1: rotp(-bw * 0.52, 0), itip: rotp(side * 0.06 * r, -ht * 0.72), i2: rotp(bw * 0.52, 0),
      ic1: rotp(-bw * 0.5, -ht * 0.45), ic2: rotp(bw * 0.5, -ht * 0.45),
    };
  }

  // ------------------------------------------------------------------ drawing
  function traceLine(ctx, part) {
    if (part.bez) {
      ctx.moveTo(part.bez[0].x, part.bez[0].y);
      ctx.bezierCurveTo(part.bez[1].x, part.bez[1].y, part.bez[2].x, part.bez[2].y, part.bez[3].x, part.bez[3].y);
    } else {
      ctx.moveTo(part.pts[0].x, part.pts[0].y);
      for (let i = 1; i < part.pts.length; i++) ctx.lineTo(part.pts[i].x, part.pts[i].y);
    }
  }

  function traceShape(ctx, part) {
    if (part.fn) { part.fn(ctx); return; }
    ctx.moveTo(part.x + part.rx * cos(part.rot || 0), part.y + part.rx * sin(part.rot || 0));
    ctx.ellipse(part.x, part.y, part.rx, part.ry, part.rot || 0, 0, TAU);
  }

  function drawGroup(ctx, parts, fill, line, o) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = line;
    for (const p of parts) {
      ctx.beginPath();
      if (p.line) { traceLine(ctx, p); ctx.lineWidth = p.w + 2 * o; }
      else { traceShape(ctx, p); ctx.lineWidth = 2 * o; }
      ctx.stroke();
    }
    for (const p of parts) {
      ctx.beginPath();
      if (p.line) { traceLine(ctx, p); ctx.lineWidth = p.w; ctx.strokeStyle = fill; ctx.stroke(); }
      else { traceShape(ctx, p); ctx.fillStyle = fill; ctx.fill(); }
    }
  }

  // Re-draw a part with a soft inner contour on top of the silhouette.
  // clipY: only draw below this y (so a leg's contour starts below where it meets the body).
  function drawDetailed(ctx, p, fill, color, alpha, fadeY) {
    if (alpha <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (fadeY != null) {
      // contour fades in below the point where the leg meets the body
      const g = ctx.createLinearGradient(0, fadeY - 3, 0, fadeY + 7);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, color);
      ctx.strokeStyle = g;
    } else ctx.strokeStyle = color;
    ctx.beginPath();
    if (p.line) { traceLine(ctx, p); ctx.lineWidth = p.w + 2; }
    else { traceShape(ctx, p); ctx.lineWidth = 2; }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    if (p.line) { traceLine(ctx, p); ctx.lineWidth = p.w; ctx.strokeStyle = fill; ctx.stroke(); }
    else { traceShape(ctx, p); ctx.fillStyle = fill; ctx.fill(); }
    ctx.restore();
  }

  function legParts(l) {
    const knee = legIK(l.root, l.foot, l.L1, l.L2, l.bend);
    const ang = atan2(l.foot.y - knee.y, l.foot.x - knee.x) - PI / 2;
    const pawRot = clamp(ang, -1.4, 1.4);
    const line = { line: true, pts: [l.root, knee, l.foot], w: l.w };
    const paw = { x: l.foot.x + cos(pawRot) * l.w * 0.12, y: l.foot.y - 0.2, rx: l.w * 0.62, ry: l.w * 0.44, rot: pawRot };
    return { line, paw, knee, pawRot };
  }

  function headParts(p, T, twitch) {
    const h = p.head;
    const ears = p.ears;
    const near = earGeom(h, ears, -1, T, twitch ? twitch[0] : 0);
    const far = earGeom(h, ears, 1, T, twitch ? twitch[1] : 0);
    const withHead = (fn) => (ctx) => {
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.rotate(h.rot);
      fn(ctx);
      ctx.restore();
    };
    const earFn = (e) => withHead((ctx) => {
      ctx.moveTo(e.b1.x, e.b1.y);
      ctx.quadraticCurveTo(e.c1.x, e.c1.y, e.tip.x, e.tip.y);
      ctx.quadraticCurveTo(e.c2.x, e.c2.y, e.b2.x, e.b2.y);
      ctx.closePath();
    });
    const headFn = withHead((ctx) => {
      const r = h.r;
      // round head with fuller cheeks
      ctx.moveTo(r * 1.08, r * 0.05);
      ctx.bezierCurveTo(r * 1.1, -r * 0.62, r * 0.6, -r * 0.94, 0, -r * 0.94);
      ctx.bezierCurveTo(-r * 0.6, -r * 0.94, -r * 1.1, -r * 0.62, -r * 1.08, r * 0.05);
      ctx.bezierCurveTo(-r * 1.08, r * 0.62, -r * 0.62, r * 0.9, 0, r * 0.88);
      ctx.bezierCurveTo(r * 0.62, r * 0.9, r * 1.08, r * 0.62, r * 1.08, r * 0.05);
      ctx.closePath();
    });
    return { near, far, earNear: { fn: earFn(near) }, earFar: { fn: earFn(far) }, head: { fn: headFn } };
  }

  function drawCat(ctx, pose, face, opts) {
    opts = opts || {};
    const pal = PALETTES[opts.palette] || PALETTES.white;
    const eyeCols = EYE_COLORS[opts.eyes] || EYE_COLORS.blue;
    const T = opts.T || 0;
    const o = 1.25;
    const p = pose;

    ctx.save();
    ctx.translate(p.ox, p.oy);
    if (p.rot) ctx.rotate(p.rot);

    const fur = ctx.createLinearGradient(0, -66, 0, 6);
    fur.addColorStop(0, pal.fur[0]);
    fur.addColorStop(1, pal.fur[1]);
    const farFill = ctx.createLinearGradient(0, -50, 0, 4);
    farFill.addColorStop(0, pal.far[0]);
    farFill.addColorStop(1, pal.far[1]);

    const legsP = p.legs.map((l) => ({ l, parts: legParts(l) }));

    // 1) far legs
    const farParts = [];
    for (const { l, parts } of legsP) {
      if (!l.far || hypot(l.foot.x - l.root.x, l.foot.y - l.root.y) < 0.5) continue;
      farParts.push(parts.line);
      if (l.nopaw < 0.5) farParts.push(parts.paw);
    }
    if (farParts.length) drawGroup(ctx, farParts, farFill, pal.line, o);

    // 2) main silhouette
    const hp = headParts(p, T, opts.earTwitch);
    const tailPart = { line: true, bez: [p.tail.p0, p.tail.c1, p.tail.c2, p.tail.p3], w: p.tail.w };
    const bodyPart = { fn: (c) => bodyPath(c, p) };
    const main = [tailPart, bodyPart];
    if (p.haunch.rx > 0.5) main.push({ x: p.haunch.x, y: p.haunch.y, rx: p.haunch.rx, ry: p.haunch.ry, rot: p.haunch.rot });
    for (const pw of p.paws) if (pw.rx > 0.5) main.push({ x: pw.x, y: pw.y, rx: pw.rx, ry: pw.ry, rot: 0 });
    const nearLegs = [];
    for (const { l, parts } of legsP) {
      if (l.far || hypot(l.foot.x - l.root.x, l.foot.y - l.root.y) < 0.5) continue;
      main.push(parts.line);
      if (l.nopaw < 0.5) main.push(parts.paw);
      nearLegs.push({ l, parts });
    }
    main.push(hp.earFar, hp.earNear, hp.head);
    if (p.tuft > 0.05) {
      main.push({
        fn: (c) => {
          c.moveTo(-5, 3); c.quadraticCurveTo(-3, -3, -1, -7 * p.tuft);
          c.quadraticCurveTo(1, -3, 2, -6 * p.tuft); c.quadraticCurveTo(3, -2, 5, 3); c.closePath();
        },
      });
    }
    drawGroup(ctx, main, fur, pal.line, o);

    // 3) inner contours for depth
    if (p.tail.detail) drawDetailed(ctx, tailPart, fur, pal.detail, p.tail.detail);
    if (p.haunch.rx > 0.5 && p.haunch.detail) drawDetailed(ctx, { x: p.haunch.x, y: p.haunch.y, rx: p.haunch.rx, ry: p.haunch.ry, rot: p.haunch.rot }, fur, pal.detail, p.haunch.detail);
    for (const { l, parts } of nearLegs) {
      if (l.detail > 0.02) {
        const down = l.foot.y >= l.root.y;
        const clipY = down ? l.root.y + l.w * 0.9 : null;
        drawDetailed(ctx, parts.line, fur, pal.detail, l.detail, clipY);
        if (l.nopaw < 0.5) drawDetailed(ctx, parts.paw, fur, pal.detail, l.detail);
      }
    }
    // paw toes + claws
    ctx.lineCap = 'round';
    for (const { l, parts } of legsP) {
      if (l.nopaw > 0.5 || hypot(l.foot.x - l.root.x, l.foot.y - l.root.y) < 0.5) continue;
      const pw = parts.paw;
      ctx.save();
      ctx.translate(pw.x, pw.y);
      ctx.rotate(pw.rot);
      ctx.strokeStyle = pal.detail;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-pw.rx * 0.25, pw.ry * 0.35); ctx.lineTo(-pw.rx * 0.25, pw.ry * 0.9);
      ctx.moveTo(pw.rx * 0.25, pw.ry * 0.35); ctx.lineTo(pw.rx * 0.25, pw.ry * 0.9);
      ctx.stroke();
      if (l.claws > 0.3) {
        ctx.strokeStyle = '#8d8fa3';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = -1; i <= 1; i++) {
          ctx.moveTo(i * pw.rx * 0.45, pw.ry * 0.8);
          ctx.lineTo(i * pw.rx * 0.55, pw.ry * 0.8 + 3.2);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const pw of p.paws) {
      if (pw.rx < 0.5) continue;
      ctx.strokeStyle = pal.detail;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(pw.x - pw.rx * 0.2, pw.y + pw.ry * 0.25); ctx.lineTo(pw.x - pw.rx * 0.2, pw.y + pw.ry * 0.85);
      ctx.moveTo(pw.x + pw.rx * 0.2, pw.y + pw.ry * 0.25); ctx.lineTo(pw.x + pw.rx * 0.2, pw.y + pw.ry * 0.85);
      ctx.stroke();
    }

    // 4) head details
    const h = p.head;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot);
    // inner ears
    for (const e of [hp.far, hp.near]) {
      ctx.beginPath();
      ctx.moveTo(e.i1.x, e.i1.y);
      ctx.quadraticCurveTo(e.ic1.x, e.ic1.y, e.itip.x, e.itip.y);
      ctx.quadraticCurveTo(e.ic2.x, e.ic2.y, e.i2.x, e.i2.y);
      ctx.closePath();
      ctx.fillStyle = pal.ear;
      ctx.fill();
    }
    // re-cover inner-ear bases with head fill so they tuck in (path in head space, fill in body space)
    ctx.beginPath();
    ctx.ellipse(0, h.r * 0.05, h.r * 0.96, h.r * 0.78, 0, 0, TAU);
    ctx.save();
    ctx.rotate(-h.rot);
    ctx.translate(-h.x, -h.y);
    ctx.fillStyle = fur;
    ctx.fill();
    ctx.restore();
    // jaw line: separates the head from the chest
    if (h.chin > 0) {
      ctx.save();
      ctx.globalAlpha = h.chin * 0.8;
      ctx.strokeStyle = pal.detail;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      const r = h.r;
      ctx.moveTo(-r * 1.06, r * 0.3);
      ctx.bezierCurveTo(-r * 1.02, r * 0.66, -r * 0.6, r * 0.88, 0, r * 0.87);
      ctx.bezierCurveTo(r * 0.6, r * 0.88, r * 1.02, r * 0.66, r * 1.06, r * 0.3);
      ctx.stroke();
      ctx.restore();
    }
    if (face !== null) drawFace(ctx, h, face || {}, pal, eyeCols, T);
    ctx.restore();

    ctx.restore();
  }

  // ------------------------------------------------------------------ face
  function heartPath(ctx, x, y, s) {
    ctx.moveTo(x, y + s * 0.35);
    ctx.bezierCurveTo(x - s * 1.1, y - s * 0.35, x - s * 0.45, y - s * 1.05, x, y - s * 0.45);
    ctx.bezierCurveTo(x + s * 0.45, y - s * 1.05, x + s * 1.1, y - s * 0.35, x, y + s * 0.35);
    ctx.closePath();
  }

  function drawEye(ctx, x, y, rx, ry, f, color, side, T, pal) {
    const mode = f.eyes || 'normal';
    const ink = '#3a3b4e';
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const lw = max(1.1, rx * 0.3);
    if (mode === 'happy') {
      ctx.beginPath();
      ctx.arc(0, ry * 0.55, rx * 1.0, PI * 1.18, PI * 1.82);
      ctx.lineWidth = lw * 1.1; ctx.strokeStyle = ink; ctx.stroke();
    } else if (mode === 'closed') {
      ctx.beginPath();
      ctx.arc(0, -ry * 0.25, rx * 0.95, PI * 0.2, PI * 0.8);
      ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.stroke();
    } else if (mode === 'squeeze') {
      ctx.beginPath();
      const s = side;
      ctx.moveTo(-rx * 0.8 * s, -ry * 0.55);
      ctx.lineTo(rx * 0.55 * s, 0);
      ctx.lineTo(-rx * 0.8 * s, ry * 0.55);
      ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.stroke();
    } else if (mode === 'heart') {
      const pulse = 1 + 0.12 * sin(T * 8);
      ctx.beginPath();
      heartPath(ctx, 0, ry * 0.15, rx * 1.15 * pulse);
      ctx.fillStyle = '#ff4f86'; ctx.fill();
      ctx.lineWidth = 0.8; ctx.strokeStyle = '#c22a5c'; ctx.stroke();
    } else if (mode === 'x') {
      ctx.beginPath();
      ctx.moveTo(-rx * 0.7, -ry * 0.6); ctx.lineTo(rx * 0.7, ry * 0.6);
      ctx.moveTo(rx * 0.7, -ry * 0.6); ctx.lineTo(-rx * 0.7, ry * 0.6);
      ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.stroke();
    } else if (mode === 'spiral') {
      ctx.beginPath();
      const rot = T * 6 * side;
      for (let a = 0; a < TAU * 2.2; a += 0.25) {
        const rr = (a / (TAU * 2.2)) * rx * 1.05;
        const px = cos(a + rot) * rr, py = sin(a + rot) * rr * (ry / rx);
        if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineWidth = lw * 0.6; ctx.strokeStyle = ink; ctx.stroke();
    } else {
      let open = clamp(f.open == null ? 1 : f.open, 0, 1);
      if (mode === 'flat') open = min(open, 0.5);
      if (open < 0.13) {
        ctx.beginPath();
        ctx.moveTo(-rx * 0.95, ry * 0.15);
        ctx.quadraticCurveTo(0, ry * 0.45, rx * 0.95, ry * 0.15);
        ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.stroke();
        ctx.restore();
        return;
      }
      let ERX = rx, ERY = ry;
      if (mode === 'wide' || mode === 'sparkle') { ERX *= 1.1; ERY *= 1.08; }
      // eyelid line: y on left & right edge (in eye-local coords)
      const lid = -ERY + 2 * ERY * (1 - open);
      let tl = 0;
      if (mode === 'angry') tl = 0.55 * ERY;
      else if (mode === 'sad') tl = -0.45 * ERY;
      else if (mode === 'flat') tl = 0;
      // inner side (toward face center) is +x for the near eye, -x for the far eye
      const yLeft = lid + tl * 0.5 * side;
      const yRight = lid - tl * 0.5 * side;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, ERX, ERY, 0, 0, TAU);
      ctx.clip();
      const g = ctx.createRadialGradient(-ERX * 0.2, -ERY * 0.35, ERX * 0.1, 0, ERY * 0.1, ERY * 1.1);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.25, color);
      g.addColorStop(1, shade(color, -0.35));
      ctx.fillStyle = g;
      ctx.fillRect(-ERX - 1, -ERY - 1, ERX * 2 + 2, ERY * 2 + 2);
      const lx = clamp(f.lookX || 0, -1, 1) * ERX * 0.32;
      const ly = clamp(f.lookY || 0, -1, 1) * ERY * 0.22;
      let pr = clamp(f.pupil == null ? 0.45 : f.pupil, 0, 1);
      if (mode === 'wide' || mode === 'sparkle') pr = max(pr, 0.85);
      let prx = ERX * (0.22 + 0.5 * pr), pry = ERY * (0.6 + 0.3 * pr);
      if (mode === 'slit' || mode === 'angry') { prx = ERX * 0.16; pry = ERY * 0.8; }
      ctx.fillStyle = '#17172a';
      ctx.beginPath(); ctx.ellipse(lx, ly + ERY * 0.04, prx, pry, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(lx - ERX * 0.3, ly - ERY * 0.38, ERX * 0.3, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(lx + ERX * 0.3, ly + ERY * 0.32, ERX * 0.13, 0, TAU); ctx.fill();
      if (mode === 'sparkle') {
        ctx.beginPath(); ctx.arc(lx + ERX * 0.25, ly - ERY * 0.45, ERX * 0.14, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.arc(lx - ERX * 0.1, ly + ERY * 0.45, ERX * 0.2, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      // eyelid (fur colored) above the lid line
      if (open < 0.999 || tl !== 0) {
        ctx.fillStyle = pal.fur[0];
        ctx.beginPath();
        ctx.moveTo(-ERX - 2, -ERY - 2);
        ctx.lineTo(ERX + 2, -ERY - 2);
        ctx.lineTo(ERX + 2, yRight);
        ctx.lineTo(-ERX - 2, yLeft);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // outline below the lid
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-ERX - 3, yLeft); ctx.lineTo(ERX + 3, yRight); ctx.lineTo(ERX + 3, ERY + 3); ctx.lineTo(-ERX - 3, ERY + 3); ctx.closePath();
      ctx.clip();
      ctx.beginPath();
      ctx.ellipse(0, 0, ERX, ERY, 0, 0, TAU);
      ctx.lineWidth = 1.15; ctx.strokeStyle = ink; ctx.stroke();
      ctx.restore();
      if (open < 0.999 || tl !== 0) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(0, 0, ERX + 1.5, ERY + 1.5, 0, 0, TAU);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(-ERX - 2, yLeft); ctx.lineTo(ERX + 2, yRight);
        ctx.lineWidth = lw * 0.9; ctx.strokeStyle = ink; ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (c) => clamp(Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt), 0, 255);
    r = f(r); g = f(g); b = f(b);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function drawFace(ctx, h, f, pal, eyeCols, T) {
    const r = h.r, turn = h.turn;
    const fs = r * 0.3 * (1 - turn);
    const ex = r * 0.38;
    const nearX = fs - ex * lerp(0.86, 1, turn);
    const farX = fs + ex * lerp(0.72, 1, turn);
    const farS = lerp(0.78, 1, turn);
    const eyY = -r * 0.04;
    const erx = r * 0.17, ery = r * 0.21;

    // blush
    if (f.blush > 0.02) {
      ctx.fillStyle = `rgba(255,120,150,${0.38 * f.blush})`;
      ctx.beginPath(); ctx.ellipse(nearX - erx * 0.35, r * 0.3, erx * 1.05, erx * 0.6, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(farX + erx * 0.25, r * 0.3, erx * 0.9 * farS, erx * 0.55, 0, 0, TAU); ctx.fill();
    }

    drawEye(ctx, nearX, eyY, erx, ery, f, eyeCols[0], -1, T, pal);
    drawEye(ctx, farX, eyY, erx * farS, ery, f, eyeCols[1], 1, T, pal);

    // brows (cartoon) for strong emotions: angry = inner ends down, sad = inner ends up
    if (f.brows === 'angry' || f.brows === 'sad' || f.brows === 'worried') {
      const k = f.brows === 'angry' ? 1 : -1;
      const top = eyY - ery - 2.6;
      ctx.strokeStyle = pal.line; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(nearX - erx * 0.9, top - 1.6 * k); ctx.lineTo(nearX + erx * 0.8, top + 1.6 * k);
      ctx.moveTo(farX + erx * 0.9 * farS, top - 1.6 * k); ctx.lineTo(farX - erx * 0.8 * farS, top + 1.6 * k);
      ctx.stroke();
    }

    // nose
    const nx = fs * 1.12, ny = r * 0.2;
    ctx.beginPath();
    ctx.moveTo(nx - r * 0.085, ny - r * 0.045);
    ctx.quadraticCurveTo(nx, ny - r * 0.085, nx + r * 0.085, ny - r * 0.045);
    ctx.quadraticCurveTo(nx + r * 0.03, ny + r * 0.06, nx, ny + r * 0.065);
    ctx.quadraticCurveTo(nx - r * 0.03, ny + r * 0.06, nx - r * 0.085, ny - r * 0.045);
    ctx.closePath();
    ctx.fillStyle = pal.nose; ctx.fill();
    ctx.lineWidth = 0.7; ctx.strokeStyle = shade(pal.nose, -0.3); ctx.stroke();

    // mouth
    const mw = r * 0.15, my = ny + r * 0.13;
    const mouth = f.mouth || 'w';
    const mo = clamp(f.mouthOpen || 0, 0, 1);
    ctx.strokeStyle = pal.line; ctx.lineWidth = 1.05; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const drawW = (up) => {
      ctx.beginPath();
      ctx.moveTo(nx, ny + r * 0.06); ctx.lineTo(nx, my - 0.6);
      ctx.moveTo(nx - mw * 1.05, my - 0.8 - up);
      ctx.quadraticCurveTo(nx - mw * 0.5, my + mw * 0.85, nx, my - 0.6);
      ctx.quadraticCurveTo(nx + mw * 0.5, my + mw * 0.85, nx + mw * 1.05, my - 0.8 - up);
      ctx.stroke();
    };
    if (mouth === 'open' || mouth === 'meow' || mouth === 'yawn' || mouth === 'hiss' || mouth === 'chew' || mouth === 'o') {
      let oh = r * (mouth === 'yawn' ? 0.36 : mouth === 'hiss' ? 0.26 : mouth === 'o' ? 0.13 : 0.22) * (mouth === 'o' ? 1 : max(0.15, mo));
      let ow = mw * (mouth === 'yawn' ? 1.2 : mouth === 'hiss' ? 1.3 : mouth === 'o' ? 0.55 : 0.85);
      ctx.beginPath();
      if (mouth === 'o') ctx.ellipse(nx, my + oh * 0.5, ow, oh * 0.6, 0, 0, TAU);
      else {
        ctx.moveTo(nx - ow, my - 0.4);
        ctx.quadraticCurveTo(nx, my - 1.8, nx + ow, my - 0.4);
        ctx.quadraticCurveTo(nx + ow * 0.95, my + oh, nx, my + oh * 1.05);
        ctx.quadraticCurveTo(nx - ow * 0.95, my + oh, nx - ow, my - 0.4);
        ctx.closePath();
      }
      ctx.fillStyle = pal.mouth; ctx.fill();
      ctx.lineWidth = 0.9; ctx.stroke();
      if (mouth !== 'o' && oh > r * 0.08) {
        ctx.save();
        ctx.clip();
        ctx.beginPath(); ctx.ellipse(nx, my + oh * 0.95, ow * 0.7, oh * 0.45, 0, 0, TAU);
        ctx.fillStyle = '#ff8ea6'; ctx.fill();
        ctx.restore();
      }
      if (mouth === 'yawn' || mouth === 'hiss') {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(nx - ow * 0.75, my - 0.2); ctx.lineTo(nx - ow * 0.55, my + oh * 0.35); ctx.lineTo(nx - ow * 0.4, my - 0.2);
        ctx.moveTo(nx + ow * 0.75, my - 0.2); ctx.lineTo(nx + ow * 0.55, my + oh * 0.35); ctx.lineTo(nx + ow * 0.4, my - 0.2);
        ctx.fill();
      }
      ctx.beginPath(); ctx.moveTo(nx, ny + r * 0.06); ctx.lineTo(nx, my - 1); ctx.stroke();
    } else if (mouth === 'frown') {
      ctx.beginPath();
      ctx.moveTo(nx, ny + r * 0.06); ctx.lineTo(nx, my - 0.3);
      ctx.moveTo(nx - mw * 0.9, my + mw * 0.55);
      ctx.quadraticCurveTo(nx, my - mw * 0.4, nx + mw * 0.9, my + mw * 0.55);
      ctx.stroke();
    } else if (mouth === 'flat') {
      ctx.beginPath();
      ctx.moveTo(nx, ny + r * 0.06); ctx.lineTo(nx, my);
      ctx.moveTo(nx - mw * 0.8, my + 0.4); ctx.lineTo(nx + mw * 0.8, my + 0.4);
      ctx.stroke();
    } else if (mouth === 'wobble') {
      ctx.beginPath();
      ctx.moveTo(nx - mw * 1.1, my + 1);
      for (let i = 0; i <= 8; i++) ctx.lineTo(nx - mw * 1.1 + (i / 8) * mw * 2.2, my + 1 + ((i % 2) ? -1.2 : 1.2));
      ctx.stroke();
    } else {
      drawW(mouth === 'smile' ? 1.4 : 0);
      if (mouth === 'tongue' || f.tongue > 0.05) {
        const tl = r * 0.13 * (f.tongue || 1);
        ctx.beginPath();
        ctx.ellipse(nx + 0.5, my + tl * 0.55, r * 0.07, tl * 0.65, 0, 0, TAU);
        ctx.fillStyle = '#ff8ea6'; ctx.fill();
        ctx.lineWidth = 0.7; ctx.strokeStyle = '#d4607c'; ctx.stroke();
      }
    }

    // whiskers
    ctx.strokeStyle = pal.detail;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    const wy = ny + r * 0.1;
    for (let i = -1; i <= 1; i++) {
      const a = i * 0.16;
      const L = r * 0.72;
      const sx = nx + r * 0.3, sx2 = nx - r * 0.3;
      ctx.moveTo(sx, wy + i * 1.2);
      ctx.quadraticCurveTo(sx + L * 0.5, wy + i * 1.2 + sin(a) * L * 0.5 - 0.6, sx + L * cos(a), wy + i * 1.2 + sin(a) * L);
      ctx.moveTo(sx2, wy + i * 1.2);
      ctx.quadraticCurveTo(sx2 - L * 0.5 * lerp(0.7, 1, turn), wy + i * 1.2 + sin(a) * L * 0.5 - 0.6, sx2 - L * cos(a) * lerp(0.7, 1, turn), wy + i * 1.2 + sin(a) * L);
    }
    ctx.stroke();

    // tear / sweat / anger mark
    if (f.tear) {
      const ty = eyY + ery + 1 + ((T * 14) % 6);
      ctx.fillStyle = 'rgba(110,180,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(nearX - erx * 0.7, ty - 3);
      ctx.quadraticCurveTo(nearX - erx * 0.7 + 2.2, ty + 1.5, nearX - erx * 0.7, ty + 2.2);
      ctx.quadraticCurveTo(nearX - erx * 0.7 - 2.2, ty + 1.5, nearX - erx * 0.7, ty - 3);
      ctx.fill();
    }
    if (f.sweat) {
      const sx = r * 0.85, sy = -r * 0.55 + ((T * 6) % 3);
      ctx.fillStyle = 'rgba(120,190,255,0.95)';
      ctx.strokeStyle = 'rgba(60,120,200,0.8)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 4.5);
      ctx.quadraticCurveTo(sx + 3.4, sy + 1, sx, sy + 2.8);
      ctx.quadraticCurveTo(sx - 3.4, sy + 1, sx, sy - 4.5);
      ctx.fill(); ctx.stroke();
    }
    if (f.anger) {
      const ax = -r * 0.62, ay = -r * 0.62, s = 3.2 * (1 + 0.15 * sin(T * 10));
      ctx.strokeStyle = '#ff3b4f'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let q = 0; q < 4; q++) {
        const a = q * PI / 2 + PI / 4;
        const cxq = ax + cos(a) * s, cyq = ay + sin(a) * s;
        ctx.moveTo(cxq + cos(a + PI / 2) * s * 0.6, cyq + sin(a + PI / 2) * s * 0.6);
        ctx.quadraticCurveTo(ax + cos(a) * s * 0.3, ay + sin(a) * s * 0.3, cxq + cos(a - PI / 2) * s * 0.6, cyq + sin(a - PI / 2) * s * 0.6);
      }
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------------ helpers
  function headCenter(p) {
    const c = cos(p.rot), s = sin(p.rot);
    const x = p.head.x, y = p.head.y;
    return { x: p.ox + x * c - y * s, y: p.oy + x * s + y * c, r: p.head.r };
  }

  function mouthPoint(p) {
    const h = p.head;
    const ca = cos(h.rot), sa = sin(h.rot);
    const lx = h.r * 0.3 * (1 - h.turn) * 1.12 + h.r * 0.1, ly = h.r * 0.55;
    const mx = h.x + lx * ca - ly * sa, my = h.y + lx * sa + ly * ca;
    const c = cos(p.rot), s = sin(p.rot);
    return { x: p.ox + mx * c - my * s, y: p.oy + mx * s + my * c };
  }

  function pawPoint(p, i) {
    const l = p.legs[i == null ? 3 : i];
    const c = cos(p.rot), s = sin(p.rot);
    return { x: p.ox + l.foot.x * c - l.foot.y * s, y: p.oy + l.foot.x * s + l.foot.y * c };
  }

  // Draw the whole cat into an offscreen buffer, then composite with alpha,
  // so overlapping parts don't show through each other (ghost / fading).
  let offCanvas = null;
  function drawCatAlpha(ctx, pose, face, opts, alpha) {
    if (alpha >= 0.999) { drawCat(ctx, pose, face, opts); return; }
    if (alpha <= 0.001) return;
    const m = ctx.getTransform();
    const sx = hypot(m.a, m.b), sy = hypot(m.c, m.d);
    const W = 240, Hh = 240, ax = 120, ay = 165;
    const cw = Math.ceil(W * sx), ch = Math.ceil(Hh * sy);
    if (!offCanvas) offCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(cw, ch) : document.createElement('canvas');
    if (offCanvas.width < cw || offCanvas.height < ch) { offCanvas.width = cw; offCanvas.height = ch; }
    const o = offCanvas.getContext('2d');
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, offCanvas.width, offCanvas.height);
    o.setTransform(m.a, m.b, m.c, m.d, ax * sx, ay * sy);
    drawCat(o, pose, face, opts);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= alpha;
    ctx.drawImage(offCanvas, 0, 0, cw, ch, m.e - ax * sx, m.f - ay * sy, cw, ch);
    ctx.restore();
  }

  function makePose(name, c) {
    const fn = POSES[name] || POSES.stand;
    c.m = c.m || {};
    const p = fn(c);
    applyMood(p, c.m);
    if (c.swat != null && c.swat >= 0 && c.swat <= 1) applySwat(p, c.swat);
    return p;
  }

  root.CatArt = {
    PALETTES, EYE_COLORS, POSES,
    makePose, lerpPose, clonePose, drawCat, drawCatAlpha, drawEye, heartPath,
    headCenter, mouthPoint, pawPoint, shade,
    util: { clamp, lerp, smooth },
  };
})(typeof window !== 'undefined' ? window : globalThis);
