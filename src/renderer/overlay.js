/*
 * Desktop Cat — overlay renderer (one per display).
 *
 * Draws the snapshot streamed from the main process. Every on-screen thing is
 * a small canvas "sprite" moved with CSS transforms and depth-sorted by its
 * floor position, so the cat can walk in front of / behind things. Particles
 * and the tool cursor use a full-screen canvas that only exists while needed.
 */
(function () {
  'use strict';
  const api = window.catAPI;
  const { PROPS, TOOLS, PARTICLES, drawBubble, drawStatus } = PropsArt;
  const { clamp, lerp, smooth } = CatArt.util;
  const stage = document.getElementById('stage');
  const menuRoot = document.getElementById('menu-root');

  let B = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  let W = null; // this display's work area
  let DID = null; // this display's id
  let snaps = [];
  let latest = null;
  let soundCfg = '';

  CatMenu.init(menuRoot, () => B, () => latest);

  api.on('init', (d) => {
    B = d.bounds;
    W = d.workArea || null;
    DID = d.id;
    document.body.dataset.platform = d.platform;
  });
  let lastEnts = null, lastStateAt = 0, scene = 'cat', iron = null;
  const EMPTY_ENTS = { bowls: [], poops: [], scratches: [], files: [], yarns: [], boxes: [], posts: [], catnips: [], bed: null, grave: null };
  api.on('state', (s) => {
    lastStateAt = Date.now();
    const ch = s.character || 'cat';
    if (ch !== scene) switchScene(ch);
    if (ch === 'cat') { if (s.ents) lastEnts = s.ents; else s.ents = lastEnts || EMPTY_ENTS; }
    else s.ents = EMPTY_ENTS;
    latest = s;
    snaps.push(s);
    if (snaps.length > 4) snaps.shift();
    const cfg = `${s.sound}|${s.volume}`;
    if (cfg !== soundCfg) { soundCfg = cfg; CatSound.configure(s.sound, s.volume); }
  });
  api.on('fx', (e) => { if (scene === 'ironman' && iron && iron.expandFx(e, latest ? latest.s : 1)) return; spawnFx(e); });
  api.on('sound', (e) => CatSound.play(e.name));
  api.on('menu:open', (m) => CatMenu.open(m));
  api.on('menu:close', () => CatMenu.close(true));
  api.on('cursor', (c) => { document.documentElement.style.cursor = c; });

  // ---------------------------------------------------------------- input
  const G = (e) => ({ x: B.x + e.clientX, y: B.y + e.clientY });
  const onPanel = (t) => !!(t && t.closest && (t.closest('.brief') || t.closest('.banner')));
  window.addEventListener('pointerdown', (e) => {
    if (CatMenu.contains(e.target) || onPanel(e.target)) return;
    if (CatMenu.isOpen()) { CatMenu.close(); return; }
    if (e.button !== 0) return;
    try { document.documentElement.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    api.send('pointer', { type: 'down', ...G(e), button: 0 });
  });
  window.addEventListener('pointerup', (e) => {
    if (CatMenu.contains(e.target) || onPanel(e.target) || e.button !== 0) return;
    api.send('pointer', { type: 'up', ...G(e), button: 0 });
  });
  // a lost press (touch cancel, capture lost) must still end the drag
  const cancel = (e) => api.send('pointer', { type: 'up', ...G(e), button: 0 });
  window.addEventListener('pointercancel', cancel);
  document.documentElement.addEventListener('lostpointercapture', cancel);
  // nothing may be dropped onto the overlay (it would otherwise try to open it)
  for (const ev of ['dragover', 'drop']) window.addEventListener(ev, (e) => e.preventDefault());
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (CatMenu.contains(e.target) || onPanel(e.target)) return;
    api.send('context', G(e));
  });

  // ---------------------------------------------------------------- sprites
  class Sprite {
    constructor() {
      this.c = document.createElement('canvas');
      this.c.className = 'sprite';
      stage.appendChild(this.c);
      this.ctx = this.c.getContext('2d');
      this.visible = true; this.key = null; this.lastDraw = 0; this.tr = ''; this.z = null;
    }
    size(w, h, ax, ay) {
      const d = window.devicePixelRatio || 1;
      w = Math.ceil(w); h = Math.ceil(h);
      if (this.w !== w || this.h !== h || this.d !== d) {
        this.w = w; this.h = h; this.d = d;
        this.c.width = Math.ceil(w * d); this.c.height = Math.ceil(h * d);
        this.c.style.width = w + 'px'; this.c.style.height = h + 'px';
        this.key = null;
      }
      this.ax = ax; this.ay = ay;
      return this;
    }
    place(gx, gy, z) {
      const d = this.d || 1;
      const lx = Math.round((gx - B.x - this.ax) * d) / d;
      const ly = Math.round((gy - B.y - this.ay) * d) / d;
      const vis = lx < B.width && ly < B.height && lx + this.w > 0 && ly + this.h > 0;
      if (vis !== this.visible) { this.visible = vis; this.c.style.display = vis ? '' : 'none'; }
      if (!vis) return false;
      const tr = `translate3d(${lx}px,${ly}px,0)`;
      if (tr !== this.tr) { this.tr = tr; this.c.style.transform = tr; }
      if (z !== this.z) { this.z = z; this.c.style.zIndex = String(z); }
      return true;
    }
    begin() {
      const c = this.ctx, d = this.d;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.c.width, this.c.height);
      c.setTransform(d, 0, 0, d, this.ax * d, this.ay * d);
      return c;
    }
    hide() { if (this.visible) { this.visible = false; this.c.style.display = 'none'; } }
    destroy() { this.c.remove(); }
  }

  const inB = (p, m) => p.x >= B.x - (m || 0) && p.x <= B.x + B.width + (m || 0) && p.y >= B.y - (m || 0) && p.y <= B.y + B.height + (m || 0);

  // ---------------------------------------------------------------- the cat
  const catSprite = new Sprite();
  const ghostSprite = new Sprite();
  const R = {
    pose: null, poseKey: '', from: null, blendStart: 0, blendDur: 0.24,
    nextBlink: 0, blinkUntil: 0, nextTwitch: 0, twitchUntil: 0, twitchSide: 0,
    zzzAt: 0, headRot: 0, gazeX: 0, gazeY: 0, nextGaze: 0, lastNow: 0, prevName: '',
  };

  const EXPR_MOOD = {
    happy: { tailUp: 0.9 }, love: { tailUp: 0.8 }, proud: { tailUp: 1 }, content: { tailUp: 0.55 }, eating: { tailUp: 0.4 },
    sad: { droop: 0.6, tailUp: 0 }, starving: { droop: 0.85 }, weak: { droop: 0.9 }, sleepy: { droop: 0.35 }, asleep: { droop: 0.2 },
    angry: { flat: 0.95, puff: 1, lash: 0.8 }, annoyed: { flat: 0.35, lash: 0.6 }, nervous: { flat: 0.5 }, surprised: { perk: 0.6, puff: 0.45 },
    hunt: { perk: 0.5, lash: 0.3 }, focused: { perk: 0.3 }, curious: { perk: 0.5, tailUp: 0.6 }, wild: { flat: 0.3, puff: 0.4 },
    derp: { tailUp: 0.7 }, dizzy: { droop: 0.3 }, begging: { tailUp: 0.8, perk: 0.3 }, strain: { tailUp: 0 },
  };

  const FACE = {
    neutral: { eyes: 'normal', open: 1, mouth: 'w' },
    content: { eyes: 'normal', open: 0.78, mouth: 'w', blush: 0.25 },
    happy: { eyes: 'happy', mouth: 'smile', blush: 0.5 },
    love: { eyes: 'happy', mouth: 'smile', blush: 0.9 },
    proud: { eyes: 'happy', mouth: 'smile', blush: 0.2 },
    sad: { eyes: 'sad', open: 0.8, mouth: 'frown', brows: 'sad' },
    begging: { eyes: 'sparkle', mouth: 'o', pupil: 1 },
    starving: { eyes: 'sad', open: 0.6, mouth: 'frown', tear: 1, brows: 'sad' },
    weak: { eyes: 'sad', open: 0.35, mouth: 'frown', sweat: 1 },
    sleepy: { eyes: 'normal', open: 0.38, mouth: 'w' },
    asleep: { eyes: 'closed', mouth: 'w' },
    closed: { eyes: 'closed', mouth: 'flat' },
    angry: { eyes: 'angry', mouth: 'hiss', mouthOpen: 1, anger: 1, brows: 'angry' },
    annoyed: { eyes: 'flat', open: 0.5, mouth: 'flat' },
    surprised: { eyes: 'wide', mouth: 'o' },
    nervous: { eyes: 'wide', mouth: 'o', sweat: 1 },
    hunt: { eyes: 'wide', pupil: 1, mouth: 'w' },
    focused: { eyes: 'normal', open: 0.85, pupil: 0.75, mouth: 'flat' },
    curious: { eyes: 'normal', pupil: 0.85, mouth: 'w' },
    strain: { eyes: 'squeeze', mouth: 'flat' },
    dizzy: { eyes: 'spiral', mouth: 'wobble' },
    eating: { eyes: 'happy', mouth: 'chew' },
    wild: { eyes: 'wide', pupil: 1, mouth: 'tongue' },
    derp: { eyes: 'heart', mouth: 'tongue', blush: 0.8 },
  };
  const BLINKABLE = new Set(['normal', 'sad', 'wide', 'sparkle', 'flat', 'angry', 'slit']);
  const NO_HEAD_LOOK = new Set(['curl', 'eat', 'groom', 'squat', 'roll', 'lieSide', 'cover', 'stretch']);

  function interp(now) {
    const c = latest.cat;
    const rt = now - 40; // snapshots arrive at ~30 Hz; render slightly in the past and interpolate
    let a = null, b = null;
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1].t <= rt) { a = snaps[i - 1]; b = snaps[i]; break; }
    }
    if (!a || Math.hypot(b.cat.x - a.cat.x, b.cat.y - a.cat.y) > 200) return { x: c.x, y: c.y, z: c.z, dist: c.dist };
    const k = clamp((rt - a.t) / Math.max(1, b.t - a.t), 0, 1.25);
    return { x: lerp(a.cat.x, b.cat.x, k), y: lerp(a.cat.y, b.cat.y, k), z: lerp(a.cat.z, b.cat.z, k), dist: lerp(a.cat.dist, b.cat.dist, k) };
  }

  function buildPose(c, cp, now, T, S) {
    const name = c.mode === 'held' ? 'held' : c.mode === 'air' ? 'fall' : c.pose;
    const mood = Object.assign({}, EXPR_MOOD[c.expr] || {});
    if (c.sleeping) Object.assign(mood, EXPR_MOOD.asleep);
    if (c.stats.food < 25) mood.thin = clamp((25 - c.stats.food) / 25, 0, 1);
    const f = c.flags || {};
    mood.wiggle = !!f.wiggle; mood.scratch = !!f.scratch; mood.chew = !!f.chew;
    mood.tremble = f.tremble || 0; mood.peek = f.peek == null ? 1 : f.peek; mood.low = c.low || 0;
    const stride = name === 'run' ? 50 : 30;
    const phase = (cp.dist / (stride * S)) * Math.PI * 2;
    const t = (now - c.poseStart) / 1000;
    let swat = -1;
    if (c.action && c.action.name === 'swat') swat = (now - c.action.start) / (c.action.dur * 1000);
    const live = CatArt.makePose(name, { t, T, phase, m: mood, k: name === 'held' ? c.rot : 0, swat });
    if (name === 'fall') live.rot += c.rot || 0;
    if (name !== R.poseKey) {
      R.from = R.pose || live;
      R.blendStart = now;
      R.blendDur = name === 'held' || R.poseKey === 'held' || name === 'fall' ? 0.14 : name === 'curl' || name === 'box' ? 0.35 : 0.24;
      R.poseKey = name;
    }
    const k = smooth(clamp((now - R.blendStart) / (R.blendDur * 1000), 0, 1));
    const pose = k >= 1 ? live : CatArt.lerpPose(R.from, live, k);
    R.pose = pose;
    return { pose, name };
  }

  function buildFace(c, name, now, T) {
    let expr = c.expr || 'neutral';
    if (c.sleeping) expr = 'asleep';
    else if (c.stats.food < 20 && (expr === 'neutral' || expr === 'content' || expr === 'curious')) expr = 'sad';
    const f = Object.assign({ eyes: 'normal', open: 1, pupil: 0.45, mouth: 'w', mouthOpen: 0, blush: 0 }, FACE[expr] || FACE.neutral);
    if (!c.sleeping && f.eyes === 'normal' && c.stats.energy < 25) f.open = Math.min(f.open, 0.42 + c.stats.energy / 50);
    if (c.purring && !c.sleeping && f.eyes === 'normal') f.eyes = 'happy';
    const a = c.action;
    if (a) {
      const k = clamp((now - a.start) / (a.dur * 1000), 0, 1), env = Math.sin(k * Math.PI);
      if (a.name === 'meow') { f.mouth = 'meow'; f.mouthOpen = Math.max(0.35, env); }
      else if (a.name === 'yawn') { f.mouth = 'yawn'; f.mouthOpen = env; f.eyes = 'closed'; }
      else if (a.name === 'lick') { f.mouth = 'tongue'; f.tongue = 0.5 + 0.5 * Math.abs(Math.sin(k * 14)); }
      else if (a.name === 'slowblink') { f.eyes = 'normal'; f.open = 1 - env * 0.97; f.blush = Math.max(f.blush, 0.45); }
      else if (a.name === 'hiss') { f.mouth = 'hiss'; f.mouthOpen = 1; f.eyes = 'angry'; }
    }
    if (f.mouth === 'chew') f.mouthOpen = 0.3 + 0.3 * Math.sin(T * 12);
    if (name === 'groom' && !a) {
      const cyc = (((now - c.poseStart) / 1000) % 5) / 5;
      if (cyc < 0.6) { f.mouth = 'tongue'; f.tongue = 0.4 + 0.6 * Math.abs(Math.sin(T * 9)); f.eyes = 'happy'; }
      else f.eyes = 'closed';
    }
    if (name === 'held' && c.expr === 'content') { f.eyes = 'happy'; f.blush = 0.5; }
    if (now > R.nextBlink) { R.blinkUntil = now + 140; R.nextBlink = now + 2200 + Math.random() * 4500; }
    if (now < R.blinkUntil && BLINKABLE.has(f.eyes) && f.open > 0.3) f.open = 0.05;
    return f;
  }

  function applyLook(c, name, pose, f, gx, gy, S, now, dt) {
    const L = c.look;
    let targetRot = 0;
    if (L) {
      const hc = CatArt.headCenter(pose);
      const hx = gx + c.facing * hc.x * S, hy = gy + hc.y * S;
      const dx = (L.x - hx) * c.facing, dy = L.y - hy;
      f.lookX = clamp(dx / 130, -1, 1);
      f.lookY = clamp(dy / 130, -1, 1);
      if (!NO_HEAD_LOOK.has(name)) {
        targetRot = clamp(Math.atan2(dy, Math.max(40, Math.abs(dx))) * 0.4, -0.32, 0.32);
        if (dx < -25 && pose.head.turn < 0.9) pose.head.turn = lerp(pose.head.turn, 0.9, 0.8);
      }
    } else {
      if (now > R.nextGaze) {
        R.nextGaze = now + 1500 + Math.random() * 3500;
        const r = Math.random();
        R.gazeX = r < 0.5 ? 0 : (Math.random() - 0.3) * 1.2;
        R.gazeY = r < 0.5 ? 0 : (Math.random() - 0.5) * 0.8;
      }
      f.lookX = R.gazeX; f.lookY = R.gazeY;
    }
    R.headRot += (targetRot - R.headRot) * Math.min(1, dt * 7);
    pose.head.rot += R.headRot;
  }

  function earTwitch(c, now) {
    if (now > R.nextTwitch) {
      R.nextTwitch = now + 3500 + Math.random() * 7000;
      R.twitchUntil = now + 220;
      R.twitchSide = Math.random() < 0.5 ? 0 : 1;
    }
    const tw = [0, 0];
    if (now < R.twitchUntil) tw[R.twitchSide] = 0.45 * Math.sin(((R.twitchUntil - now) / 220) * Math.PI);
    if (c.action && c.action.name === 'earflick') {
      const k = clamp((now - c.action.start) / (c.action.dur * 1000), 0, 1);
      tw[0] = tw[1] = 0.6 * Math.sin(k * Math.PI * 2);
    }
    return tw;
  }

  function renderCat(now, T, dt) {
    const s = latest, c = s.cat, S = s.s;
    ghostSprite.hide();
    if (c.dead) {
      catSprite.hide();
      R.pose = null; R.poseKey = '';
      CatSound.setPurr(false);
      if (c.ghost && now - c.ghost.start < 7000) renderGhost(c, now, T, S);
      return;
    }
    const cp = c.mode === 'held' ? { x: c.x, y: c.y, z: c.z, dist: c.dist } : interp(now);
    const gx = cp.x, gy = cp.y - cp.z;
    // a compact canvas most of the time; a tall one when a bubble/card/dangling cat needs the room
    const big = c.bubble || c.hover || c.mode !== 'task' || c.inBox || c.caught || c.carry || (c.flags && c.flags.stars) || c.expr === 'dizzy';
    if (big) catSprite.size(280 * S, 310 * S, 140 * S, 185 * S);
    else catSprite.size(190 * S, 128 * S, 95 * S, 110 * S);
    const here = inB({ x: cp.x, y: cp.y - 30 * S });
    CatSound.setPurr(!!(c.purring && here && s.sound));
    const visible = catSprite.place(gx, gy, Math.round(cp.y) + 10);
    if (!visible) { R.pose = null; R.poseKey = ''; return; }
    const { pose, name } = buildPose(c, cp, now, T, S);
    const headG = (() => { const hc = CatArt.headCenter(pose); return { x: gx + c.facing * hc.x * S, y: gy + hc.y * S, r: hc.r * S }; })();
    if (c.sleeping && here && now - R.zzzAt > 1500) {
      R.zzzAt = now;
      spawnFx({ kind: 'zzz', x: headG.x + c.facing * 6 * S, y: headG.y - headG.r * 0.9, n: 1 });
    }
    const face = buildFace(c, name, now, T);
    applyLook(c, name, pose, face, gx, gy, S, now, dt);
    const ctx = catSprite.begin();

    // shadow on the floor (below the cat when it is lifted)
    {
      const lifted = c.mode === 'held' || cp.z > 1;
      const sh = clamp(1 - cp.z / (150 * S), 0.35, 1);
      const rx = (lifted ? 24 : pose.shadow.rx) * S * sh;
      if (rx > 0.5) {
        ctx.fillStyle = `rgba(0,0,0,${0.16 * sh})`;
        ctx.beginPath(); ctx.ellipse(0, cp.z, rx, 4.6 * S * sh, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    const box = c.inBox ? s.ents.boxes.find((b) => b.id === c.inBox) : null;
    ctx.save();
    ctx.scale(S, S);
    if (box) PROPS.boxBack(ctx);
    ctx.save();
    if (box) { ctx.beginPath(); ctx.rect(-80, -200, 160, 199); ctx.clip(); } // only the part above the box floor
    ctx.scale(c.facing, 1);
    if (c.action && c.action.name === 'land') {
      const k = clamp((now - c.action.start) / (c.action.dur * 1000), 0, 1);
      ctx.scale(1 + 0.08 * (1 - k), 1 - 0.13 * (1 - k));
    }
    CatArt.drawCat(ctx, pose, face, { T, palette: c.palette, eyes: c.eyes, earTwitch: earTwitch(c, now) });
    if (c.caught) {
      // the toy mouse pinned under the front paws
      const pw = pose.paws[0];
      ctx.save(); ctx.translate(pw.x + 20, pw.y - 1.5); ctx.scale(0.8, 0.8); TOOLS.mouse(ctx, T * 0.2, 0, false); ctx.restore();
      ctx.beginPath(); ctx.ellipse(pw.x + 1, pw.y - 0.5, pw.rx, pw.ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = CatArt.PALETTES[c.palette] ? CatArt.PALETTES[c.palette].fur[1] : '#eee'; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = CatArt.PALETTES[c.palette] ? CatArt.PALETTES[c.palette].line : '#777'; ctx.stroke();
    }
    ctx.restore();
    if (c.carry) {
      const f = s.ents.files.find((x) => x.id === c.carry);
      if (f) {
        const mp = CatArt.mouthPoint(pose);
        ctx.save();
        ctx.translate(c.facing * (mp.x + 3), mp.y + 15);
        ctx.scale(0.62, 0.62);
        PROPS.file(ctx, { ...f, rot: c.facing * 0.5, name: null }, T);
        ctx.restore();
      }
    }
    if (box) PROPS.boxFront(ctx);
    const hc = CatArt.headCenter(pose);
    const hx = c.facing * hc.x, hy = hc.y;
    if ((c.flags && c.flags.stars) || c.expr === 'dizzy') {
      for (let i = 0; i < 3; i++) {
        const a = T * 4 + (i * Math.PI * 2) / 3;
        ctx.save();
        ctx.translate(hx + Math.cos(a) * 18, hy - hc.r - 4 + Math.sin(a) * 5);
        PARTICLES.star(ctx, { size: 0.9 });
        ctx.restore();
      }
    }
    // particles that are around the cat are drawn here (cheap) instead of on the full-screen fx layer
    {
      const sx0 = gx - catSprite.ax, sy0 = gy - catSprite.ay;
      for (const p of particles) {
        if (p.x < sx0 + 8 || p.y < sy0 + 8 || p.x > sx0 + catSprite.w - 8 || p.y > sy0 + catSprite.h - 8) { p.inCat = false; continue; }
        p.inCat = true;
        drawParticle(ctx, p, (p.x - gx) / S, (p.y - gy) / S, 1 / S, T);
      }
    }
    // thought bubble / hover status card (screen-upright)
    const top = hy - hc.r - 6;
    const side = headG.x > B.x + B.width - 90 * S ? -1 : 1;
    if (c.hover && !c.bubble) {
      drawStatus(ctx, hx, top - 2, c.stats, c.name, c.mood, 1);
    } else if (c.bubble) {
      const age = (Date.now() - c.bubble.start) / 1000;
      const left = (c.bubble.until - Date.now()) / 1000;
      ctx.save();
      ctx.globalAlpha = clamp(left / 0.3, 0, 1);
      drawBubble(ctx, hx + side * 4, top, c.bubble.icon, age, T, c.bubble.urgent, side);
      ctx.restore();
    }
    ctx.restore();
  }

  function renderGhost(c, now, T, S) {
    const k = (now - c.ghost.start) / 7000;
    const gx = c.ghost.x + Math.sin(k * 9) * 10 * S, gy = c.ghost.y - 20 * S - k * 200 * S;
    ghostSprite.size(200 * S, 200 * S, 100 * S, 140 * S);
    if (!ghostSprite.place(gx, gy, 300000)) return;
    const ctx = ghostSprite.begin();
    ctx.save();
    ctx.scale(S, S);
    const a = clamp(Math.min(k * 4, (1 - k) * 2), 0, 1) * 0.75;
    const pose = CatArt.makePose('ghost', { t: k * 7, T, phase: 0, m: { tailUp: 1 } });
    // wings
    ctx.save();
    ctx.globalAlpha = a * 0.9;
    for (const sgn of [-1, 1]) {
      ctx.save();
      ctx.translate(-2 + sgn * 6, -38);
      ctx.rotate(sgn * (0.5 + 0.25 * Math.sin(T * 8)));
      ctx.beginPath(); ctx.ellipse(sgn * -14, -6, 15, 8, sgn * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.strokeStyle = 'rgba(160,170,220,0.8)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    CatArt.drawCatAlpha(ctx, pose, { eyes: 'closed', mouth: 'smile', blush: 0.5 }, { T, palette: c.palette, eyes: c.eyes }, a);
    const hc = CatArt.headCenter(pose);
    ctx.globalAlpha = a;
    ctx.beginPath(); ctx.ellipse(hc.x, hc.y - hc.r - 6, 11, 3.5, 0, 0, Math.PI * 2);
    ctx.lineWidth = 2.4; ctx.strokeStyle = '#ffd84d'; ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- props on screen
  const ENT = {
    bowl: { w: 52, h: 46, ax: 26, ay: 36, z: 0 },
    poop: { w: 66, h: 80, ax: 33, ay: 64, z: 0, fps: 8 },
    bed: { w: 90, h: 40, ax: 45, ay: 28, z: -400 },
    box: { w: 96, h: 66, ax: 48, ay: 56, z: 0 },
    post: { w: 76, h: 104, ax: 32, ay: 94, z: 0, fps: 8 },
    yarn: { w: 140, h: 46, ax: 70, ay: 32, z: 0 },
    catnip: { w: 46, h: 48, ax: 23, ay: 40, z: -300, fps: 10 },
    file: { w: 90, h: 62, ax: 45, ay: 44, z: 0 },
    grave: { w: 80, h: 74, ax: 40, ay: 64, z: 0, fps: 2 },
    scratch: { w: 88, h: 88, ax: 44, ay: 44, z: 300000 },
  };
  const entSprites = new Map();
  const yarnTrails = new Map();

  function ent(seen, key, type, x, y, S, stateKey, draw) {
    seen.add(key);
    const cfg = ENT[type];
    let sp = entSprites.get(key);
    if (!sp) { sp = new Sprite(); entSprites.set(key, sp); }
    sp.size(cfg.w * S, cfg.h * S, cfg.ax * S, cfg.ay * S);
    if (!sp.place(x, y, cfg.z > 100000 ? cfg.z : Math.round(y) + cfg.z)) return;
    const now = performance.now();
    if (sp.key !== stateKey || (cfg.fps && now - sp.lastDraw > 1000 / cfg.fps)) {
      const ctx = sp.begin();
      ctx.scale(S, S);
      draw(ctx);
      sp.key = stateKey;
      sp.lastDraw = now;
    }
  }

  function renderEntities(now, T) {
    const s = latest, S = s.s, E = s.ents;
    const seen = new Set();
    const tool = s.tool && s.tool.kind;
    const cur = s.cursor;
    const near = (e, rx, ry, oy) => {
      const dx = (cur.x - e.x) / (rx * S), dy = (cur.y - (e.y - (oy || 0) * S)) / (ry * S);
      return dx * dx + dy * dy <= 1;
    };
    for (const b of E.bowls) ent(seen, 'b' + b.id, 'bowl', b.x, b.y, S, b.kind + b.amount.toFixed(2), (c) => PROPS.bowl(c, b.kind, b.amount, T));
    if (E.bed) ent(seen, 'bed' + E.bed.id, 'bed', E.bed.x, E.bed.y, S, 'bed', (c) => PROPS.bed(c, T));
    for (const p of E.poops) {
      const hot = tool === 'scoop';
      const hov = hot && near(p, 20, 18, 11);
      ent(seen, 'p' + p.id, 'poop', p.x, p.y, S, `${hot}${hov}`, (c) => {
        if (hot) {
          c.save();
          c.translate(0, -10);
          c.beginPath(); c.ellipse(0, 0, hov ? 22 : 19, hov ? 18 : 15, 0, 0, Math.PI * 2);
          c.fillStyle = hov ? 'rgba(46,196,182,0.28)' : `rgba(46,196,182,${0.1 + 0.08 * Math.sin(T * 5)})`;
          c.fill();
          c.setLineDash([3, 3]); c.lineWidth = 1.3; c.strokeStyle = 'rgba(26,138,128,0.85)'; c.stroke();
          c.restore();
        }
        PROPS.poop(c, { seed: p.seed, age: (Date.now() - p.created) / 1000 }, T);
      });
    }
    for (const b of E.boxes) {
      if (s.cat.inBox === b.id) continue;
      ent(seen, 'x' + b.id, 'box', b.x, b.y, S, 'box', (c) => PROPS.box(c));
    }
    for (const p of E.posts) ent(seen, 'o' + p.id, 'post', p.x, p.y, S, 'post' + p.wear, (c) => PROPS.post(c, T, p.wear || 0));
    for (const n of E.catnips) ent(seen, 'n' + n.id, 'catnip', n.x, n.y, S, 'nip', (c) => PROPS.catnip(c, T));
    for (const y of E.yarns) {
      let tr = yarnTrails.get(y.id);
      if (!tr) { tr = { pts: [], last: { x: y.x, y: y.y } }; yarnTrails.set(y.id, tr); }
      if (Math.hypot(y.x - tr.last.x, y.y - tr.last.y) > 6 * S) { tr.pts.unshift({ x: tr.last.x, y: tr.last.y }); tr.last = { x: y.x, y: y.y }; if (tr.pts.length > 5) tr.pts.pop(); }
      const rel = tr.pts.map((p) => ({ x: clamp((p.x - y.x) / S, -60, 60), y: clamp((p.y - y.y) / S, -10, 12) }));
      if (!rel.length) rel.push({ x: -14, y: 2 }, { x: -24, y: 4 });
      ent(seen, 'y' + y.id, 'yarn', y.x, y.y, S, `${y.x.toFixed(1)},${y.y.toFixed(1)},${(y.rot || 0).toFixed(2)}`, (c) => PROPS.yarn(c, { rot: y.rot, trail: rel }, T));
    }
    for (const f of E.files) {
      if (f.carried) continue;
      const hov = near(f, 17, 24, 12);
      ent(seen, 'f' + f.id, 'file', f.x, f.y, S, `${f.x.toFixed(1)},${f.y.toFixed(1)},${f.rot.toFixed(2)},${f.torn},${hov}`, (c) => {
        if (hov) { c.save(); c.translate(0, -14); c.beginPath(); c.ellipse(0, 0, 20, 22, 0, 0, Math.PI * 2); c.fillStyle = 'rgba(122,102,255,0.13)'; c.fill(); c.restore(); }
        PROPS.file(c, f, T);
      });
    }
    if (E.grave) ent(seen, 'g' + E.grave.id, 'grave', E.grave.x, E.grave.y, S, 'g' + E.grave.flowers, (c) => PROPS.tombstone(c, E.grave, T));
    for (const sc of E.scratches) {
      const hot = tool === 'repair' && !sc.fixing;
      const hov = hot && Math.hypot((cur.x - sc.x) / (24 * sc.size), (cur.y - sc.y) / (26 * sc.size)) <= 1;
      const ss = sc.size;
      ent(seen, 's' + sc.id, 'scratch', sc.x, sc.y, ss, `${sc.progress.toFixed(2)},${(sc.fade == null ? 1 : sc.fade).toFixed(2)},${hot},${hov}`, (c) => PROPS.scratch(c, { ...sc, size: 1 }, T, hov));
    }
    for (const [k, sp] of entSprites) if (!seen.has(k)) { sp.destroy(); entSprites.delete(k); }
    for (const id of [...yarnTrails.keys()]) if (!E.yarns.some((y) => y.id === id)) yarnTrails.delete(id);
  }

  // ---------------------------------------------------------------- particles & tool cursor
  const particles = [];
  let fxCanvas = null, fxCtx = null, fxIdleSince = 0, fxWasDrawn = false;
  let mouseDir = 0;

  function spawnFx(e) {
    const S = latest ? latest.s : 1;
    if (e.kind === 'fileAway') {
      particles.push({ type: 'fileAway', x: e.x, y: e.y, vx: 0, vy: -90 * S, g: -60, life: 0.7, age: 0, size: S, data: e });
      return;
    }
    const n = e.n || 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const p = { type: e.kind, x: e.x, y: e.y, vx: 0, vy: 0, g: 0, life: 1, age: 0, size: S, rot: Math.random() * 6, vr: 0, color: e.color, text: e.text };
      switch (e.kind) {
        case 'heart': p.vx = (Math.random() - 0.5) * 30 * S; p.vy = (-30 - Math.random() * 25) * S; p.life = 1.4; p.x += (Math.random() - 0.5) * 16 * S; break;
        case 'sparkle': { const sp = (30 + Math.random() * 70) * S; p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 15 * S; p.life = 0.75; p.size = S * (0.6 + Math.random() * 0.6); break; }
        case 'star': { const sp = (40 + Math.random() * 60) * S; p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 30 * S; p.life = 0.9; break; }
        case 'dust': p.vx = (Math.random() - 0.5) * 80 * S; p.vy = (-4 - Math.random() * 10) * S; p.life = 0.55; break;
        case 'poof': p.life = 0.5; p.size = S * 1.25; p.x += (Math.random() - 0.5) * 20 * S; p.y += (Math.random() - 0.5) * 8 * S; break;
        case 'crumb': p.vx = (Math.random() - 0.5) * 70 * S; p.vy = (-40 - Math.random() * 50) * S; p.g = 320 * S; p.life = 0.55; break;
        case 'fur': p.vx = (Math.random() - 0.5) * 50 * S; p.vy = (-20 - Math.random() * 30) * S; p.g = 18 * S; p.life = 1.5; p.vr = (Math.random() - 0.5) * 4; break;
        case 'paper': p.vx = (Math.random() - 0.5) * 120 * S; p.vy = (-50 - Math.random() * 60) * S; p.g = 260 * S; p.life = 1; p.vr = (Math.random() - 0.5) * 14; break;
        case 'text': p.vy = -32 * S; p.life = 1.3; break;
        case 'zzz': p.vx = (8 + Math.random() * 6) * S; p.vy = -20 * S; p.life = 2.2; break;
        case 'note': p.vx = (Math.random() - 0.5) * 20 * S; p.vy = -25 * S; p.life = 1.6; break;
        default: p.life = 0.8;
      }
      particles.push(p);
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
  }

  function spawnParticles(o) {
    const n = o.n || 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = o.speed ? o.speed * (0.35 + 0.65 * Math.random()) : 0;
      const sprd = o.spread || 0;
      particles.push({
        type: o.kind, x: o.x + (Math.random() - 0.5) * 2 * sprd, y: o.y + (Math.random() - 0.5) * 1.2 * sprd,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.rise || 0) - (o.kind === 'debris' ? sp * 0.5 : 0),
        g: o.g || 0, life: (o.life || 0.6) * (0.8 + 0.4 * Math.random()), age: -(o.stagger || 0) * i,
        size: (o.size || 1) * (o.small ? 0.5 : 0.75 + 0.5 * Math.random()), rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10,
        color: o.color, flat: o.flat,
      });
    }
    if (particles.length > 500) particles.splice(0, particles.length - 500);
  }

  function drawParticle(ctx, p, x, y, unit, T) {
    if (p.age < 0) return;
    const k = p.age / p.life;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha *= k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.55) / 0.45);
    const sc = p.size * unit;
    if (p.type === 'fileAway') {
      ctx.scale(sc * (1 - k * 0.5), sc * (1 - k * 0.5));
      PROPS.file(ctx, { kind: p.data.fkind, ext: p.data.ext, rot: (p.data.rot || 0) + k * 2, name: null }, T);
    } else {
      const fn = PARTICLES[p.type] || IronArt.FX[p.type];
      if (fn) { ctx.scale(sc, sc); fn(ctx, { size: 1, k, rot: p.rot, color: p.color, text: p.text, age: p.age, flat: p.flat }); }
    }
    ctx.restore();
  }

  function ensureFx() {
    // big battles and the nuke fill the whole screen with soft effects every frame:
    // draw them at 1× so a Retina screen has a quarter of the pixels to push
    const heavy = scene === 'ironman' && latest && (latest.army || latest.nuke);
    const d = heavy ? 1 : window.devicePixelRatio || 1;
    if (!fxCanvas) {
      fxCanvas = document.createElement('canvas');
      fxCanvas.className = 'fx';
      document.body.appendChild(fxCanvas);
      fxCtx = fxCanvas.getContext('2d');
    }
    const w = Math.ceil(B.width * d), h = Math.ceil(B.height * d);
    if (fxCanvas.width !== w || fxCanvas.height !== h) {
      fxCanvas.width = w; fxCanvas.height = h;
      fxCanvas.style.width = B.width + 'px'; fxCanvas.style.height = B.height + 'px';
    }
    return d;
  }

  function releaseFx() {
    if (fxCanvas) { fxCanvas.remove(); fxCanvas = null; fxCtx = null; }
  }

  function renderFx(now, T, dt) {
    const s = latest;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) { particles.splice(i, 1); continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.type === 'zzz') p.vx *= 0.99;
    }
    const tool = s.tool && s.tool.kind;
    const cur = s.cursor;
    const curHere = inB(cur, 40);
    const mine = particles.filter((p) => !p.inCat && inB(p, 60));
    const showTool = tool && curHere && !(tool === 'mouse' && s.toyCaught);
    renderTool(showTool ? tool : null, cur, s, T, dt);
    const ironFx = scene === 'ironman' && iron && iron.fxBusy(s);
    if (!mine.length && !ironFx) {
      if (fxWasDrawn && fxCtx) { fxCtx.setTransform(1, 0, 0, 1, 0, 0); fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height); fxWasDrawn = false; fxIdleSince = now; }
      if (fxCanvas && now - fxIdleSince > 3000) releaseFx();
      return;
    }
    const d = ensureFx();
    const ctx = fxCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    ctx.setTransform(d, 0, 0, d, -B.x * d, -B.y * d);
    fxWasDrawn = true;
    if (ironFx) iron.drawFx(ctx, s, now, T);
    for (const p of mine) drawParticle(ctx, p, p.x, p.y, 1, T);
  }

  const toolSprite = new Sprite();
  function renderTool(tool, cur, s, T, dt) {
    if (!tool) { toolSprite.hide(); return; }
    toolSprite.size(120, 120, 60, 60);
    if (!toolSprite.place(cur.x, cur.y, 450000)) return;
    const ctx = toolSprite.begin();
    const v = s.cursorVel;
    if (tool === 'mouse') {
      if (Math.hypot(v.x, v.y) > 40) {
        let diff = Math.atan2(v.y, v.x) - mouseDir;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        mouseDir += diff * Math.min(1, dt * 10);
      }
      ctx.rotate(mouseDir);
      if (Math.cos(mouseDir) < 0) ctx.scale(1, -1);
      TOOLS.mouse(ctx, T, 0, false);
    } else if (TOOLS[tool]) {
      TOOLS[tool](ctx, T);
    }
  }

  // ---------------------------------------------------------------- scenes
  function switchScene(ch) {
    if (scene === 'cat') {
      catSprite.hide(); ghostSprite.hide();
      for (const sp of entSprites.values()) sp.destroy();
      entSprites.clear();
      CatSound.setPurr(false);
      R.pose = null; R.poseKey = '';
    } else if (iron) iron.dispose();
    scene = ch;
    snaps = [];
    if (ch === 'ironman' && !iron) {
      iron = IronScene.create({ Sprite, inB, spawn: spawnParticles, snaps: () => snaps, latest: () => latest, bounds: () => B, work: () => W, shake: applyShake });
    }
    document.body.dataset.character = ch;
  }

  // ---------------------------------------------------------------- shake (nuke shockwave)
  let shaking = false;
  function applyShake(px) {
    if (px > 0.3) {
      const dx = (Math.random() - 0.5) * 2 * px, dy = (Math.random() - 0.5) * 2 * px;
      const tr = `translate3d(${dx.toFixed(1)}px,${dy.toFixed(1)}px,0)`;
      stage.style.transform = tr;
      if (fxCanvas) fxCanvas.style.transform = tr;
      shaking = true;
    } else if (shaking) {
      stage.style.transform = '';
      if (fxCanvas) fxCanvas.style.transform = '';
      shaking = false;
    }
  }

  // ---------------------------------------------------------------- nuke countdown + army battle bar
  const banner = { el: document.createElement('div'), key: '' };
  banner.el.className = 'banner';
  banner.el.style.display = 'none';
  document.body.appendChild(banner.el);

  function renderBanner() {
    const s = latest;
    let html = null, kind = '';
    if (scene === 'ironman' && iron) {
      const n = s.nuke;
      if (n && !n.detonated && inB(n)) {
        const left = Math.max(0, Math.ceil((n.det - Date.now()) / 1000));
        kind = 'nuke';
        html = ['☢ NUCLEAR STRIKE INBOUND', `T-MINUS ${left}`, 'ALL UNITS EVACUATE THIS SCREEN'];
      } else if (s.army) {
        const a = s.army;
        if (String(a.did) === String(DID)) {
          kind = 'army';
          const done = Math.max(0, a.total - a.left);
          const title = a.total >= 1000 ? 'LEGENDARY BATTLE' : a.total >= 200 ? 'EPIC BATTLE' : 'HOSTILE ARMY';
          html = [`⚔ ${title} · ${a.left} LEFT`, `${done} / ${a.total} DESTROYED`, `IRON LEGION ×${a.legion}`, done / Math.max(1, a.total)];
        }
      }
    }
    if (!html) { if (banner.el.style.display !== 'none') { banner.el.style.display = 'none'; banner.key = ''; } return; }
    const key = kind + JSON.stringify(html);
    if (key !== banner.key) {
      banner.key = key;
      banner.el.dataset.kind = kind;
      banner.el.innerHTML = '';
      banner.el.appendChild(txt('div', 'b1', html[0]));
      const row = txt('div', 'b2');
      row.appendChild(txt('span', '', html[1]));
      if (html[2]) row.appendChild(txt('span', '', html[2]));
      banner.el.appendChild(row);
      if (typeof html[3] === 'number') {
        const bar = txt('div', 'bbar');
        const f = txt('div', 'bfill');
        f.style.width = Math.round(html[3] * 100) + '%';
        bar.appendChild(f);
        banner.el.appendChild(bar);
      }
    }
    banner.el.style.display = '';
    const w = banner.el.offsetWidth;
    const top = W ? W.y - B.y + 16 : 16;
    let left = (B.width - w) / 2;
    // keep the countdown out of the falling bomb's way
    if (kind === 'nuke') {
      const gx = s.nuke.x - B.x;
      if (gx > left - 70 && gx < left + w + 70) left = gx > B.width / 2 ? Math.max(16, gx - w - 110) : Math.min(B.width - w - 16, gx + 110);
    }
    banner.el.style.transform = `translate3d(${Math.round(left)}px,${Math.round(top)}px,0)`;
  }

  // ---------------------------------------------------------------- army launch dialog (from the menu)
  const dialog = { el: document.createElement('div'), open: false, at: null, side: 'right', size: 'medium', openedAt: 0 };
  dialog.el.className = 'brief armydlg';
  dialog.el.dataset.character = 'ironman';
  dialog.el.style.display = 'none';
  document.body.appendChild(dialog.el);

  function openArmyDialog(origin) {
    dialog.open = true; dialog.at = origin; dialog.openedAt = Date.now();
    buildDialog();
    dialog.el.style.display = '';
    const w = dialog.el.offsetWidth, h = dialog.el.offsetHeight;
    const lx = clamp(origin.x - B.x - w / 2, 10, B.width - w - 10), ly = clamp(origin.y - B.y - h / 2, 10, B.height - h - 10);
    dialog.el.style.transform = `translate3d(${Math.round(lx)}px,${Math.round(ly)}px,0)`;
    reportHud();
  }
  function closeArmyDialog() { dialog.open = false; dialog.el.style.display = 'none'; reportHud(); }
  function buildDialog() {
    const el = dialog.el;
    el.innerHTML = '';
    el.appendChild(txt('div', 'brief-head', 'ARMY ATTACK'));
    el.appendChild(txt('div', 'brief-time', 'CHOOSE WHERE THEY COME FROM AND HOW MANY'));
    const group = (label, opts, key) => {
      el.appendChild(txt('div', 'dlg-label', label));
      const row = txt('div', 'dlg-row');
      for (const [v, l] of opts) {
        const b = txt('button', dialog[key] === v ? 'on' : '', l);
        b.addEventListener('click', (e) => { e.stopPropagation(); dialog[key] = v; buildDialog(); });
        row.appendChild(b);
      }
      el.appendChild(row);
    };
    group('FROM', [['left', '◀ LEFT'], ['right', 'RIGHT ▶'], ['top', '▲ SKY'], ['both', '◀▶ BOTH']], 'side');
    group('SIZE', [['small', '10'], ['medium', '20'], ['large', '35'], ['massive', '50']], 'size');
    group('EPIC BATTLES', [['epic', '200 · EPIC'], ['legendary', '1000 · LEGENDARY']], 'size');
    const legion = { small: 2, medium: 3, large: 5 }[dialog.size] || 7;
    el.appendChild(txt('div', 'brief-quip', dialog.size === 'legendary'
      ? 'All 7 suits of the Iron Legion join the fight, and replacements fly in when one goes down. About 4 minutes of war.'
      : dialog.size === 'epic' ? 'All 7 suits of the Iron Legion join the fight. Heavy mechs in every wave.'
        : `Iron Man will call ${legion} more suits from the Iron Legion.`));
    const row = txt('div', 'brief-btns');
    const go = txt('button', 'primary', 'LAUNCH ATTACK');
    go.addEventListener('click', (e) => { e.stopPropagation(); api.send('cmd', { name: 'army', args: { side: dialog.side, size: dialog.size, x: dialog.at.x, y: dialog.at.y } }); closeArmyDialog(); });
    const cancel = txt('button', '', 'CANCEL');
    cancel.addEventListener('click', (e) => { e.stopPropagation(); closeArmyDialog(); });
    row.appendChild(go); row.appendChild(cancel);
    el.appendChild(row);
  }
  CatMenu.onLocal = (name, origin) => { if (name === 'army') openArmyDialog(origin); };

  // all clickable overlay panels report their rectangles to main (so only they catch the mouse)
  let hudKey = '';
  function reportHud() {
    const rects = [];
    for (const el of [panel.el, dialog.el]) {
      if (el.style.display === 'none') continue;
      const r = el.getBoundingClientRect();
      rects.push({ x: B.x + r.left, y: B.y + r.top, w: r.width, h: r.height });
    }
    const key = JSON.stringify(rects.map((r) => [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)]));
    if (key !== hudKey) { hudKey = key; api.send('hud', { rects }); }
  }

  // ---------------------------------------------------------------- reminder briefing + diagnostics panels
  const panel = { el: document.createElement('div'), id: null, spokeFor: null, rectKey: '' };
  panel.el.className = 'brief';
  panel.el.style.display = 'none';
  document.body.appendChild(panel.el);
  const diag = { el: document.createElement('div'), key: '' };
  diag.el.className = 'diag';
  diag.el.style.display = 'none';
  document.body.appendChild(diag.el);
  let battery = null;
  try { navigator.getBattery && navigator.getBattery().then((b) => { battery = b; }).catch(() => {}); } catch (e) { /* */ }

  function txt(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function buildPanel(a) {
    const el = panel.el;
    el.innerHTML = '';
    el.dataset.character = a.character || scene;
    el.appendChild(txt('div', 'brief-head', a.header || 'Reminder'));
    if (a.character === 'ironman') el.appendChild(txt('div', 'brief-time', `T-MINUS 0 · ${a.time}`));
    el.appendChild(txt('div', 'brief-task', a.text));
    el.appendChild(txt('div', 'brief-quip', a.quip || ''));
    const row = txt('div', 'brief-btns');
    const btn = (label, cmd, args, primary) => {
      const b = txt('button', primary ? 'primary' : '', label);
      b.addEventListener('click', (e) => { e.stopPropagation(); api.send('cmd', { name: cmd, args: { id: a.id, ...(args || {}) } }); });
      row.appendChild(b);
    };
    const ironStyle = a.character === 'ironman';
    btn(ironStyle ? 'ACKNOWLEDGED' : 'Done ✓', 'reminderDone', null, true);
    btn(ironStyle ? 'SNOOZE 5' : 'Snooze 5 min', 'reminderSnooze', { minutes: 5 });
    btn(ironStyle ? 'SNOOZE 15' : '15 min', 'reminderSnooze', { minutes: 15 });
    el.appendChild(row);
  }

  function renderPanels(now) {
    const s = latest;
    const a = s.announce;
    // the briefing appears on the main screen, above where the character comes to stand
    let show = false;
    if (a) {
      const wa = s.primaryWork || null;
      const ready = a.arrived || Date.now() - a.start > 3500;
      if (ready) {
        const S = s.s;
        let ax, ay;
        if (scene === 'ironman' && s.hero) { ax = s.hero.x; ay = s.hero.y - 120 * S; }
        else if (s.cat) { ax = s.cat.x; ay = s.cat.y - 95 * S; }
        if (!a.arrived && wa) { ax = wa.x + wa.width / 2; ay = wa.y + wa.height * 0.62 - 110 * S; }
        if (ax != null && inB({ x: ax, y: ay })) {
          show = true;
          if (panel.id !== a.id + a.start) { panel.id = a.id + a.start; buildPanel(a); }
          const el = panel.el;
          el.style.display = '';
          const w = el.offsetWidth, h = el.offsetHeight;
          const lx = clamp(ax - B.x - w / 2, 10, B.width - w - 10), ly = clamp(ay - B.y - h, 10, B.height - h - 10);
          el.style.transform = `translate3d(${Math.round(lx)}px,${Math.round(ly)}px,0)`;
          reportHud();
          if (panel.spokeFor !== panel.id) {
            panel.spokeFor = panel.id;
            CatSound.play(scene === 'ironman' ? 'alert' : 'reminder');
            if (s.voice) setTimeout(() => CatSound.speak(a.speech || a.text, a.character || scene), 600);
          }
        }
      }
    }
    if (!show && panel.el.style.display !== 'none') {
      panel.el.style.display = 'none';
      reportHud();
    }
    if (dialog.open && (scene !== 'ironman' || Date.now() - dialog.openedAt > 60000)) closeArmyDialog();
    renderBanner();
    // hero diagnostics card, follows the hero
    let dshow = false;
    if (scene === 'ironman' && s.diag && s.hero) {
      const S = s.s, h = s.hero;
      const ax = h.x + h.facing * 40 * S, ay = h.y - 100 * S;
      if (inB({ x: ax, y: ay })) {
        dshow = true;
        const i = s.diag.info || {};
        const bat = battery ? `${Math.round(battery.level * 100)}%${battery.charging ? ' ⚡' : ''}` : 'n/a';
        const lines = [
          ['SYSTEM', i.platform || ''], ['CPU', i.cpu != null ? `${i.cpu}%  · ${i.cores || '?'} cores` : '—'],
          ['MEMORY', i.mem != null ? `${i.mem}% of ${i.memGB} GB` : `${i.memGB || '?'} GB`], ['BATTERY', bat],
          ['UPTIME', i.uptime || '—'], ['TIME', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })],
          ['THREATS DOWN', String(s.diag.kills || 0)],
        ];
        const key = JSON.stringify(lines);
        if (key !== diag.key) {
          diag.key = key;
          diag.el.innerHTML = '';
          diag.el.appendChild(txt('div', 'diag-head', 'DIAGNOSTICS'));
          for (const [k, v] of lines) { const r = txt('div', 'diag-row'); r.appendChild(txt('span', '', k)); r.appendChild(txt('b', '', v)); diag.el.appendChild(r); }
        }
        diag.el.style.display = '';
        const w = diag.el.offsetWidth, hh = diag.el.offsetHeight;
        const lx = clamp(h.facing > 0 ? ax - B.x : ax - B.x - w, 8, B.width - w - 8), ly = clamp(ay - B.y - hh, 8, B.height - hh - 8);
        diag.el.style.transform = `translate3d(${Math.round(lx)}px,${Math.round(ly)}px,0)`;
      }
    }
    if (!dshow && diag.el.style.display !== 'none') diag.el.style.display = 'none';
  }

  // ---------------------------------------------------------------- loop
  // Adaptive frame rate: smooth when things move, gentle on the CPU/GPU when idle.
  const MOVING = new Set(['walk', 'run', 'pounce', 'fall', 'held', 'scratchFront', 'cover', 'shake', 'dizzy', 'groom', 'roll', 'standUp']);
  function busyHere() {
    const s = latest;
    if (panel.el.style.display !== 'none' || diag.el.style.display !== 'none' || dialog.open || banner.el.style.display !== 'none') return true;
    if (scene === 'ironman') return particles.some((p) => inB(p, 60)) || iron.busyHere(s);
    const c = s.cat, S = s.s;
    if (inB({ x: c.x, y: c.y - c.z }, 160 * S)) return true;
    if (c.dead && c.ghost && inB(c.ghost, 200 * S)) return true;
    if (particles.length || (s.tool && inB(s.cursor, 60))) return true;
    const E = s.ents;
    for (const k of ['bowls', 'poops', 'scratches', 'files', 'yarns', 'boxes', 'posts', 'catnips']) for (const e of E[k]) if (inB(e, 80 * S)) return true;
    return !!((E.bed && inB(E.bed, 80)) || (E.grave && inB(E.grave, 80)));
  }
  function wantFps() {
    const s = latest, c = s.cat;
    if (document.hidden || Date.now() - lastStateAt > 2000) return 2; // hidden / paused: don't draw
    if (!busyHere()) return 3;
    if (scene === 'ironman') return Math.max(iron.wantFps(s), particles.some((p) => inB(p, 60)) ? 60 : 0, panel.el.style.display !== 'none' ? 30 : 0);
    if (s.announce) return 30;
    if ((s.tool && inB(s.cursor, 60)) || c.mode !== 'task' || c.speed > 120 || c.pose === 'pounce' || c.pose === 'run') return 60;
    let fps = c.dead ? (c.ghost && Date.now() - c.ghost.start < 7000 ? 40 : 4) : c.sleeping ? 8 : 12;
    if (c.speed > 1 || MOVING.has(c.pose) || (c.flags && c.flags.wiggle) || c.action) fps = 40;
    for (const p of particles) {
      if (!inB(p, 60)) continue;
      fps = Math.max(fps, p.inCat ? (p.type === 'zzz' ? 8 : 24) : 40);
    }
    return fps;
  }
  let lastFrame = performance.now();
  function schedule() {
    // rAF for smooth motion; a plain timer when idle so the compositor can rest
    const fps = latest ? wantFps() : 4;
    if (fps >= 30) requestAnimationFrame(frame);
    else setTimeout(frame, Math.max(16, 1000 / fps - 2));
  }
  function frame() {
    schedule();
    if (!latest) return;
    const pnow = performance.now();
    const fps = wantFps();
    if (fps <= 3 && (document.hidden || Date.now() - lastStateAt > 2000)) { CatSound.setPurr(false); CatSound.setLoop('thrust', 0); return; }
    if (pnow - lastFrame < 1000 / fps - 4) return;
    const dt = Math.min(0.1, (pnow - lastFrame) / 1000);
    lastFrame = pnow;
    const now = Date.now();
    const T = now / 1000;
    try {
      if (scene === 'ironman') iron.render(latest, now, T, dt);
      else { renderEntities(now, T); renderCat(now, T, dt); }
      renderFx(now, T, dt);
      renderPanels(now);
    } catch (e) {
      console.error('render error', e && e.stack || e);
    }
  }
  schedule();
  api.send('ready', {});
})();
