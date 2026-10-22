/*
 * Desktop Buddies — procedural "Iron Man" style armored hero, enemies and effects.
 *
 * Same idea as catArt.js: every pose returns joint *targets*, resolve() turns
 * them into a full skeleton (2-bone IK for arms and legs), and resolved
 * skeletons blend smoothly with lerpRig().
 *
 * Hero coordinates: origin = ground point under the hero, x forward (caller
 * flips for facing left), y down. Standing height ≈ 95 units.
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const { sin, cos, abs, max, min, hypot, atan2, sqrt, PI } = Math;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const P = (x, y) => ({ x, y });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
  const rot = (p, a) => ({ x: p.x * cos(a) - p.y * sin(a), y: p.x * sin(a) + p.y * cos(a) });
  const norm = (p) => { const l = hypot(p.x, p.y) || 1; return { x: p.x / l, y: p.y / l }; };
  const lp = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });

  // ------------------------------------------------------------------ suits
  const SUITS = {
    classic: { label: 'Classic red & gold', red: ['#f0464c', '#c41f2a', '#7a0d16'], gold: ['#ffe08a', '#f2b134', '#a8700f'], line: '#2a080d', dark: '#3a1015', glow: '#d8fbff', halo: '90,220,255' },
    stealth: { label: 'Stealth', red: ['#5b6170', '#343843', '#17191f'], gold: ['#d9dee8', '#9aa3b3', '#5f6778'], line: '#06070a', dark: '#14161b', glow: '#ffffff', halo: '170,200,255' },
    silver: { label: 'Silver prototype', red: ['#f2f4f7', '#b8bfca', '#717a88'], gold: ['#e1e5eb', '#a6aebb', '#68717f'], line: '#262a31', dark: '#3d424b', glow: '#e9fbff', halo: '120,220,255' },
    patriot: { label: 'Patriot', red: ['#4a6fd0', '#26408f', '#142355'], gold: ['#ffffff', '#d4d9e2', '#8d95a5'], line: '#0a1230', dark: '#7a1420', glow: '#ffffff', halo: '160,200,255' },
    gold: { label: 'Gold', red: ['#ffe08a', '#e0a22a', '#8f5f0a'], gold: ['#fff4c4', '#f2d06a', '#b08a26'], line: '#3a2604', dark: '#4a3008', glow: '#fffbe0', halo: '255,220,140' },
    midnight: { label: 'Midnight', red: ['#3b3e48', '#1d1f26', '#0b0c10'], gold: ['#ff5a5a', '#c41f2a', '#6e0d14'], line: '#000000', dark: '#120406', glow: '#ffd0d0', halo: '255,90,90' },
    arctic: { label: 'Arctic', red: ['#ffffff', '#d7e6f5', '#8fa9c4'], gold: ['#8fd8ff', '#3fa7e0', '#1b6a99'], line: '#1d3550', dark: '#2b4a6b', glow: '#e8fbff', halo: '120,220,255' },
    gunmetal: { label: 'Gunmetal', red: ['#8a929e', '#5b636f', '#30353d'], gold: ['#c7ccd4', '#8e95a0', '#545b66'], line: '#111418', dark: '#22262c', glow: '#ffffff', halo: '170,210,255' },
  };

  // ------------------------------------------------------------------ poses
  // c = { t, T, phase, aim:{x,y}|null (unit dir, local), m:{...} }
  function base(T) {
    const b = 0.5 * sin(T * 2.1);
    return {
      ox: 0, oy: 0, rot: 0,
      hip: P(0, -44 + b * 0.3), lean: 0, headTilt: 0, turn: 0.35,
      // [near, far] — near = viewer side (drawn in front)
      legs: [{ foot: P(-6, -4), knee: null, bend: 1, footAng: 0 }, { foot: P(6, -4), knee: null, bend: 1, footAng: 0 }],
      arms: [{ hand: P(-14, -48 + b), elbow: null, bend: 1, palm: 0, open: 0, thumb: 0, handAng: null }, { hand: P(13, -48 + b), elbow: null, bend: -1, palm: 0, open: 0, thumb: 0, handAng: null }],
      thrust: { feet: 0, hands: [0, 0] },
      pods: 0, reactor: 0.55 + 0.15 * sin(T * 3), eyes: 1, flaps: 0, beam: 0, shadow: 1,
    };
  }

  const POSES = {};

  POSES.stand = (c) => {
    const p = base(c.T);
    p.headTilt = 0.04 * sin(c.T * 0.4);
    return p;
  };

  POSES.idleLook = (c) => {
    const p = base(c.T);
    p.headTilt = -0.12 + 0.1 * sin(c.t * 1.5);
    p.turn = 0.35 + 0.25 * sin(c.t * 0.9);
    return p;
  };

  POSES.gauntlet = (c) => {
    // looking at his raised palm
    const p = base(c.T);
    p.arms[0].hand = P(9, -70 + sin(c.t * 2));
    p.arms[0].open = 1; p.arms[0].palm = 0.35 + 0.25 * sin(c.t * 6); p.arms[0].handAng = -2.2;
    p.headTilt = 0.22;
    return p;
  };

  POSES.walk = (c) => {
    const p = base(c.T);
    const ph = c.phase;
    const s = sin(ph), k = cos(ph);
    p.hip.y = -44 - abs(k) * 1.2;
    p.lean = 0.06;
    p.legs[0].foot = P(-1 + 9 * s, -4 - 5 * max(0, -k));
    p.legs[1].foot = P(1 - 9 * s, -4 - 5 * max(0, k));
    p.legs[0].footAng = -0.25 * max(0, -k);
    p.legs[1].footAng = -0.25 * max(0, k);
    p.arms[0].hand = P(-10 - 6 * s, -49 + 1.5 * abs(s));
    p.arms[1].hand = P(9 + 6 * s, -49 + 1.5 * abs(s));
    return p;
  };

  POSES.crouch = (c) => {
    const p = base(c.T);
    p.hip.y = -33;
    p.lean = 0.25;
    p.legs[0].foot = P(-8, -4); p.legs[1].foot = P(8, -4);
    p.arms[0].hand = P(-12, -36); p.arms[1].hand = P(13, -37);
    p.thrust.feet = 0.25 * (0.5 + 0.5 * sin(c.T * 30));
    return p;
  };

  POSES.hover = (c) => {
    const p = base(c.T);
    const bob = 1.6 * sin(c.T * 3);
    p.hip.y = -46 + bob;
    p.legs[0].foot = P(-4, -7 + bob); p.legs[1].foot = P(4.5, -5 + bob);
    p.legs[0].footAng = 0.35; p.legs[1].footAng = 0.3;
    p.legs[0].bend = 1; p.legs[1].bend = 1;
    p.arms[0].hand = P(-17, -46 + bob); p.arms[1].hand = P(16, -47 + bob);
    p.arms[0].open = p.arms[1].open = 1;
    p.arms[0].handAng = p.arms[1].handAng = PI / 2; // palms down
    p.arms[0].palm = p.arms[1].palm = 0.5;
    p.thrust.feet = 0.75; p.thrust.hands = [0.5, 0.5];
    p.lean = (c.m.lean || 0) * 0.35;
    return p;
  };

  POSES.flyUp = (c) => {
    const p = POSES.hover(c);
    p.legs[0].foot = P(-2, -3); p.legs[1].foot = P(2, -2);
    p.legs[0].footAng = p.legs[1].footAng = 0.9;
    p.arms[0].hand = P(-12, -40); p.arms[1].hand = P(12, -41);
    p.thrust.feet = 1; p.thrust.hands = [0.8, 0.8];
    p.headTilt = -0.15;
    return p;
  };

  POSES.fly = (c) => {
    // the classic flight pose: body nearly horizontal, arms back, everything thrusting
    const p = base(c.T);
    p.hip.y = -44;
    p.legs[0].foot = P(-1.5, -3); p.legs[1].foot = P(2, -4);
    p.legs[0].footAng = p.legs[1].footAng = 1.25;
    p.arms[0].hand = P(-7, -30); p.arms[1].hand = P(6, -31);
    p.arms[0].open = p.arms[1].open = 1;
    p.arms[0].handAng = p.arms[1].handAng = PI / 2;
    p.arms[0].palm = p.arms[1].palm = 0.6;
    p.thrust.feet = 1; p.thrust.hands = [0.85, 0.85];
    p.flaps = 1;
    p.headTilt = -0.7; // look ahead
    p.rot = 1.15 + (c.m.climb || 0) * 0.35;
    p.oy = -10;
    p.shadow = 0;
    return p;
  };

  POSES.land = (c) => {
    // superhero landing: one knee down, fist on the ground
    const p = base(c.T);
    p.hip = P(-2, -21);
    p.lean = 0.55;
    p.legs[0].foot = P(-17, -2); p.legs[0].knee = P(-6, -4); p.legs[0].footAng = 1.2;
    p.legs[1].foot = P(13, -4); p.legs[1].knee = P(14, -24);
    p.arms[0].hand = P(10, -4); p.arms[0].elbow = P(6, -20);
    p.arms[1].hand = P(-27, -26); p.arms[1].open = 1; p.arms[1].handAng = PI * 0.9; p.arms[1].bend = 1;
    p.headTilt = 0.35;
    p.reactor = 1;
    return p;
  };

  POSES.aim = (c) => {
    // one arm out, palm toward the target
    const p = c.m.air ? POSES.hover(c) : base(c.T);
    const a = c.aim || P(1, 0);
    const arm = p.arms[0];
    p.legs[0].foot = c.m.air ? p.legs[0].foot : P(-8, -4);
    p.legs[1].foot = c.m.air ? p.legs[1].foot : P(7, -4);
    arm.hand = add(P(-6, -69), mul(a, 27));
    arm.open = 1; arm.palm = 0.6 + 0.4 * (c.m.charge || 0); arm.handAng = atan2(a.y, a.x);
    arm.bend = a.y < 0 ? -1 : 1;
    p.thrust.hands[0] = 0;
    p.lean = clamp(a.y * 0.15, -0.15, 0.15);
    p.headTilt = clamp(atan2(a.y, max(0.2, a.x)) * 0.5, -0.35, 0.35);
    return p;
  };

  POSES.blast = (c) => {
    // both palms forward — a big repulsor blast
    const p = c.m.air ? POSES.hover(c) : base(c.T);
    const a = c.aim || P(1, 0);
    p.legs[0].foot = c.m.air ? p.legs[0].foot : P(-10, -4);
    p.legs[1].foot = c.m.air ? p.legs[1].foot : P(10, -4);
    p.hip.y += c.m.air ? 0 : 3;
    const tip = add(P(2, -66), mul(a, 24));
    p.arms[0].hand = add(tip, P(-1, 2)); p.arms[1].hand = add(tip, P(1, -2));
    for (const arm of p.arms) { arm.open = 1; arm.palm = 0.6 + 0.4 * (c.m.charge || 0); arm.handAng = atan2(a.y, a.x); }
    p.arms[0].bend = -1; p.arms[1].bend = -1;
    p.thrust.hands = [0, 0];
    p.lean = 0.1;
    return p;
  };

  POSES.unibeam = (c) => {
    const p = c.m.air ? POSES.hover(c) : base(c.T);
    p.legs[0].foot = c.m.air ? p.legs[0].foot : P(-11, -4);
    p.legs[1].foot = c.m.air ? p.legs[1].foot : P(10, -4);
    p.hip.y += c.m.air ? 0 : 2;
    p.lean = -0.12;
    p.arms[0].hand = P(-19, -42); p.arms[1].hand = P(-14, -44);
    p.arms[0].open = p.arms[1].open = 1;
    p.arms[0].handAng = p.arms[1].handAng = PI * 0.85;
    p.arms[0].palm = p.arms[1].palm = 0.5;
    p.thrust.hands = [c.m.air ? 0.6 : 0, c.m.air ? 0.6 : 0];
    p.reactor = 1;
    p.beam = c.m.beam || 0;
    p.headTilt = -0.05;
    return p;
  };

  POSES.missile = (c) => {
    const p = c.m.air ? POSES.hover(c) : base(c.T);
    p.pods = clamp(c.t * 4, 0, 1);
    p.arms[0].hand = P(-17, -52); p.arms[1].hand = P(17, -53);
    p.arms[0].open = p.arms[1].open = 1;
    p.headTilt = -0.2;
    return p;
  };

  POSES.punch = (c) => {
    const p = base(c.T);
    const k = clamp(c.t / 0.18, 0, 1);
    p.lean = 0.22 * k;
    p.legs[0].foot = P(-10, -4); p.legs[1].foot = P(9, -4);
    p.arms[0].hand = lp(P(-4, -60), P(26, -66), k);
    p.arms[1].hand = P(-6, -55);
    return p;
  };

  POSES.thumbsUp = (c) => {
    const p = base(c.T);
    const k = clamp(c.t / 0.3, 0, 1);
    p.arms[0].hand = lp(P(-11.5, -49), P(5, -64), k);
    p.arms[0].thumb = k;
    p.arms[0].handAng = -PI / 2;
    p.turn = 0.6;
    p.headTilt = -0.05;
    return p;
  };

  POSES.salute = (c) => {
    const p = base(c.T);
    const k = clamp(c.t / 0.35, 0, 1);
    p.arms[0].hand = lp(P(-11.5, -49), P(6, -88), k);
    p.arms[0].open = 1; p.arms[0].handAng = -0.4;
    p.turn = 0.55;
    return p;
  };

  POSES.brace = (c) => {
    // crouched, arms crossed in front of the faceplate
    const p = base(c.T);
    p.hip.y = -35;
    p.lean = 0.18;
    p.legs[0].foot = P(-11, -4); p.legs[1].foot = P(9, -4);
    p.arms[0].hand = P(8, -74); p.arms[1].hand = P(4, -78);
    p.arms[0].bend = -1; p.arms[1].bend = 1;
    p.arms[0].handAng = p.arms[1].handAng = -PI / 2;
    p.headTilt = 0.3;
    p.reactor = 0.9;
    p.thrust.feet = 0.15 * (0.5 + 0.5 * sin(c.T * 30));
    return p;
  };

  POSES.stagger = (c) => {
    const p = c.m.air ? POSES.hover(c) : base(c.T);
    p.lean = -0.3;
    p.arms[0].hand = P(4, -72); p.arms[1].hand = P(10, -70);
    p.headTilt = -0.25;
    return p;
  };

  POSES.down = (c) => {
    const p = base(c.T);
    p.rot = -1.5;
    p.oy = 38;
    p.ox = 6;
    p.arms[0].hand = P(-14, -40); p.arms[1].hand = P(14, -44);
    p.legs[0].foot = P(-6, -3); p.legs[1].foot = P(5, -6);
    p.eyes = c.m.eyes == null ? 0 : c.m.eyes;
    p.reactor = c.m.reactor == null ? 0.15 : c.m.reactor;
    p.shadow = 1.4;
    return p;
  };

  POSES.powerDown = (c) => {
    // standing at rest in stand-by, slightly slumped
    const p = base(c.T);
    p.hip.y = -43;
    p.lean = 0.05;
    p.headTilt = 0.3;
    p.eyes = 0.15;
    p.reactor = 0.25 + 0.05 * sin(c.T);
    return p;
  };

  POSES.held = (c) => {
    // held up by the back of the armor; thrusters sputter
    const p = base(c.T);
    const f = sin(c.T * 7), g = sin(c.T * 5.3);
    p.hip.y = -44;
    p.legs[0].foot = P(-4 + 2 * f, -3); p.legs[1].foot = P(4 - 2 * f, -5);
    p.legs[0].footAng = p.legs[1].footAng = 0.8;
    p.arms[0].hand = P(-17, -62 + 4 * g); p.arms[1].hand = P(16, -63 - 4 * g);
    p.arms[0].open = p.arms[1].open = 1;
    p.thrust.feet = 0.3 * (0.5 + 0.5 * sin(c.T * 40));
    p.headTilt = -0.1;
    p.rot = c.m.swing || 0;
    p.shadow = 0;
    return p;
  };

  // ------------------------------------------------------------------ resolve & blend
  const THIGH = 19, SHIN = 22, UPPER = 14.5, FORE = 14;

  function ik(r, f, L1, L2, bend) {
    const dx = f.x - r.x, dy = f.y - r.y;
    const d = hypot(dx, dy);
    if (d < 0.001) return P(r.x, r.y);
    if (d >= L1 + L2 - 0.01) return P(r.x + dx * L1 / (L1 + L2), r.y + dy * L1 / (L1 + L2));
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = sqrt(max(0, L1 * L1 - a * a));
    const ux = dx / d, uy = dy / d;
    return P(r.x + ux * a - uy * h * bend, r.y + uy * a + ux * h * bend);
  }

  function reachTo(r, f, L) {
    const d = sub(f, r), l = hypot(d.x, d.y);
    return l > L ? add(r, mul(d, L / l)) : f;
  }

  // Turn pose targets into a complete skeleton.
  function resolve(p) {
    const L = p.lean;
    const hip = p.hip;
    const chest = add(hip, rot(P(0, -26), L));
    const neck = add(hip, rot(P(0.5, -31), L));
    const head = add(hip, rot(P(1.5, -42), L));
    const sh = [add(hip, rot(P(-10.5, -29.5), L)), add(hip, rot(P(10, -30.5), L))];
    const hp = [add(hip, P(-4.4, 0)), add(hip, P(4.4, -0.6))];
    const arms = p.arms.map((a, i) => {
      const hand = reachTo(sh[i], a.hand, UPPER + FORE - 0.2);
      const elbow = a.elbow ? a.elbow : ik(sh[i], hand, UPPER, FORE, a.bend);
      const ang = a.handAng == null ? atan2(hand.y - elbow.y, hand.x - elbow.x) : a.handAng;
      return { sh: sh[i], elbow, hand, ang, palm: a.palm, open: a.open, thumb: a.thumb, thrust: p.thrust.hands[i] };
    });
    const legs = p.legs.map((l, i) => {
      const foot = reachTo(hp[i], l.foot, THIGH + SHIN - 0.2);
      const knee = l.knee ? l.knee : ik(hp[i], foot, THIGH, SHIN, l.bend);
      return { hip: hp[i], knee, foot, ang: l.footAng };
    });
    return {
      ox: p.ox, oy: p.oy, rot: p.rot, lean: L, headTilt: p.headTilt, turn: p.turn,
      hip, chest, neck, head, arms, legs,
      thrustFeet: p.thrust.feet, pods: p.pods, reactor: p.reactor, eyes: p.eyes, flaps: p.flaps, beam: p.beam, shadow: p.shadow,
    };
  }

  function lerpAng(a, b, k) {
    let d = b - a;
    while (d > PI) d -= TAU;
    while (d < -PI) d += TAU;
    return a + d * k;
  }

  function lerpRig(a, b, k) {
    if (k >= 1) return b;
    if (k <= 0) return a;
    const o = {};
    for (const key of ['ox', 'oy', 'rot', 'lean', 'headTilt', 'turn', 'thrustFeet', 'pods', 'reactor', 'eyes', 'flaps', 'beam', 'shadow']) o[key] = lerp(a[key], b[key], k);
    for (const key of ['hip', 'chest', 'neck', 'head']) o[key] = lp(a[key], b[key], k);
    o.arms = a.arms.map((x, i) => {
      const y = b.arms[i];
      return { sh: lp(x.sh, y.sh, k), elbow: lp(x.elbow, y.elbow, k), hand: lp(x.hand, y.hand, k), ang: lerpAng(x.ang, y.ang, k), palm: lerp(x.palm, y.palm, k), open: lerp(x.open, y.open, k), thumb: lerp(x.thumb, y.thumb, k), thrust: lerp(x.thrust, y.thrust, k) };
    });
    o.legs = a.legs.map((x, i) => {
      const y = b.legs[i];
      return { hip: lp(x.hip, y.hip, k), knee: lp(x.knee, y.knee, k), foot: lp(x.foot, y.foot, k), ang: lerp(x.ang, y.ang, k) };
    });
    return o;
  }

  function makeRig(name, c) {
    c.m = c.m || {};
    const fn = POSES[name] || POSES.stand;
    return resolve(fn(c));
  }

  // ------------------------------------------------------------------ drawing helpers
  function grad(ctx, x1, y1, x2, y2, cols) {
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, cols[0]); g.addColorStop(0.55, cols[1]); g.addColorStop(1, cols[2]);
    return g;
  }

  // a tapered capsule from a to b
  function limbPath(ctx, a, b, w1, w2) {
    const d = norm(sub(b, a));
    const n = P(-d.y, d.x);
    ctx.beginPath();
    ctx.moveTo(a.x + n.x * w1 / 2, a.y + n.y * w1 / 2);
    ctx.lineTo(b.x + n.x * w2 / 2, b.y + n.y * w2 / 2);
    ctx.arc(b.x, b.y, w2 / 2, atan2(n.y, n.x), atan2(n.y, n.x) - PI, true);
    ctx.lineTo(a.x - n.x * w1 / 2, a.y - n.y * w1 / 2);
    ctx.arc(a.x, a.y, w1 / 2, atan2(-n.y, -n.x), atan2(-n.y, -n.x) - PI, true);
    ctx.closePath();
  }

  function limb(ctx, a, b, w1, w2, cols, line) {
    limbPath(ctx, a, b, w1, w2);
    const d = norm(sub(b, a)), n = P(-d.y, d.x);
    const m = lp(a, b, 0.5);
    ctx.fillStyle = grad(ctx, m.x - n.x * w1 / 2, m.y - n.y * w1 / 2, m.x + n.x * w1 / 2, m.y + n.y * w1 / 2, cols);
    ctx.fill();
    ctx.lineWidth = 1.1; ctx.strokeStyle = line; ctx.stroke();
  }

  function glow(ctx, x, y, r, halo, a) {
    if (a <= 0.01) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * a})`);
    g.addColorStop(0.25, `rgba(${halo},${0.55 * a})`);
    g.addColorStop(1, `rgba(${halo},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  // Repulsor / boot flame pointing along `ang` from (x, y)
  function flame(ctx, x, y, ang, len, w, halo, T) {
    if (len <= 0.5) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const fl = len * (0.85 + 0.15 * sin(T * 55 + x));
    const g = ctx.createLinearGradient(0, 0, fl, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.25, `rgba(${halo},0.85)`);
    g.addColorStop(1, `rgba(${halo},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -w / 2);
    ctx.quadraticCurveTo(fl * 0.55, -w * 0.45, fl, 0);
    ctx.quadraticCurveTo(fl * 0.55, w * 0.45, 0, w / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------------ hero
  function drawLeg(ctx, L, S, far) {
    const red = far ? [S.red[1], S.red[2], S.red[2]] : S.red;
    const gold = far ? [S.gold[1], S.gold[2], S.gold[2]] : S.gold;
    limb(ctx, L.hip, L.knee, 11.2, 8.8, red, S.line);
    limb(ctx, L.knee, L.foot, 8.6, 7.4, red, S.line);
    // gold shin guard
    const d = norm(sub(L.foot, L.knee)), n = P(d.y, -d.x);
    const a = add(lp(L.knee, L.foot, 0.25), mul(n, 1.8)), b = add(lp(L.knee, L.foot, 0.85), mul(n, 1.6));
    limb(ctx, a, b, 3.8, 3.1, gold, S.line);
    // boot
    ctx.save();
    ctx.translate(L.foot.x, L.foot.y);
    ctx.rotate(L.ang);
    ctx.beginPath();
    ctx.moveTo(-3.6, -2); ctx.lineTo(3.2, -2.4); ctx.quadraticCurveTo(7.6, -0.5, 8, 3.2);
    ctx.lineTo(-3.8, 3.8); ctx.closePath();
    ctx.fillStyle = grad(ctx, 0, -2.4, 0, 3.8, red); ctx.fill();
    ctx.lineWidth = 1.1; ctx.strokeStyle = S.line; ctx.stroke();
    ctx.fillStyle = S.dark; ctx.fillRect(-3.6, 2.6, 11, 1.3);
    ctx.restore();
    // knee cap
    ctx.beginPath(); ctx.arc(L.knee.x + 0.6, L.knee.y, 3.9, 0, TAU);
    ctx.fillStyle = grad(ctx, L.knee.x, L.knee.y - 3, L.knee.x, L.knee.y + 3, gold); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = S.line; ctx.stroke();
  }

  function drawArm(ctx, A, S, far, pods) {
    const red = far ? [S.red[1], S.red[2], S.red[2]] : S.red;
    const gold = far ? [S.gold[1], S.gold[2], S.gold[2]] : S.gold;
    limb(ctx, A.sh, A.elbow, 8.2, 7.2, gold, S.line);
    limb(ctx, A.elbow, A.hand, 7.6, 8.4, red, S.line);
    ctx.beginPath(); ctx.arc(A.elbow.x, A.elbow.y, 3.1, 0, TAU); ctx.fillStyle = S.dark; ctx.fill();
    // hand
    ctx.save();
    ctx.translate(A.hand.x, A.hand.y);
    ctx.rotate(A.ang);
    ctx.beginPath();
    if (A.open > 0.5) { ctx.moveTo(-1, -3.2); ctx.lineTo(5.5, -2.8); ctx.quadraticCurveTo(7.6, 0, 5.5, 2.8); ctx.lineTo(-1, 3.2); }
    else { ctx.moveTo(-1, -3.3); ctx.lineTo(3.4, -3.3); ctx.quadraticCurveTo(6, -3.2, 6, 0); ctx.quadraticCurveTo(6, 3.3, 3.4, 3.3); ctx.lineTo(-1, 3.3); }
    ctx.closePath();
    ctx.fillStyle = grad(ctx, 0, -3.3, 0, 3.3, red); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = S.line; ctx.stroke();
    if (A.thumb > 0.1) {
      ctx.beginPath(); ctx.moveTo(2, -3); ctx.lineTo(2 + 0.4 * A.thumb, -3 - 5 * A.thumb);
      ctx.lineCap = 'round'; ctx.lineWidth = 2.8; ctx.strokeStyle = S.line; ctx.stroke();
      ctx.lineWidth = 1.6; ctx.strokeStyle = S.red[0]; ctx.stroke();
    }
    ctx.restore();
    // shoulder pauldron (+ missile pod)
    ctx.save();
    ctx.translate(A.sh.x, A.sh.y);
    if (pods > 0.02) {
      ctx.save();
      ctx.rotate(-pods * 0.9);
      ctx.fillStyle = S.dark;
      ctx.fillRect(-4, -6 - pods * 2, 8, 5);
      ctx.fillStyle = '#dfe6ee';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-2.6 + i * 2.6, -6 - pods * 2.4, 1, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    ctx.beginPath(); ctx.ellipse(0, -0.5, 6.6, 5.6, 0, 0, TAU);
    ctx.fillStyle = grad(ctx, 0, -6, 0, 5, red); ctx.fill();
    ctx.lineWidth = 1.1; ctx.strokeStyle = S.line; ctx.stroke();
    ctx.restore();
  }

  function drawTorso(ctx, R, S, T) {
    ctx.save();
    ctx.translate(R.hip.x, R.hip.y);
    ctx.rotate(R.lean);
    const f = 2.2 * (R.turn - 0.35) / 0.65 + 1.2; // feature shift toward facing
    // trunks / hips
    ctx.beginPath();
    ctx.moveTo(-9.6, -3); ctx.lineTo(9.6, -3); ctx.lineTo(8.6, 3.5); ctx.lineTo(-8.6, 3.5); ctx.closePath();
    ctx.fillStyle = grad(ctx, 0, -3, 0, 3, S.red); ctx.fill();
    ctx.lineWidth = 1.1; ctx.strokeStyle = S.line; ctx.stroke();
    // torso shell
    ctx.beginPath();
    ctx.moveTo(-8.2, -4);
    ctx.lineTo(-12.4, -19); ctx.quadraticCurveTo(-13.6, -27.5, -9, -30.5);
    ctx.lineTo(-3.5, -32); ctx.lineTo(4, -32); ctx.lineTo(10, -30.5);
    ctx.quadraticCurveTo(14.6, -27.5, 13.4, -19);
    ctx.lineTo(8.4, -4); ctx.closePath();
    ctx.fillStyle = grad(ctx, -11, -31, 11, -4, S.red); ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = S.line; ctx.stroke();
    // gold abs
    ctx.beginPath();
    ctx.moveTo(-5 + f * 0.3, -5); ctx.lineTo(5.5 + f * 0.3, -5); ctx.lineTo(6.8 + f * 0.3, -15); ctx.lineTo(-5.8 + f * 0.3, -15); ctx.closePath();
    ctx.fillStyle = grad(ctx, 0, -15, 0, -5, S.gold); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(f * 0.3 + 0.3, -5); ctx.lineTo(f * 0.3 + 0.6, -15);
    ctx.moveTo(-5.4 + f * 0.3, -8.4); ctx.lineTo(6 + f * 0.3, -8.4);
    ctx.moveTo(-5.6 + f * 0.3, -11.8); ctx.lineTo(6.4 + f * 0.3, -11.8);
    ctx.stroke();
    // chest plate seams
    ctx.strokeStyle = S.line; ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-9, -16.5); ctx.quadraticCurveTo(f, -15, 10.5, -16.5);
    ctx.moveTo(-6.5, -29); ctx.lineTo(-2 + f, -22); ctx.moveTo(8, -29); ctx.lineTo(4 + f, -22);
    ctx.stroke();
    // arc reactor
    const rx = 1 + f, ry = -21.5;
    ctx.beginPath(); ctx.arc(rx, ry, 4.4, 0, TAU); ctx.fillStyle = S.dark; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = S.line; ctx.stroke();
    ctx.beginPath(); ctx.arc(rx, ry, 3.3, 0, TAU); ctx.fillStyle = `rgba(${S.halo},${0.5 + 0.5 * R.reactor})`; ctx.fill();
    ctx.beginPath(); ctx.arc(rx, ry, 1.8, 0, TAU); ctx.fillStyle = S.glow; ctx.globalAlpha = 0.4 + 0.6 * R.reactor; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = `rgba(255,255,255,${0.35 * R.reactor})`; ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = i * TAU / 10; ctx.moveTo(rx + cos(a) * 2.2, ry + sin(a) * 2.2); ctx.lineTo(rx + cos(a) * 3.2, ry + sin(a) * 3.2); }
    ctx.stroke();
    // back flaps (flight)
    if (R.flaps > 0.05) {
      ctx.fillStyle = S.red[2];
      ctx.beginPath(); ctx.moveTo(-10, -28); ctx.lineTo(-10 - 6 * R.flaps, -26); ctx.lineTo(-10.5, -21); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    return { x: R.hip.x + rot(P(rx, ry), R.lean).x, y: R.hip.y + rot(P(rx, ry), R.lean).y };
  }

  function drawHead(ctx, R, S, T) {
    ctx.save();
    ctx.translate(R.head.x, R.head.y);
    ctx.rotate(R.lean + R.headTilt);
    const f = 1.5 + 2.6 * (R.turn - 0.35) / 0.65;
    // neck
    ctx.fillStyle = S.dark; ctx.fillRect(-3, 5, 6, 5);
    // helmet shell
    ctx.beginPath();
    ctx.moveTo(-7.8, 1);
    ctx.bezierCurveTo(-8.6, -6.5, -4, -10.4, 1.2, -10.2);
    ctx.bezierCurveTo(6.6, -10, 9.4, -5.6, 8.6, 1);
    ctx.lineTo(7.4, 6.4); ctx.quadraticCurveTo(4, 9.6, 0, 9.6);
    ctx.quadraticCurveTo(-5, 9.4, -7, 6); ctx.closePath();
    ctx.fillStyle = grad(ctx, -8, -10, 8, 9, S.red); ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = S.line; ctx.stroke();
    // ear disc
    ctx.beginPath(); ctx.arc(-4.6 + f * 0.2, 0.5, 2.3, 0, TAU); ctx.fillStyle = S.red[2]; ctx.fill(); ctx.lineWidth = 0.9; ctx.stroke();
    // gold faceplate
    ctx.beginPath();
    ctx.moveTo(f - 0.2, -7.6);
    ctx.lineTo(f + 1.4, -5.6); ctx.lineTo(f + 5.6, -5.2);
    ctx.lineTo(f + 6.3, 2); ctx.lineTo(f + 4.6, 7.2); ctx.lineTo(f + 1.5, 8.8);
    ctx.lineTo(f - 2.2, 8.6); ctx.lineTo(f - 3.8, 6.6); ctx.lineTo(f - 4.4, 1.6);
    ctx.lineTo(f - 3.6, -5); ctx.lineTo(f - 1.6, -5.6); ctx.closePath();
    ctx.fillStyle = grad(ctx, f, -7.6, f, 8.8, S.gold); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = S.line; ctx.stroke();
    // eyes
    const e = R.eyes;
    const eye = (x1, x2, slope) => {
      ctx.beginPath();
      ctx.moveTo(x1, -1.4 + slope); ctx.lineTo(x2, -1.9 - slope * 0.3); ctx.lineTo(x2 - 0.4, -0.1); ctx.lineTo(x1 + 0.3, 0.2 + slope * 0.5); ctx.closePath();
    };
    ctx.fillStyle = S.dark;
    eye(f - 3.4, f - 0.6, 0.5); ctx.fill();
    eye(f + 1.2, f + 4.8, -0.5); ctx.fill();
    if (e > 0.02) {
      ctx.globalAlpha = e;
      ctx.fillStyle = S.glow;
      eye(f - 3.4, f - 0.6, 0.5); ctx.fill();
      eye(f + 1.2, f + 4.8, -0.5); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, f - 2, -0.8, 4.5, S.halo, 0.6 * e);
      glow(ctx, f + 3, -0.9, 4.5, S.halo, 0.6 * e);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    // mouth slit + cheek lines
    ctx.strokeStyle = 'rgba(40,20,0,0.55)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(f - 1.6, 5.4); ctx.lineTo(f + 2.6, 5.4);
    ctx.moveTo(f - 3.6, 2.6); ctx.lineTo(f - 1.8, 4.2);
    ctx.moveTo(f + 5.6, 2.6); ctx.lineTo(f + 3.6, 4.2);
    ctx.stroke();
    ctx.restore();
  }

  // Draw the hero. Returns useful world-local points (reactor, palms, feet).
  function drawHero(ctx, R, opts) {
    opts = opts || {};
    const S = SUITS[opts.suit] || SUITS.classic;
    const T = opts.T || 0;
    ctx.save();
    ctx.translate(R.ox, R.oy);
    if (R.rot) { ctx.translate(R.hip.x, R.hip.y); ctx.rotate(R.rot); ctx.translate(-R.hip.x, -R.hip.y); }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    drawLeg(ctx, R.legs[1], S, true);
    drawArm(ctx, R.arms[1], S, true, R.pods);
    drawTorso(ctx, R, S, T);
    drawLeg(ctx, R.legs[0], S, false);
    drawHead(ctx, R, S, T);
    drawArm(ctx, R.arms[0], S, false, R.pods);

    // light: boot jets, palm repulsors, reactor glow
    ctx.globalCompositeOperation = 'lighter';
    for (const L of R.legs) {
      if (R.thrustFeet > 0.02) {
        const ang = atan2(L.foot.y - L.knee.y, L.foot.x - L.knee.x); // jets fire down the leg
        const fx = L.foot.x + cos(L.ang) * 2 - sin(L.ang) * -3.5, fy = L.foot.y + sin(L.ang) * 2 + cos(L.ang) * 3.5;
        glow(ctx, fx, fy, 6 + 4 * R.thrustFeet, S.halo, R.thrustFeet);
        flame(ctx, fx, fy, ang, 8 + 18 * R.thrustFeet, 4.5, S.halo, T);
      }
    }
    for (const A of R.arms) {
      const px = A.hand.x + cos(A.ang) * 4.5, py = A.hand.y + sin(A.ang) * 4.5;
      const pa = max(A.palm, A.thrust);
      if (pa > 0.02) glow(ctx, px, py, 5 + 5 * pa, S.halo, pa);
      if (A.thrust > 0.02) flame(ctx, px, py, A.ang, 6 + 14 * A.thrust, 3.6, S.halo, T);
    }
    const rc = add(R.hip, rot(P(1 + 1.5 + 2.2 * (R.turn - 0.35) / 0.65 - 0.3, -21.5), R.lean));
    glow(ctx, rc.x, rc.y, 7 + 6 * R.reactor + 10 * R.beam, S.halo, 0.45 + 0.4 * R.reactor);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  // world-local points for effects (after ox/oy/rot), in hero-local units
  function points(R) {
    const tr = (p) => {
      let q = { x: p.x, y: p.y };
      if (R.rot) { q = add(R.hip, rot(sub(q, R.hip), R.rot)); }
      return { x: q.x + R.ox, y: q.y + R.oy };
    };
    const f = 1.2 + 2.2 * (R.turn - 0.35) / 0.65;
    const reactor = tr(add(R.hip, rot(P(1 + f, -21.5), R.lean)));
    const palms = R.arms.map((A) => tr(P(A.hand.x + cos(A.ang) * 5, A.hand.y + sin(A.ang) * 5)));
    const shoulders = R.arms.map((A) => tr(A.sh));
    return { reactor, palms, shoulders, head: tr(R.head), hip: tr(R.hip) };
  }

  // ------------------------------------------------------------------ enemies
  const MET = ['#8a93a3', '#5a6272', '#2f343e'];
  const ENEMY_LINE = '#15181e';

  function hpBar(ctx, e, w, y) {
    if (e.hp >= e.maxHp) return;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(-w / 2 - 1, y - 1, w + 2, 4);
    ctx.fillStyle = e.hp / e.maxHp > 0.35 ? '#ff5a4f' : '#ffb02e';
    ctx.fillRect(-w / 2, y, w * clamp(e.hp / e.maxHp, 0, 1), 2);
  }

  function redEye(ctx, x, y, r, T, charge) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = '#ff2a3a'; ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    const gr = r * (1.8 + 1.6 * (charge || 0));
    const g = ctx.createRadialGradient(x, y, 0, x, y, gr);
    g.addColorStop(0, 'rgba(255,120,120,0.75)'); g.addColorStop(1, 'rgba(255,0,30,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, gr, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  const ENEMIES = {
    drone(ctx, e, T) {
      const tilt = clamp((e.vx || 0) / 600, -0.35, 0.35);
      ctx.save();
      ctx.rotate(tilt);
      // arms + thrusters
      for (const s of [-1, 1]) {
        ctx.strokeStyle = MET[2]; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s * 6, 0); ctx.lineTo(s * 15, -3); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(s * 16, -3.5, 4.5, 2, 0, 0, TAU); ctx.fillStyle = MET[1]; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = ENEMY_LINE; ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(0, -1, 0, 9);
        g.addColorStop(0, 'rgba(255,150,60,0.9)'); g.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(s * 16 - 2.5, -2); ctx.lineTo(s * 16 + 2.5, -2); ctx.lineTo(s * 16, 7 + 2 * sin(T * 40 + s)); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      // body
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 7, 0, 0, TAU);
      ctx.fillStyle = grad(ctx, 0, -7, 0, 7, MET); ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = ENEMY_LINE; ctx.stroke();
      ctx.fillStyle = '#20242c'; ctx.beginPath(); ctx.ellipse(2, 1, 5.5, 3.6, 0, 0, TAU); ctx.fill();
      redEye(ctx, 3.5, 1, 2, T, e.charge);
      ctx.strokeStyle = MET[2]; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-2, -7); ctx.lineTo(-4, -12); ctx.stroke();
      ctx.beginPath(); ctx.arc(-4, -12.5, 1.2, 0, TAU); ctx.fillStyle = (T * 2) % 1 < 0.5 ? '#ff3a3a' : '#5a1010'; ctx.fill();
      ctx.restore();
      hpBar(ctx, e, 22, -18);
    },
    mini(ctx, e, T) {
      ctx.save();
      ctx.rotate(T * 4 + (e.seed || 0));
      ctx.fillStyle = MET[2];
      for (let i = 0; i < 6; i++) { ctx.rotate(TAU / 6); ctx.beginPath(); ctx.moveTo(4.5, -1.5); ctx.lineTo(8, 0); ctx.lineTo(4.5, 1.5); ctx.fill(); }
      ctx.restore();
      ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, TAU); ctx.fillStyle = grad(ctx, 0, -5, 0, 5, MET); ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = ENEMY_LINE; ctx.stroke();
      redEye(ctx, 1.5, 0, 1.8, T, 0.5 + 0.5 * sin(T * 12));
    },
    walker(ctx, e, T) {
      const ph = e.phase || 0, s = sin(ph);
      // legs
      const legL = (dx, k) => {
        const hip = P(dx, -18), foot = P(dx + 6 * k, 0), knee = P(dx - 5 + 2 * k, -9);
        ctx.strokeStyle = ENEMY_LINE; ctx.lineWidth = 4.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(knee.x, knee.y); ctx.lineTo(foot.x, foot.y); ctx.stroke();
        ctx.strokeStyle = MET[1]; ctx.lineWidth = 2.8;
        ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(knee.x, knee.y); ctx.lineTo(foot.x, foot.y); ctx.stroke();
        ctx.fillStyle = MET[2]; ctx.fillRect(foot.x - 4, -2, 8, 2);
      };
      legL(3, -s); legL(-3, s);
      // body
      ctx.save();
      ctx.translate(0, -26 + abs(s) * 0.8);
      ctx.beginPath(); ctx.moveTo(-10, -8); ctx.lineTo(9, -9); ctx.lineTo(11, 5); ctx.lineTo(-9, 7); ctx.closePath();
      ctx.fillStyle = grad(ctx, 0, -9, 0, 7, MET); ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = ENEMY_LINE; ctx.stroke();
      ctx.fillStyle = '#20242c'; ctx.fillRect(1, -6, 9, 4.5);
      redEye(ctx, 6.5, -3.8, 1.6, T, e.charge);
      // cannon
      ctx.fillStyle = MET[2]; ctx.fillRect(4, 1, 13, 3.6);
      ctx.fillStyle = '#ff5a3a'; ctx.globalAlpha = 0.3 + 0.7 * (e.charge || 0); ctx.fillRect(16, 1.4, 2, 2.8); ctx.globalAlpha = 1;
      ctx.restore();
      hpBar(ctx, e, 24, -42);
    },
    tank(ctx, e, T) {
      const tr = (e.phase || 0) * 3;
      ctx.beginPath(); ctx.moveTo(-22, -10); ctx.lineTo(22, -10); ctx.quadraticCurveTo(27, -5, 22, 0); ctx.lineTo(-22, 0); ctx.quadraticCurveTo(-27, -5, -22, -10); ctx.closePath();
      ctx.fillStyle = '#25282f'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = ENEMY_LINE; ctx.stroke();
      ctx.fillStyle = '#4a505c';
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.arc(i * 6.5, -5, 2.8, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = '#6a7280'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 12; i++) { const x = -22 + ((i * 4 + tr) % 44); ctx.moveTo(x, -10); ctx.lineTo(x, -8.6); ctx.moveTo(x, 0); ctx.lineTo(x, -1.4); }
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-20, -10); ctx.lineTo(-15, -20); ctx.lineTo(16, -20); ctx.lineTo(21, -10); ctx.closePath();
      ctx.fillStyle = grad(ctx, 0, -20, 0, -10, ['#7e8a6b', '#5a6548', '#33392a']); ctx.fill(); ctx.strokeStyle = ENEMY_LINE; ctx.stroke();
      ctx.save();
      ctx.translate(2, -22);
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 5.5, 0, 0, TAU); ctx.fillStyle = '#5a6548'; ctx.fill(); ctx.stroke();
      ctx.rotate(e.aim || -0.25);
      ctx.fillStyle = '#33392a'; ctx.fillRect(4, -1.8, 20, 3.6); ctx.strokeRect(4, -1.8, 20, 3.6);
      ctx.restore();
      redEye(ctx, -2, -22, 1.4, T, e.charge);
      hpBar(ctx, e, 34, -36);
    },
    boss(ctx, e, T) {
      const ph = e.phase || 0, s = sin(ph);
      ctx.save();
      ctx.scale(2.1, 2.1);
      const leg = (dx, k) => {
        ctx.strokeStyle = ENEMY_LINE; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(dx, -20); ctx.lineTo(dx - 4 + 3 * k, -10); ctx.lineTo(dx + 5 * k, 0); ctx.stroke();
        ctx.strokeStyle = '#6b5a5a'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(dx, -20); ctx.lineTo(dx - 4 + 3 * k, -10); ctx.lineTo(dx + 5 * k, 0); ctx.stroke();
        ctx.fillStyle = '#2a2224'; ctx.fillRect(dx + 5 * k - 5, -2.4, 10, 2.4);
      };
      leg(5, -s); leg(-5, s);
      ctx.translate(0, -30 + abs(s));
      // torso
      ctx.beginPath(); ctx.moveTo(-14, -12); ctx.lineTo(14, -12); ctx.lineTo(11, 9); ctx.lineTo(-11, 9); ctx.closePath();
      ctx.fillStyle = grad(ctx, 0, -12, 0, 9, ['#8c7676', '#5b4646', '#2c2122']); ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = ENEMY_LINE; ctx.stroke();
      // core
      redEye(ctx, 0, -1, 2.2, T, e.charge);
      // shoulders + cannons
      for (const sgn of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(sgn * 15, -12, 7, 5.5, 0, 0, TAU); ctx.fillStyle = '#4b3a3a'; ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2c2122'; ctx.fillRect(sgn * 15 - 2, -22, 4, 8); ctx.strokeRect(sgn * 15 - 2, -22, 4, 8);
      }
      ctx.fillStyle = '#2c2122'; ctx.fillRect(8, 0, 18, 5); ctx.strokeRect(8, 0, 18, 5);
      // head
      ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(-5, -20); ctx.lineTo(6, -20); ctx.lineTo(7, -12); ctx.closePath();
      ctx.fillStyle = '#5b4646'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff2a3a'; ctx.fillRect(-1, -17.5, 7, 2);
      ctx.restore();
      hpBar(ctx, e, 60, -104);
    },
  };

  function drawEnemy(ctx, e, T) {
    const fn = ENEMIES[e.kind];
    if (!fn) return;
    ctx.save();
    const flip = e.facing < 0;
    if (flip) ctx.scale(-1, 1);
    fn(ctx, e, T);
    ctx.restore();
  }

  // ------------------------------------------------------------------ projectiles & effects (global coords)
  function drawBeam(ctx, x1, y1, x2, y2, w, k, halo, core) {
    const a = atan2(y2 - y1, x2 - x1), L = hypot(x2 - x1, y2 - y1);
    ctx.save();
    ctx.translate(x1, y1); ctx.rotate(a);
    ctx.globalCompositeOperation = 'lighter';
    const ww = w * (0.8 + 0.2 * sin(k * 60));
    let g = ctx.createLinearGradient(0, -ww * 1.6, 0, ww * 1.6);
    g.addColorStop(0, `rgba(${halo},0)`); g.addColorStop(0.5, `rgba(${halo},0.55)`); g.addColorStop(1, `rgba(${halo},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, -ww * 1.6, L, ww * 3.2);
    ctx.fillStyle = core || 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.moveTo(0, -ww * 0.35); ctx.lineTo(L, -ww * 0.25); ctx.lineTo(L, ww * 0.25); ctx.lineTo(0, ww * 0.35); ctx.closePath(); ctx.fill();
    glow(ctx, 0, 0, ww * 2.2, halo, 0.9);
    glow(ctx, L, 0, ww * 2.6, halo, 0.9);
    ctx.restore();
  }

  function drawLaser(ctx, x, y, vx, vy) {
    const a = atan2(vy, vx);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,40,60,0.45)'; ctx.fillRect(-14, -2.4, 16, 4.8);
    ctx.fillStyle = 'rgba(255,220,220,0.95)'; ctx.fillRect(-11, -0.8, 12, 1.6);
    ctx.restore();
  }

  function drawMissile(ctx, x, y, a, T, enemy) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(-16, 0, -3, 0);
    g.addColorStop(0, 'rgba(255,120,30,0)'); g.addColorStop(1, 'rgba(255,220,120,0.95)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-3, -1.6); ctx.lineTo(-14 - 3 * sin(T * 50), 0); ctx.lineTo(-3, 1.6); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = enemy ? '#6b3a3a' : '#e8edf2'; ctx.strokeStyle = '#2a2f38'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-4, -1.6); ctx.lineTo(4, -1.6); ctx.quadraticCurveTo(7, 0, 4, 1.6); ctx.lineTo(-4, 1.6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = enemy ? '#ff3a3a' : '#c41f2a'; ctx.fillRect(3, -1.6, 1.5, 3.2);
    ctx.restore();
  }

  function drawShell(ctx, x, y, T) {
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, x, y, 7, '255,140,40', 0.8);
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath(); ctx.arc(x, y, 2.6, 0, TAU); ctx.fillStyle = '#2a2a2a'; ctx.fill();
  }

  // explosion & combat particles: p = { type, k (0..1), size, rot, color }
  const FX = {
    fire(ctx, p) {
      const r = (6 + 18 * p.k) * p.size;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, `rgba(255,250,210,${0.95 * (1 - p.k)})`);
      g.addColorStop(0.35, `rgba(255,170,40,${0.85 * (1 - p.k)})`);
      g.addColorStop(0.8, `rgba(220,60,20,${0.5 * (1 - p.k)})`);
      g.addColorStop(1, 'rgba(120,20,0,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    },
    smoke(ctx, p) {
      const r = (5 + 14 * p.k) * p.size;
      ctx.fillStyle = `rgba(70,70,78,${0.45 * (1 - p.k)})`;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    },
    debris(ctx, p) {
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color || '#5a6272';
      ctx.fillRect(-2.2 * p.size, -1.2 * p.size, 4.4 * p.size, 2.4 * p.size);
    },
    ring(ctx, p) {
      ctx.strokeStyle = `rgba(${p.color || '255,220,160'},${0.8 * (1 - p.k)})`;
      ctx.lineWidth = 3 * (1 - p.k) + 0.5;
      ctx.beginPath(); ctx.ellipse(0, 0, (8 + 60 * p.k) * p.size, (8 + 60 * p.k) * p.size * (p.flat || 1), 0, 0, TAU); ctx.stroke();
    },
    spark(ctx, p) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.rotate(p.rot);
      ctx.fillStyle = `rgba(255,230,150,${1 - p.k})`;
      ctx.fillRect(-3 * p.size, -0.6, 6 * p.size, 1.2);
      ctx.globalCompositeOperation = 'source-over';
    },
    flash(ctx, p) {
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, 0, 0, (14 + 20 * p.k) * p.size, p.color || '140,230,255', 1 - p.k);
      ctx.globalCompositeOperation = 'source-over';
    },
    thrust(ctx, p) {
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, 0, 0, (2 + 4 * p.k) * p.size, p.color || '120,220,255', 0.5 * (1 - p.k));
      ctx.globalCompositeOperation = 'source-over';
    },
    ash(ctx, p) {
      ctx.rotate(p.rot);
      ctx.fillStyle = `rgba(70,66,64,${0.7 * (1 - p.k * 0.6)})`;
      ctx.fillRect(-1.6 * p.size, -0.9 * p.size, 3.2 * p.size, 1.8 * p.size);
    },
    ember(ctx, p) {
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, 0, 0, 3.5 * p.size, '255,150,60', 1 - p.k);
      ctx.globalCompositeOperation = 'source-over';
    },
    portal(ctx, p) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,60,80,${1 - p.k})`;
      ctx.lineWidth = 2;
      const r = (24 * sin(p.k * PI)) * p.size;
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.35, 0, 0, TAU); ctx.stroke();
      glow(ctx, 0, 0, r * 1.2 + 1, '255,40,70', 0.5 * (1 - p.k));
      ctx.globalCompositeOperation = 'source-over';
    },
  };

  // ------------------------------------------------------------------ nuke
  // deterministic wobble for cloud edges
  const nz = (i, t) => sin(i * 12.9898 + t * 1.3) * 0.5 + sin(i * 4.1 + t * 0.7) * 0.5;

  function drawBomb(ctx, x, y, T) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(0.05 * sin(T * 6));
    // fins
    ctx.fillStyle = '#3c4250';
    ctx.beginPath(); ctx.moveTo(-9, -40); ctx.lineTo(-16, -56); ctx.lineTo(16, -56); ctx.lineTo(9, -40); ctx.closePath(); ctx.fill();
    ctx.fillRect(-1.5, -58, 3, 20);
    // body
    const g = ctx.createLinearGradient(-12, 0, 12, 0);
    g.addColorStop(0, '#5b6272'); g.addColorStop(0.45, '#c9ced8'); g.addColorStop(1, '#4b5160');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, -18, 12, 26, 0, 0, TAU); ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#1d2028'; ctx.stroke();
    // yellow band + trefoil
    ctx.fillStyle = '#ffcc1a'; ctx.fillRect(-11.5, -24, 23, 9);
    ctx.fillStyle = '#1d1d1d';
    for (let i = 0; i < 3; i++) {
      const a = -PI / 2 + i * TAU / 3;
      ctx.beginPath(); ctx.moveTo(0, -19.5); ctx.arc(0, -19.5, 4.2, a - 0.5, a + 0.5); ctx.closePath(); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, -19.5, 1.1, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function trefoil(ctx, x, y, r, a) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha *= a;
    ctx.fillStyle = '#ffcc1a';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    for (let i = 0; i < 3; i++) {
      const b = -PI / 2 + i * TAU / 3;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r * 0.82, b - 0.52, b + 0.52); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#ffcc1a'; ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(0, 0, r * 0.13, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Ground-zero marker during the countdown: a laser designator from the sky
  // and pulsing rings painted on the floor. topY = top of the screen.
  function drawNukeTarget(ctx, x, y, T, k, topY) {
    ctx.save();
    const pulse = 0.5 + 0.5 * sin(T * 10);
    if (topY != null) {
      const g = ctx.createLinearGradient(0, topY, 0, y);
      g.addColorStop(0, 'rgba(255,40,40,0)');
      g.addColorStop(1, `rgba(255,40,40,${0.35 + 0.35 * pulse})`);
      ctx.fillStyle = g;
      ctx.fillRect(x - 1.5, topY, 3, y - topY);
      ctx.fillStyle = `rgba(255,60,60,${0.08 + 0.08 * pulse})`;
      ctx.fillRect(x - 7, topY, 14, y - topY);
    }
    ctx.strokeStyle = `rgba(255,40,40,${0.55 + 0.4 * pulse})`;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      const rx = 40 + i * 34 + 10 * pulse;
      ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.28, 0, 0, TAU); ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x - 160, y); ctx.lineTo(x - 30, y); ctx.moveTo(x + 30, y); ctx.lineTo(x + 160, y);
    ctx.stroke();
    // hot spot where the laser touches the floor
    const hg = ctx.createRadialGradient(x, y, 0, x, y, 22);
    hg.addColorStop(0, `rgba(255,220,220,${0.8 + 0.2 * pulse})`);
    hg.addColorStop(0.4, 'rgba(255,40,40,0.6)');
    hg.addColorStop(1, 'rgba(255,40,40,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.ellipse(x, y, 22, 10, 0, 0, TAU); ctx.fill();
    trefoil(ctx, x, y - 74 - 6 * pulse, 18, 0.95);
    ctx.restore();
  }

  // A soft elliptical glow: the gradient is squashed with the shape, so no hard rim.
  function softEllipse(ctx, x, y, rx, ry, stops) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    for (const [k, c] of stops) g.addColorStop(k, c);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Ground-burst fireball → mushroom cloud. (x, y) = ground zero on the floor,
  // t = seconds since detonation, R = cap radius scale, H = how high the cap climbs.
  function drawMushroom(ctx, x, y, t, R, H) {
    H = H || R * 1.6;
    const fade = t < 10 ? 1 : clamp(1 - (t - 10) / 6, 0, 1);
    if (fade <= 0) return;
    ctx.save();
    ctx.globalAlpha = fade;
    const rise = Math.min(1, t / 6);
    const ease = 1 - Math.pow(1 - rise, 2.2);
    const capY = y - R * 0.35 - ease * (H - R * 0.35);
    const grow = Math.min(1, t / 0.8);
    const capR = R * (0.5 + 0.6 * grow + 0.3 * rise) * (1 + 0.035 * Math.max(0, t - 6));
    const heat = clamp(1 - t / 6.5, 0, 1);
    const smoke = (al) => `rgba(${120 + 130 * heat | 0},${108 + 82 * heat | 0},${100 - 10 * heat | 0},${al})`;
    // condensation ring (back half, behind the stem)
    const ringK = clamp((t - 1) / 4, 0, 1);
    const ringA = t > 1 && t < 6.5 ? Math.sin(ringK * PI) * 0.55 : 0;
    const ringY = lerp(y, capY, 0.5), ringRx = capR * (0.7 + 0.6 * ringK), ringRy = ringRx * 0.14;
    // stem: a tapered column with rolling blobs climbing up it
    if (t > 0.45) {
      const sw = R * (0.15 + 0.1 * rise);
      const top = capY + capR * 0.25;
      const g = ctx.createLinearGradient(0, top, 0, y);
      g.addColorStop(0, smoke(0.85));
      g.addColorStop(0.7, `rgba(${110 + 120 * heat | 0},${90 + 60 * heat | 0},${70},0.75)`);
      g.addColorStop(1, `rgba(${150 + 105 * heat | 0},${110 + 80 * heat | 0},${70 + 40 * heat | 0},0.85)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - sw * 0.7, top);
      ctx.bezierCurveTo(x - sw * 0.55, (top + y) / 2, x - sw * 1.3, y - R * 0.12, x - sw * 2.4, y);
      ctx.lineTo(x + sw * 2.4, y);
      ctx.bezierCurveTo(x + sw * 1.3, y - R * 0.12, x + sw * 0.55, (top + y) / 2, x + sw * 0.7, top);
      ctx.closePath();
      ctx.fill();
      for (let j = 0; j < 9; j++) {
        const ph = (j / 9 + t * 0.22) % 1;
        const py = lerp(y - R * 0.15, top + capR * 0.1, ph);
        const px = x + nz(j, t) * sw * 0.25;
        const br = sw * (1.25 - 0.5 * ph) * (1 + 0.15 * nz(j + 5, t));
        const hot = heat * (1 - ph * 0.6);
        const g2 = ctx.createRadialGradient(px - br * 0.25, py - br * 0.25, br * 0.1, px, py, br);
        g2.addColorStop(0, `rgba(${150 + 105 * hot | 0},${110 + 90 * hot | 0},${85 + 40 * hot | 0},0.75)`);
        g2.addColorStop(1, 'rgba(110,95,85,0)');
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(px, py, br, 0, TAU); ctx.fill();
      }
    }
    // base surge: dust rolling outward along the floor
    if (t > 0.2) {
      const spread = 0.5 + 1.6 * Math.min(1, t / 4);
      for (let i = 0; i < 23; i++) {
        const u = (i - 11) / 11;
        const bx = x + u * R * 1.15 * spread + nz(i + 9, t) * R * 0.06;
        const br = R * (0.24 + 0.08 * nz(i, t)) * (0.55 + 0.6 * Math.min(1, t / 4)) * (1 - Math.abs(u) * 0.55);
        const by = y - br * (0.35 + 0.15 * nz(i + 4, t * 0.7));
        const g2 = ctx.createRadialGradient(bx, by, br * 0.1, bx, by, br);
        g2.addColorStop(0, `rgba(${125 + 90 * heat | 0},${105 + 55 * heat | 0},88,0.62)`);
        g2.addColorStop(1, 'rgba(110,100,90,0)');
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
      }
    }
    // cap underside: the glowing toroid
    softEllipse(ctx, x, capY + capR * 0.32, capR * 1.15, capR * 0.36, [
      [0, `rgba(${200 + 55 * heat | 0},${90 + 90 * heat | 0},${40 + 40 * heat | 0},${0.55 + 0.35 * heat})`],
      [1, 'rgba(90,60,50,0)']]);
    // cap: a filled centre, then overlapping blobs rolling outward
    for (let i = 0; i < 6; i++) {
      const bx = x + (i - 2.5) * capR * 0.32, by = capY + nz(i + 3, t) * capR * 0.08 - capR * 0.05;
      const br = capR * 0.5;
      const g = ctx.createRadialGradient(bx, by - br * 0.2, br * 0.1, bx, by, br);
      g.addColorStop(0, `rgba(${180 + 75 * heat | 0},${120 + 90 * heat | 0},${80 + 70 * heat | 0},0.9)`);
      g.addColorStop(1, 'rgba(110,85,75,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
    }
    const blobs = 16;
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * TAU + t * 0.25 * (layer ? -1 : 1);
        const rr = capR * (0.62 + 0.12 * nz(i + layer * 7, t));
        const bx = x + cos(a) * rr * 1.25;
        const by = capY + sin(a) * rr * 0.55;
        const br = capR * (0.38 + 0.08 * nz(i * 3, t));
        const g = ctx.createRadialGradient(bx, by - br * 0.3, br * 0.1, bx, by, br);
        if (layer === 0) {
          g.addColorStop(0, `rgba(255,${200 + 50 * heat | 0},${120 + 120 * heat | 0},0.95)`);
          g.addColorStop(0.5, `rgba(${170 + 60 * heat | 0},${90 + 80 * heat | 0},${50 + 10 * heat | 0},0.9)`);
          g.addColorStop(1, 'rgba(110,80,60,0)');
        } else {
          g.addColorStop(0, smoke(0.85));
          g.addColorStop(1, 'rgba(95,88,85,0)');
        }
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
      }
    }
    // cooled smoke darkens the crown
    if (heat < 0.8) softEllipse(ctx, x, capY - capR * 0.2, capR * 1.2, capR * 0.62, [[0, `rgba(85,78,76,${0.45 * (1 - heat)})`], [0.6, `rgba(85,78,76,${0.25 * (1 - heat)})`], [1, 'rgba(85,78,76,0)']]);
    // incandescent core
    if (heat > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, capY, 0, x, capY, capR * 1.1);
      g.addColorStop(0, `rgba(255,255,230,${0.95 * heat})`);
      g.addColorStop(0.35, `rgba(255,200,90,${0.7 * heat})`);
      g.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, capY, capR * 1.1, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    // condensation ring (front half)
    if (ringA > 0) {
      ctx.lineWidth = ringRy * 0.8;
      ctx.strokeStyle = `rgba(245,248,255,${ringA * 0.7})`;
      ctx.beginPath(); ctx.ellipse(x, ringY, ringRx, ringRy, 0, 0, TAU); ctx.stroke();
      ctx.lineWidth = ringRy * 0.25;
      ctx.strokeStyle = `rgba(255,255,255,${ringA * 0.5})`;
      ctx.stroke();
    }
    ctx.restore();
  }

  // The expanding shockwave ring (plus condensation shell early on).
  function drawShockwave(ctx, x, y, r, t) {
    if (r <= 0) return;
    ctx.save();
    const a = clamp(1 - t / 4.5, 0.15, 1);
    // condensation dome
    if (t < 1.4) {
      const k = t / 1.4;
      const g = ctx.createRadialGradient(x, y, r * 0.75, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.85, `rgba(235,240,255,${0.35 * (1 - k)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
    // the front: a bright ring with a heat-shimmer double
    ctx.lineWidth = 14 * a + 4;
    ctx.strokeStyle = `rgba(255,236,200,${0.5 * a})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(255,255,255,${0.85 * a})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(200,225,255,${0.4 * a})`;
    ctx.beginPath(); ctx.arc(x, y, r * 0.96, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // Dust surge rolling along a floor (one call per screen floor line).
  function drawDustWall(ctx, x, floorY, r, t, left, right) {
    const a = clamp(1 - t / 6, 0, 1);
    if (a <= 0) return;
    ctx.save();
    for (const dir of [-1, 1]) {
      const fx = x + dir * r;
      if (fx < left - 200 || fx > right + 200) continue;
      for (let i = 0; i < 7; i++) {
        const bx = fx - dir * i * 26, h = (60 - i * 6) * (0.7 + 0.3 * nz(i, t));
        const g = ctx.createRadialGradient(bx, floorY - h * 0.4, 2, bx, floorY - h * 0.4, h);
        g.addColorStop(0, `rgba(160,140,120,${0.5 * a})`);
        g.addColorStop(1, 'rgba(160,140,120,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(bx, floorY - h * 0.4, h, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  // Charred, glowing strip on the floor around ground zero.
  function drawScorch(ctx, x, y, R, a, t) {
    if (a <= 0) return;
    ctx.save();
    softEllipse(ctx, x, y, R, Math.max(6, R * 0.06), [[0, `rgba(20,14,10,${0.7 * a})`], [0.6, `rgba(40,28,20,${0.3 * a})`], [1, 'rgba(40,28,20,0)']]);
    const glow = t == null ? 0 : clamp(1 - t / 5, 0, 1);
    if (glow > 0) {
      ctx.globalCompositeOperation = 'lighter';
      softEllipse(ctx, x, y, R * 0.7, Math.max(7, R * 0.09), [[0, `rgba(255,150,50,${0.7 * glow})`], [1, 'rgba(255,60,0,0)']]);
    }
    ctx.restore();
  }

  // HUD callout text (cyan, monospace, bracketed)
  function hudText(ctx, text, x, y, a, color) {
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 9px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = 'rgba(6,18,30,0.72)';
    ctx.fillRect(x - w / 2, y - 7, w, 14);
    ctx.strokeStyle = color || 'rgba(110,225,255,0.9)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + 4, y - 7); ctx.lineTo(x - w / 2, y - 7); ctx.lineTo(x - w / 2, y + 7); ctx.lineTo(x - w / 2 + 4, y + 7);
    ctx.moveTo(x + w / 2 - 4, y - 7); ctx.lineTo(x + w / 2, y - 7); ctx.lineTo(x + w / 2, y + 7); ctx.lineTo(x + w / 2 - 4, y + 7);
    ctx.stroke();
    ctx.fillStyle = color || '#8ff0ff';
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  // targeting reticle around an enemy
  function reticle(ctx, x, y, r, T, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(T * 1.5);
    ctx.strokeStyle = color || 'rgba(255,80,80,0.9)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) {
      ctx.rotate(PI / 2);
      ctx.beginPath(); ctx.arc(0, 0, r, -0.45, 0.45); ctx.stroke();
    }
    ctx.restore();
  }

  // menu / home portrait: a bust
  function drawBust(ctx, suit, T) {
    const R = makeRig('stand', { t: 0, T, phase: 0, m: {} });
    R.turn = 0.62;
    drawHero(ctx, R, { suit, T });
  }

  root.IronArt = {
    SUITS, POSES, makeRig, lerpRig, drawHero, points, drawEnemy, ENEMIES,
    drawBeam, drawLaser, drawMissile, drawShell, FX, hudText, reticle, glow, drawBust,
    drawBomb, drawNukeTarget, drawMushroom, drawShockwave, drawDustWall, drawScorch, trefoil,
  };
})(typeof window !== 'undefined' ? window : globalThis);
