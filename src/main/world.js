'use strict';
/*
 * Desktop Cat — the world simulation (runs in the main process).
 *
 *  - Cat: needs (food, energy, fun, clean, health, love, bladder), a brain that
 *    picks activities, and generator-based "tasks" (walk → sniff → eat → groom…).
 *  - World: everything on screen (bowls, poop, scratches, files, toys, bed…),
 *    tools (scoop, repair spray, toy mouse, laser, treat, brush), user input,
 *    persistence and the snapshot that the overlay windows render.
 *
 * Positions are global screen DIPs. The cat's (x, y) is the point on the
 * "floor" under it; z is height above the floor (jumps, being held).
 */

const { CAT_NAMES, fakeItem } = require('./names');

const rand = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const now = () => Date.now();
let SEQ = 1;
const uid = (p) => `${p || 'e'}${(SEQ++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const TIME_SPEEDS = { relaxed: 0.5, normal: 1, fast: 4, turbo: 25 };
const MISCHIEF = { off: 0, low: 0.4, normal: 1, high: 2.2 };
const SIZES = { tiny: 0.8, small: 1, medium: 1.3, large: 1.65 };

// Need rates, per *game* second at normal speed.
const H = 3600;
const RATE = {
  food: 100 / (3 * H),
  energy: 100 / (5 * H),
  energySleep: 100 / (0.6 * H),
  energySleepFloor: 100 / (1.3 * H),
  fun: 100 / (2 * H),
  clean: 100 / (12 * H),
  cleanPerPoop: 100 / (1.5 * H),
  bladder: 100 / (4 * H),
  healthStarve: 100 / (0.75 * H),
  healthDirty: 100 / (4 * H),
  healthHeal: 100 / (1 * H),
  love: 100 / (30 * H),
};

const FOODS = {
  fish: { food: 45, fun: 6, love: 2, sound: 'crunch', rate: 0.12, crumbs: '#6fb0f0' },
  kibble: { food: 35, fun: 2, love: 1, sound: 'crunch', rate: 0.13, crumbs: '#a8692f' },
  milk: { food: 18, fun: 9, love: 2, sound: 'lap', rate: 0.17, crumbs: '#ffffff' },
  chicken: { food: 55, fun: 10, love: 3, sound: 'crunch', rate: 0.11, crumbs: '#d98a3a' },
};

const SPEEDS = { sneak: 22, weak: 15, walk: 40, trot: 72, run: 155, zoom: 245 };

const LYING = new Set(['loaf', 'curl', 'lieSide', 'roll', 'catch']);
const TALL = new Set(['sit', 'sitFront', 'standUp', 'beg', 'scratchFront', 'groom']);

const DEFAULT_SETTINGS = {
  palette: 'white',
  eyes: 'blue',
  size: 'small',
  timeSpeed: 'normal',
  mischief: 'normal',
  sound: true,
  volume: 0.55,
  rightClick: 'anywhere', // 'anywhere' | 'alt' | 'cat'
  notifications: true,
  bubbles: true,
  realFiles: false,
  launchAtLogin: false,
};

const DEFAULT_COUNTERS = {
  meals: 0, treats: 0, poops: 0, poopsCleaned: 0, scratchesMade: 0, scratchesFixed: 0,
  filesTidied: 0, filesLost: 0, miceCaught: 0, laserPounces: 0, pets: 0, boops: 0,
  naps: 0, throws: 0, brushed: 0,
};

function newCatData(name, palette, eyes) {
  return {
    id: uid('cat'),
    name: name || pick(CAT_NAMES),
    born: now(),
    palette: palette || 'white',
    eyes: eyes || pick(['blue', 'blue', 'green', 'amber', 'odd']),
    x: 0, y: 0,
    food: 75, energy: 85, fun: 70, clean: 95, health: 100, love: 35, bladder: 15,
    dead: false, died: null,
  };
}

// ======================================================================= Cat
class Cat {
  constructor(world, data) {
    this.w = world;
    Object.assign(this, data);
    this.z = 0; this.vz = 0; this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.dist = 0;
    this.speed = 0;
    this.mode = this.dead ? 'dead' : 'task';
    this.pose = 'stand'; this.poseStart = now();
    this.expr = 'neutral';
    this.action = null;
    this.look = null;
    this.bubble = null;
    this.lastBubbleAt = 0;
    this.lastMeowAt = 0;
    this.lastMealAt = 0;
    this.rot = 0; this.spinV = 0;
    this.task = null; this.taskName = null; this.taskPrio = 0;
    this.clicks = [];
    this.pet = { active: false, path: [], since: 0, lastMove: 0 };
    this.dt = 1 / 60;
    this.ghost = null;
    this.resetTransient();
  }

  get s() { return this.w.s; }

  resetTransient() {
    this.purring = false;
    this.sleeping = false;
    this.sleepInBed = false;
    this.low = 0;
    this.flags = {};
    this.look = null;
    if (this.carry) {
      const f = this.w.ents.files.find((e) => e.id === this.carry);
      if (f) { f.carried = false; f.x = this.x + this.facing * 26 * this.s; f.y = this.y; }
      this.carry = null;
    }
    if (this.inBox) { this.inBox = null; this.z = 0; }
    this.caught = false;
  }

  // ------------------------------------------------------------ helpers
  setPose(name, expr) {
    if (this.pose !== name) { this.pose = name; this.poseStart = now(); }
    if (expr) this.expr = expr;
  }

  act(name, dur, sound) {
    this.action = { name, start: now(), dur: dur || 0.6 };
    if (sound) this.w.sound(sound, this);
  }

  meow(kind) {
    if (this.w.quiet) return;
    this.lastMeowAt = now();
    this.act('meow', kind === 'long' ? 1.0 : 0.55, 'meow-' + (kind || 'short'));
  }

  think(icon, urgent, sec) {
    if (!this.w.settings.bubbles && !urgent) return;
    if (this.w.quiet) return;
    this.bubble = { icon, urgent: !!urgent, start: now(), until: now() + (sec || 3) * 1000 };
    this.lastBubbleAt = now();
  }

  faceTo(p) {
    if (Math.abs(p.x - this.x) > 2) this.facing = p.x > this.x ? 1 : -1;
  }

  speedFor(name) {
    let v = SPEEDS[name] || SPEEDS.walk;
    if (this.food < 8 || this.health < 40) v = Math.min(v, SPEEDS.weak * 1.6);
    if (this.energy < 10) v = Math.min(v, SPEEDS.walk * 0.8);
    return v * this.s;
  }

  * wait(sec, until) {
    let t = 0;
    while (t < sec) {
      if (until && until()) return false;
      t += this.dt;
      yield;
    }
    return true;
  }

  // one movement step toward p; returns remaining distance
  step(p, speedName, expr) {
    const d = dist(this, p);
    const sp = this.speedFor(speedName);
    if (d < 0.5) { this.speed = 0; return 0; }
    const stepLen = Math.min(d, sp * this.dt);
    const dx = (p.x - this.x) / d, dy = (p.y - this.y) / d;
    let nx = this.x + dx * stepLen, ny = this.y + dy * stepLen;
    const geo = this.w.geo;
    if (!geo.inUnion('bounds', { x: nx, y: ny }, 4) && geo.inUnion('bounds', this, 4)) {
      // slide along screen edges / inside corners instead of getting pinned
      if (geo.inUnion('bounds', { x: nx, y: this.y }, 4)) ny = this.y;
      else if (geo.inUnion('bounds', { x: this.x, y: ny }, 4)) nx = this.x;
    }
    this.dist += Math.hypot(nx - this.x, ny - this.y);
    this.x = nx; this.y = ny;
    this.speed = sp;
    if (Math.abs(dx) > 0.2) this.facing = dx > 0 ? 1 : -1;
    const fast = speedName === 'run' || speedName === 'zoom';
    this.low = speedName === 'sneak' ? 1 : 0;
    this.setPose(fast ? 'run' : 'walk', expr);
    return d - stepLen;
  }

  * walkTo(target, o = {}) {
    const route = this.w.geo.route(this, target, 30 * this.s);
    const timeout = o.timeout || 40;
    let t = 0;
    for (let i = 0; i < route.length; i++) {
      const wp = route[i];
      const last = i === route.length - 1;
      const near = last ? (o.near || 2) : 4;
      let lastPos = { x: this.x, y: this.y }, still = 0;
      while (dist(this, wp) > near) {
        this.step(wp, o.speed || 'walk', o.expr);
        t += this.dt;
        if (t > timeout || (o.until && o.until())) { this.speed = 0; this.low = 0; return false; }
        // no progress for a second (blocked by a screen edge): give up and pick something else
        if (dist(this, lastPos) < 0.5) { still += this.dt; if (still > 1) { this.speed = 0; this.low = 0; return false; } }
        else { still = 0; lastPos = { x: this.x, y: this.y }; }
        yield;
      }
    }
    this.speed = 0;
    this.low = 0;
    return true;
  }

  * jumpTo(p, height, dur) {
    const sx = this.x, sy = this.y;
    const d = dist(this, p);
    dur = dur || clamp(d / (320 * this.s), 0.28, 0.6);
    this.faceTo(p);
    this.setPose('pounce');
    let t = 0;
    while (t < dur) {
      t += this.dt;
      const k = clamp(t / dur, 0, 1);
      this.x = lerp(sx, p.x, k); this.y = lerp(sy, p.y, k);
      this.z = Math.sin(Math.PI * k) * height;
      yield;
    }
    this.z = 0;
    this.w.fx('dust', this.x, this.y, { n: 3 });
  }

  // ------------------------------------------------------------ task runner
  run(gen, name, prio) {
    if (this.inTask) { this.pending = [gen, name, prio]; return; } // switch after this step finishes
    const old = this.task;
    this.task = null;
    if (old) { try { old.return(); } catch (e) { /* ignore */ } }
    this.resetTransient();
    this.task = gen;
    this.taskName = name;
    this.taskPrio = prio || 0;
  }

  interrupt(gen, name, prio) {
    if (this.mode !== 'task') return false;
    if (this.task && prio < this.taskPrio) return false;
    this.run(gen, name, prio);
    return true;
  }

  tick(dt) {
    this.dt = dt;
    if (this.action && now() - this.action.start > this.action.dur * 1000) this.action = null;
    if (this.bubble && now() > this.bubble.until) this.bubble = null;

    if (this.mode === 'dead') return;
    if (this.mode === 'held') return this.tickHeld(dt);
    if (this.mode === 'air') return this.tickAir(dt);

    if (!this.task) {
      const [gen, name, prio] = this.choose();
      this.run(gen, name, prio);
    }
    const px = this.x, py = this.y, pz = this.z;
    this.inTask = true;
    try {
      const r = this.task.next();
      if (r.done) { this.task = null; this.taskName = null; this.taskPrio = 0; }
    } catch (e) {
      console.error('[cat] task error in', this.taskName, e);
      this.task = null; this.taskName = null; this.taskPrio = 0;
    }
    this.inTask = false;
    if (this.pending) { const [g, n, pr] = this.pending; this.pending = null; this.run(g, n, pr); }
    // stay on screen
    const c = this.w.geo.clampBounds(this, 4);
    this.x = c.x; this.y = c.y;
    // actual speed this tick (the renderer uses it to pick a frame rate)
    this.speed = Math.hypot(this.x - px, this.y - py, this.z - pz) / Math.max(dt, 0.001);
  }

  // ------------------------------------------------------------ being held
  tickHeld(dt) {
    const w = this.w, s = this.s;
    const cur = w.cursor;
    // the cat dangles ~66px below the grip; its "floor" is a little lower (it drops onto it when let go)
    this.x = cur.x; this.y = cur.y + 66 * s + 30 * s; this.z = 66 * s + 30 * s;
    // pendulum swing driven by cursor acceleration
    const L = 34 * s, g = 1900 * s;
    const ax = w.cursorAcc.x;
    const acc = -(g / L) * Math.sin(this.rot) - 5.5 * this.spinV - (clamp(ax, -9000 * s, 9000 * s) / L) * Math.cos(this.rot) * 0.45;
    this.spinV += acc * dt;
    this.rot = clamp(this.rot + this.spinV * dt, -0.85, 0.85);
    // shake detection: direction reversals of fast movement
    const vx = w.cursorVel.x;
    const sgn = Math.abs(vx) > 650 * s ? Math.sign(vx) : 0;
    const t = now();
    if (sgn && sgn !== this.heldShakeSign) {
      this.heldShakeSign = sgn;
      this.heldShakes.push(t);
    }
    this.heldShakes = this.heldShakes.filter((x) => t - x < 1400);
    if (this.heldShakes.length >= 5) this.dizzyPending = true;
    const heldFor = (t - this.heldSince) / 1000;
    if (this.dizzyPending) this.expr = 'dizzy';
    else if (heldFor < 1.2) this.expr = 'surprised';
    else this.expr = this.love > 65 ? 'content' : 'nervous';
    if (heldFor > 2.5 && t - this.lastMeowAt > 6000 && chance(0.01)) this.meow(this.love > 65 ? 'short' : 'question');
  }

  startHold() {
    if (this.mode === 'dead') return;
    this.pending = null;
    if (this.task) { try { this.task.return(); } catch (e) { /* */ } }
    this.task = null; this.taskName = null; this.taskPrio = 0;
    this.resetTransient();
    this.mode = 'held';
    this.setPose('held', 'surprised');
    this.heldSince = now();
    this.heldShakes = []; this.heldShakeSign = 0;
    this.dizzyPending = false;
    this.rot = 0; this.spinV = 0;
    this.bubble = null;
    if (chance(0.55)) this.meow('question');
  }

  release() {
    if (this.mode !== 'held') return;
    const w = this.w, s = this.s;
    const v = w.cursorVel;
    const sp = Math.hypot(v.x, v.y);
    const cap = 1100 * s;
    const k = sp > cap ? cap / sp : 1;
    this.vx = v.x * k * 0.55;
    this.vy = v.y * k * 0.3;
    this.vz = Math.max(0, -v.y * k * 0.35) + 40 * s;
    this.thrown = sp > 700 * s;
    if (this.thrown) w.counters.throws++;
    this.spinV = this.thrown ? clamp(v.x / (120 * s), -14, 14) : 0;
    this.z = 30 * s; // feet start where they were dangling
    this.mode = 'air';
    this.setPose('fall', this.dizzyPending ? 'dizzy' : 'surprised');
  }

  tickAir(dt) {
    const w = this.w, s = this.s;
    const g = 2300 * s;
    this.vz -= g * dt;
    this.z += this.vz * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    const fr = Math.exp(-1.2 * dt);
    this.vx *= fr; this.vy *= fr;
    if (this.thrown) this.rot += this.spinV * dt;
    else this.rot *= Math.exp(-10 * dt);
    // bounce off the screen edges
    const c = w.geo.clampWork(this, 20 * s);
    if (c.x !== this.x) { this.vx = -this.vx * 0.4; this.x = c.x; }
    if (c.y !== this.y) { this.vy = -this.vy * 0.4; this.y = c.y; }
    if (this.z <= 0) {
      this.z = 0;
      // cats land on their feet
      this.rot = 0; this.spinV = 0;
      const hard = this.thrown;
      w.sound('thud', this);
      w.fx('dust', this.x, this.y, { n: hard ? 6 : 3 });
      this.mode = 'task';
      this.run(this.taskLand(hard, this.dizzyPending), 'land', 75);
      this.dizzyPending = false;
    }
  }

  // ------------------------------------------------------------ brain
  choose() {
    const w = this.w, s = this.s;
    if (w.announcement && !this.dead) return [this.taskAnnounce(), 'announce', 96];
    if (w.quiet) return [this.taskQuiet(), 'quiet', 95];
    if (this.health <= 0) return [this.taskDie(), 'die', 99];
    if (this.health < 30) return [this.taskWeak(), 'weak', 70];

    const bowl = w.bestBowl();
    if (bowl && this.food < 88) return [this.taskEat(bowl), 'eat', 55];
    const tool = w.tool && w.tool.kind;
    if ((tool === 'mouse' || tool === 'laser') && this.energy >= 10) return [this.taskChase(), 'chase', 60];
    if (tool === 'treat') return [this.taskTreat(), 'treat', 60];
    if (this.energy < 7) return [this.taskSleep(w.ents.bed, w.ents.bed ? 'bed' : 'floor'), 'sleep', 65];
    if (w.ents.bed && this.energy < 35) return [this.taskSleep(w.ents.bed, 'bed'), 'sleep', 55];
    if (this.bladder >= 100 && now() - this.lastMealAt > 45000) return [this.taskPoop(), 'poop', 50];
    if (this.food < 22 && chance(0.55)) return [this.taskAskFor('fish', this.food < 12), 'ask-food', 40];
    if (this.energy < 25 && chance(0.5)) {
      return chance(0.5) ? [this.taskAskFor('bed', this.energy < 14), 'ask-bed', 35] : [this.taskNap(rand(25, 45)), 'nap', 30];
    }
    if (w.ents.poops.length && this.clean < 45 && chance(0.35)) return [this.taskAskFor('poop', this.clean < 25), 'ask-clean', 30];

    const opts = [];
    const add = (wt, fn, name) => { if (wt > 0) opts.push([wt, fn, name]); };
    const mis = MISCHIEF[w.settings.mischief] == null ? 1 : MISCHIEF[w.settings.mischief];
    const bored = this.fun < 40 ? 1.8 : 1;
    const night = isNight();
    add(3, () => this.taskWander(), 'wander');
    add(1.8, () => this.taskSit(rand(6, 14)), 'sit');
    add(1 + this.love / 90, () => this.taskSitFront(rand(5, 10)), 'sitFront');
    add(this.energy < 60 ? 2 : 0.8, () => this.taskLoaf(rand(10, 25)), 'loaf');
    add((this.energy < 50 ? 1.6 : 0.3) * (night ? 2.5 : 1), () => this.taskNap(rand(30, 70)), 'nap');
    add(this.clean < 70 ? 1.5 : 0.8, () => this.taskGroom(rand(4, 9)), 'groom');
    add(0.5, () => this.taskStretch(), 'stretch');
    add(0.35 + this.love / 110, () => this.taskApproachUser(), 'approach');
    add(w.cursorBusy() ? 1.1 : 0.15, () => this.taskWatchCursor(), 'watch');
    add(this.energy > 70 && this.fun > 45 && !night ? 0.28 : 0, () => this.taskZoomies(), 'zoomies');
    add(this.love > 50 ? 0.3 : 0, () => this.taskRoll(), 'roll');
    add(this.fun < 30 ? 0.9 : 0.08, () => this.taskAskFor(pick(['yarn', 'mouse']), false), 'ask-play');
    add(w.geo.displays.length > 1 ? 0.6 : 0, () => this.taskVisitDisplay(), 'visit');
    if (mis > 0) {
      const post = w.nearest(w.ents.posts, this);
      add(0.42 * mis * bored, () => (post ? this.taskScratchPost(post) : w.ents.scratches.length < 16 ? this.taskScratchScreen() : this.taskSit(6)), 'scratch');
      add(0.42 * mis * bored, () => this.taskFilePlay(), 'files');
    }
    for (const y of w.ents.yarns) add(1.6 * bored, () => this.taskYarn(y), 'yarn');
    for (const b of w.ents.boxes) add(1.4, () => this.taskBox(b), 'box');
    for (const n of w.ents.catnips) add(6, () => this.taskCatnip(n), 'catnip');
    if (w.ents.bed && this.energy < 70) add(1.2, () => this.taskSleep(w.ents.bed, 'nap'), 'bed-nap');

    let total = opts.reduce((a, o) => a + o[0], 0);
    let r = Math.random() * total;
    for (const [wt, fn, name] of opts) {
      r -= wt;
      if (r <= 0) return [fn(), name, 10];
    }
    return [this.taskSit(5), 'sit', 10];
  }

  // Bubbles that tell the user what the cat needs.
  needs() {
    const w = this.w;
    if (this.health < 35) return { icon: 'sick', urgent: true };
    if (this.food < 15) return { icon: 'fish', urgent: true };
    if (this.energy < 12) return { icon: 'bed', urgent: true };
    if (this.food < 35) return { icon: 'fish', urgent: false };
    if (w.ents.poops.length && this.clean < 25) return { icon: 'poop', urgent: true };
    if (this.energy < 28) return { icon: 'bed', urgent: false };
    if (w.ents.poops.some((p) => now() - p.created > 120000) || (w.ents.poops.length && this.clean < 55)) return { icon: 'poop', urgent: false };
    if (this.fun < 25) return { icon: this.fun < 12 ? 'mouse' : 'yarn', urgent: false };
    if (this.love < 15) return { icon: 'brokenHeart', urgent: false };
    return null;
  }

  tickNeedsBubble() {
    if (this.mode !== 'task' || this.sleeping || this.bubble || this.w.quiet) return;
    const n = this.needs();
    const gap = n ? (n.urgent ? 7000 : 20000) : 60000;
    if (now() - this.lastBubbleAt < gap * rand(0.8, 1.3)) return;
    if (n) {
      this.think(n.icon, n.urgent, n.urgent ? 3.6 : 3);
      if (n.urgent && now() - this.lastMeowAt > 9000) this.meow(n.icon === 'sick' ? 'sad' : 'long');
    } else if (this.fun > 70 && this.love > 50 && chance(0.4)) {
      this.think(pick(['heart', 'note']), false, 2.5);
    } else {
      this.lastBubbleAt = now();
    }
  }

  moodText() {
    if (this.dead) return 'resting in peace';
    if (this.w.quiet) return 'quiet time';
    if (this.mode === 'held') return this.expr === 'dizzy' ? 'dizzy!' : 'being carried';
    if (this.sleeping) return 'sleeping';
    if (this.health < 30) return 'very weak';
    if (this.food < 15) return 'starving!';
    if (this.food < 35) return 'hungry';
    if (this.energy < 20) return 'sleepy';
    if (this.w.ents.poops.length && this.clean < 40) return 'wants clean-up';
    if (this.fun < 25) return 'bored';
    if (this.purring) return 'purring';
    if (this.love > 75 && this.fun > 60) return 'very happy';
    if (this.fun > 55) return 'happy';
    return 'content';
  }

  // ============================================================ tasks
  * taskSit(dur) {
    this.setPose('sit', 'neutral');
    let t = 0;
    while (t < dur) {
      if (chance(0.01)) this.look = chance(0.6) && this.w.cursorNear(this, 600 * this.s) ? { ref: 'cursor' } : this.w.geo.randomPoint(0, this, 300 * this.s);
      if (chance(0.0025)) this.act('yawn', 1.3);
      if (this.look && this.look.ref === 'cursor') this.faceTo(this.w.cursor);
      t += this.dt;
      yield;
    }
    if (chance(0.3)) yield* this.taskGroom(rand(3, 6));
  }

  * taskSitFront(dur) {
    this.setPose('sitFront', this.love > 60 ? 'content' : 'neutral');
    this.look = { ref: 'cursor' };
    let t = 0;
    let blinked = false;
    while (t < dur) {
      if (!blinked && this.love > 55 && t > 1.5 && chance(0.02)) { this.act('slowblink', 1.4); blinked = true; }
      if (chance(0.002)) this.meow('short');
      t += this.dt;
      yield;
    }
  }

  * taskLoaf(dur) {
    this.setPose('loaf', this.energy < 40 ? 'sleepy' : 'content');
    let t = 0;
    while (t < dur) {
      if (chance(0.008)) this.look = chance(0.5) ? { ref: 'cursor' } : null;
      t += this.dt;
      yield;
    }
  }

  * taskNap(dur) {
    this.setPose('loaf', 'sleepy');
    yield* this.wait(2);
    this.setPose(this.energy < 40 ? 'curl' : 'loaf', 'asleep');
    this.sleeping = true;
    this.w.counters.naps++;
    yield* this.wait(dur, () => this.energy >= 99);
    this.sleeping = false;
    this.setPose('loaf', 'sleepy');
    yield* this.wait(1.2);
    yield* this.taskStretch();
  }

  * taskWander() {
    const s = this.s;
    const far = chance(0.2);
    const target = far ? this.w.geo.randomPoint(60 * s) : this.w.geo.randomPoint(60 * s, this, rand(120, 420) * s);
    yield* this.walkTo(target, { speed: chance(0.2) ? 'trot' : 'walk', expr: 'neutral', timeout: 25 });
    this.setPose('stand', 'neutral');
    yield* this.wait(rand(0.6, 2));
  }

  * taskGroom(dur) {
    this.setPose('groom', 'content');
    let t = 0;
    while (t < dur) {
      this.clean = Math.min(100, this.clean + 0.4 * this.dt);
      t += this.dt;
      yield;
    }
    this.setPose('sit');
    yield* this.wait(0.8);
  }

  * taskStretch() {
    this.setPose('stretch', 'content');
    yield* this.wait(0.5);
    this.act('yawn', 1.4);
    if (chance(0.5)) this.w.sound('yawn', this);
    yield* this.wait(1.7);
    this.setPose('stand');
    yield* this.wait(0.4);
  }

  * taskApproachUser() {
    const w = this.w, s = this.s;
    const cur = w.cursor;
    if (!w.geo.inWork(cur)) return;
    const side = this.x < cur.x ? -1 : 1;
    const target = w.geo.clampWork({ x: cur.x + side * 55 * s, y: cur.y + 45 * s }, 30 * s);
    yield* this.walkTo(target, { speed: 'trot', timeout: 20 });
    this.faceTo(w.cursor);
    yield* this.taskSitFront(rand(4, 8));
  }

  * taskAskFor(icon, urgent) {
    const w = this.w, s = this.s;
    const cur = w.cursor;
    if (w.geo.inWork(cur)) {
      const side = this.x < cur.x ? -1 : 1;
      const target = w.geo.clampWork({ x: cur.x + side * 50 * s, y: cur.y + 55 * s }, 30 * s);
      yield* this.walkTo(target, { speed: urgent ? 'trot' : 'walk', timeout: 18 });
    }
    this.faceTo(w.cursor);
    const beg = icon === 'fish' && this.health > 40;
    this.setPose(beg ? 'beg' : 'sitFront', icon === 'fish' ? (this.food < 15 ? 'starving' : 'begging') : icon === 'bed' ? 'sleepy' : icon === 'poop' ? 'annoyed' : 'begging');
    this.look = { ref: 'cursor' };
    this.think(icon, urgent, 3.5);
    this.meow(urgent ? 'long' : 'short');
    yield* this.wait(2.2);
    if (urgent || chance(0.5)) this.meow(icon === 'fish' ? 'sad' : 'short');
    yield* this.wait(rand(2, 4));
    if (icon === 'bed') this.act('yawn', 1.4);
    yield* this.wait(1.5);
  }

  * taskWatchCursor() {
    const w = this.w, s = this.s;
    this.setPose('sit', 'curious');
    this.look = { ref: 'cursor' };
    let t = 0;
    const dur = rand(5, 12);
    while (t < dur) {
      this.faceTo(w.cursor);
      // hunting instinct: pounce at a fast cursor that comes close
      const d = dist(this, w.cursor);
      if (d < 140 * s && d > 40 * s && w.cursorSpeed() > 500 * s && this.energy > 30 && chance(0.05)) {
        this.setPose('crouch', 'hunt');
        this.flags.wiggle = true;
        yield* this.wait(0.45);
        this.flags.wiggle = false;
        const tgt = w.geo.clampWork({ x: w.cursor.x - this.facing * 26 * s, y: Math.max(w.cursor.y + 10 * s, this.y - 60 * s) }, 20 * s);
        yield* this.jumpTo(tgt, 26 * s);
        this.setPose('crouch', 'curious');
        yield* this.wait(0.6);
        this.setPose('sit', 'curious');
      }
      t += this.dt;
      yield;
    }
  }

  * taskZoomies() {
    const s = this.s;
    this.think('bang', false, 1.2);
    const n = Math.floor(rand(3, 6));
    for (let i = 0; i < n; i++) {
      const target = this.w.geo.randomPoint(60 * s, this, rand(250, 600) * s);
      yield* this.walkTo(target, { speed: 'zoom', expr: 'wild', timeout: 6 });
      if (chance(0.3)) { this.setPose('crouch', 'wild'); yield* this.wait(0.35); }
    }
    this.fun = Math.min(100, this.fun + 6);
    this.setPose('stand', 'happy');
    yield* this.wait(1);
    yield* this.taskSit(rand(3, 6));
  }

  * taskRoll() {
    this.setPose('roll', 'happy');
    this.purring = this.love > 60;
    yield* this.wait(rand(3, 6));
    this.purring = false;
    this.setPose('loaf', 'content');
    yield* this.wait(1.5);
  }

  * taskVisitDisplay() {
    const w = this.w, s = this.s;
    const here = w.geo.displayAt(this);
    const others = w.geo.displays.filter((d) => d !== here);
    if (!others.length) return;
    const d = pick(others);
    const target = w.geo.randomIn(d, 80 * s);
    yield* this.walkTo(target, { speed: 'trot', timeout: 40 });
    yield* this.taskSit(rand(3, 8));
  }

  * taskEat(bowl) {
    const w = this.w, s = this.s;
    const dir = this.x < bowl.x ? 1 : -1;
    // stand just behind the bowl so its rim is in front of the cat's face
    const spot = { x: bowl.x - dir * 24 * s, y: bowl.y - 3 * s };
    const hungry = this.food < 45;
    if (hungry) { this.think('bang', false, 1); }
    const ok = yield* this.walkTo(spot, { speed: hungry ? 'run' : 'trot', expr: 'happy', timeout: 30, until: () => !w.ents.bowls.includes(bowl) });
    if (!ok || !w.ents.bowls.includes(bowl)) return;
    this.facing = dir;
    if (this.food > 88) {
      this.setPose('eat', 'curious');
      yield* this.wait(1.2);
      this.setPose('stand', 'annoyed');
      this.think('question', false, 2);
      yield* this.wait(1.5);
      return;
    }
    const info = FOODS[bowl.kind] || FOODS.kibble;
    this.setPose('eat', 'eating');
    this.flags.chew = true;
    bowl.eating = true;
    let last = 0;
    try {
      while (bowl.amount > 0.001 && this.food < 100 && w.ents.bowls.includes(bowl)) {
        const bite = Math.min(bowl.amount, info.rate * this.dt);
        bowl.amount -= bite;
        this.food = Math.min(100, this.food + bite * info.food);
        this.bladder += bite * info.food * 0.45;
        this.fun = Math.min(100, this.fun + bite * info.fun);
        last += this.dt;
        if (last > 0.65) {
          last = 0;
          w.sound(info.sound, this);
          w.fx('crumb', bowl.x, bowl.y - 12 * s, { n: 2, color: info.crumbs });
        }
        w.dirty();
        yield;
      }
    } finally {
      bowl.eating = false;
      this.flags.chew = false;
    }
    this.lastMealAt = now();
    w.counters.meals++;
    this.love = Math.min(100, this.love + info.love);
    if (bowl.amount <= 0.02) w.remove('bowls', bowl, 'poof');
    this.setPose('sit', 'happy');
    this.act('lick', 1.2);
    yield* this.wait(1.4);
    if (chance(0.7)) yield* this.taskGroom(rand(3, 6));
  }

  * taskPoop() {
    const w = this.w, s = this.s;
    const spot = w.findSpot(this, 120 * s, 380 * s);
    yield* this.walkTo(spot, { speed: 'trot', expr: 'focused', timeout: 20 });
    this.setPose('cover', 'focused');
    w.sound('dig', this);
    yield* this.wait(1.1);
    this.setPose('squat', 'strain');
    yield* this.wait(2.6);
    const p = w.addPoop(this.x - this.facing * 17 * s, this.y + 1);
    w.sound('plop', p);
    this.bladder = 0;
    w.counters.poops++;
    this.setPose('cover', 'proud');
    w.sound('dig', this);
    yield* this.wait(1.6);
    this.setPose('stand', 'proud');
    // the famous post-poop zoomies
    if (chance(0.5)) {
      const target = w.geo.randomPoint(60 * s, this, rand(250, 450) * s);
      yield* this.walkTo(target, { speed: 'run', expr: 'wild', timeout: 6 });
    }
  }

  * taskSleep(bed, reason) {
    const w = this.w, s = this.s;
    if (bed) {
      const ok = yield* this.walkTo({ x: bed.x, y: bed.y - 2 * s }, { speed: 'walk', expr: 'sleepy', timeout: 30, until: () => w.ents.bed !== bed });
      if (!ok || w.ents.bed !== bed) return;
      // turn around a couple of times before lying down
      for (let i = 0; i < 2; i++) {
        this.facing = -this.facing;
        this.setPose('walk', 'sleepy');
        const sx = this.x;
        yield* this.walkTo({ x: sx + this.facing * 6 * s, y: this.y }, { speed: 'walk', timeout: 1 });
        yield* this.wait(0.25);
      }
      if (reason === 'nap' && this.energy > 60) {
        this.setPose('loaf', 'content');
        yield* this.wait(rand(8, 20));
        return;
      }
    } else if (reason === 'floor') {
      this.think('bed', true, 2.5);
      this.setPose('loaf', 'sleepy');
      yield* this.wait(1.5);
    }
    this.setPose('loaf', 'sleepy');
    this.act('yawn', 1.4);
    yield* this.wait(1.6);
    this.setPose('curl', 'asleep');
    this.sleeping = true;
    this.sleepInBed = !!bed;
    if (bed) bed.used = true;
    w.counters.naps++;
    const target = reason === 'nap' ? Math.min(100, this.energy + 35) : 99;
    yield* this.wait(60 * 60 * 4, () => this.energy >= target || (bed && w.ents.bed !== bed));
    this.sleeping = false;
    this.sleepInBed = false;
    this.setPose('loaf', 'sleepy');
    yield* this.wait(1.5);
    yield* this.taskStretch();
    if (bed && w.ents.bed === bed && reason !== 'nap') {
      // the bed folds itself away a little after a full night's sleep
      bed.fadeAt = now() + 20000;
    }
    if (!bed && reason === 'floor') {
      this.think('angry', false, 2);
      this.expr = 'annoyed';
      yield* this.wait(1.5);
    }
  }

  * taskScratchScreen() {
    const w = this.w, s = this.s;
    const near = w.cursorNear(this, 700 * s) && chance(0.4) ? w.cursor : this;
    let spot = w.geo.randomPoint(80 * s, near, 300 * s);
    spot = w.geo.clampWork({ x: spot.x, y: Math.max(spot.y, (w.geo.displayAt(spot) || w.geo.primary).work.y + 90 * s) }, 40 * s);
    yield* this.walkTo(spot, { speed: 'trot', expr: 'focused', timeout: 20 });
    this.setPose('scratchFront', 'focused');
    this.flags.scratch = true;
    const left = w.addScratch(this.x - 20 * s, this.y - 55 * s, -0.12);
    const right = w.addScratch(this.x + 20 * s, this.y - 55 * s, 0.12);
    const dur = rand(2.4, 3.4);
    let t = 0, last = 0;
    while (t < dur) {
      t += this.dt; last += this.dt;
      left.progress = Math.min(1, t / dur);
      right.progress = Math.min(1, (t - 0.15) / dur);
      if (last > 0.32) { last = 0; w.sound('scratch', this); }
      w.dirty();
      yield;
    }
    left.progress = right.progress = 1;
    this.flags.scratch = false;
    w.counters.scratchesMade++;
    this.fun = Math.min(100, this.fun + 8);
    this.setPose('sitFront', 'proud');
    this.look = { ref: 'cursor' };
    yield* this.wait(rand(1.5, 3));
  }

  * taskScratchPost(post) {
    const w = this.w, s = this.s;
    const dir = this.x < post.x ? 1 : -1;
    const ok = yield* this.walkTo({ x: post.x - dir * 22 * s, y: post.y + 2 }, { speed: 'trot', timeout: 20, until: () => !w.ents.posts.includes(post) });
    if (!ok) return;
    this.facing = dir;
    this.setPose('standUp', 'happy');
    this.flags.scratch = true;
    let t = 0, last = 0;
    const dur = rand(2.5, 4);
    while (t < dur && w.ents.posts.includes(post)) {
      t += this.dt; last += this.dt;
      if (last > 0.3) { last = 0; w.sound('scratch', this); w.fx('fur', post.x, post.y - 40 * s, { n: 1, color: '#e8cc95' }); }
      yield;
    }
    this.flags.scratch = false;
    post.wear = Math.min(1, (post.wear || 0) + 0.15);
    this.fun = Math.min(100, this.fun + 10);
    w.dirty();
    this.setPose('sit', 'proud');
    yield* this.wait(1.5);
  }

  * taskFilePlay() {
    const w = this.w, s = this.s;
    let file = null;
    if (w.ents.files.length && (w.ents.files.length >= 5 || chance(0.35))) file = pick(w.ents.files.filter((f) => !f.carried)) || null;
    if (!file) {
      const spot = w.geo.randomPoint(90 * s, this, 350 * s);
      yield* this.walkTo(spot, { speed: 'trot', expr: 'curious', timeout: 20 });
      this.setPose('crouch', 'hunt');
      this.flags.wiggle = true;
      yield* this.wait(0.7);
      this.flags.wiggle = false;
      file = w.addFile(this.x + this.facing * 36 * s, this.y + 2);
      if (!file) return;
      w.sound('pop', file);
      this.think('bang', false, 1);
      yield* this.wait(0.6);
    }
    const hits = Math.floor(rand(3, 6));
    for (let i = 0; i < hits; i++) {
      if (!w.ents.files.includes(file)) { this.think('question', false, 2); this.setPose('sit', 'curious'); yield* this.wait(2); return; }
      const dir = this.x < file.x ? 1 : -1;
      const ok = yield* this.walkTo({ x: file.x - dir * 28 * s, y: file.y }, { speed: 'run', expr: 'hunt', timeout: 6, until: () => !w.ents.files.includes(file) });
      if (!ok) continue;
      this.facing = dir;
      this.setPose('stand', 'hunt');
      this.look = { x: file.x, y: file.y - 10 * s };
      yield* this.wait(rand(0.2, 0.6));
      this.act('swat', 0.35);
      yield* this.wait(0.12);
      if (!w.ents.files.includes(file)) continue;
      file.vx = dir * rand(260, 520) * s;
      file.vy = rand(-160, 160) * s;
      file.vr = rand(-7, 7);
      w.sound('swat', file);
      w.fx('paper', file.x, file.y - 12 * s, { n: 2 });
      if (chance(0.25)) file.torn = true;
      this.fun = Math.min(100, this.fun + 5);
      yield* this.wait(0.5);
    }
    if (w.ents.files.includes(file) && chance(0.4)) {
      // carry it somewhere in the mouth
      const ok = yield* this.walkTo({ x: file.x - this.facing * 26 * s, y: file.y }, { speed: 'trot', timeout: 6 });
      if (ok && w.ents.files.includes(file)) {
        this.carry = file.id; file.carried = true;
        const dest = w.geo.randomPoint(80 * s, this, 400 * s);
        yield* this.walkTo(dest, { speed: 'trot', expr: 'proud', timeout: 15 });
        file.carried = false; this.carry = null;
        file.x = this.x + this.facing * 26 * s; file.y = this.y + 1;
        w.dirty();
      }
    }
    this.setPose('sit', 'proud');
    yield* this.wait(rand(1.5, 3));
  }

  * taskYarn(yarn) {
    const w = this.w, s = this.s;
    const n = Math.floor(rand(4, 8));
    for (let i = 0; i < n; i++) {
      if (!w.ents.yarns.includes(yarn) || this.energy < 10) break;
      const dir = this.x < yarn.x ? 1 : -1;
      const ok = yield* this.walkTo({ x: yarn.x - dir * 24 * s, y: yarn.y }, { speed: 'run', expr: 'hunt', timeout: 8, until: () => !w.ents.yarns.includes(yarn) });
      if (!ok) break;
      this.facing = dir;
      if (chance(0.35)) {
        this.setPose('crouch', 'hunt');
        this.flags.wiggle = true;
        yield* this.wait(0.5);
        this.flags.wiggle = false;
        yield* this.jumpTo({ x: yarn.x - dir * 14 * s, y: yarn.y }, 22 * s);
      } else {
        this.setPose('stand', 'hunt');
        yield* this.wait(0.2);
        this.act('swat', 0.35);
        yield* this.wait(0.12);
      }
      if (!w.ents.yarns.includes(yarn)) break;
      yarn.vx = dir * rand(200, 420) * s;
      yarn.vy = rand(-140, 140) * s;
      w.sound('swat', yarn);
      this.fun = Math.min(100, this.fun + 6);
      this.love = Math.min(100, this.love + 0.5);
      yield* this.wait(0.4);
    }
    this.setPose('sit', 'happy');
    yield* this.wait(2);
  }

  * taskBox(box) {
    const w = this.w, s = this.s;
    const dir = this.x < box.x ? 1 : -1;
    const ok = yield* this.walkTo({ x: box.x - dir * 50 * s, y: box.y }, { speed: 'trot', expr: 'curious', timeout: 20, until: () => !w.ents.boxes.includes(box) });
    if (!ok || !w.ents.boxes.includes(box)) return;
    this.facing = dir;
    this.setPose('crouch', 'curious');
    this.flags.wiggle = true;
    yield* this.wait(0.5);
    this.flags.wiggle = false;
    yield* this.jumpTo({ x: box.x, y: box.y }, 36 * s, 0.45);
    this.inBox = box.id;
    this.setPose('box', 'happy');
    this.flags.peek = 1;
    this.fun = Math.min(100, this.fun + 8);
    const dur = rand(15, 45);
    let t = 0;
    try {
      while (t < dur && w.ents.boxes.includes(box)) {
        t += this.dt;
        // duck down and peek out now and then; peek when the cursor comes near
        const near = dist(w.cursor, box) < 160 * s;
        if (near) this.flags.peek = Math.min(1, this.flags.peek + this.dt * 3);
        else if (chance(0.005)) this.flags.peekTarget = chance(0.5) ? 0 : 1;
        if (!near && this.flags.peekTarget != null) this.flags.peek += (this.flags.peekTarget - this.flags.peek) * Math.min(1, this.dt * 4);
        this.look = near ? { ref: 'cursor' } : null;
        if (this.energy < 30 && t > 6) { this.expr = 'sleepy'; }
        yield;
      }
    } finally {
      this.inBox = null;
    }
    if (!w.ents.boxes.includes(box)) return;
    yield* this.jumpTo({ x: box.x + this.facing * 50 * s, y: box.y }, 34 * s, 0.45);
    this.setPose('stand', 'happy');
    yield* this.wait(0.8);
  }

  * taskCatnip(nip) {
    const w = this.w, s = this.s;
    const dir = this.x < nip.x ? 1 : -1;
    const ok = yield* this.walkTo({ x: nip.x - dir * 22 * s, y: nip.y }, { speed: 'trot', expr: 'curious', timeout: 20, until: () => !w.ents.catnips.includes(nip) });
    if (!ok) return;
    this.facing = dir;
    this.setPose('eat', 'curious');
    w.sound('sniff', this);
    yield* this.wait(1.6);
    w.remove('catnips', nip, 'sparkle');
    this.setPose('roll', 'derp');
    this.purring = true;
    this.fun = Math.min(100, this.fun + 20);
    this.love = Math.min(100, this.love + 4);
    yield* this.wait(5);
    this.purring = false;
    for (let i = 0; i < 3; i++) {
      const target = w.geo.randomPoint(60 * s, this, rand(250, 500) * s);
      yield* this.walkTo(target, { speed: 'zoom', expr: 'derp', timeout: 5 });
    }
    this.setPose('loaf', 'sleepy');
    yield* this.wait(rand(6, 12));
  }

  * taskCome(p) {
    const w = this.w, s = this.s;
    const ignore = this.love < 25 && chance(0.5);
    if (ignore) {
      this.setPose('sit', 'annoyed');
      this.look = { x: p.x, y: p.y };
      this.act('earflick', 0.4);
      yield* this.wait(2.5);
      return;
    }
    this.think('heart', false, 1.5);
    this.meow('short');
    const target = w.geo.clampWork({ x: p.x, y: p.y + 30 * s }, 30 * s);
    yield* this.walkTo(target, { speed: this.love > 50 ? 'run' : 'trot', expr: 'happy', timeout: 30 });
    this.faceTo(w.cursor);
    yield* this.taskSitFront(rand(4, 7));
  }

  * taskChase() {
    const w = this.w, s = this.s;
    let stalk = 0;
    let lastCatch = 0;
    this.think('bang', false, 1);
    while (w.tool && (w.tool.kind === 'mouse' || w.tool.kind === 'laser')) {
      const kind = w.tool.kind;
      const tgt = w.cursor;
      if (this.energy < 8) {
        this.setPose('lieSide', 'sleepy');
        this.think('bed', false, 2.5);
        yield* this.wait(4);
        continue;
      }
      if (w.toyCaught) {
        // holding the mouse; wait for it to "escape"
        if (dist(tgt, w.toyCaught) > 70 * s) { w.toyCaught = null; this.think('bang', false, 0.8); }
        yield;
        continue;
      }
      const reach = { x: tgt.x - this.facing * 26 * s, y: tgt.y };
      const d = dist(this, reach);
      const sp = w.cursorSpeed();
      this.look = { ref: 'cursor' };
      if (d > 170 * s || sp > 650 * s) {
        this.step(w.geo.clampWork(reach, 10 * s), 'run', 'hunt');
        stalk = 0;
      } else if (d > 60 * s) {
        if (stalk < 0.7 || sp > 250 * s) {
          this.step(w.geo.clampWork(reach, 10 * s), 'sneak', 'hunt');
          stalk += this.dt;
        } else {
          // wiggle… and pounce!
          this.faceTo(tgt);
          this.setPose('crouch', 'hunt');
          this.flags.wiggle = true;
          yield* this.wait(rand(0.35, 0.7));
          this.flags.wiggle = false;
          const lead = { x: tgt.x + w.cursorVel.x * 0.12 - this.facing * 26 * s, y: tgt.y + w.cursorVel.y * 0.12 };
          w.sound('pounce', this);
          yield* this.jumpTo(w.geo.clampWork(lead, 10 * s), 30 * s);
          yield* this.afterPounce(kind, lastCatch);
          if (w.toyCaught) lastCatch = now();
          stalk = 0;
          continue;
        }
      } else {
        this.faceTo(tgt);
        if (sp < 200 * s && now() - lastCatch > 2500) {
          this.setPose('crouch', 'hunt');
          this.flags.wiggle = true;
          yield* this.wait(0.3);
          this.flags.wiggle = false;
          yield* this.jumpTo(w.geo.clampWork({ x: tgt.x - this.facing * 24 * s, y: tgt.y }, 10 * s), 18 * s, 0.28);
          yield* this.afterPounce(kind, lastCatch);
          if (w.toyCaught) lastCatch = now();
        } else {
          this.setPose('stand', 'hunt');
          if (chance(0.04)) this.act('swat', 0.35);
        }
      }
      this.energy = Math.max(0, this.energy - 0.25 * this.dt);
      this.fun = Math.min(100, this.fun + 0.8 * this.dt);
      if (chance(0.003)) w.sound('chirp', this);
      yield;
    }
    this.setPose('sit', 'happy');
    yield* this.wait(1.5);
  }

  * afterPounce(kind, lastCatch) {
    const w = this.w, s = this.s;
    const paw = { x: this.x + this.facing * 28 * s, y: this.y };
    const got = dist(paw, w.cursor) < 34 * s;
    if (kind === 'laser') {
      w.counters.laserPounces++;
      this.setPose('crouch', 'curious');
      if (got) {
        // pounced on the dot... where did it go?
        yield* this.wait(0.5);
        this.think('question', false, 1.5);
        this.setPose('sit', 'curious');
        yield* this.wait(0.8);
      }
      return;
    }
    if (got && w.cursorSpeed() < 900 * s && now() - lastCatch > 2500) {
      w.toyCaught = { x: w.cursor.x, y: w.cursor.y };
      w.counters.miceCaught++;
      w.sound('squeak', this);
      w.fx('star', paw.x, paw.y - 20 * s, { n: 5 });
      this.setPose('catch', 'proud');
      this.fun = Math.min(100, this.fun + 12);
      this.love = Math.min(100, this.love + 2);
      this.think('heart', false, 1.8);
      yield* this.wait(1.2);
    } else {
      this.setPose('crouch', 'hunt');
      yield* this.wait(0.25);
    }
  }

  * taskTreat() {
    const w = this.w, s = this.s;
    this.think('bang', false, 1);
    let begT = 0;
    while (w.tool && w.tool.kind === 'treat') {
      const cur = w.cursor;
      const spot = w.geo.clampWork({ x: cur.x - this.facing * 9 * s, y: cur.y + 52 * s }, 10 * s);
      const d = dist(this, spot);
      this.look = { ref: 'cursor' };
      if (d > 30 * s) {
        this.step(spot, d > 150 * s ? 'run' : 'trot', 'begging');
        begT = 0;
      } else {
        this.faceTo(cur);
        this.setPose('beg', 'begging');
        begT += this.dt;
        const head = { x: this.x + this.facing * 8 * s, y: this.y - 56 * s };
        if (begT > 0.9 && dist(head, cur) < 55 * s) {
          w.tool = null;
          w.dirty();
          w.counters.treats++;
          this.food = Math.min(100, this.food + 8);
          this.fun = Math.min(100, this.fun + 12);
          this.love = Math.min(100, this.love + 6);
          w.sound('nom', this);
          w.fx('heart', head.x, head.y, { n: 3 });
          this.setPose('sit', 'happy');
          this.act('lick', 1.2);
          yield* this.wait(1.8);
          yield* this.taskSitFront(3);
          return;
        }
        if (chance(0.01)) this.meow('short');
      }
      yield;
    }
  }

  * taskPetted() {
    const w = this.w, s = this.s;
    if (!LYING.has(this.pose) && this.pose !== 'sitFront') this.setPose(chance(0.5) ? 'sitFront' : 'loaf');
    this.expr = 'love';
    this.purring = true;
    let idle = 0, t = 0, heart = 0;
    while (idle < 1.6) {
      const active = this.pet.active;
      if (active) idle = 0; else idle += this.dt;
      t += this.dt; heart += this.dt;
      if (active) {
        this.love = Math.min(100, this.love + 0.9 * this.dt);
        this.fun = Math.min(100, this.fun + 0.6 * this.dt);
        if (w.tool && w.tool.kind === 'brush') {
          this.clean = Math.min(100, this.clean + 2.5 * this.dt);
          if (heart > 0.25) { heart = 0; w.fx('fur', w.cursor.x, w.cursor.y, { n: 2 }); }
        } else if (heart > 0.55) {
          heart = 0;
          const hc = { x: this.x + this.facing * 10 * s, y: this.y - 50 * s };
          w.fx('heart', hc.x, hc.y, { n: 1 });
        }
      }
      // overstimulated: a real cat might swat after a long session
      if (t > 25 && this.love < 50 && chance(0.004)) {
        this.purring = false;
        this.setPose('stand', 'annoyed');
        this.act('swat', 0.35, 'hiss');
        yield* this.wait(0.5);
        const away = w.geo.randomPoint(60 * s, this, 260 * s);
        yield* this.walkTo(away, { speed: 'trot', expr: 'annoyed', timeout: 8 });
        return;
      }
      yield;
    }
    this.purring = false;
    if (this.love > 55 && chance(0.5)) this.act('slowblink', 1.4);
    this.expr = 'content';
    yield* this.wait(1.2);
  }

  * taskBooped() {
    const w = this.w;
    this.faceTo(w.cursor);
    this.look = { ref: 'cursor' };
    const recent = this.clicks.filter((t) => now() - t < 3000).length;
    if (recent >= 5) {
      this.clicks = [];
      this.love = Math.max(0, this.love - 3);
      this.setPose('arch', 'angry');
      this.w.sound('hiss', this);
      this.think('angry', false, 2);
      yield* this.wait(1.4);
      const away = w.geo.randomPoint(60 * this.s, this, 300 * this.s);
      yield* this.walkTo(away, { speed: 'run', expr: 'annoyed', timeout: 6 });
      this.setPose('sit', 'annoyed');
      yield* this.wait(2);
      return;
    }
    if (!TALL.has(this.pose) && !LYING.has(this.pose)) this.setPose('sitFront');
    this.expr = 'surprised';
    this.act('earflick', 0.4);
    if (chance(0.5)) this.meow(chance(0.5) ? 'short' : 'question');
    yield* this.wait(0.6);
    this.expr = this.food < 30 ? 'begging' : 'content';
    if (this.food < 30) this.think('fish', false, 2);
    yield* this.wait(1.6);
  }

  * taskLand(hard, dizzy) {
    const w = this.w;
    this.setPose('stand', dizzy ? 'dizzy' : 'surprised');
    this.act('land', 0.25);
    yield* this.wait(0.3);
    // dropped onto something interesting?
    const s = this.s;
    const bowl = w.ents.bowls.find((b) => dist(b, this) < 40 * s);
    const box = w.ents.boxes.find((b) => dist(b, this) < 35 * s);
    const poop = w.ents.poops.find((p) => dist(p, this) < 26 * s);
    if (poop) {
      this.clean = Math.max(0, this.clean - 8);
      this.setPose('arch', 'angry');
      w.sound('hiss', this);
      this.think('angry', false, 2);
      yield* this.wait(0.8);
      const away = w.geo.randomPoint(60 * s, this, 200 * s);
      yield* this.walkTo(away, { speed: 'run', expr: 'annoyed', timeout: 4 });
      yield* this.taskGroom(rand(4, 7));
      return;
    }
    if (dizzy) {
      this.setPose('dizzy', 'dizzy');
      this.flags.stars = true;
      yield* this.wait(3.2);
      this.flags.stars = false;
      this.setPose('shake', 'annoyed');
      yield* this.wait(0.9);
      this.setPose('sit', 'annoyed');
      yield* this.wait(1);
      return;
    }
    if (box) { this.taskName = 'box'; this.taskPrio = 40; yield* this.taskBox(box); return; }
    if (w.ents.bed && dist(w.ents.bed, this) < 45 * s && this.energy < 75) { this.taskName = 'sleep'; this.taskPrio = 55; yield* this.taskSleep(w.ents.bed, this.energy < 40 ? 'bed' : 'nap'); return; }
    if (bowl && this.food < 88) { this.taskName = 'eat'; this.taskPrio = 55; yield* this.taskEat(bowl); return; }
    this.taskPrio = 30;
    if (hard) {
      this.setPose('shake', 'annoyed');
      yield* this.wait(0.9);
      yield* this.taskGroom(rand(3, 6));
      return;
    }
    const r = Math.random();
    if (r < 0.4) yield* this.taskGroom(rand(3, 5));
    else if (r < 0.7) { this.faceTo(w.cursor); yield* this.taskSitFront(rand(2, 4)); }
    else { this.setPose('shake', 'neutral'); yield* this.wait(0.9); }
  }

  * taskWeak() {
    const w = this.w;
    this.setPose('lieSide', 'weak');
    this.flags.tremble = 1;
    let t = 0;
    while (this.health > 0) {
      t += this.dt;
      const bowl = w.bestBowl();
      if (bowl) {
        this.flags.tremble = 0;
        yield* this.taskEat(bowl);
        return;
      }
      if (this.health >= 40) return;
      if (now() - this.lastMeowAt > 12000 && chance(0.02)) { this.meow('sad'); this.think('sick', true, 3); }
      yield;
    }
    yield* this.taskDie();
  }

  * taskDie() {
    const w = this.w;
    this.setPose('lieSide', 'weak');
    this.flags.tremble = 0.4;
    yield* this.wait(2);
    this.expr = 'closed';
    this.flags.tremble = 0;
    yield* this.wait(2.5);
    w.catDied();
  }

  * taskQuiet() {
    const w = this.w, s = this.s;
    const d = w.geo.displayAt(this) || w.geo.primary;
    const corner = { x: d.work.x + d.work.width - 70 * s, y: d.work.y + d.work.height - 30 * s };
    yield* this.walkTo(corner, { speed: 'walk', expr: 'sleepy', timeout: 30, until: () => !w.quiet });
    if (!w.quiet) return;
    this.setPose('curl', 'asleep');
    this.sleeping = true;
    while (w.quiet) yield;
    this.sleeping = false;
    yield* this.taskStretch();
  }

  * taskAnnounce() {
    const w = this.w, s = this.s;
    const a = w.announcement;
    if (!a) return;
    const d = w.geo.primary;
    const spot = { x: d.work.x + d.work.width / 2, y: d.work.y + d.work.height * 0.62 };
    this.think('bang', true, 1.5);
    this.meow('long');
    yield* this.walkTo(spot, { speed: 'run', expr: 'focused', timeout: 15 });
    a.arrived = true;
    w.dirty();
    this.facing = 1;
    this.setPose('sitFront', 'begging');
    this.look = { ref: 'cursor' };
    let t = 0;
    while (w.announcement === a) {
      t += this.dt;
      if (t > 6 && Math.random() < 0.004) this.meow('short');
      yield;
    }
    this.setPose('sitFront', 'happy');
    this.think('heart', false, 2);
    this.meow('happy');
    yield* this.wait(1.5);
  }

  * taskArrive() {
    const w = this.w, s = this.s;
    const d = w.geo.primary;
    const target = { x: d.work.x + d.work.width * rand(0.3, 0.6), y: d.work.y + d.work.height * rand(0.5, 0.8) };
    this.x = d.work.x - 40 * s; this.y = target.y; this.facing = 1;
    yield* this.walkTo(target, { speed: 'walk', expr: 'curious', timeout: 30 });
    this.setPose('sitFront', 'happy');
    this.look = { ref: 'cursor' };
    this.meow('short');
    this.think('heart', false, 2.5);
    yield* this.wait(3);
  }
}

function sanitizeCat(saved, palette) {
  const d = newCatData(null, palette);
  const out = { ...d, ...saved };
  for (const k of ['x', 'y', 'food', 'energy', 'fun', 'clean', 'health', 'love', 'bladder', 'born']) {
    if (!Number.isFinite(out[k])) out[k] = d[k];
  }
  if (typeof out.name !== 'string' || !out.name.trim()) out.name = d.name;
  out.dead = !!out.dead;
  return out;
}

function lifeSpan(ms) {
  const m = Math.round(ms / 60000), h = Math.round(ms / 3600000), d = Math.round(ms / 86400000);
  if (d >= 1) return `${d} day${d > 1 ? 's' : ''}`;
  if (h >= 1) return `${h} hour${h > 1 ? 's' : ''}`;
  return `${Math.max(1, m)} min`;
}

function isNight() {
  const h = new Date().getHours();
  return h >= 23 || h < 6;
}

// ======================================================================= World
class World {
  constructor({ geo, data, desktopItems, emit, settings }) {
    this.character = 'cat';
    this.geo = geo;
    this.emit = emit || (() => {});
    this.desktopItems = desktopItems || (() => []);
    this.settings = settings || { ...DEFAULT_SETTINGS, ...((data && data.settings) || {}) };
    this.announcement = null;
    this.counters = { ...DEFAULT_COUNTERS, ...((data && data.counters) || {}) };
    this.memorial = (data && data.memorial) || [];
    this.ents = { bowls: [], poops: [], scratches: [], files: [], yarns: [], boxes: [], posts: [], catnips: [], bed: null, grave: null };
    if (data && data.ents) {
      for (const k of Object.keys(this.ents)) if (data.ents[k] != null) this.ents[k] = data.ents[k];
      for (const b of this.ents.bowls) b.eating = false;
      for (const f of this.ents.files) { f.carried = false; f.vx = f.vy = f.vr = 0; }
      for (const y of this.ents.yarns) { y.held = false; y.vx = y.vy = 0; }
    }
    this.tool = null;
    this.toyCaught = null;
    this.quiet = !!(data && data.quiet);
    this.hidden = false;
    this.cursor = { x: 0, y: 0 };
    this.cursorVel = { x: 0, y: 0 };
    this.cursorAcc = { x: 0, y: 0 };
    this.cursorMovedAt = 0;
    this.press = null;
    this.hoverSince = 0;
    this.ver = 1;
    this.alerts = {};
    const catData = data && data.cat ? sanitizeCat(data.cat, this.settings.palette) : newCatData(null, this.settings.palette);
    this.cat = new Cat(this, catData);
    if (!data || !data.cat) this.cat.run(this.cat.taskArrive(), 'arrive', 20);
    this.placeCatOnScreen(!data || !data.cat);
    this.lastSaveAt = now();
  }

  get s() { return SIZES[this.settings.size] || 1; }
  get timeScale() { return TIME_SPEEDS[this.settings.timeSpeed] || 1; }

  dirty() { this.ver++; }

  sound(name, at) { if (!this.quiet) this.emit({ type: 'sound', name, x: at ? at.x : this.cat.x, y: at ? at.y : this.cat.y }); }
  fx(kind, x, y, o) { this.emit({ type: 'fx', kind, x, y, ...(o || {}) }); }
  notify(key, title, body) {
    if (this.alerts[key]) return;
    this.alerts[key] = true;
    if (this.settings.notifications && !this.quiet) this.emit({ type: 'notify', title, body });
  }

  placeCatOnScreen(force) {
    const c = this.cat;
    if (force || !this.geo.inAny(c)) {
      const d = this.geo.primary;
      if (!d) return;
      c.x = d.work.x + d.work.width * 0.5; c.y = d.work.y + d.work.height * 0.7;
    }
    // keep entities reachable after monitor changes
    for (const k of ['bowls', 'poops', 'files', 'yarns', 'boxes', 'posts', 'catnips']) {
      for (const e of this.ents[k]) { const q = this.geo.clampWork(e, 20); e.x = q.x; e.y = q.y; }
    }
    for (const e of this.ents.scratches) { const q = this.geo.clampBounds(e, 10); e.x = q.x; e.y = q.y; }
    for (const k of ['bed', 'grave']) if (this.ents[k]) { const q = this.geo.clampWork(this.ents[k], 30); Object.assign(this.ents[k], q); }
    this.dirty();
  }

  onDisplaysChanged() { this.placeCatOnScreen(false); }

  // ------------------------------------------------------------ entities
  add(list, e, fx) {
    this.ents[list].push(e);
    if (fx) this.fx(fx, e.x, e.y - 10 * this.s, { n: 6 });
    this.dirty();
    return e;
  }

  remove(list, e, fx) {
    const arr = this.ents[list];
    const i = arr.indexOf(e);
    if (i >= 0) arr.splice(i, 1);
    if (fx) this.fx(fx, e.x, e.y - 10 * this.s, { n: 6 });
    this.dirty();
  }

  nearest(list, p) {
    let best = null, bd = Infinity;
    for (const e of list) { const d = dist(e, p); if (d < bd) { bd = d; best = e; } }
    return best;
  }

  bestBowl() {
    const list = this.ents.bowls.filter((b) => b.amount > 0.01);
    return this.nearest(list, this.cat);
  }

  // A spot away from food and beds (for poop) within [rmin, rmax] of `from`.
  findSpot(from, rmin, rmax) {
    const avoid = [...this.ents.bowls, ...(this.ents.bed ? [this.ents.bed] : []), ...this.ents.poops];
    let best = null, bs = -1;
    for (let i = 0; i < 14; i++) {
      const p = this.geo.randomPoint(60 * this.s, from, rand(rmin, rmax));
      const score = avoid.length ? Math.min(...avoid.map((a) => dist(a, p))) : 500;
      if (score > bs) { bs = score; best = p; }
    }
    return best || this.geo.randomPoint(60 * this.s);
  }

  placeNear(p, gap) {
    const s = this.s;
    let q = { x: p.x, y: p.y };
    if (dist(q, this.cat) < (gap || 60) * s) q.x += (q.x >= this.cat.x ? 1 : -1) * (gap || 60) * s;
    return this.geo.clampWork(q, 40 * s);
  }

  addPoop(x, y) {
    return this.add('poops', { id: uid('p'), x, y, seed: Math.floor(Math.random() * 1e6), created: now() });
  }

  addScratch(x, y, angle) {
    return this.add('scratches', { id: uid('s'), x, y, seed: Math.floor(Math.random() * 1e6), angle: angle + rand(-0.12, 0.12), size: this.s * rand(0.85, 1.1), progress: 0, created: now() });
  }

  addFile(x, y) {
    if (this.ents.files.length >= 8) return null;
    let item = null;
    if (this.settings.realFiles) {
      const list = this.desktopItems();
      const used = new Set(this.ents.files.map((f) => f.name));
      const fresh = list.filter((it) => !used.has(it.name));
      if (fresh.length) item = pick(fresh);
    }
    if (!item) item = fakeItem();
    const q = this.geo.clampWork({ x, y }, 30 * this.s);
    return this.add('files', { id: uid('f'), x: q.x, y: q.y, vx: 0, vy: 0, rot: rand(-0.3, 0.3), vr: 0, name: item.name, kind: item.kind, ext: item.ext, created: now() }, 'poof');
  }

  updateEntities(dt) {
    const s = this.s;
    let moved = false;
    // files slide after being swatted, and can be knocked off the screen
    for (const f of [...this.ents.files]) {
      if (f.carried) {
        const c = this.cat;
        f.x = c.x + c.facing * 30 * s; f.y = c.y - 1;
        moved = true;
        continue;
      }
      if (Math.abs(f.vx) + Math.abs(f.vy) > 2) {
        f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt;
        const k = Math.exp(-2.6 * dt);
        f.vx *= k; f.vy *= k; f.vr *= k;
        moved = true;
        if (!this.geo.inAny({ x: f.x, y: f.y }, -8)) {
          this.remove('files', f);
          this.counters.filesLost++;
          this.sound('whoosh', f);
        } else if (!this.geo.inWork({ x: f.x, y: f.y }, 0)) {
          const q = this.geo.clampWork(f, 10);
          if (q.y !== f.y) f.vy = -f.vy * 0.3;
          f.y = q.y;
          if (Math.abs(q.x - f.x) > 0) { f.vx = -f.vx * 0.3; f.x = q.x; }
        }
      } else if (f.vx || f.vy) { f.vx = f.vy = f.vr = 0; moved = true; }
    }
    // yarn rolls with friction and leaves a little thread behind
    for (const y of this.ents.yarns) {
      if (y.held) continue;
      const sp = Math.hypot(y.vx || 0, y.vy || 0);
      if (sp > 3) {
        y.x += y.vx * dt; y.y += y.vy * dt;
        y.rot = (y.rot || 0) + (y.vx > 0 ? 1 : -1) * sp * dt / (9 * s);
        const k = Math.exp(-1.6 * dt);
        y.vx *= k; y.vy *= k;
        const q = this.geo.clampWork(y, 14 * s);
        if (q.x !== y.x) { y.vx = -y.vx * 0.6; y.x = q.x; }
        if (q.y !== y.y) { y.vy = -y.vy * 0.6; y.y = q.y; }
        moved = true;
      } else if (y.vx || y.vy) { y.vx = y.vy = 0; moved = true; }
    }
    // scratches being polished away
    for (const sc of [...this.ents.scratches]) {
      if (sc.fixing) {
        sc.fade = (sc.fade == null ? 1 : sc.fade) - dt * 2.2;
        moved = true;
        if (sc.fade <= 0) { this.remove('scratches', sc); }
      }
    }
    // bed folds away after a full sleep
    const bed = this.ents.bed;
    if (bed && bed.fadeAt && now() > bed.fadeAt && !(this.cat.sleeping && this.cat.sleepInBed)) {
      this.fx('poof', bed.x, bed.y - 8 * s, { n: 8 });
      this.ents.bed = null;
      moved = true;
    }
    if (moved) this.dirty();
  }

  // ------------------------------------------------------------ tools
  setTool(kind) {
    const prev = this.tool && this.tool.kind;
    this.tool = kind ? { kind, start: now(), used: now() } : null;
    this.toyCaught = null;
    const c = this.cat;
    if (kind === 'mouse' || kind === 'laser') {
      if (c.sleeping && c.energy < 25) { c.act('earflick', 0.4); c.think('bed', false, 2); }
      else c.interrupt(c.taskChase(), 'chase', 60);
    } else if (kind === 'treat') {
      if (!c.sleeping || c.food < 60) c.interrupt(c.taskTreat(), 'treat', 60);
    } else if (!kind && (prev === 'mouse' || prev === 'laser' || prev === 'treat') && (c.taskName === 'chase' || c.taskName === 'treat')) {
      c.run(c.taskSit(3), 'sit', 10);
    }
    this.dirty();
  }

  checkToolExpiry() {
    const t = this.tool;
    if (!t) return;
    const age = (now() - t.start) / 1000;
    const idle = (now() - (t.used || t.start)) / 1000;
    if (t.kind === 'scoop' && (!this.ents.poops.length || idle > 90)) this.setTool(null);
    else if (t.kind === 'repair' && (!this.ents.scratches.some((s) => !s.fixing) || idle > 90)) this.setTool(null);
    else if ((t.kind === 'mouse' || t.kind === 'laser') && age > 240) this.setTool(null);
    else if (t.kind === 'treat' && age > 90) this.setTool(null);
    else if (t.kind === 'brush' && age > 120) this.setTool(null);
  }

  // ------------------------------------------------------------ cursor & input
  setCursor(p, dt) {
    const vx = (p.x - this.cursor.x) / Math.max(dt, 0.001), vy = (p.y - this.cursor.y) / Math.max(dt, 0.001);
    const k = 1 - Math.exp(-dt * 14);
    const nvx = lerp(this.cursorVel.x, vx, k), nvy = lerp(this.cursorVel.y, vy, k);
    const ak = 1 - Math.exp(-dt * 10);
    this.cursorAcc.x = lerp(this.cursorAcc.x, (nvx - this.cursorVel.x) / Math.max(dt, 0.001), ak);
    this.cursorAcc.y = lerp(this.cursorAcc.y, (nvy - this.cursorVel.y) / Math.max(dt, 0.001), ak);
    this.cursorVel.x = nvx; this.cursorVel.y = nvy;
    if (p.x !== this.cursor.x || p.y !== this.cursor.y) this.cursorMovedAt = now();
    this.cursor = { x: p.x, y: p.y };
  }

  cursorSpeed() { return Math.hypot(this.cursorVel.x, this.cursorVel.y); }
  cursorBusy() { return now() - this.cursorMovedAt < 1500; }
  cursorNear(p, r) { return dist(this.cursor, p) < r; }

  catBox() {
    const c = this.cat, s = this.s;
    if (c.dead) return null;
    if (c.mode === 'held') return { x: c.x - 24 * s, y: c.y - c.z - 18 * s, w: 48 * s, h: 90 * s };
    if (c.inBox) {
      const b = this.ents.boxes.find((x) => x.id === c.inBox);
      if (b) return { x: b.x - 30 * s, y: b.y - 62 * s, w: 60 * s, h: 64 * s };
    }
    const lying = LYING.has(c.pose);
    const tall = TALL.has(c.pose);
    const h = (lying ? 40 : tall ? 74 : 62) * s;
    const wd = (lying ? 80 : tall ? 50 : 78) * s;
    const cx = c.x + c.facing * (tall ? 3 : 5) * s;
    return { x: cx - wd / 2, y: c.y - c.z - h, w: wd, h: h + 8 * s };
  }

  hitCat(p, pad) {
    const b = this.catBox();
    pad = pad || 0;
    return !!b && p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
  }

  hitList(list, p, rx, ry, oy) {
    const s = this.s;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const dx = (p.x - e.x) / (rx * s), dy = (p.y - (e.y - (oy || 0) * s)) / (ry * s);
      if (dx * dx + dy * dy <= 1) return e;
    }
    return null;
  }

  poopAt(p) { return this.hitList(this.ents.poops, p, 20, 18, 11); }
  fileAt(p) { return this.hitList(this.ents.files.filter((f) => !f.carried), p, 17, 24, 12); }
  yarnAt(p) { return this.hitList(this.ents.yarns, p, 14, 14, 9); }
  scratchAt(p) {
    for (let i = this.ents.scratches.length - 1; i >= 0; i--) {
      const e = this.ents.scratches[i];
      if (e.fixing) continue;
      const dx = (p.x - e.x) / (24 * e.size), dy = (p.y - e.y) / (26 * e.size);
      if (dx * dx + dy * dy <= 1) return e;
    }
    return null;
  }
  graveAt(p) {
    const g = this.ents.grave, s = this.s;
    return g && Math.abs(p.x - g.x) < 24 * s && p.y < g.y + 4 * s && p.y > g.y - 54 * s ? g : null;
  }
  boxAt(p) {
    const s = this.s;
    return this.ents.boxes.find((b) => Math.abs(p.x - b.x) < 30 * s && p.y < b.y + 4 * s && p.y > b.y - 46 * s) || null;
  }

  // Should the overlay accept the mouse at this point (instead of clicking through)?
  isInteractive(p) {
    if (this.press) return true;
    if (this.hidden) return false;
    const t = this.tool && this.tool.kind;
    if (t === 'scoop' && this.poopAt(p)) return true;
    if (t === 'repair' && this.scratchAt(p)) return true;
    if (this.hitCat(p)) return true;
    if (this.yarnAt(p) || this.fileAt(p)) return true;
    if (this.graveAt(p)) return true;
    if (this.cat.inBox && this.boxAt(p)) return true;
    return false;
  }

  cursorStyle(p) {
    if (this.press && this.press.target === 'cat' && this.cat.mode === 'held') return 'grabbing';
    if (this.press && this.press.target === 'yarn') return 'grabbing';
    const t = this.tool && this.tool.kind;
    if (t === 'scoop' && this.poopAt(p)) return 'none';
    if (t === 'repair' && this.scratchAt(p)) return 'none';
    if (t === 'brush' && this.hitCat(p)) return 'none';
    if (this.hitCat(p)) return t === 'treat' ? 'none' : 'grab';
    if (this.yarnAt(p)) return 'grab';
    if (this.fileAt(p) || this.graveAt(p)) return 'pointer';
    return 'default';
  }

  pointerDown(p, button) {
    if (button !== 0) return;
    const t = this.tool && this.tool.kind;
    const s = this.s;
    if (t === 'scoop') {
      const poop = this.poopAt(p);
      if (poop) { this.scoop(poop); return; }
    }
    if (t === 'repair') {
      const sc = this.scratchAt(p);
      if (sc) { this.fixScratch(sc); return; }
    }
    if (this.cat.inBox && this.boxAt(p)) {
      this.press = { target: 'box', x: p.x, y: p.y, t: now() };
      return;
    }
    if (this.hitCat(p) && !this.cat.dead) {
      this.press = { target: 'cat', x: p.x, y: p.y, t: now(), dragging: false };
      return;
    }
    const y = this.yarnAt(p);
    if (y) { this.press = { target: 'yarn', yarn: y, x: p.x, y: p.y, t: now(), ox: y.x - p.x, oy: y.y - p.y }; y.held = true; return; }
    const f = this.fileAt(p);
    if (f) { this.tidyFile(f); return; }
    const g = this.graveAt(p);
    if (g) { this.cmdFlowers(); return; }
    void s;
  }

  pointerUp(p, button) {
    const pr = this.press;
    this.press = null;
    if (!pr) return;
    const c = this.cat;
    if (pr.target === 'cat') {
      if (c.mode === 'held') { c.release(); return; }
      // a click (boop)
      this.counters.boops++;
      c.clicks.push(now());
      c.clicks = c.clicks.filter((t) => now() - t < 4000);
      if (c.sleeping) {
        if (c.clicks.length >= 3) { c.clicks = []; c.run(c.taskStretch(), 'wake', 40); c.expr = 'annoyed'; }
        else { c.act('earflick', 0.4); if (chance(0.5)) c.meow('short'); }
        return;
      }
      if (c.taskPrio <= 45 || c.taskName === 'boop') c.run(c.taskBooped(), 'boop', 45);
      else { c.act('earflick', 0.4); }
    } else if (pr.target === 'yarn') {
      const y = pr.yarn;
      y.held = false;
      const v = this.cursorVel;
      y.vx = clamp(v.x * 0.8, -1400, 1400); y.vy = clamp(v.y * 0.8, -1400, 1400);
      this.dirty();
      const cc = this.cat;
      if (!cc.sleeping && Math.hypot(y.vx, y.vy) > 150 && cc.taskPrio < 40) cc.interrupt(cc.taskYarn(y), 'yarn', 40);
    } else if (pr.target === 'box') {
      // knock on the box: the cat pops out
      if (c.inBox) c.run(c.taskLand(false, false), 'land', 30);
    }
  }

  tickPress() {
    const pr = this.press;
    if (!pr) return;
    if (pr.target === 'cat' && this.cat.mode !== 'held' && !this.cat.dead) {
      if (dist(this.cursor, pr) > 6) this.cat.startHold();
    } else if (pr.target === 'yarn') {
      const y = pr.yarn;
      y.x = this.cursor.x + pr.ox; y.y = this.cursor.y + pr.oy;
      this.dirty();
    }
  }

  // hover → status card; stroking → petting
  tickHover(dt) {
    const c = this.cat, s = this.s;
    const over = !c.dead && c.mode === 'task' && this.hitCat(this.cursor, 4 * s);
    if (over) { if (!this.hoverSince) this.hoverSince = now(); }
    else this.hoverSince = 0;
    const pet = c.pet;
    const t = now();
    if (over && !this.press && this.cursorSpeed() > 30) {
      pet.path.push({ t, d: this.cursorSpeed() * dt });
      pet.lastMove = t;
    }
    pet.path = pet.path.filter((e) => t - e.t < 1200);
    const stroke = pet.path.reduce((a, e) => a + e.d, 0);
    const wasActive = pet.active;
    pet.active = over && stroke > 110 * s && t - pet.lastMove < 400;
    if (pet.active && !wasActive) {
      this.counters.pets++;
      if (this.tool && this.tool.kind === 'brush') this.counters.brushed++;
      if (c.sleeping) { c.purring = true; c.expr = 'asleep'; }
      else if (c.taskName !== 'petted' && c.taskPrio < 30) c.run(c.taskPetted(), 'petted', 30);
    }
    if (!pet.active && c.sleeping && c.purring && c.taskName !== 'petted' && t - pet.lastMove > 2000) c.purring = false;
  }

  // ------------------------------------------------------------ actions
  scoop(poop) {
    if (this.tool) this.tool.used = now();
    this.remove('poops', poop);
    this.counters.poopsCleaned++;
    this.cat.clean = Math.min(100, this.cat.clean + 10);
    this.sound('scoop', poop);
    this.fx('sparkle', poop.x, poop.y - 12 * this.s, { n: 7 });
    this.fx('text', poop.x, poop.y - 30 * this.s, { text: `+1  (${this.counters.poopsCleaned})`, color: '#1a8a80' });
    if (!this.ents.poops.length) {
      this.setTool(null);
      if (this.cat.mode === 'task' && !this.cat.sleeping) { this.cat.think('heart', false, 2); }
    }
  }

  fixScratch(sc) {
    if (this.tool) this.tool.used = now();
    sc.fixing = true;
    this.counters.scratchesFixed++;
    this.sound('spray', sc);
    this.fx('sparkle', sc.x, sc.y, { n: 8, color: '#bfe4ff' });
    this.dirty();
  }

  tidyFile(f) {
    this.counters.filesTidied++;
    this.sound('pop', f);
    this.fx('sparkle', f.x, f.y - 14 * this.s, { n: 5 });
    this.emit({ type: 'fx', kind: 'fileAway', x: f.x, y: f.y, name: f.name, fkind: f.kind, ext: f.ext, rot: f.rot });
    this.remove('files', f);
  }

  catDied() {
    const c = this.cat;
    c.dead = true;
    c.died = now();
    c.mode = 'dead';
    c.task = null;
    c.resetTransient();
    c.ghost = { start: now(), x: c.x, y: c.y };
    this.ents.grave = { id: uid('g'), x: c.x, y: c.y + 2, name: c.name, subtitle: '♥ ' + lifeSpan(c.died - c.born), flowers: 0 };
    this.memorial.push({ name: c.name, born: c.born, died: c.died, palette: c.palette, eyes: c.eyes, cause: 'hunger' });
    this.setTool(null);
    this.sound('sad', c);
    this.alerts = {};
    this.notify('dead', `💔 ${c.name} has passed away`, 'Right-click to lay flowers or adopt a new kitten.');
    this.dirty();
  }

  adopt() {
    const old = this.cat;
    old.pending = null;
    if (old.task) { try { old.task.return(); } catch (e) { /* */ } }
    old.task = null;
    old.resetTransient();
    for (const f of this.ents.files) f.carried = false;
    this.press = null;
    const data = newCatData(null, this.settings.palette);
    this.cat = new Cat(this, data);
    this.alerts = {};
    this.cat.run(this.cat.taskArrive(), 'arrive', 20);
    this.placeCatOnScreen(true);
    this.dirty();
  }

  cmdFlowers() {
    const g = this.ents.grave;
    if (!g) return;
    g.flowers = Math.min(7, (g.flowers || 0) + 1);
    this.fx('heart', g.x, g.y - 50 * this.s, { n: 2 });
    this.dirty();
  }

  // Commands from the right-click menu / Cat Home window.
  command(name, a = {}) {
    const c = this.cat, s = this.s;
    const at = a.x != null ? { x: a.x, y: a.y } : { x: c.x + c.facing * 80 * s, y: c.y };
    switch (name) {
      case 'feed': {
        if (c.dead) return;
        const kind = FOODS[a.kind] ? a.kind : 'fish';
        // a weak cat can barely move: bring the bowl right to it
        const weak = c.health < 40 || c.food < 10 || c.taskName === 'weak';
        const p = weak ? this.geo.clampWork({ x: c.x + c.facing * 34 * s, y: c.y - 14 * s }, 30 * s) : this.placeNear(at, 70);
        const bowl = this.add('bowls', { id: uid('b'), x: p.x, y: p.y + 14 * s, kind, amount: 1, created: now() }, 'poof');
        this.sound('bowl', bowl);
        if (c.mode === 'task' && c.food < 88) {
          if (c.sleeping) {
            if (c.food < 40) c.run(c.taskEat(bowl), 'eat', 55);
            else c.act('earflick', 0.4);
          } else c.interrupt(c.taskEat(bowl), 'eat', 55);
        } else if (c.mode === 'task' && !c.sleeping) {
          c.think('question', false, 1.5);
        }
        break;
      }
      case 'treat': if (!c.dead) this.setTool('treat'); break;
      case 'scoop': if (this.ents.poops.length) this.setTool('scoop'); break;
      case 'cleanAll': for (const p of [...this.ents.poops]) this.scoop(p); break;
      case 'bed': {
        if (c.dead) return;
        const p = this.placeNear(at, 70);
        if (this.ents.bed) this.fx('poof', this.ents.bed.x, this.ents.bed.y - 8 * s, { n: 6 });
        this.ents.bed = { id: uid('bed'), x: p.x, y: p.y + 10 * s, created: now() };
        this.fx('poof', p.x, p.y, { n: 8 });
        this.dirty();
        if (c.mode === 'task' && !c.sleeping) {
          if (c.energy < 85) c.interrupt(c.taskSleep(this.ents.bed, 'bed'), 'sleep', 58);
          else c.interrupt(c.taskSleep(this.ents.bed, 'nap'), 'bed-nap', 40);
        }
        break;
      }
      case 'wake': if (c.sleeping && c.mode === 'task') c.run(c.taskStretch(), 'wake', 40); break;
      case 'putAwayBed': if (this.ents.bed) { this.fx('poof', this.ents.bed.x, this.ents.bed.y - 8 * s, { n: 6 }); this.ents.bed = null; this.dirty(); } break;
      case 'toyMouse': this.setTool(this.tool && this.tool.kind === 'mouse' ? null : 'mouse'); break;
      case 'laser': this.setTool(this.tool && this.tool.kind === 'laser' ? null : 'laser'); break;
      case 'brush': this.setTool(this.tool && this.tool.kind === 'brush' ? null : 'brush'); break;
      case 'repair': if (this.ents.scratches.length) this.setTool('repair'); break;
      case 'stopTool': this.setTool(null); break;
      case 'yarn': {
        const p = this.placeNear(at, 60);
        if (this.ents.yarns.length >= 3) this.remove('yarns', this.ents.yarns[0]);
        const y = this.add('yarns', { id: uid('y'), x: p.x, y: p.y + 10 * s, vx: 0, vy: 0, rot: 0 }, 'poof');
        if (c.mode === 'task' && !c.sleeping && c.taskPrio < 40) c.interrupt(c.taskYarn(y), 'yarn', 40);
        break;
      }
      case 'box': {
        const p = this.placeNear(at, 80);
        if (this.ents.boxes.length >= 2) this.remove('boxes', this.ents.boxes[0]);
        const b = this.add('boxes', { id: uid('x'), x: p.x, y: p.y + 20 * s }, 'poof');
        if (c.mode === 'task' && !c.sleeping && c.taskPrio < 40 && chance(0.85)) c.interrupt(c.taskBox(b), 'box', 40);
        break;
      }
      case 'catnip': {
        const p = this.placeNear(at, 60);
        const n = this.add('catnips', { id: uid('n'), x: p.x, y: p.y + 10 * s }, 'sparkle');
        if (c.mode === 'task' && !c.sleeping && c.taskPrio < 45) c.interrupt(c.taskCatnip(n), 'catnip', 45);
        break;
      }
      case 'post': {
        const p = this.placeNear(at, 70);
        if (this.ents.posts.length >= 2) this.remove('posts', this.ents.posts[0]);
        const post = this.add('posts', { id: uid('o'), x: p.x, y: p.y + 20 * s, wear: 0 }, 'poof');
        if (c.mode === 'task' && !c.sleeping && c.taskPrio < 40) c.interrupt(c.taskScratchPost(post), 'scratch', 40);
        break;
      }
      case 'fixAll': for (const sc of this.ents.scratches) if (!sc.fixing) this.fixScratch(sc); break;
      case 'tidyFiles': for (const f of [...this.ents.files]) if (!f.carried) this.tidyFile(f); break;
      case 'putAwayToys':
        for (const k of ['yarns', 'boxes', 'catnips', 'posts']) for (const e of [...this.ents[k]]) this.remove(k, e, 'poof');
        if (c.inBox) c.run(c.taskSit(2), 'sit', 10);
        break;
      case 'call':
        if (c.mode === 'task' && !c.dead) {
          if (c.sleeping && c.energy < 30) { c.act('earflick', 0.4); c.think('bed', false, 2); }
          else c.interrupt(c.taskCome(at), 'come', 50);
        }
        break;
      case 'quiet':
        this.quiet = a.value != null ? !!a.value : !this.quiet;
        this.setTool(null);
        if (c.mode === 'task' && !c.dead) c.run(this.quiet ? c.taskQuiet() : c.taskStretch(), this.quiet ? 'quiet' : 'wake', 95);
        this.dirty();
        break;
      case 'flowers': this.cmdFlowers(); break;
      case 'removeGrave': this.ents.grave = null; this.dirty(); break;
      case 'adopt': if (c.dead) { this.adopt(); } break;
      case 'rename': if (a.name && String(a.name).trim()) { c.name = String(a.name).trim().slice(0, 24); this.dirty(); } break;
      case 'resetCat': this.memorial.push({ name: c.name, born: c.born, died: now(), palette: c.palette, eyes: c.eyes, cause: 'rehomed' }); this.ents.grave = null; this.adopt(); break;
      case 'setting':
        if (a.key in DEFAULT_SETTINGS) { this.settings[a.key] = a.value; this.onSetting(a.key, a.value); }
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ shared interface (see main.js)
  announce(a) {
    this.announcement = { ...a, start: now() };
    const c = this.cat;
    if (c.mode === 'held') c.release();
    if (c.mode === 'task' && !c.dead) c.run(c.taskAnnounce(), 'announce', 96);
    this.dirty();
  }

  clearAnnouncement(id) {
    if (this.announcement && (id == null || this.announcement.id === id)) { this.announcement = null; this.dirty(); }
  }

  activate() {
    const c = this.cat;
    if (!c.dead) { c.run(c.taskArrive(), 'arrive', 20); }
    this.dirty();
  }

  deactivate() {
    const c = this.cat;
    this.setTool(null);
    this.press = null;
    c.pending = null;
    if (c.task) { try { c.task.return(); } catch (e) { /* */ } }
    c.task = null; c.taskName = null; c.taskPrio = 0;
    c.resetTransient();
    if (c.mode === 'held' || c.mode === 'air') { c.mode = 'task'; c.z = 0; c.rot = 0; }
  }

  onSetting(key, value) {
    if (key === 'palette') this.cat.palette = value;
    if (key === 'eyes') this.cat.eyes = value;
    if (key === 'size') this.placeCatOnScreen(false);
    this.dirty();
  }

  wantsFast() {
    const c = this.cat;
    return !!(this.press || c.mode === 'held' || c.mode === 'air' || this.tool);
  }

  activeIn(near) {
    const c = this.cat;
    if (near({ x: c.x, y: c.y - c.z }, 220)) return true;
    if (c.ghost && Date.now() - c.ghost.start < 8000 && near(c.ghost, 300)) return true;
    if (this.announcement) return true;
    const E = this.ents;
    for (const k of ['bowls', 'poops', 'scratches', 'files', 'yarns', 'boxes', 'posts', 'catnips']) for (const e of E[k]) if (near(e, 100)) return true;
    return !!((E.bed && near(E.bed, 100)) || (E.grave && near(E.grave, 100)));
  }

  info() {
    const c = this.cat;
    return { name: c.name, status: c.moodText(), dead: c.dead, food: c.food };
  }

  contextAt(p) {
    const c = this.cat;
    return {
      onCat: this.hitCat(p, 6 * this.s),
      onPoop: !!this.poopAt(p),
      onScratch: !!this.scratchAt(p),
      onFile: !!this.fileAt(p),
      onGrave: !!this.graveAt(p),
      dead: c.dead,
    };
  }

  // ------------------------------------------------------------ main tick
  tick(dt, realGap) {
    if (this.hidden) return;
    // long gaps (sleep/hibernate) are handled gently, like time away
    if (realGap && realGap > 5) { this.applyAway(realGap); return; }
    const c = this.cat;
    const gdt = this.quiet ? 0 : dt * this.timeScale;
    this.updateStats(gdt);
    this.updateEntities(dt);
    this.tickPress();
    c.tick(dt);
    if (!c.dead) {
      this.tickHover(dt);
      c.tickNeedsBubble();
      this.checkAlerts();
      if (c.mode === 'task' && !this.quiet) {
        // urgent needs interrupt whatever the cat is doing
        if (c.health <= 0 && c.taskName !== 'die') c.run(c.taskDie(), 'die', 99);
        else if (c.health < 30 && c.taskPrio < 55 && c.taskName !== 'weak') c.run(c.taskWeak(), 'weak', 70);
        else if (c.energy < 4 && !c.sleeping && c.taskPrio < 60) c.run(c.taskSleep(this.ents.bed, this.ents.bed ? 'bed' : 'floor'), 'sleep', 65);
      }
    }
    this.checkToolExpiry();
  }

  updateStats(gdt) {
    const c = this.cat;
    if (c.dead || gdt <= 0) return;
    const active = c.pose === 'run' || c.pose === 'pounce' ? 3 : 1;
    const night = isNight();
    c.food -= RATE.food * gdt * (c.sleeping ? 0.6 : 1);
    if (c.sleeping) c.energy += (c.sleepInBed ? RATE.energySleep : RATE.energySleepFloor) * gdt;
    else c.energy -= RATE.energy * gdt * active * (night ? 1.4 : 1);
    c.fun -= RATE.fun * gdt * (c.sleeping ? 0.15 : 1);
    c.clean -= (RATE.clean + RATE.cleanPerPoop * this.ents.poops.length) * gdt;
    c.bladder += RATE.bladder * gdt;
    c.love -= RATE.love * gdt;
    if (c.food <= 0) c.health -= RATE.healthStarve * gdt;
    else if (c.clean < 12) c.health -= RATE.healthDirty * gdt;
    else if (c.food > 30) c.health += RATE.healthHeal * gdt;
    for (const k of ['food', 'energy', 'fun', 'clean', 'health', 'love']) c[k] = clamp(c[k], 0, 100);
    c.bladder = clamp(c.bladder, 0, 130);
  }

  checkAlerts() {
    const c = this.cat, n = c.name;
    if (c.food < 15) this.notify('food', `🐟 ${n} is very hungry!`, 'Right-click anywhere → Feed.');
    else if (c.food > 40) this.alerts.food = false;
    if (c.health < 30) this.notify('health', `💔 ${n} is getting weak`, 'Feed them soon, or they might not make it.');
    else if (c.health > 50) this.alerts.health = false;
    if (c.energy < 8) this.notify('energy', `😴 ${n} is exhausted`, 'Right-click → Sleep to give them a cozy bed.');
    else if (c.energy > 30) this.alerts.energy = false;
  }

  // Time passed while the app was closed or the computer was asleep: gentle decay, never fatal.
  applyAway(sec) {
    const c = this.cat;
    if (c.dead || this.quiet) return;
    const g = sec * this.timeScale * 0.3;
    c.food = Math.max(Math.min(c.food, 25), c.food - RATE.food * g);
    c.energy = clamp(c.energy + RATE.energySleepFloor * g * 0.5, 0, 100);
    c.fun = Math.max(Math.min(c.fun, 30), c.fun - RATE.fun * g);
    c.love = Math.max(Math.min(c.love, 20), c.love - RATE.love * g);
    c.bladder += RATE.bladder * g;
    if (c.bladder >= 100 && sec > 1800 && this.ents.poops.length < 3) {
      const p = this.geo.randomPoint(80 * this.s);
      this.addPoop(p.x, p.y);
      c.bladder = 10;
      this.counters.poops++;
    }
    this.dirty();
  }

  // ------------------------------------------------------------ snapshot & save
  snapshot() {
    const c = this.cat, s = this.s;
    let look = null;
    if (c.look) look = c.look.ref === 'cursor' ? { x: this.cursor.x, y: this.cursor.y } : { x: c.look.x, y: c.look.y };
    const hover = !!this.hoverSince && now() - this.hoverSince > 450 && !this.press && !c.pet.active && !(this.tool && this.tool.kind === 'brush');
    return {
      t: now(),
      s,
      character: 'cat',
      announce: this.announcement,
      primaryWork: this.geo.primary ? this.geo.primary.work : null,
      cat: {
        x: c.x, y: c.y, z: c.z, facing: c.facing, dist: c.dist, speed: c.speed,
        pose: c.pose, poseStart: c.poseStart, expr: c.expr, action: c.action, look,
        rot: c.rot, bubble: c.bubble, purring: c.purring, sleeping: c.sleeping, mode: c.mode,
        low: c.low, flags: c.flags, carry: c.carry, inBox: c.inBox, hover, dead: c.dead, ghost: c.ghost,
        name: c.name, palette: c.palette, eyes: c.eyes, mood: c.moodText(),
        stats: { food: c.food, energy: c.energy, fun: c.fun, clean: c.clean, health: c.health, love: c.love },
        caught: !!this.toyCaught && c.pose === 'catch',
        petting: c.pet.active,
      },
      ents: this.ents, // main.js strips this when unchanged (see `ver`)
      ver: this.ver,
      tool: this.tool,
      toyCaught: this.toyCaught,
      cursor: this.cursor,
      cursorVel: this.cursorVel,
      quiet: this.quiet,
      sound: this.settings.sound,
      volume: this.settings.volume,
      voice: this.settings.voice !== false,
    };
  }

  homeState() {
    const c = this.cat;
    return {
      character: 'cat',
      cat: {
        name: c.name, born: c.born, died: c.died, dead: c.dead, palette: c.palette, eyes: c.eyes, mood: c.moodText(),
        pose: c.pose, expr: c.expr, sleeping: c.sleeping,
        stats: { food: c.food, energy: c.energy, fun: c.fun, clean: c.clean, health: c.health, love: c.love, bladder: c.bladder },
      },
      counts: { poops: this.ents.poops.length, scratches: this.ents.scratches.length, files: this.ents.files.length, bowls: this.ents.bowls.length },
      counters: this.counters,
      settings: this.settings,
      memorial: this.memorial,
      quiet: this.quiet,
      tool: this.tool && this.tool.kind,
    };
  }

  serialize() {
    const c = this.cat;
    const cat = {};
    for (const k of ['id', 'name', 'born', 'palette', 'eyes', 'x', 'y', 'food', 'energy', 'fun', 'clean', 'health', 'love', 'bladder', 'dead', 'died']) cat[k] = c[k];
    const ents = JSON.parse(JSON.stringify(this.ents));
    ents.scratches = ents.scratches.filter((s) => !s.fixing).map((s) => ({ ...s, progress: 1 }));
    return { version: 1, savedAt: now(), cat, ents, settings: this.settings, counters: this.counters, memorial: this.memorial, quiet: this.quiet };
  }
}

module.exports = { World, DEFAULT_SETTINGS, TIME_SPEEDS, SIZES };
