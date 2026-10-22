'use strict';
/*
 * Desktop Buddies — the armored hero ("Iron Man" style) world simulation.
 *
 * Side view: the hero stands on the floor (bottom of each screen's work area)
 * and has to fly to go anywhere higher. Enemies are deployed from the menu;
 * the hero fights them with repulsors, a two-hand blast, homing micro-missiles
 * and the chest beam. Enemies shoot back; at zero armor the suit goes offline
 * and reboots.
 *
 * Same public interface as the cat World (world.js) so main.js can switch.
 * Positions are global screen DIPs; hero (x, y) = point between the feet.
 */

const rand = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const now = () => Date.now();
const num = (v, d) => (Number.isFinite(v) ? v : d);
let SEQ = 1;
const uid = (p) => `${p}${(SEQ++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const SIZES = { tiny: 0.8, small: 1, medium: 1.3, large: 1.6 };
const DIFF = { easy: { hp: 0.8, dmg: 0.5, rate: 0.75 }, normal: { hp: 1, dmg: 1, rate: 1 }, hard: { hp: 1.35, dmg: 1.5, rate: 1.3 } };
const INVASIONS = { off: null, rare: [20 * 60, 40 * 60], often: [4 * 60, 9 * 60] };

const ENEMY = {
  drone: { hp: 3, air: true, speed: 150, fire: [1.6, 3.0], dmg: 4, score: 1, r: 15, cy: 0, label: 'DRONE' },
  mini: { hp: 1, air: true, speed: 240, kamikaze: true, dmg: 4, score: 1, r: 9, cy: 0, label: 'SWARM' },
  walker: { hp: 6, air: false, speed: 48, fire: [2.0, 3.2], dmg: 5, score: 2, r: 20, cy: -24, label: 'WALKER' },
  tank: { hp: 12, air: false, speed: 34, fire: [3.2, 4.6], dmg: 9, score: 3, r: 24, cy: -13, label: 'TANK' },
  boss: { hp: 45, air: false, speed: 24, fire: [2.6, 3.6], dmg: 8, score: 10, r: 50, cy: -62, label: 'HEAVY MECH' },
};

const QUIPS_GREET = ['Hey there.', 'Systems nominal.', 'Need something?', 'Suit check: looking good.', 'All good up here.', 'At your service.'];
const QUIPS_POKE = ['Careful with the paint job.', 'That tickles. Not really.', 'Hands off the armor!', 'Okay, okay, I\'m awake.'];
const QUIPS_HELD = ['Whoa! Put me down!', 'Stabilizers… offline-ish.', 'This is undignified.', 'I can fly, you know.'];
const QUIPS_WIN = ['Threat neutralized.', 'That was almost too easy.', 'Area secure.', 'Another day, another drone.'];

const DEFAULT_IRON = { power: 100, armor: 100, missiles: 12 };

// ======================================================================= Hero
class Hero {
  constructor(w, d) {
    d = d || {};
    this.w = w;
    this.power = clamp(num(d.power, 100), 0, 100);
    this.armor = clamp(num(d.armor, 100), 0, 100);
    this.missiles = clamp(num(d.missiles, 12), 0, 12);
    this.x = num(d.x, 0); this.y = num(d.y, 0);
    this.vx = 0; this.vy = 0; this.facing = 1;
    this.mode = 'ground'; // ground | air | held | fall | down
    this.pose = 'stand'; this.poseStart = now();
    this.aim = null; this.aimArm = 'near';
    this.charge = 0; this.beamK = 0; this.eyes = 1;
    this.dist = 0; this.hitAt = 0; this.swing = 0; this.swingV = 0;
    this.task = null; this.taskName = null; this.taskPrio = 0; this.inTask = false; this.pending = null;
    this.cd = { repulsor: 0, blast: 0, missiles: 0, unibeam: 0, dodge: 0 };
    this.clicks = [];
    this.lastStep = 0;
    this.dt = 1 / 60;
    this.speed = 0;
  }

  get s() { return this.w.s; }

  setPose(name) { if (this.pose !== name) { this.pose = name; this.poseStart = now(); } }
  ground() { return this.w.groundAt(this.x, this.y); }
  faceTo(p) { if (Math.abs(p.x - this.x) > 3) this.facing = p.x > this.x ? 1 : -1; }
  chest() { return { x: this.x + this.facing * 2 * this.s, y: this.y - 62 * this.s }; }
  reactor() { return { x: this.x + this.facing * 2.4 * this.s, y: this.y - 65.5 * this.s }; }
  shoulder(far) { return { x: this.x + this.facing * (far ? 10 : -10.5) * this.s, y: this.y - 74 * this.s }; }
  palm(tp, far) {
    const sh = this.shoulder(far);
    const dx = tp.x - sh.x, dy = tp.y - sh.y, d = Math.hypot(dx, dy) || 1;
    return { x: sh.x + dx / d * 32 * this.s, y: sh.y + dy / d * 32 * this.s };
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

  // ------------------------------------------------------------ runner
  run(gen, name, prio) {
    if (this.inTask) { this.pending = [gen, name, prio]; return; }
    const old = this.task;
    this.task = null;
    if (old) { try { old.return(); } catch (e) { /* */ } }
    this.aim = null; this.charge = 0; this.beamK = 0;
    this.task = gen; this.taskName = name; this.taskPrio = prio || 0;
  }

  interrupt(gen, name, prio) {
    if (this.mode === 'held' || this.mode === 'down') return false;
    if (this.task && prio < this.taskPrio) return false;
    this.run(gen, name, prio);
    return true;
  }

  tick(dt) {
    this.dt = dt;
    const w = this.w, s = this.s;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    // power & armor
    if (this.mode === 'air') this.power -= (this.speed > 250 * s ? 0.8 : 0.45) * dt;
    else if (this.mode === 'ground' && !this.aim && this.pose !== 'unibeam') this.power += (this.pose === 'walk' ? 1.2 : 3) * dt;
    if (!w.enemies.length && this.mode !== 'down') this.armor += (this.mode === 'ground' ? 1.4 : 0.5) * dt;
    if (w.now - (this.lastMissileAt || 0) > 6000 && this.missiles < 12) { this.missiles++; this.lastMissileAt = w.now; }
    this.power = clamp(this.power, 0, 100);
    this.armor = clamp(this.armor, 0, 100);

    const px = this.x, py = this.y;
    if (this.mode === 'held') { this.tickHeld(dt); return; }
    if (this.mode === 'fall') { this.tickFall(dt); this.speed = Math.hypot(this.x - px, this.y - py) / dt; return; }

    if (!this.task) { const [g, n, p] = this.choose(); this.run(g, n, p); }
    this.inTask = true;
    try {
      const r = this.task.next();
      if (r.done) { this.task = null; this.taskName = null; this.taskPrio = 0; }
    } catch (e) {
      console.error('[hero] task error in', this.taskName, e);
      this.task = null; this.taskName = null; this.taskPrio = 0;
    }
    this.inTask = false;
    if (this.pending) { const [g, n, p] = this.pending; this.pending = null; this.run(g, n, p); }
    // stay on screen; on the floor unless flying
    const g = this.ground();
    if (this.mode === 'ground' || this.mode === 'down') this.y = g;
    else if (this.y > g) { this.y = g; this.vy = Math.min(0, this.vy); }
    this.keepOnScreen();
    this.speed = Math.hypot(this.x - px, this.y - py) / Math.max(dt, 0.001);
  }

  keepOnScreen() {
    const s = this.s, geo = this.w.geo;
    const d = geo.displayAt({ x: this.x, y: this.y - 40 * s }) || geo.nearestDisplay({ x: this.x, y: this.y });
    if (!d) return;
    const top = d.work.y + 100 * s;
    if (this.y < top) { this.y = top; this.vy = Math.max(0, this.vy); }
    const c = geo.clampBounds({ x: this.x, y: this.y - 40 * s }, 20 * s);
    if (c.x !== this.x) { this.x = c.x; this.vx = 0; }
  }

  // ------------------------------------------------------------ movement
  * walkTo(tx, o = {}) {
    const s = this.s;
    tx = this.w.clampFloorX(tx, this.x, this.y);
    let t = 0;
    while (Math.abs(tx - this.x) > 2) {
      const dir = Math.sign(tx - this.x);
      this.facing = dir;
      const step = Math.min(Math.abs(tx - this.x), 55 * s * this.dt);
      this.x += dir * step;
      this.dist += step;
      this.setPose('walk');
      // heavy footsteps
      if (this.dist - this.lastStep > 15 * s) { this.lastStep = this.dist; this.w.sound('clank', this); }
      t += this.dt;
      if (t > (o.timeout || 20) || (o.until && o.until())) break;
      yield;
    }
    this.setPose('stand');
  }

  steer(tx, ty, maxSp, accel) {
    const dt = this.dt, s = this.s;
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    const want = Math.min(maxSp, d * 2.8);
    const wx = d > 0.5 ? (dx / d) * want : 0, wy = d > 0.5 ? (dy / d) * want : 0;
    const dvx = wx - this.vx, dvy = wy - this.vy;
    const dv = Math.hypot(dvx, dvy), a = (accel || 1300 * s) * dt;
    if (dv > a) { this.vx += (dvx / dv) * a; this.vy += (dvy / dv) * a; } else { this.vx = wx; this.vy = wy; }
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (Math.abs(this.vx) > 40 * s && !this.aim) this.facing = this.vx > 0 ? 1 : -1;
    this.airPose();
    return d;
  }

  airPose() {
    if (this.aim) return;
    const s = this.s;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 210 * s && Math.abs(this.vx) > Math.abs(this.vy) * 0.55) this.setPose('fly');
    else if (this.vy < -130 * s && Math.abs(this.vx) < 120 * s) this.setPose('flyUp');
    else this.setPose('hover');
  }

  * takeOff(height) {
    if (this.mode === 'air') return;
    const s = this.s;
    this.setPose('crouch');
    this.w.sound('thrustOn', this);
    yield* this.wait(0.28);
    this.mode = 'air';
    this.vy = -260 * s;
    const target = { x: this.x, y: this.y - (height || rand(140, 240)) * s };
    let t = 0;
    while (t < 1.2 && this.steer(target.x, target.y, 320 * s) > 6) { t += this.dt; yield; }
  }

  * flyTo(p, o = {}) {
    const s = this.s;
    if (this.mode !== 'air') yield* this.takeOff(120);
    const route = this.w.geo.route({ x: this.x, y: this.y - 40 * s }, { x: p.x, y: p.y - 40 * s }, 40 * s).map((q) => ({ x: q.x, y: q.y + 40 * s }));
    let t = 0;
    for (let i = 0; i < route.length; i++) {
      const wp = route[i];
      const last = i === route.length - 1;
      while (this.steer(wp.x, wp.y, (o.speed || 340) * s) > (last ? (o.near || 6) : 30)) {
        t += this.dt;
        if (t > (o.timeout || 25) || (o.until && o.until())) return false;
        yield;
      }
    }
    return true;
  }

  * hoverFor(sec, until) {
    let t = 0;
    const hx = this.x, hy = this.y;
    while (t < sec) {
      if (until && until()) break;
      this.steer(hx, hy, 100 * this.s);
      t += this.dt;
      yield;
    }
  }

  * land(x) {
    const s = this.s;
    if (this.mode === 'ground') return;
    const tx = x == null ? this.x : x;
    const g = this.w.groundAt(tx, this.y);
    const height = g - this.y;
    if (height > 130 * s) {
      // dive down for a superhero landing
      yield* this.flyTo({ x: tx, y: g - 70 * s }, { speed: 420, near: 14 });
      let t = 0;
      while (this.y < this.w.groundAt(this.x, this.y) - 1 && t < 1) {
        this.vy = Math.min(900 * s, this.vy + 2600 * s * this.dt);
        this.vx *= 0.9;
        this.x += this.vx * this.dt; this.y += this.vy * this.dt;
        this.setPose('hover');
        t += this.dt;
        yield;
      }
      this.y = this.w.groundAt(this.x, this.y);
      this.vx = this.vy = 0;
      this.mode = 'ground';
      this.setPose('land');
      this.w.sound('landing', this);
      this.w.fx('shockwave', this.x, this.y, {});
      yield* this.wait(0.95);
      this.setPose('stand');
      yield* this.wait(0.25);
    } else {
      yield* this.flyTo({ x: tx, y: g - 4 * s }, { speed: 220, near: 5 });
      this.y = this.w.groundAt(this.x, this.y);
      this.vx = this.vy = 0;
      this.mode = 'ground';
      this.setPose('stand');
      this.w.sound('clank', this);
      yield* this.wait(0.3);
    }
  }

  // ------------------------------------------------------------ attacks
  aimAt(tp, arm) {
    this.aim = { x: tp.x, y: tp.y };
    this.aimArm = arm || 'near';
    this.faceTo(tp);
  }

  holdPosition() {
    if (this.mode === 'air') this.steer(this.x - this.vx * 0.02, this.y - this.vy * 0.02, 120 * this.s);
  }

  * repulsor(tp, enemy, shots) {
    const w = this.w, s = this.s;
    for (let i = 0; i < (shots || 1); i++) {
      if (enemy && enemy.hp <= 0) return;
      const t0 = enemy ? w.enemyCenter(enemy) : tp;
      this.aimAt(t0, 'near');
      this.setPose('aim');
      let t = 0;
      while (t < 0.14) { this.charge = t / 0.14; this.holdPosition(); t += this.dt; yield; }
      if (this.power < 1.5) { w.say('POWER LOW', 'warn'); this.aim = null; return; }
      this.power -= 1.5;
      const target = enemy ? w.enemyCenter(enemy) : tp;
      const from = this.palm(target);
      let to = target;
      let victim = null;
      if (enemy && chance(0.88)) victim = enemy;
      else victim = w.firstEnemyOnLine(from, target, 1.15);
      if (victim) { to = w.enemyCenter(victim); w.damage(victim, 1.7, from); }
      else if (enemy) {
        const ang = Math.atan2(target.y - from.y, target.x - from.x) + rand(-0.12, 0.12);
        to = { x: from.x + Math.cos(ang) * 900 * s, y: from.y + Math.sin(ang) * 900 * s };
      }
      w.addBeam('repulsor', from, to, 0.14, 4.2, 'hero');
      w.counters.shotsFired++;
      w.sound('repulsor', this);
      w.fx(victim || !enemy ? 'impact' : 'spark', to.x, to.y, {});
      this.charge = 0;
      t = 0;
      while (t < 0.2) { this.holdPosition(); t += this.dt; yield; }
    }
    this.aim = null;
  }

  * blast(tp) {
    const w = this.w, s = this.s;
    this.aimAt(tp, 'both');
    this.setPose('blast');
    w.sound('charge', this);
    let t = 0;
    while (t < 0.45) { this.charge = t / 0.45; this.holdPosition(); t += this.dt; yield; }
    if (this.power < 6) { w.say('POWER LOW', 'warn'); this.aim = null; return; }
    this.power -= 6;
    this.cd.blast = 3;
    const from = this.palm(tp);
    const ang = Math.atan2(tp.y - from.y, tp.x - from.x);
    const reach = 210 * s;
    for (const e of [...w.enemies]) {
      const c = w.enemyCenter(e);
      const dx = c.x - from.x, dy = c.y - from.y, d = Math.hypot(dx, dy);
      let da = Math.atan2(dy, dx) - ang;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      if (d < reach + ENEMY[e.kind].r * s && Math.abs(da) < 0.65) {
        w.damage(e, 5, from);
        if (e.air) { e.vx += Math.cos(ang) * 360 * s; e.vy += Math.sin(ang) * 360 * s; }
      }
    }
    w.addBeam('blast', from, { x: from.x + Math.cos(ang) * reach, y: from.y + Math.sin(ang) * reach }, 0.3, 16, 'hero');
    w.sound('blast', this);
    w.fx('flash', from.x, from.y, { size: 1.6 });
    if (this.mode === 'air') { this.vx -= Math.cos(ang) * 140 * s; this.vy -= Math.sin(ang) * 140 * s; }
    this.charge = 0;
    t = 0;
    while (t < 0.35) { this.holdPosition(); t += this.dt; yield; }
    this.aim = null;
  }

  * missileBarrage(targets) {
    const w = this.w, s = this.s;
    if (this.missiles < 1) { w.say('MISSILES DEPLETED', 'warn'); return; }
    this.aim = null;
    this.setPose('missile');
    w.say('MISSILES AWAY');
    let t = 0;
    while (t < 0.3) { this.holdPosition(); t += this.dt; yield; }
    const n = Math.min(this.missiles, Math.max(3, Math.min(6, targets.length * 2)));
    for (let i = 0; i < n; i++) {
      const tg = targets[i % targets.length];
      const far = i % 2 === 1;
      const sh = this.shoulder(far);
      const up = -rand(240, 340) * s;
      w.addShot({ kind: 'missile', owner: 'hero', x: sh.x, y: sh.y - 6 * s, vx: this.facing * rand(40, 140) * s, vy: up, target: tg.id || null, tp: tg.id ? null : { x: tg.x, y: tg.y }, dmg: 3, life: 4, speed: 140 * s });
      this.missiles--;
      w.counters.missiles++;
      w.sound('missile', this);
      t = 0;
      while (t < 0.09) { this.holdPosition(); t += this.dt; yield; }
    }
    this.cd.missiles = 6;
    t = 0;
    while (t < 0.35) { this.holdPosition(); t += this.dt; yield; }
  }

  * unibeam(tp) {
    const w = this.w, s = this.s;
    this.aim = null;
    this.faceTo(tp);
    this.setPose('unibeam');
    w.say('UNIBEAM');
    w.sound('chargeLong', this);
    let t = 0;
    while (t < 0.7) { this.charge = t / 0.7; this.holdPosition(); t += this.dt; yield; }
    if (this.power < 20) { w.say('POWER LOW', 'warn'); this.charge = 0; return; }
    this.power -= 22;
    this.cd.unibeam = 10;
    w.counters.unibeams++;
    const from = this.reactor();
    let ang = Math.atan2(tp.y - from.y, tp.x - from.x);
    // the chest faces forward: keep the beam in the front half
    if (Math.cos(ang) * this.facing < 0.2) ang = Math.atan2(Math.sin(ang), this.facing * 0.3);
    const beam = w.addBeam('unibeam', from, from, 1.1, 13, 'hero');
    w.sound('unibeam', this);
    t = 0;
    while (t < 1.1) {
      const f = this.reactor();
      const end = { x: f.x + Math.cos(ang) * 1600 * s, y: f.y + Math.sin(ang) * 1600 * s };
      beam.x1 = f.x; beam.y1 = f.y; beam.x2 = end.x; beam.y2 = end.y;
      for (const e of [...w.enemies]) {
        const c = w.enemyCenter(e);
        if (segDist(c, f, end) < (ENEMY[e.kind].r + 12) * s) w.damage(e, 14 * this.dt, f, true);
      }
      this.beamK = 1;
      this.holdPosition();
      t += this.dt;
      yield;
    }
    this.beamK = 0;
    this.charge = 0;
    yield* this.wait(0.3);
  }

  * punch(e) {
    const w = this.w, s = this.s;
    const c = w.enemyCenter(e);
    this.faceTo(c);
    this.setPose('punch');
    yield* this.wait(0.16);
    if (e.hp > 0 && dist(c, this.chest()) < 90 * s) {
      w.damage(e, 3, this.chest());
      w.sound('hit', e);
      if (e.air) { e.vx += this.facing * 420 * s; e.vy -= 120 * s; }
    }
    yield* this.wait(0.25);
  }

  // ------------------------------------------------------------ brain
  choose() {
    const w = this.w, s = this.s;
    if (this.mode === 'down') return [this.taskReboot(), 'reboot', 99];
    if (w.quiet) return [this.taskQuiet(), 'quiet', 95];
    if (w.announcement) return [this.taskAnnounce(), 'announce', 96];
    if (w.enemies.length && (w.settings.autoDefend !== false || w.lockId)) return [this.taskCombat(), 'combat', 80];
    if (this.mode === 'air') {
      if (this.power < 18 || chance(0.6)) return [this.land(), 'land', 30];
      return [this.taskPatrol(), 'patrol', 20];
    }
    if (this.power < 35) return [this.taskRecharge(), 'recharge', 25];
    const opts = [];
    const add = (wt, fn, name) => { if (wt > 0) opts.push([wt, fn, name]); };
    add(3, () => this.taskIdle(rand(3, 7)), 'idle');
    add(1.6, () => this.taskIdle(rand(3, 6), 'idleLook'), 'look');
    add(0.7, () => this.taskIdle(rand(2.5, 4), 'gauntlet'), 'gauntlet');
    add(2, () => this.taskStroll(), 'stroll');
    add(1.3, () => this.taskPatrol(), 'patrol');
    add(0.6, () => this.taskFlyBy(), 'flyby');
    add(0.6, () => this.taskScan(), 'scan');
    add(0.9, () => this.taskHop(), 'hover');
    add(w.geo.displays.length > 1 ? 0.7 : 0, () => this.taskVisit(), 'visit');
    add(0.3, () => this.taskGreet(false), 'wave');
    add(0.12, () => this.taskDiagnostics(), 'diag');
    let r = Math.random() * opts.reduce((a, o) => a + o[0], 0);
    for (const [wt, fn, name] of opts) { r -= wt; if (r <= 0) return [fn(), name, 10]; }
    return [this.taskIdle(3), 'idle', 10];
  }

  * taskIdle(dur, pose) {
    if (this.mode === 'air') yield* this.land();
    this.setPose(pose || 'stand');
    if (pose === 'gauntlet' && chance(0.5)) this.w.say(pick(['CALIBRATING…', 'REPULSOR CHECK', 'GAUNTLET OK']));
    yield* this.wait(dur);
    this.setPose('stand');
  }

  * taskRecharge() {
    if (this.mode === 'air') yield* this.land();
    this.setPose('stand');
    this.w.say('RECHARGING');
    yield* this.wait(60, () => this.power >= 95);
  }

  * taskStroll() {
    if (this.mode === 'air') yield* this.land();
    const s = this.s;
    const d = this.w.geo.displayAt({ x: this.x, y: this.y - 40 * s }) || this.w.geo.primary;
    const tx = clamp(this.x + rand(-380, 380) * s, d.work.x + 40 * s, d.work.x + d.work.width - 40 * s);
    yield* this.walkTo(tx);
    yield* this.wait(rand(0.5, 1.5));
  }

  airPoint(margin, near, radius) {
    const s = this.s;
    const p = this.w.geo.randomPoint(margin || 120 * s, near, radius);
    const d = this.w.geo.displayAt(p) || this.w.geo.primary;
    return { x: p.x, y: clamp(p.y, d.work.y + 130 * s, d.work.y + d.work.height - 120 * s) };
  }

  * taskPatrol() {
    const s = this.s;
    const n = Math.floor(rand(2, 5));
    for (let i = 0; i < n; i++) {
      const p = this.airPoint(140 * s, { x: this.x, y: this.y }, rand(300, 700) * s);
      yield* this.flyTo(p, { speed: rand(300, 460), near: 30, timeout: 10 });
    }
    yield* this.hoverFor(rand(0.6, 1.5));
    yield* this.land(this.x + rand(-120, 120) * s);
  }

  * taskFlyBy() {
    const s = this.s, w = this.w;
    const d = w.geo.displayAt({ x: this.x, y: this.y - 40 * s }) || w.geo.primary;
    const left = this.x > d.work.x + d.work.width / 2;
    const y = d.work.y + rand(0.25, 0.55) * d.work.height;
    yield* this.takeOff(140);
    yield* this.flyTo({ x: left ? d.work.x + 120 * s : d.work.x + d.work.width - 120 * s, y }, { speed: 560, near: 40, timeout: 8 });
    yield* this.land();
  }

  * taskHop() {
    yield* this.takeOff(rand(80, 160));
    yield* this.hoverFor(rand(1.5, 3));
    yield* this.land();
  }

  * taskScan() {
    const w = this.w;
    yield* this.takeOff(rand(120, 200));
    w.say('SCANNING…');
    w.fx('scan', this.x, this.y - 55 * this.s, {});
    yield* this.hoverFor(2.2);
    w.say(pick(['NO THREATS DETECTED', 'PERIMETER CLEAR', 'ALL QUIET']));
    yield* this.hoverFor(1);
    yield* this.land();
  }

  * taskVisit() {
    const w = this.w, s = this.s;
    const here = w.geo.displayAt({ x: this.x, y: this.y - 40 * s });
    const others = w.geo.displays.filter((d) => d !== here);
    if (!others.length) return;
    const d = pick(others);
    const tx = d.work.x + rand(0.2, 0.8) * d.work.width;
    yield* this.flyTo({ x: tx, y: d.work.y + d.work.height * 0.45 }, { speed: 460, near: 30, timeout: 15 });
    yield* this.land();
  }

  * taskGreet(byUser) {
    const w = this.w;
    if (this.mode === 'air') { this.faceTo(w.cursor); this.setPose('hover'); }
    else {
      this.faceTo(w.cursor);
      this.setPose(chance(0.5) ? 'thumbsUp' : 'salute');
    }
    if (byUser) {
      const recent = this.clicks.filter((t) => now() - t < 3000).length;
      w.say(recent >= 4 ? pick(QUIPS_POKE) : pick(QUIPS_GREET), recent >= 4 ? 'warn' : null);
      w.sound('hudBeep', this);
    }
    if (this.mode === 'air') yield* this.hoverFor(1.4); else yield* this.wait(1.4);
    if (this.mode !== 'air') this.setPose('stand');
  }

  * taskDiagnostics() {
    const w = this.w;
    if (this.mode === 'air') yield* this.hoverFor(0.5);
    this.setPose(this.mode === 'air' ? 'hover' : 'gauntlet');
    w.showDiagnostics();
    w.sound('hudBeep', this);
    if (this.mode === 'air') yield* this.hoverFor(7); else yield* this.wait(7);
    this.setPose('stand');
  }

  * taskQuiet() {
    const w = this.w, s = this.s;
    const d = w.geo.displayAt({ x: this.x, y: this.y - 40 * s }) || w.geo.primary;
    const tx = d.work.x + d.work.width - 60 * s;
    if (this.mode === 'air' || Math.abs(tx - this.x) > 280 * s) {
      yield* this.flyTo({ x: tx, y: w.groundAt(tx, this.y) - 110 * s }, { speed: 460, near: 20, timeout: 8 });
      yield* this.land(tx);
    } else yield* this.walkTo(tx, { until: () => !w.quiet });
    this.facing = -1;
    this.setPose('powerDown');
    w.say('STANDBY MODE');
    while (w.quiet) yield;
    this.setPose('stand');
    w.say('SYSTEMS ONLINE');
    w.sound('reboot', this);
    yield* this.wait(0.8);
  }

  * taskAnnounce() {
    const w = this.w, s = this.s;
    const a = w.announcement;
    if (!a) return;
    const d = w.geo.primary;
    const spot = { x: d.work.x + d.work.width / 2, y: d.work.y + d.work.height * 0.62 };
    w.say('INCOMING MESSAGE');
    w.sound('alert', this);
    yield* this.flyTo(spot, { speed: 520, near: 8, timeout: 12 });
    a.arrived = true;
    this.faceTo({ x: spot.x - 100, y: spot.y });
    this.facing = 1;
    w.dirty();
    while (w.announcement === a) {
      this.steer(spot.x, spot.y, 80 * s);
      this.setPose(this.w.now - a.start < 2500 ? 'salute' : 'hover');
      yield;
    }
    w.say(pick(['ROGER THAT.', 'GOOD. BACK TO WORK.', 'NOTED.']));
    yield* this.hoverFor(0.8);
    yield* this.land();
  }

  * taskReboot() {
    const w = this.w, s = this.s;
    this.aim = null; this.charge = 0; this.beamK = 0;
    w.say('SUIT OFFLINE', 'warn');
    w.sound('powerDown', this);
    if (this.mode === 'air' || this.y < this.ground() - 2) {
      this.mode = 'fall';
      while (this.mode === 'fall') yield; // tickFall handles the drop
    }
    this.mode = 'down';
    this.setPose('down');
    this.eyes = 0;
    let t = 0;
    while (t < 5) {
      if (chance(0.06)) w.fx('spark', this.x + rand(-20, 20) * s, this.y - rand(5, 20) * s, {});
      t += this.dt;
      yield;
    }
    w.say('REBOOTING…');
    w.sound('reboot', this);
    t = 0;
    while (t < 1.2) { this.eyes = (Math.floor(t * 10) % 2) ? 1 : 0.2; t += this.dt; yield; }
    this.eyes = 1;
    this.armor = Math.max(this.armor, 35);
    this.mode = 'ground';
    this.setPose('crouch');
    yield* this.wait(0.5);
    this.setPose('stand');
    w.say('BACK ONLINE');
    yield* this.wait(0.5);
  }

  * taskArrive() {
    const w = this.w, s = this.s;
    const d = w.geo.primary;
    this.x = d.work.x + d.work.width * rand(0.35, 0.65);
    this.y = d.work.y + 60 * s;
    this.mode = 'air';
    this.vx = 0; this.vy = 300 * s;
    this.setPose('hover');
    w.sound('thrustOn', this);
    yield* this.land(this.x);
    w.say('SYSTEMS ONLINE');
    w.sound('reboot', this);
    yield* this.wait(0.4);
    this.setPose('thumbsUp');
    yield* this.wait(1.4);
    this.setPose('stand');
  }

  * taskCombat() {
    const w = this.w, s = this.s;
    w.say(w.enemies.some((e) => e.kind === 'boss') ? 'WARNING: HEAVY UNIT' : 'THREAT DETECTED', 'warn');
    w.sound('alert', this);
    let engaged = 0;
    while (w.enemies.length) {
      if (w.announcement) return;
      const target = w.pickTarget(this);
      if (!target) { yield; continue; }
      const tc = w.enemyCenter(target);
      const anyAir = w.enemies.some((e) => e.air);
      // power management: land and recharge a bit when nearly empty
      if (this.power < 6) {
        w.say('POWER CRITICAL', 'warn');
        if (this.mode === 'air') yield* this.land();
        this.setPose('stand');
        yield* this.wait(3, () => this.power > 30);
        continue;
      }
      // get into position
      const dx = this.x - tc.x;
      const side = Math.abs(dx) < 40 * s ? (chance(0.5) ? 1 : -1) : Math.sign(dx);
      const range = (target.kind === 'boss' ? 380 : 260) * s;
      if (anyAir || this.mode === 'air' || chance(0.25)) {
        if (this.mode !== 'air') yield* this.takeOff(rand(120, 200));
        const d = w.geo.displayAt(tc) || w.geo.nearestDisplay(tc);
        const want = {
          x: clamp(tc.x + side * range, d.work.x + 60 * s, d.work.x + d.work.width - 60 * s),
          y: clamp((target.air ? tc.y : tc.y - 90 * s) - rand(20, 90) * s + 60 * s, d.work.y + 130 * s, w.groundAt(tc.x, tc.y) - 20 * s),
        };
        let t = 0;
        const moveFor = rand(0.4, 1);
        while (t < moveFor && w.enemies.includes(target)) { this.steer(want.x, want.y, 360 * s); t += this.dt; yield; }
      } else {
        const d = w.geo.displayAt({ x: tc.x, y: tc.y - 10 }) || w.geo.nearestDisplay(tc);
        const tx = clamp(tc.x + side * range, d.work.x + 40 * s, d.work.x + d.work.width - 40 * s);
        if (Math.abs(tx - this.x) > 80 * s) {
          if (w.groundAt(tx, tc.y) !== this.ground() || Math.abs(tx - this.x) > 500 * s) { yield* this.flyTo({ x: tx, y: w.groundAt(tx, tc.y) - 120 * s }, { speed: 420, near: 30, timeout: 6 }); yield* this.land(tx); }
          else yield* this.walkTo(tx, { timeout: 2.5 });
        }
      }
      if (!w.enemies.includes(target)) continue;
      // dodge incoming fire
      const threat = w.incomingThreat(this);
      if (threat && this.cd.dodge <= 0 && chance(0.45)) {
        this.cd.dodge = 1.2;
        if (this.mode !== 'air') yield* this.takeOff(90);
        const dodgeY = this.y + (chance(0.5) ? -1 : 1) * 110 * s;
        let t = 0;
        while (t < 0.35) { this.steer(this.x - this.facing * 40 * s, dodgeY, 560 * s, 3000 * s); t += this.dt; yield; }
      }
      // pick a weapon
      const t2 = w.enemyCenter(target);
      const dd = dist(t2, this.chest());
      const lineCount = w.enemiesInCone(this, t2, 0.25).length;
      engaged++;
      if (this.cd.unibeam <= 0 && this.power > 32 && (target.kind === 'boss' || lineCount >= 3) && engaged > 1) {
        yield* this.unibeam(t2);
      } else if (this.cd.missiles <= 0 && this.missiles >= 2 && (w.enemies.length >= 3 || target.kind === 'tank' || target.kind === 'boss')) {
        yield* this.missileBarrage(w.enemies.slice().sort((a, b) => dist(w.enemyCenter(a), this) - dist(w.enemyCenter(b), this)).slice(0, 4));
      } else if (dd < 70 * s) {
        yield* this.punch(target);
      } else if (dd < 190 * s && this.cd.blast <= 0 && this.power > 12) {
        yield* this.blast(t2);
      } else {
        yield* this.repulsor(t2, target, Math.floor(rand(2, 4)));
      }
    }
    // victory
    w.say(pick(QUIPS_WIN));
    if (this.mode === 'air') yield* this.land();
    this.setPose('thumbsUp');
    yield* this.wait(1.6);
    this.setPose('stand');
  }

  * taskAttackAt(kind, p) {
    const w = this.w, s = this.s;
    const near = w.enemies.filter((e) => dist(w.enemyCenter(e), p) < 120 * s);
    if (kind === 'missiles') {
      yield* this.missileBarrage(near.length ? near : [{ x: p.x, y: p.y }]);
    } else if (kind === 'unibeam') {
      yield* this.unibeam(p);
    } else if (kind === 'blast') {
      if (dist(p, this.chest()) > 200 * s) {
        const side = this.x < p.x ? -1 : 1;
        yield* this.flyTo({ x: p.x + side * 150 * s, y: Math.min(this.w.groundAt(p.x, p.y), p.y + 62 * s) }, { speed: 480, near: 20, timeout: 5 });
      }
      yield* this.blast(p);
    } else {
      yield* this.repulsor(p, near[0] || null, 2);
    }
    yield* this.wait(0.4);
  }

  // ------------------------------------------------------------ held / falling
  startHold() {
    if (this.mode === 'down') return;
    this.pending = null;
    if (this.task) { try { this.task.return(); } catch (e) { /* */ } }
    this.task = null; this.taskName = null; this.taskPrio = 0;
    this.aim = null; this.charge = 0; this.beamK = 0;
    this.mode = 'held';
    this.setPose('held');
    this.swing = 0; this.swingV = 0;
    this.w.say(pick(QUIPS_HELD));
  }

  tickHeld(dt) {
    const w = this.w, s = this.s;
    this.x = w.cursor.x; this.y = w.cursor.y + 100 * s;
    const L = 50 * s, g = 1900 * s;
    const acc = -(g / L) * Math.sin(this.swing) - 6 * this.swingV - (clamp(w.cursorAcc.x, -9000 * s, 9000 * s) / L) * Math.cos(this.swing) * 0.35;
    this.swingV += acc * dt;
    this.swing = clamp(this.swing + this.swingV * dt, -0.6, 0.6);
  }

  release() {
    if (this.mode !== 'held') return;
    const w = this.w, s = this.s;
    this.vx = clamp(w.cursorVel.x * 0.5, -900 * s, 900 * s);
    this.vy = clamp(w.cursorVel.y * 0.5, -900 * s, 900 * s);
    this.swing = 0;
    if (this.power > 5) {
      // catches himself with the thrusters
      this.mode = 'air';
      this.w.sound('thrustOn', this);
      this.run(this.taskStabilize(), 'stabilize', 60);
    } else {
      this.mode = 'fall';
      this.run(this.taskAfterFall(), 'fall', 60);
    }
  }

  * taskStabilize() {
    const s = this.s;
    const hx = this.x + this.vx * 0.25, hy = Math.min(this.y + this.vy * 0.25, this.ground() - 30 * s);
    let t = 0;
    while (t < 0.9) { this.steer(hx, hy, 300 * s, 1600 * s); t += this.dt; yield; }
    this.w.say(pick(['STABILIZED.', 'THANKS FOR THE LIFT.', 'SMOOTH.']));
    yield* this.hoverFor(0.6);
  }

  * taskAfterFall() {
    while (this.mode === 'fall') yield;
    this.setPose('land');
    this.w.sound('landing', this);
    this.w.fx('shockwave', this.x, this.y, {});
    yield* this.wait(1);
    this.setPose('stand');
  }

  tickFall(dt) {
    const s = this.s;
    this.vy += 2200 * s * dt;
    this.vx *= Math.exp(-1 * dt);
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.setPose('stagger');
    const g = this.ground();
    if (this.y >= g) {
      this.y = g; this.vx = this.vy = 0;
      this.mode = 'ground';
      this.w.sound('landing', this);
      this.w.fx('shockwave', this.x, this.y, {});
    }
    this.keepOnScreen();
    if (this.task) {
      this.inTask = true;
      try { const r = this.task.next(); if (r.done) { this.task = null; this.taskName = null; this.taskPrio = 0; } } catch (e) { this.task = null; }
      this.inTask = false;
    }
  }

  statusText() {
    const w = this.w;
    if (w.quiet) return 'standby';
    if (this.mode === 'down') return 'suit offline — rebooting';
    if (this.mode === 'held') return 'being carried';
    if (w.enemies.length) return 'combat mode';
    if (this.armor < 30) return 'armor damaged';
    if (this.power < 25) return 'low power';
    if (this.mode === 'air') return 'flying';
    return 'systems nominal';
  }
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

// ======================================================================= World
class IronWorld {
  constructor({ geo, data, settings, emit, sysinfo }) {
    this.character = 'ironman';
    this.geo = geo;
    this.emit = emit || (() => {});
    this.sysinfo = sysinfo || (() => ({}));
    this.settings = settings;
    this.counters = { kills: 0, drones: 0, walkers: 0, tanks: 0, bosses: 0, shotsFired: 0, missiles: 0, unibeams: 0, reboots: 0, waves: 0, ...((data && data.counters) || {}) };
    this.hero = new Hero(this, data && data.hero);
    this.enemies = [];
    this.shots = [];
    this.beams = [];
    this.hud = [];
    this.diag = null;
    this.lockId = null;
    this.announcement = null;
    this.quiet = !!(data && data.quiet);
    this.hidden = false;
    this.cursor = { x: 0, y: 0 }; this.cursorVel = { x: 0, y: 0 }; this.cursorAcc = { x: 0, y: 0 };
    this.cursorMovedAt = 0;
    this.press = null;
    this.ver = 1;
    this.now = now();
    this.nextInvasion = 0;
    this.placeOnScreen(!(data && data.hero && Number.isFinite(data.hero.x)));
  }

  get s() { return SIZES[this.settings.ironSize] || 1; }
  get diff() { return DIFF[this.settings.difficulty] || DIFF.normal; }

  dirty() { this.ver++; }
  sound(name, at) { if (!this.quiet) this.emit({ type: 'sound', name, x: at ? at.x : this.hero.x, y: at ? at.y - 40 : this.hero.y - 40 }); }
  fx(kind, x, y, o) { this.emit({ type: 'fx', kind, x, y, ...(o || {}) }); }
  notify(title, body) { if (this.settings.notifications) this.emit({ type: 'notify', title, body }); }

  say(text, tone) {
    if (this.settings.hudCallouts === false && tone !== 'warn') return;
    this.hud.push({ text, tone: tone || 'info', start: now() });
    if (this.hud.length > 3) this.hud.shift();
  }

  showDiagnostics() {
    const info = this.sysinfo();
    this.diag = { start: now(), info, kills: this.counters.kills };
  }

  // ------------------------------------------------------------ geometry
  groundAt(x, y) {
    const geo = this.geo;
    let d = geo.displays.find((q) => x >= q.bounds.x && x <= q.bounds.x + q.bounds.width && y >= q.bounds.y - 2 && y <= q.bounds.y + q.bounds.height + 2);
    if (!d) d = geo.displays.find((q) => x >= q.bounds.x && x <= q.bounds.x + q.bounds.width);
    if (!d) d = geo.nearestDisplay({ x, y });
    return d ? d.work.y + d.work.height - 2 : y;
  }

  clampFloorX(x, fromX, fromY) {
    const d = this.geo.displayAt({ x: fromX, y: fromY - 30 }) || this.geo.nearestDisplay({ x: fromX, y: fromY });
    if (!d) return x;
    return clamp(x, d.work.x + 24 * this.s, d.work.x + d.work.width - 24 * this.s);
  }

  placeOnScreen(force) {
    const h = this.hero;
    if (force || !this.geo.inAny({ x: h.x, y: h.y - 40 })) {
      const d = this.geo.primary;
      if (!d) return;
      h.x = d.work.x + d.work.width * 0.5;
      h.y = this.groundAt(h.x, d.work.y + d.work.height - 5);
      h.mode = 'ground';
    }
    for (const e of this.enemies) {
      const q = this.geo.clampWork(e, 30);
      e.x = q.x; e.y = e.air ? q.y : this.groundAt(q.x, q.y);
    }
  }

  onDisplaysChanged() { this.placeOnScreen(false); }

  // ------------------------------------------------------------ enemies
  enemyCenter(e) { const s = this.s; return { x: e.x, y: e.y + ENEMY[e.kind].cy * s }; }

  spawn(kind, p) {
    const s = this.s, k = ENEMY[kind];
    if (!k || this.enemies.length >= 30) return null;
    const q = this.geo.clampWork(p, 40 * s);
    const e = {
      id: uid('x'), kind, x: q.x, y: q.y, vx: 0, vy: 0, facing: q.x < this.hero.x ? 1 : -1,
      hp: k.hp * this.diff.hp, maxHp: k.hp * this.diff.hp, air: k.air, cool: rand(1, 2.5), phase: 0, charge: 0, hitAt: 0,
      orbit: rand(0, Math.PI * 2), range: rand(200, 330), alt: rand(60, 170), born: now(), state: 'idle', grounded: k.air,
    };
    this.enemies.push(e);
    this.fx(k.air ? 'portal' : 'portal', e.x, e.y + k.cy * s, {});
    this.sound(kind === 'boss' ? 'bossSpawn' : 'spawn', e);
    this.dirty();
    const h = this.hero;
    if (this.settings.autoDefend !== false && h.taskName !== 'combat' && h.taskName !== 'announce' && h.mode !== 'down') {
      h.interrupt(h.taskCombat(), 'combat', 80);
    }
    return e;
  }

  pickTarget(h) {
    const locked = this.enemies.find((e) => e.id === this.lockId);
    if (locked) return locked;
    let best = null, bs = -Infinity;
    for (const e of this.enemies) {
      const d = dist(this.enemyCenter(e), h);
      const threat = { boss: 3, tank: 1.5, walker: 1.2, drone: 1, mini: 1.4 }[e.kind] || 1;
      const score = threat * 400 - d * 0.6;
      if (score > bs) { bs = score; best = e; }
    }
    return best;
  }

  firstEnemyOnLine(a, b, extend) {
    const s = this.s;
    const end = { x: a.x + (b.x - a.x) * (extend || 1), y: a.y + (b.y - a.y) * (extend || 1) };
    let best = null, bd = Infinity;
    for (const e of this.enemies) {
      const c = this.enemyCenter(e);
      if (segDist(c, a, end) < ENEMY[e.kind].r * s) { const d = dist(c, a); if (d < bd) { bd = d; best = e; } }
    }
    return best;
  }

  enemiesInCone(h, tp, spread) {
    const a = Math.atan2(tp.y - h.chest().y, tp.x - h.chest().x);
    return this.enemies.filter((e) => {
      const c = this.enemyCenter(e);
      let d = Math.atan2(c.y - h.chest().y, c.x - h.chest().x) - a;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return Math.abs(d) < spread;
    });
  }

  incomingThreat(h) {
    const c = h.chest(), s = this.s;
    for (const p of this.shots) {
      if (p.owner === 'hero') continue;
      const rx = c.x - p.x, ry = c.y - p.y;
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const along = (rx * p.vx + ry * p.vy) / sp;
      if (along > 0 && along / sp < 0.45 && Math.abs(rx * p.vy - ry * p.vx) / sp < 40 * s) return p;
    }
    return null;
  }

  damage(e, dmg, from, quiet) {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    e.hitAt = now();
    if (e.hp <= 0) this.kill(e);
    this.dirty();
  }

  kill(e, silent) {
    const i = this.enemies.indexOf(e);
    if (i < 0) return;
    this.enemies.splice(i, 1);
    const c = this.enemyCenter(e);
    if (!silent) {
      this.counters.kills++;
      const key = { drone: 'drones', mini: 'drones', walker: 'walkers', tank: 'tanks', boss: 'bosses' }[e.kind];
      this.counters[key] = (this.counters[key] || 0) + 1;
      this.fx('explosion', c.x, c.y, { size: e.kind === 'boss' ? 3 : e.kind === 'tank' ? 1.6 : e.kind === 'mini' ? 0.7 : 1 });
      this.sound(e.kind === 'boss' || e.kind === 'tank' ? 'boomBig' : 'boom', c);
      if (e.kind === 'boss') this.say('HEAVY UNIT DOWN');
    } else {
      this.fx('portal', c.x, c.y, {});
    }
    if (this.lockId === e.id) this.lockId = null;
    if (!this.enemies.length) this.counters.waves++;
  }

  hurtHero(dmg, at) {
    const h = this.hero, s = this.s;
    if (h.mode === 'down' || h.taskName === 'reboot') return;
    h.armor -= dmg * this.diff.dmg;
    h.hitAt = now();
    this.fx('hitspark', at ? at.x : h.x, at ? at.y : h.y - 55 * s, {});
    this.sound('hit', h);
    if (h.armor <= 0) {
      h.armor = 0;
      this.counters.reboots++;
      h.run(h.taskReboot(), 'reboot', 99);
    } else if (h.armor < 25 && !h.warnedArmor) { h.warnedArmor = true; this.say('ARMOR CRITICAL', 'warn'); }
    if (h.armor > 40) h.warnedArmor = false;
  }

  addShot(p) { p.id = uid('p'); p.age = 0; this.shots.push(p); return p; }
  addBeam(kind, a, b, dur, w, owner) {
    const beam = { id: uid('b'), kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y, start: now(), dur, w, owner };
    this.beams.push(beam);
    return beam;
  }

  tickEnemies(dt) {
    const h = this.hero, s = this.s, D = this.diff;
    const hc = h.chest();
    for (const e of [...this.enemies]) {
      const k = ENEMY[e.kind];
      e.cool -= dt * D.rate;
      e.phase += dt * (e.air ? 1 : Math.abs(e.vx) / (6 * s) + 0.01);
      const d = dist(this.enemyCenter(e), hc);
      if (e.kind === 'drone') {
        e.orbit += dt * 0.7;
        const want = { x: hc.x + Math.cos(e.orbit) * e.range * s, y: hc.y - e.alt * s + Math.sin(e.orbit * 1.7) * 30 * s };
        this.steerEnemy(e, want, k.speed * s, dt);
        e.facing = hc.x > e.x ? 1 : -1;
        e.charge = clamp(1 - e.cool / 0.6, 0, 1);
        if (e.cool <= 0 && d < 750 * s && h.mode !== 'down') {
          e.cool = rand(k.fire[0], k.fire[1]);
          this.enemyLaser(e, hc, 520 * s, k.dmg);
        }
      } else if (e.kind === 'mini') {
        this.steerEnemy(e, { x: hc.x, y: hc.y }, k.speed * s * (h.mode === 'down' ? 0.3 : 1), dt, 900 * s);
        e.facing = e.vx > 0 ? 1 : -1;
        if (d < 22 * s && h.mode !== 'down') { this.hurtHero(k.dmg, this.enemyCenter(e)); this.kill(e); continue; }
      } else {
        // ground units fall to the floor first
        const g = this.groundAt(e.x, e.y);
        if (!e.grounded) {
          e.vy += 1800 * s * dt; e.y += e.vy * dt;
          if (e.y >= g) { e.y = g; e.vy = 0; e.grounded = true; this.fx('shockwave', e.x, e.y, { size: e.kind === 'boss' ? 1.6 : 0.7 }); this.sound('landing', e); }
          continue;
        }
        e.y = g;
        const dx = hc.x - e.x;
        e.facing = dx > 0 ? 1 : -1;
        const want = (e.kind === 'boss' ? 320 : e.kind === 'tank' ? 380 : 280) * s;
        let mv = 0;
        if (e.state !== 'charging' && e.state !== 'firing') {
          if (Math.abs(dx) > want + 40 * s) mv = Math.sign(dx);
          else if (Math.abs(dx) < want - 120 * s) mv = -Math.sign(dx) * 0.6;
        }
        e.vx = mv * k.speed * s;
        const d0 = this.geo.displayAt({ x: e.x, y: e.y - 20 }) || this.geo.nearestDisplay(e);
        e.x = clamp(e.x + e.vx * dt, d0.work.x + 30 * s, d0.work.x + d0.work.width - 30 * s);
        if (e.kind === 'walker') {
          e.charge = clamp(1 - e.cool / 0.5, 0, 1);
          if (e.cool <= 0 && h.mode !== 'down') { e.cool = rand(k.fire[0], k.fire[1]); this.enemyLaser(e, hc, 460 * s, k.dmg, { x: e.x + e.facing * 18 * s, y: e.y - 24 * s }); }
        } else if (e.kind === 'tank') {
          const muzzle = { x: e.x + e.facing * 24 * s, y: e.y - 24 * s };
          e.aim = -0.35;
          e.charge = clamp(1 - e.cool / 0.6, 0, 1);
          if (e.cool <= 0 && h.mode !== 'down') { e.cool = rand(k.fire[0], k.fire[1]); this.enemyShell(e, muzzle, hc, k.dmg); }
        } else if (e.kind === 'boss') {
          this.tickBoss(e, dt, hc);
        }
      }
    }
  }

  steerEnemy(e, want, maxSp, dt, accel) {
    const dx = want.x - e.x, dy = want.y - e.y, d = Math.hypot(dx, dy);
    const sp = Math.min(maxSp, d * 2);
    const wx = d > 0.5 ? dx / d * sp : 0, wy = d > 0.5 ? dy / d * sp : 0;
    const a = (accel || 500 * this.s) * dt;
    const dvx = wx - e.vx, dvy = wy - e.vy, dv = Math.hypot(dvx, dvy);
    if (dv > a) { e.vx += dvx / dv * a; e.vy += dvy / dv * a; } else { e.vx = wx; e.vy = wy; }
    e.x += e.vx * dt; e.y += e.vy * dt;
    const q = this.geo.clampWork({ x: e.x, y: e.y }, 20 * this.s);
    e.x = q.x; e.y = Math.min(q.y, this.groundAt(q.x, q.y) - 20 * this.s);
  }

  enemyLaser(e, target, speed, dmg, from) {
    const s = this.s;
    const o = from || this.enemyCenter(e);
    const lead = { x: target.x + this.hero.vx * 0.25, y: target.y + this.hero.vy * 0.25 };
    const a = Math.atan2(lead.y - o.y, lead.x - o.x) + rand(-0.06, 0.06);
    this.addShot({ kind: 'laser', owner: 'enemy', x: o.x, y: o.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg, life: 3 });
    this.sound('laser', o);
    void s;
  }

  enemyShell(e, from, target, dmg) {
    const s = this.s, g = 600 * s;
    const dx = target.x - from.x, dy = target.y - from.y;
    const t = clamp(Math.abs(dx) / (340 * s), 0.6, 2.2);
    this.addShot({ kind: 'shell', owner: 'enemy', x: from.x, y: from.y, vx: dx / t, vy: dy / t - 0.5 * g * t, g, dmg, life: 4 });
    this.sound('shellFire', from);
    this.fx('flash', from.x, from.y, { size: 0.6, color: '255,170,60' });
  }

  tickBoss(e, dt, hc) {
    const s = this.s;
    const cannon = { x: e.x + e.facing * 52 * s, y: e.y - 62 * s };
    if (e.state === 'idle' && e.cool <= 0 && this.hero.mode !== 'down') {
      if (chance(0.55)) { e.state = 'charging'; e.stateT = 0; this.sound('chargeLong', e); this.say('INCOMING BEAM!', 'warn'); }
      else {
        for (let i = 0; i < 3; i++) {
          this.addShot({ kind: 'emissile', owner: 'enemy', x: e.x + (i - 1) * 16 * s, y: e.y - 100 * s, vx: e.facing * 60 * s + (i - 1) * 60 * s, vy: -260 * s, target: 'hero', dmg: 9, life: 5, speed: 200 * s });
        }
        this.sound('missile', e);
        e.cool = rand(3.2, 4.4);
      }
    }
    if (e.state === 'charging') {
      e.stateT += dt;
      e.charge = clamp(e.stateT / 1.2, 0, 1);
      if (e.stateT >= 1.2) { e.state = 'firing'; e.stateT = 0; e.beamAng = Math.atan2(hc.y - cannon.y, hc.x - cannon.x); e.beam = this.addBeam('enemy', cannon, cannon, 1.3, 9, 'enemy'); this.sound('unibeam', e); }
    } else if (e.state === 'firing') {
      e.stateT += dt;
      const want = Math.atan2(hc.y - cannon.y, hc.x - cannon.x);
      e.beamAng += clamp(want - e.beamAng, -0.5 * dt, 0.5 * dt);
      const end = { x: cannon.x + Math.cos(e.beamAng) * 1500 * s, y: cannon.y + Math.sin(e.beamAng) * 1500 * s };
      if (e.beam) { e.beam.x1 = cannon.x; e.beam.y1 = cannon.y; e.beam.x2 = end.x; e.beam.y2 = end.y; }
      if (segDist(hc, cannon, end) < 26 * s) {
        e.beamTick = (e.beamTick || 0) + dt;
        if (e.beamTick > 0.2) { e.beamTick = 0; this.hurtHero(2.4, hc); }
      }
      if (e.stateT >= 1.3) { e.state = 'idle'; e.charge = 0; e.cool = rand(2.6, 3.8); e.beam = null; }
    }
  }

  tickShots(dt) {
    const s = this.s, h = this.hero;
    const hc = h.chest();
    for (const p of [...this.shots]) {
      p.age += dt;
      let dead = p.age > p.life;
      if (p.kind === 'missile' || p.kind === 'emissile') {
        let tgt = null;
        if (p.kind === 'missile') {
          let e = p.target && this.enemies.find((x) => x.id === p.target);
          if (!e && this.enemies.length && !p.tp) { e = this.enemies.reduce((a, b) => (dist(b, p) < dist(a, p) ? b : a)); p.target = e.id; }
          tgt = e ? this.enemyCenter(e) : p.tp;
        } else tgt = hc;
        if (p.age > 0.25 && tgt) {
          const want = Math.atan2(tgt.y - p.y, tgt.x - p.x);
          let a = Math.atan2(p.vy, p.vx);
          let dA = want - a;
          while (dA > Math.PI) dA -= 2 * Math.PI;
          while (dA < -Math.PI) dA += 2 * Math.PI;
          const turn = (p.kind === 'missile' ? 7 : 2.4) * dt;
          a += clamp(dA, -turn, turn);
          p.speed = Math.min((p.kind === 'missile' ? 640 : 330) * s, (p.speed || 100 * s) + 900 * s * dt);
          p.vx = Math.cos(a) * p.speed; p.vy = Math.sin(a) * p.speed;
        } else { p.vy += 500 * s * dt; }
      }
      if (p.kind === 'shell') p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      // hits
      if (p.owner === 'hero') {
        for (const e of this.enemies) {
          const c = this.enemyCenter(e);
          if (dist(c, p) < (ENEMY[e.kind].r + 5) * s) {
            this.damage(e, p.dmg, p);
            this.fx('explosion', p.x, p.y, { size: 0.55 });
            this.sound('boom', p);
            dead = true;
            break;
          }
        }
        if (!dead && p.tp && dist(p, p.tp) < 14 * s) { this.fx('explosion', p.x, p.y, { size: 0.7 }); this.sound('boom', p); dead = true; }
      } else if (h.mode !== 'down' && dist(p, hc) < 26 * s) {
        this.hurtHero(p.dmg, p);
        if (p.kind !== 'laser') { this.fx('explosion', p.x, p.y, { size: 0.6 }); this.sound('boom', p); }
        dead = true;
      }
      if (!dead && p.y >= this.groundAt(p.x, p.y) && p.kind !== 'laser') {
        this.fx('explosion', p.x, p.y, { size: 0.6 });
        this.sound('boom', p);
        if (p.owner === 'enemy' && dist(p, { x: h.x, y: h.y - 30 * s }) < 50 * s) this.hurtHero(p.dmg * 0.5, p);
        dead = true;
      }
      if (!dead && !this.geo.inAny(p, -40)) dead = true;
      if (dead) this.shots.splice(this.shots.indexOf(p), 1);
    }
    const t = now();
    this.beams = this.beams.filter((b) => t - b.start < b.dur * 1000);
  }

  tickInvasions() {
    const range = INVASIONS[this.settings.invasions];
    if (!range || this.quiet || this.announcement) { this.nextInvasion = 0; return; }
    const t = now();
    if (!this.nextInvasion) { this.nextInvasion = t + rand(range[0], range[1]) * 1000; return; }
    if (t < this.nextInvasion || this.enemies.length) return;
    this.nextInvasion = t + rand(range[0], range[1]) * 1000;
    const d = pick(this.geo.displays);
    const s = this.s;
    const n = Math.floor(rand(2, 4));
    for (let i = 0; i < n; i++) this.spawn('drone', { x: d.work.x + rand(0.1, 0.9) * d.work.width, y: d.work.y + rand(0.12, 0.3) * d.work.height });
    if (chance(0.4)) this.spawn('walker', { x: d.work.x + (chance(0.5) ? 60 * s : d.work.width - 60 * s), y: d.work.y + d.work.height * 0.5 });
    this.say('INCOMING!', 'warn');
  }

  // ------------------------------------------------------------ input
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
  cursorBusy() { return now() - this.cursorMovedAt < 1500; }

  heroBox() {
    const h = this.hero, s = this.s;
    if (h.mode === 'held') return { x: h.x - 20 * s, y: h.y - 104 * s, w: 40 * s, h: 104 * s };
    if (h.pose === 'fly') return { x: h.x - 50 * s, y: h.y - 78 * s, w: 100 * s, h: 50 * s };
    if (h.pose === 'down') return { x: h.x - 50 * s, y: h.y - 26 * s, w: 100 * s, h: 28 * s };
    return { x: h.x - 18 * s, y: h.y - 98 * s, w: 36 * s, h: 100 * s };
  }
  hitHero(p) { const b = this.heroBox(); return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; }
  enemyAt(p) {
    const s = this.s;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (dist(this.enemyCenter(e), p) < (ENEMY[e.kind].r + 6) * s) return e;
    }
    return null;
  }

  isInteractive(p) {
    if (this.press) return true;
    if (this.hidden) return false;
    return this.hitHero(p) || !!this.enemyAt(p);
  }

  cursorStyle(p) {
    if (this.press && this.hero.mode === 'held') return 'grabbing';
    if (this.hitHero(p)) return 'grab';
    if (this.enemyAt(p)) return 'crosshair';
    return 'default';
  }

  pointerDown(p, button) {
    if (button !== 0) return;
    if (this.hitHero(p) && this.hero.mode !== 'down') { this.press = { target: 'hero', x: p.x, y: p.y, t: now() }; return; }
    const e = this.enemyAt(p);
    if (e) {
      this.lockId = e.id;
      this.say(`TARGET LOCKED: ${ENEMY[e.kind].label}`);
      this.sound('lock', e);
      const h = this.hero;
      if (h.taskName !== 'combat' && h.mode !== 'down') h.interrupt(h.taskCombat(), 'combat', 80);
      this.dirty();
    }
  }

  pointerUp(p, button) {
    const pr = this.press;
    this.press = null;
    if (!pr) return;
    const h = this.hero;
    if (h.mode === 'held') { h.release(); return; }
    h.clicks.push(now());
    h.clicks = h.clicks.filter((t) => now() - t < 4000);
    if (h.taskPrio <= 45) h.run(h.taskGreet(true), 'greet', 45);
    else this.say(pick(QUIPS_GREET));
  }

  tickPress() {
    const pr = this.press;
    if (pr && pr.target === 'hero' && this.hero.mode !== 'held' && dist(this.cursor, pr) > 6) this.hero.startHold();
  }

  contextAt(p) {
    return { onCat: this.hitHero(p), onEnemy: !!this.enemyAt(p), dead: false };
  }

  // ------------------------------------------------------------ commands
  command(name, a = {}) {
    const h = this.hero, s = this.s;
    const at = a.x != null ? { x: a.x, y: a.y } : { x: h.x + h.facing * 200 * s, y: h.y - 160 * s };
    const free = h.mode !== 'held' && h.mode !== 'down';
    switch (name) {
      case 'spawn': {
        const kind = ENEMY[a.kind] ? a.kind : 'drone';
        if (kind === 'mini' || a.kind === 'swarm') {
          for (let i = 0; i < 6; i++) this.spawn('mini', { x: at.x + rand(-80, 80) * s, y: at.y + rand(-50, 50) * s });
        } else this.spawn(kind, at);
        break;
      }
      case 'clearEnemies':
        for (const e of [...this.enemies]) this.kill(e, true);
        this.shots = []; this.beams = [];
        break;
      case 'attack':
        if (free) h.interrupt(h.taskAttackAt(a.kind || 'repulsor', at), 'attack', 85);
        break;
      case 'takeoff': if (free && h.mode !== 'air') h.interrupt(h.taskHop(), 'hover', 50); break;
      case 'land': if (free && h.mode === 'air') h.interrupt(h.land(), 'land', 50); break;
      case 'flyTo':
      case 'call':
        if (free) h.interrupt((function* () { yield* h.flyTo(at, { speed: 480, near: 10 }); yield* h.hoverFor(1.2); yield* h.land(); }).call(h), 'flyTo', 50);
        break;
      case 'patrol': if (free) h.interrupt(h.taskPatrol(), 'patrol', 50); break;
      case 'flyby': if (free) h.interrupt(h.taskFlyBy(), 'flyby', 50); break;
      case 'scan': if (free) h.interrupt(h.taskScan(), 'scan', 50); break;
      case 'diagnostics': if (free) h.interrupt(h.taskDiagnostics(), 'diag', 50); break;
      case 'thumbsUp': if (free) h.interrupt(h.taskGreet(false), 'greet', 50); break;
      case 'repair':
        h.armor = 100; this.say('ARMOR RESTORED'); this.fx('repair', h.x, h.y - 50 * s, {}); this.sound('reboot', h);
        break;
      case 'recharge':
        h.power = 100; h.missiles = 12; this.say('ARC REACTOR AT 100%'); this.fx('flash', h.x + h.facing * 2 * s, h.y - 65 * s, { size: 1.4 }); this.sound('chargeLong', h);
        break;
      case 'quiet':
        this.quiet = a.value != null ? !!a.value : !this.quiet;
        if (this.quiet) { for (const e of [...this.enemies]) this.kill(e, true); this.shots = []; }
        if (free) h.run(this.quiet ? h.taskQuiet() : h.taskIdle(1), this.quiet ? 'quiet' : 'idle', 95);
        this.dirty();
        break;
      case 'stopTool': break;
      default: break;
    }
  }

  onSetting(key) {
    if (key === 'ironSize') this.placeOnScreen(false);
  }

  activate() {
    const h = this.hero;
    h.run(h.taskArrive(), 'arrive', 90);
    this.dirty();
  }

  deactivate() {
    for (const e of [...this.enemies]) this.kill(e, true);
    this.shots = []; this.beams = []; this.press = null;
    const h = this.hero;
    if (h.task) { try { h.task.return(); } catch (e) { /* */ } }
    h.task = null; h.taskName = null; h.taskPrio = 0;
    if (h.mode === 'held' || h.mode === 'fall' || h.mode === 'down') { h.mode = 'ground'; h.armor = Math.max(h.armor, 35); h.eyes = 1; }
  }

  // ------------------------------------------------------------ reminders
  announce(a) {
    this.announcement = { ...a, start: now() };
    const h = this.hero;
    if (h.mode === 'held') h.release();
    if (h.mode !== 'down') h.run(h.taskAnnounce(), 'announce', 96);
    this.dirty();
  }

  clearAnnouncement(id) {
    if (this.announcement && (id == null || this.announcement.id === id)) { this.announcement = null; this.dirty(); }
  }

  // ------------------------------------------------------------ tick & state
  tick(dt, realGap) {
    if (this.hidden) return;
    this.now = now();
    if (realGap && realGap > 5) return;
    this.tickPress();
    this.hero.tick(dt);
    if (!this.quiet) {
      this.tickEnemies(dt);
      this.tickShots(dt);
      this.tickInvasions();
    }
    const t = this.now;
    this.hud = this.hud.filter((x) => t - x.start < 2600);
    if (this.diag && t - this.diag.start > 8000) this.diag = null;
  }

  applyAway() { /* the suit doesn't get hungry */ }

  wantsFast() {
    const h = this.hero;
    return !!(this.press || h.mode !== 'ground' || this.enemies.length || this.shots.length || this.beams.length || h.speed > 1);
  }

  activeIn(near) {
    const h = this.hero;
    if (near({ x: h.x, y: h.y - 50 }, 260)) return true;
    if (this.enemies.some((e) => near(e, 200)) || this.shots.some((p) => near(p, 60)) || this.beams.length) return true;
    if (this.announcement) return true;
    return false;
  }

  info() {
    return { name: 'Iron Man', status: this.hero.statusText(), dead: false };
  }

  snapshot() {
    const h = this.hero;
    const t = now();
    return {
      t, s: this.s, character: 'ironman', ver: this.ver,
      hero: {
        x: h.x, y: h.y, vx: h.vx, vy: h.vy, facing: h.facing, mode: h.mode, pose: h.pose, poseStart: h.poseStart,
        aim: h.aim, aimArm: h.aimArm, charge: h.charge, beam: h.beamK, eyes: h.eyes, swing: h.swing, dist: h.dist, speed: h.speed,
        power: h.power, armor: h.armor, missiles: h.missiles, hitAt: h.hitAt, status: h.statusText(), task: h.taskName,
        ground: this.groundAt(h.x, h.y),
      },
      enemies: this.enemies.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, vx: e.vx, vy: e.vy, facing: e.facing, hp: e.hp, maxHp: e.maxHp, phase: e.phase, charge: e.charge, hitAt: e.hitAt, aim: e.aim, air: e.air, born: e.born })),
      shots: this.shots.map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, vx: p.vx, vy: p.vy, owner: p.owner })),
      beams: this.beams,
      hud: this.hud,
      diag: this.diag,
      lockId: this.lockId,
      announce: this.announcement,
      primaryWork: this.geo.primary ? this.geo.primary.work : null,
      cursor: this.cursor, cursorVel: this.cursorVel,
      tool: null,
      quiet: this.quiet,
      sound: this.settings.sound, volume: this.settings.volume, voice: this.settings.voice !== false,
      suit: this.settings.suit || 'classic',
      ents: null,
    };
  }

  homeState() {
    const h = this.hero;
    return {
      character: 'ironman',
      hero: { name: 'Iron Man', status: h.statusText(), power: h.power, armor: h.armor, missiles: h.missiles, mode: h.mode },
      enemies: this.enemies.length,
      counters: this.counters,
      settings: this.settings,
      quiet: this.quiet,
    };
  }

  serialize() {
    const h = this.hero;
    return { hero: { power: h.power, armor: h.armor, missiles: h.missiles, x: h.x, y: h.y }, counters: this.counters, quiet: this.quiet };
  }
}

module.exports = { IronWorld, ENEMY, DEFAULT_IRON, SIZES };
