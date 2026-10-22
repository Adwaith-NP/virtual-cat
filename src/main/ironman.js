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

// army sizes and how many Iron Legion suits answer the call (never more than 7)
const ARMY_SIZES = { small: 10, medium: 20, large: 35, massive: 50, epic: 200, legendary: 1000 };
const MAX_LEGION = 7;
const legionFor = (total) => (total >= 50 ? 7 : total >= 35 ? 5 : total >= 20 ? 3 : 2);
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
  constructor(w, d, o) {
    d = d || {};
    o = o || {};
    this.w = w;
    this.id = o.id || 'main';
    this.ally = !!o.ally;
    this.suit = o.suit || null;
    this.callsign = o.callsign || 'MK-XLII';
    this.hud = [];
    this.spin = 0; this.spinV = 0;
    this.targetId = null;
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

  say(text, tone) {
    if (this.w.settings.hudCallouts === false && tone !== 'warn') return;
    // in a crowd of suits only the main one calls out every weapon
    if (this.ally && tone !== 'warn' && tone !== 'radio' && this.w.allies.length > 2) return;
    this.hud.push({ text, tone: tone || 'info', start: now() });
    if (this.hud.length > 3) this.hud.shift();
  }

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
    if (this.mode === 'thrown') { this.tickThrown(dt); this.speed = Math.hypot(this.x - px, this.y - py) / dt; return; }
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
      if (this.power < 1.5) { this.say('POWER LOW', 'warn'); this.aim = null; return; }
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
      w.addBeam('repulsor', from, to, 0.14, 4.2, this.id);
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
    if (this.power < 6) { this.say('POWER LOW', 'warn'); this.aim = null; return; }
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
    w.addBeam('blast', from, { x: from.x + Math.cos(ang) * reach, y: from.y + Math.sin(ang) * reach }, 0.3, 16, this.id);
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
    if (this.missiles < 1) { this.say('MISSILES DEPLETED', 'warn'); return; }
    this.aim = null;
    this.setPose('missile');
    this.say('MISSILES AWAY');
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
    this.say('UNIBEAM');
    w.sound('chargeLong', this);
    let t = 0;
    while (t < 0.7) { this.charge = t / 0.7; this.holdPosition(); t += this.dt; yield; }
    if (this.power < 20) { this.say('POWER LOW', 'warn'); this.charge = 0; return; }
    this.power -= 22;
    this.cd.unibeam = 10;
    w.counters.unibeams++;
    const from = this.reactor();
    let ang = Math.atan2(tp.y - from.y, tp.x - from.x);
    // the chest faces forward: keep the beam in the front half
    if (Math.cos(ang) * this.facing < 0.2) ang = Math.atan2(Math.sin(ang), this.facing * 0.3);
    const beam = w.addBeam('unibeam', from, from, 1.1, 13, this.id);
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
    if (w.nuke && !w.nuke.passed) return [this.taskEvacuate(), 'evacuate', 98];
    if (this.ally) {
      if (w.enemies.length && !w.quiet) return [this.taskCombat(), 'combat', 80];
      return [this.taskAllyLeave(), 'leave', 70];
    }
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
    if (pose === 'gauntlet' && chance(0.5)) this.say(pick(['CALIBRATING…', 'REPULSOR CHECK', 'GAUNTLET OK']));
    yield* this.wait(dur);
    this.setPose('stand');
  }

  * taskRecharge() {
    if (this.mode === 'air') yield* this.land();
    this.setPose('stand');
    this.say('RECHARGING');
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
    this.say('SCANNING…');
    w.fx('scan', this.x, this.y - 55 * this.s, {});
    yield* this.hoverFor(2.2);
    this.say(pick(['NO THREATS DETECTED', 'PERIMETER CLEAR', 'ALL QUIET']));
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
      this.say(recent >= 4 ? pick(QUIPS_POKE) : pick(QUIPS_GREET), recent >= 4 ? 'warn' : null);
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
    this.say('STANDBY MODE');
    while (w.quiet) yield;
    this.setPose('stand');
    this.say('SYSTEMS ONLINE');
    w.sound('reboot', this);
    yield* this.wait(0.8);
  }

  * taskAnnounce() {
    const w = this.w, s = this.s;
    const a = w.announcement;
    if (!a) return;
    const d = w.geo.primary;
    const spot = { x: d.work.x + d.work.width / 2, y: d.work.y + d.work.height * 0.62 };
    this.say('INCOMING MESSAGE');
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
    this.say(pick(['ROGER THAT.', 'GOOD. BACK TO WORK.', 'NOTED.']));
    yield* this.hoverFor(0.8);
    yield* this.land();
  }

  * taskReboot() {
    const w = this.w, s = this.s;
    this.aim = null; this.charge = 0; this.beamK = 0;
    this.say('SUIT OFFLINE', 'warn');
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
    this.say('REBOOTING…');
    w.sound('reboot', this);
    t = 0;
    while (t < 1.2) { this.eyes = (Math.floor(t * 10) % 2) ? 1 : 0.2; t += this.dt; yield; }
    this.eyes = 1;
    this.armor = Math.max(this.armor, 35);
    this.mode = 'ground';
    this.setPose('crouch');
    yield* this.wait(0.5);
    this.setPose('stand');
    this.say('BACK ONLINE');
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
    this.say('SYSTEMS ONLINE');
    w.sound('reboot', this);
    yield* this.wait(0.4);
    this.setPose('thumbsUp');
    yield* this.wait(1.4);
    this.setPose('stand');
  }

  * taskCombat() {
    const w = this.w, s = this.s;
    this.say(w.enemies.some((e) => e.kind === 'boss') ? 'WARNING: HEAVY UNIT' : 'THREAT DETECTED', 'warn');
    w.sound('alert', this);
    let engaged = 0;
    while (w.enemies.length) {
      if (w.announcement) return;
      const target = w.pickTarget(this);
      if (!target) { yield; continue; }
      this.targetId = target.id;
      const tc = w.enemyCenter(target);
      const anyAir = w.enemies.some((e) => e.air);
      // power management: land and recharge a bit when nearly empty
      if (this.power < 6) {
        this.say('POWER CRITICAL', 'warn');
        if (this.mode === 'air') yield* this.land();
        this.setPose('stand');
        yield* this.wait(3, () => this.power > 30);
        continue;
      }
      // get into position
      const dx = this.x - tc.x;
      const side = Math.abs(dx) < 40 * s ? (chance(0.5) ? 1 : -1) : Math.sign(dx);
      const range = (target.kind === 'boss' ? 380 : 260) * s;
      // each suit of the Legion keeps its own slot so they don't stack up
      const slot = this.ally ? w.allies.indexOf(this) + 1 : 0;
      const sx = side * Math.floor(slot / 3) * 70 * s, sy = ((slot % 3) - (slot % 3 === 2 ? 3 : 0)) * 80 * s;
      if (anyAir || this.mode === 'air' || chance(0.25)) {
        if (this.mode !== 'air') yield* this.takeOff(rand(120, 200));
        const d = w.geo.displayAt(tc) || w.geo.nearestDisplay(tc);
        const want = {
          x: clamp(tc.x + side * range + sx, d.work.x + 60 * s, d.work.x + d.work.width - 60 * s),
          y: clamp((target.air ? tc.y : tc.y - 90 * s) - rand(20, 90) * s + 60 * s + sy, d.work.y + 130 * s, w.groundAt(tc.x, tc.y) - 20 * s),
        };
        let t = 0;
        const moveFor = rand(0.4, 1);
        while (t < moveFor && w.enemies.includes(target)) { this.steer(want.x, want.y, 360 * s); t += this.dt; yield; }
      } else {
        const d = w.geo.displayAt({ x: tc.x, y: tc.y - 10 }) || w.geo.nearestDisplay(tc);
        const tx = clamp(tc.x + side * range + sx + side * (slot % 3) * 45 * s, d.work.x + 40 * s, d.work.x + d.work.width - 40 * s);
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
    if (this.ally) return;
    this.say(pick(QUIPS_WIN));
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

  // ------------------------------------------------------------ nuke: evacuate, get thrown, recover
  * taskEvacuate() {
    const w = this.w, s = this.s;
    const n = w.nuke;
    if (!n) return;
    this.aim = null; this.charge = 0; this.beamK = 0;
    this.say(this.ally ? 'EVACUATING!' : 'NUKE INBOUND — EVACUATING!', 'warn');
    const spot = w.safeSpot(this);
    if (this.mode !== 'air') yield* this.takeOff(110);
    yield* this.flyTo(spot, { speed: 820, near: 26, timeout: 7, until: () => !w.nuke || w.nuke.detonated && w.nukeRadius() > dist(this.chest(), w.nuke) - 300 * s });
    // touch down if there's still time, then brace
    if (w.nuke && !w.nuke.detonated && this.y < this.ground() - 6 * s) {
      const g = this.ground();
      let t = 0;
      while (this.y < g - 2 && t < 1.2 && w.nuke && !w.nuke.detonated) { this.steer(this.x, g, 420 * s, 2400 * s); t += this.dt; yield; }
      if (this.y >= g - 6 * s) { this.y = g; this.vx = this.vy = 0; this.mode = 'ground'; }
    }
    this.setPose(this.mode === 'air' ? 'hover' : 'brace');
    this.say('BRACE FOR IMPACT!', 'warn');
    while (w.nuke && !w.nuke.passed) {
      if (this.mode === 'air') this.steer(this.x, this.y, 60 * s);
      else this.setPose('brace');
      yield;
    }
  }

  // hit by a shockwave: tumble through the air
  throwBy(vx, vy, dmg) {
    if (this.mode === 'down') { this.armor = Math.max(0, this.armor - dmg); return; }
    this.pending = null;
    if (this.task) { try { this.task.return(); } catch (e) { /* */ } }
    this.task = null; this.taskName = null; this.taskPrio = 0;
    this.aim = null; this.charge = 0; this.beamK = 0;
    if (this.mode === 'held' && this.w.press) this.w.press = null;
    this.mode = 'thrown';
    this.vx = vx; this.vy = vy;
    this.spin = 0;
    this.spinV = (vx >= 0 ? 1 : -1) * rand(9, 15);
    this.armor = Math.max(0, this.armor - dmg);
    this.hitAt = now();
    this.say(pick(['WHOA—!', 'AAAH!', 'HANG ON—', 'TOO CLOSE!']), 'warn');
  }

  tickThrown(dt) {
    const w = this.w, s = this.s, geo = w.geo;
    this.vy += 1500 * s * dt;
    const k = Math.exp(-0.5 * dt);
    this.vx *= k;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.spin += this.spinV * dt;
    this.spinV *= Math.exp(-0.7 * dt);
    this.setPose('stagger');
    // bounce off the outer edges of the screens
    const c = geo.clampBounds({ x: this.x, y: this.y - 40 * s }, 24 * s);
    if (c.x !== this.x) { this.x = c.x; this.vx = -this.vx * 0.35; this.spinV = -this.spinV * 0.6; w.sound('hit', this); }
    const d = geo.displayAt({ x: this.x, y: this.y - 40 * s }) || geo.nearestDisplay(this);
    if (d && this.y < d.work.y + 100 * s) { this.y = d.work.y + 100 * s; this.vy = Math.abs(this.vy) * 0.3; }
    const g = this.ground();
    if (this.y >= g) {
      this.y = g;
      if (this.vy > 520 * s) {
        // bounce once or twice
        this.vy = -this.vy * 0.32;
        this.vx *= 0.6;
        this.spinV *= 0.55;
        w.fx('shockwave', this.x, this.y, { size: 0.6 });
        w.sound('landing', this);
      } else {
        this.vx = this.vy = 0;
        this.spin = 0; this.spinV = 0;
        this.mode = 'ground';
        w.fx('shockwave', this.x, this.y, { size: 0.5 });
        if (this.armor <= 0) {
          if (this.ally) { w.destroyAlly(this); return; }
          w.counters.reboots++;
          this.run(this.taskReboot(), 'reboot', 99);
        } else this.run(this.taskRecover(), 'recover', 90);
      }
    }
  }

  * taskRecover() {
    this.setPose('down');
    this.eyes = 1;
    yield* this.wait(0.9);
    this.setPose('crouch');
    yield* this.wait(0.45);
    this.setPose('stand');
    this.say(pick(['THAT WAS LOUD.', 'NOTE TO SELF: RUN FASTER.', 'STILL IN ONE PIECE.', 'EARS RINGING…']));
    yield* this.wait(0.6);
  }

  // ------------------------------------------------------------ Iron Legion (allies)
  * taskAllyArrive(target) {
    const s = this.s;
    this.say(`${this.callsign} REPORTING`, 'radio');
    yield* this.flyTo(target, { speed: 620, near: 40, timeout: 5 });
  }

  * taskAllyLeave() {
    const w = this.w, s = this.s;
    if (w.nuke) { yield* this.hoverFor(1); return; }
    this.aim = null;
    if (this.mode !== 'air') yield* this.takeOff(120);
    this.faceTo(w.hero);
    this.setPose('salute');
    this.say(pick(['GOOD HUNTING.', 'LEGION OUT.', 'CALL IF YOU NEED US.', 'RETURNING TO BASE.']), 'radio');
    let t = 0;
    while (t < 1.3) { this.steer(this.x, this.y, 60 * s); this.setPose('salute'); t += this.dt; yield; }
    const d = w.geo.displayAt({ x: this.x, y: this.y - 40 * s }) || w.geo.primary;
    const exit = { x: clamp(this.x + rand(-200, 200) * s, d.work.x + 60 * s, d.work.x + d.work.width - 60 * s), y: d.work.y + 100 * s };
    yield* this.flyTo(exit, { speed: 700, near: 30, timeout: 4 });
    w.removeAlly(this, true);
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
    this.say(pick(QUIPS_HELD));
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
    this.say(pick(['STABILIZED.', 'THANKS FOR THE LIFT.', 'SMOOTH.']));
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
    if (this.mode === 'thrown') return 'hit by the shockwave';
    if (w.nuke && !w.nuke.passed) return 'evacuating — nuke inbound';
    if (w.army) return `army battle · legion ×${w.allies.length}`;
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
    this.counters = { kills: 0, drones: 0, walkers: 0, tanks: 0, bosses: 0, shotsFired: 0, missiles: 0, unibeams: 0, reboots: 0, waves: 0, nukes: 0, armies: 0, armiesWon: 0, legion: 0, ...((data && data.counters) || {}) };
    this.hero = new Hero(this, data && data.hero);
    this.allies = [];
    this.nuke = null;
    this.army = null;
    this.clock = now(); // simulation time (ms); advances with dt, so tests can run faster than real time
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
  get heroes() { return this.allies.length ? [this.hero, ...this.allies] : [this.hero]; }
  sound(name, at) { if (!this.quiet) this.emit({ type: 'sound', name, x: at ? at.x : this.hero.x, y: at ? at.y - 40 : this.hero.y - 40 }); }
  fx(kind, x, y, o) { this.emit({ type: 'fx', kind, x, y, ...(o || {}) }); }
  notify(title, body) { if (this.settings.notifications) this.emit({ type: 'notify', title, body }); }

  say(text, tone) { this.hero.say(text, tone); }

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

  spawn(kind, p, o) {
    o = o || {};
    const s = this.s, k = ENEMY[kind];
    if (!k || this.enemies.length >= (o.max || 30)) return null;
    const q = this.geo.clampWork(p, 40 * s);
    const e = {
      id: uid('x'), kind, x: q.x, y: q.y, vx: 0, vy: 0, facing: q.x < this.hero.x ? 1 : -1,
      hp: k.hp * this.diff.hp, maxHp: k.hp * this.diff.hp, air: k.air, cool: rand(1, 2.5), phase: 0, charge: 0, hitAt: 0,
      orbit: rand(0, Math.PI * 2), range: rand(200, 330), alt: rand(60, 170), born: now(), state: 'idle', grounded: k.air,
    };
    if (o.vx) e.vx = o.vx;
    this.enemies.push(e);
    if (!o.silent) {
      this.fx('portal', e.x, e.y + k.cy * s, {});
      this.sound(kind === 'boss' ? 'bossSpawn' : 'spawn', e);
    }
    this.dirty();
    const h = this.hero;
    if (this.settings.autoDefend !== false && h.taskName !== 'combat' && h.taskName !== 'announce' && h.mode !== 'down') {
      h.interrupt(h.taskCombat(), 'combat', 80);
    }
    return e;
  }

  pickTarget(h) {
    const locked = this.enemies.find((e) => e.id === this.lockId);
    if (locked && (!h.ally || chance(0.3))) return locked;
    let best = null, bs = -Infinity;
    const others = this.allies.length ? this.heroes.filter((x) => x !== h) : [];
    for (const e of this.enemies) {
      const d = dist(this.enemyCenter(e), h);
      const threat = { boss: 3, tank: 1.5, walker: 1.2, drone: 1, mini: 1.4 }[e.kind] || 1;
      // spread the suits over different targets
      const taken = others.reduce((a, x) => a + (x.targetId === e.id ? 1 : 0), 0);
      const score = threat * 400 - d * 0.6 - taken * 260;
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
      if (p.owner !== 'enemy') continue;
      const rx = c.x - p.x, ry = c.y - p.y;
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const along = (rx * p.vx + ry * p.vy) / sp;
      if (along > 0 && along / sp < 0.45 && Math.abs(rx * p.vy - ry * p.vx) / sp < 40 * s) return p;
    }
    return null;
  }

  damage(e, dmg, from, quiet) {
    if (e.hp <= 0) return;
    // the Legion fights at full power in a big battle
    e.hp -= this.army && this.army.huge ? dmg * 1.6 : dmg;
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

  hurtHero(dmg, at, who) {
    const h = who || this.hero, s = this.s;
    if (h.mode === 'down' || h.taskName === 'reboot' || h.mode === 'thrown') return;
    h.armor -= dmg * this.diff.dmg * (h.ally ? 0.8 : 1) * (this.army && this.army.huge ? 0.35 : 1);
    h.hitAt = now();
    this.fx('hitspark', at ? at.x : h.x, at ? at.y : h.y - 55 * s, {});
    this.sound('hit', h);
    if (h.armor <= 0) {
      h.armor = 0;
      if (h.ally) { this.destroyAlly(h); return; }
      this.counters.reboots++;
      h.run(h.taskReboot(), 'reboot', 99);
    } else if (h.armor < 25 && !h.warnedArmor) { h.warnedArmor = true; h.say('ARMOR CRITICAL', 'warn'); }
    if (h.armor > 40) h.warnedArmor = false;
  }

  // the hero an enemy goes after: the nearest suit that's still in the fight
  nearestHero(e) {
    if (!this.allies.length) return this.hero;
    let best = this.hero, bd = Infinity;
    for (const h of this.heroes) {
      if (h.mode === 'down') continue;
      const d = dist(h, e);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  addShot(p) { p.id = uid('p'); p.age = 0; this.shots.push(p); return p; }
  addBeam(kind, a, b, dur, w, owner) {
    const beam = { id: uid('b'), kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y, start: now(), dur, w, owner };
    this.beams.push(beam);
    return beam;
  }

  tickEnemies(dt) {
    const s = this.s, D = this.diff;
    for (const e of [...this.enemies]) {
      const k = ENEMY[e.kind];
      const h = this.nearestHero(e);
      const hc = h.chest();
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
          this.enemyLaser(e, hc, 520 * s, k.dmg, null, h);
        }
      } else if (e.kind === 'mini') {
        this.steerEnemy(e, { x: hc.x, y: hc.y }, k.speed * s * (h.mode === 'down' ? 0.3 : 1), dt, 900 * s);
        e.facing = e.vx > 0 ? 1 : -1;
        if (d < 22 * s && h.mode !== 'down') { this.hurtHero(k.dmg, this.enemyCenter(e), h); this.kill(e); continue; }
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
          if (e.cool <= 0 && h.mode !== 'down') { e.cool = rand(k.fire[0], k.fire[1]); this.enemyLaser(e, hc, 460 * s, k.dmg, { x: e.x + e.facing * 18 * s, y: e.y - 24 * s }, h); }
        } else if (e.kind === 'tank') {
          const muzzle = { x: e.x + e.facing * 24 * s, y: e.y - 24 * s };
          e.aim = -0.35;
          e.charge = clamp(1 - e.cool / 0.6, 0, 1);
          if (e.cool <= 0 && h.mode !== 'down') { e.cool = rand(k.fire[0], k.fire[1]); this.enemyShell(e, muzzle, hc, k.dmg); }
        } else if (e.kind === 'boss') {
          this.tickBoss(e, dt, hc, h);
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

  enemyLaser(e, target, speed, dmg, from, who) {
    const s = this.s;
    const o = from || this.enemyCenter(e);
    const hv = who || this.hero;
    const lead = { x: target.x + hv.vx * 0.25, y: target.y + hv.vy * 0.25 };
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

  tickBoss(e, dt, hc, who) {
    const s = this.s;
    const cannon = { x: e.x + e.facing * 52 * s, y: e.y - 62 * s };
    if (e.state === 'idle' && e.cool <= 0 && (who || this.hero).mode !== 'down') {
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
      e.beamTick = (e.beamTick || 0) + dt;
      if (e.beamTick > 0.2) {
        e.beamTick = 0;
        for (const hh of this.heroes) { const c = hh.chest(); if (segDist(c, cannon, end) < 26 * s) this.hurtHero(2.4, c, hh); }
      }
      if (e.stateT >= 1.3) { e.state = 'idle'; e.charge = 0; e.cool = rand(2.6, 3.8); e.beam = null; }
    }
  }

  tickShots(dt) {
    const s = this.s;
    const heroes = this.heroes;
    for (const p of [...this.shots]) {
      p.age += dt;
      let dead = p.age > p.life;
      if (p.kind === 'missile' || p.kind === 'emissile') {
        let tgt = null;
        if (p.kind === 'missile') {
          let e = p.target && this.enemies.find((x) => x.id === p.target);
          if (!e && this.enemies.length && !p.tp) { e = this.enemies.reduce((a, b) => (dist(b, p) < dist(a, p) ? b : a)); p.target = e.id; }
          tgt = e ? this.enemyCenter(e) : p.tp;
        } else tgt = this.nearestHero(p).chest();
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
      if (p.owner !== 'enemy') {
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
      } else {
        for (const h of heroes) {
          if (h.mode === 'down' || dist(p, h.chest()) >= 26 * s) continue;
          this.hurtHero(p.dmg, p, h);
          if (p.kind !== 'laser') { this.fx('explosion', p.x, p.y, { size: 0.6 }); this.sound('boom', p); }
          dead = true;
          break;
        }
      }
      if (!dead && p.y >= this.groundAt(p.x, p.y) && p.kind !== 'laser') {
        this.fx('explosion', p.x, p.y, { size: 0.6 });
        this.sound('boom', p);
        if (p.owner === 'enemy') for (const h of heroes) if (dist(p, { x: h.x, y: h.y - 30 * s }) < 50 * s) this.hurtHero(p.dmg * 0.5, p, h);
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

  // ------------------------------------------------------------ the nuke
  // Siren → bomb falls → detonation → a shockwave sweeps the whole screen (and
  // the next one). Everything on the target screen is destroyed; heroes try to
  // escape to another screen and get thrown when the wave reaches them.
  startNuke(p) {
    if (this.nuke) return false;
    const geo = this.geo, s = this.s;
    const d = geo.displayAt(p) || geo.nearestDisplay(p) || geo.primary;
    // ground burst: the bomb comes down on the floor below the chosen spot
    const gz = { x: clamp(p.x, d.work.x + 60 * s, d.work.x + d.work.width - 60 * s), y: d.work.y + d.work.height - 2 };
    let rMax = 0;
    for (const q of geo.displays) for (const [cx, cy] of [[q.bounds.x, q.bounds.y], [q.bounds.x + q.bounds.width, q.bounds.y], [q.bounds.x, q.bounds.y + q.bounds.height], [q.bounds.x + q.bounds.width, q.bounds.y + q.bounds.height]]) rMax = Math.max(rMax, Math.hypot(cx - gz.x, cy - gz.y));
    const t = this.clock;
    this.nuke = { id: uid('n'), did: d.id, x: gz.x, y: gz.y, start: t, det: t + 5000, dropAt: t + 3100, rMax: rMax + 200, speed: 1050, hit: {}, detonated: false, passed: false };
    this.counters.nukes++;
    this.sound('siren', gz);
    this.lockId = null;
    for (const h of this.heroes) if (h.mode !== 'held' && h.mode !== 'down') h.run(h.taskEvacuate(), 'evacuate', 98);
    this.dirty();
    return true;
  }

  nukeRadius() {
    const n = this.nuke;
    return n && n.detonated ? ((this.clock - n.det) / 1000) * n.speed : 0;
  }

  // the safest place: the far side of another screen, or the far side of this one
  safeSpot(h) {
    const n = this.nuke, geo = this.geo, s = this.s;
    const gz = { x: n.x, y: n.y };
    const target = geo.displays.find((d) => d.id === n.did) || geo.primary;
    const others = geo.displays.filter((d) => d !== target);
    const cand = [];
    const consider = (d) => {
      for (const fx of [0.12, 0.5, 0.88]) {
        const x = d.work.x + d.work.width * fx;
        cand.push({ x, y: this.groundAt(x, d.work.y + d.work.height - 5) });
      }
    };
    if (others.length) others.forEach(consider); else consider(target);
    cand.sort((a, b) => dist(b, gz) - dist(a, gz));
    const best = cand[0];
    // spread the suits out a little
    return { x: best.x + (h.ally ? rand(-90, 90) * s : 0), y: best.y };
  }

  tickNuke() {
    const n = this.nuke;
    if (!n) return;
    const t = this.clock, s = this.s;
    if (!n.whistled && t >= n.dropAt) { n.whistled = true; this.sound('bombWhistle', n); }
    if (!n.detonated && t >= n.det) {
      n.detonated = true;
      this.sound('nukeBoom', n);
      this.fx('nuke', n.x, n.y, {});
      this.dirty();
    }
    if (!n.detonated) return;
    const r = this.nukeRadius();
    const target = this.geo.displays.find((d) => d.id === n.did);
    const inTarget = (p) => target && p.x >= target.bounds.x && p.x <= target.bounds.x + target.bounds.width && p.y >= target.bounds.y && p.y <= target.bounds.y + target.bounds.height;
    // the wave front destroys / batters everything it passes
    for (const e of [...this.enemies]) {
      if (n.hit[e.id]) continue;
      const c = this.enemyCenter(e);
      if (r < dist(c, n)) continue;
      n.hit[e.id] = 1;
      if (inTarget(c)) this.kill(e);
      else {
        this.damage(e, e.maxHp * 0.6, n, true);
        if (e.hp > 0) { const a = Math.atan2(c.y - n.y, c.x - n.x); e.vx += Math.cos(a) * 500 * s; if (e.air) e.vy += Math.sin(a) * 300 * s; }
      }
    }
    for (const sh of [...this.shots]) if (dist(sh, n) < r && inTarget(sh)) this.shots.splice(this.shots.indexOf(sh), 1);
    for (const h of this.heroes) {
      if (n.hit[h.id]) continue;
      const c = h.chest();
      const d = dist(c, n);
      if (r < d) continue;
      n.hit[h.id] = 1;
      const close = inTarget(c);
      const f = clamp(1 - d / n.rMax, 0.15, 1);
      const a = d < 5 ? -Math.PI / 2 + rand(-0.6, 0.6) : Math.atan2(c.y - n.y, c.x - n.x);
      const sp = (close ? 1250 : 650 + 600 * f) * s;
      const dmg = close ? 55 + 30 * f : 10 + 25 * f;
      h.throwBy(Math.cos(a) * sp, Math.min(Math.sin(a) * sp, 0) - (close ? 520 : 360) * s, dmg);
      this.sound('shockHit', c);
    }
    if (!n.passed && r > n.rMax) {
      n.passed = true;
      this.hero.say(this.enemies.length ? 'THEY\'RE STILL COMING!' : 'GROUND ZERO… CLEAR.');
    }
    if (t - n.det > 16000) { this.nuke = null; this.dirty(); }
  }

  // ------------------------------------------------------------ army attack
  startArmy(o) {
    const geo = this.geo, s = this.s;
    let d = o.display != null ? geo.displays.find((q) => String(q.id) === String(o.display)) : null;
    if (!d && o.x != null) d = geo.displayAt({ x: o.x, y: o.y }) || geo.nearestDisplay({ x: o.x, y: o.y });
    if (!d) d = geo.primary;
    if (this.army) return false;
    const total = clamp(Math.round(ARMY_SIZES[o.size] || Number(o.size) || 20), 1, 1000);
    const side = ['left', 'right', 'top', 'both'].includes(o.side) ? o.side : 'right';
    const queue = [];
    const bosses = total >= 200 ? Math.round(total / 125) : total >= 50 ? 2 : total >= 35 ? 1 : 0;
    for (let i = 0; i < total - bosses; i++) {
      const r = Math.random();
      queue.push(r < 0.5 ? 'walker' : r < 0.78 ? 'drone' : r < 0.9 ? 'tank' : 'mini');
    }
    // bosses arrive with the second half (spread through a huge army)
    if (bosses > 2) for (let b = 0; b < bosses; b++) queue.splice(Math.floor(queue.length * (0.08 + 0.9 * b / bosses)), 0, 'boss');
    else for (let b = 0; b < bosses; b++) queue.splice(Math.floor(queue.length * (0.45 + 0.4 * b)), 0, 'boss');
    const legion = legionFor(total);
    const t = this.clock;
    const huge = total >= 200;
    this.army = { id: uid('a'), did: d.id, side, total, queue, spawned: 0, start: t, nextAt: t + 1400, legion, legionAt: t + 2200, called: 0, lastSide: 'left', huge, mark: 0 };
    this.counters.armies++;
    this.hero.say(total >= 1000 ? 'LEGENDARY BATTLE: 1000 HOSTILES' : `HOSTILE ARMY: ${total} UNITS`, 'warn');
    this.sound('warHorn', { x: d.work.x + d.work.width / 2, y: d.work.y + 200 });
    this.dirty();
    return true;
  }

  tickArmy(dt) {
    const a = this.army;
    if (!a) return;
    const t = this.clock, s = this.s, geo = this.geo;
    const d = geo.displays.find((q) => q.id === a.did) || geo.primary;
    // a huge army attacks in waves: a front line on screen, the rest behind it
    const front = a.huge ? 45 : 70;
    if (a.huge) for (const h of this.heroes) if (h.mode !== 'down' && h.armor > 0) h.armor = Math.min(100, h.armor + 2 * (dt || 0));
    if (a.queue.length && t >= a.nextAt && this.enemies.length < front) {
      const side = a.side === 'both' ? (a.lastSide = a.lastSide === 'left' ? 'right' : 'left') : a.side;
      const squad = a.huge ? Math.floor(rand(2, 5)) : 1;
      let last = '';
      for (let i = 0; i < squad && a.queue.length && this.enemies.length < front; i++) {
        let kind = a.queue[0];
        if (kind === 'boss' && this.enemies.filter((e) => e.kind === 'boss').length >= 2) {
          // two mechs on the field is plenty: hold this one back a little
          a.queue.splice(Math.min(a.queue.length, 12), 0, a.queue.shift());
          kind = a.queue[0];
          if (kind === 'boss') break;
        }
        a.queue.shift();
        last = kind;
        const w = d.work;
        let p;
        if (side === 'top') p = { x: w.x + rand(0.08, 0.92) * w.width, y: w.y + rand(70, 140) * s };
        else {
          const x = side === 'left' ? w.x + rand(12, 70) * s : w.x + w.width - rand(12, 70) * s;
          const air = kind === 'drone' || kind === 'mini';
          p = { x, y: air ? w.y + rand(0.15, 0.6) * w.height : w.y + w.height - 10 };
        }
        const e = this.spawn(kind, p, { max: 75, silent: a.spawned > 0 && kind !== 'boss' });
        if (e) {
          if (side !== 'top' && !e.air) e.vx = (side === 'left' ? 1 : -1) * 40 * s;
          if (side !== 'top' && e.air) e.vx = (side === 'left' ? 1 : -1) * 260 * s;
          if (a.huge && kind !== 'boss') { e.hp *= 0.7; e.maxHp = e.hp; }
          if (i === 0 || kind === 'boss') this.fx('portal', e.x, this.enemyCenter(e).y, {});
          if (kind === 'boss' && a.huge) this.hero.say('HEAVY MECH INBOUND', 'warn');
        }
        a.spawned++;
      }
      a.nextAt = t + (last === 'boss' ? 900 : a.huge ? rand(380, 620) : rand(160, 320));
    }
    // milestones in a big battle
    if (a.huge) {
      const done = a.total - a.queue.length - this.enemies.length;
      const m = Math.floor((done / a.total) * 4);
      if (m > a.mark && m < 4) {
        a.mark = m;
        this.hero.say(m === 1 ? `${done} DOWN. KEEP PUSHING!` : m === 2 ? 'HALFWAY THERE, LEGION!' : `${done}! THEY'RE BREAKING!`);
        this.sound('hudBeep', this.hero);
      }
    }
    // the main suit calls in the Iron Legion
    if (a.called < a.legion && t >= a.legionAt) {
      if (a.called === 0) { this.hero.say('CALLING THE LEGION'); this.sound('hudBeep', this.hero); }
      this.spawnAlly(a);
      a.called++;
      a.legionAt = t + rand(350, 650);
    } else if (a.called >= a.legion && this.allies.length < a.legion && a.queue.length && t >= a.legionAt) {
      // a suit went down: send a replacement
      if (this.spawnAlly(a)) this.hero.say('REINFORCEMENTS, JARVIS');
      a.legionAt = t + rand(6000, 9000);
    }
    if (!a.queue.length && !this.enemies.length && t - a.start > 3000) {
      this.counters.armiesWon++;
      this.hero.say('ARMY DEFEATED. GOOD WORK, LEGION.');
      this.sound('reboot', this.hero);
      this.army = null;
      this.dirty();
    }
  }

  spawnAlly(a, near) {
    const geo = this.geo, s = this.s;
    if (this.allies.length >= MAX_LEGION) return null;
    const d = (a && geo.displays.find((q) => q.id === a.did)) || geo.displayAt({ x: this.hero.x, y: this.hero.y - 40 * s }) || geo.primary;
    const SUITS = ['silver', 'stealth', 'patriot', 'gold', 'midnight', 'arctic', 'gunmetal', 'classic'];
    const used = new Set(this.allies.map((x) => x.suit));
    const suit = SUITS.find((k) => !used.has(k) && k !== this.settings.suit) || pick(SUITS);
    const callsign = `MK-${pick(['II', 'XVII', 'XXI', 'XXXIII', 'XL', 'XXVI', 'XV', 'XXXV', 'XLVI'])}`;
    // they come in from the side opposite the enemy (or from the sky)
    const from = a && a.side === 'left' ? 'right' : a && a.side === 'right' ? 'left' : chance(0.5) ? 'left' : 'right';
    const x = from === 'left' ? d.work.x + rand(40, 140) * s : d.work.x + d.work.width - rand(40, 140) * s;
    const h = new Hero(this, { power: 100, armor: 100, missiles: 12, x, y: d.work.y + 110 * s }, { id: uid('h'), ally: true, suit, callsign });
    h.mode = 'air';
    h.facing = from === 'left' ? 1 : -1;
    h.vx = h.facing * 300 * s; h.vy = 120 * s;
    const target = { x: d.work.x + d.work.width * (from === 'left' ? rand(0.2, 0.4) : rand(0.6, 0.8)), y: d.work.y + d.work.height * rand(0.35, 0.6) };
    h.run(h.taskAllyArrive(near || target), 'arrive', 70);
    this.allies.push(h);
    this.counters.legion++;
    this.sound('thrustOn', h);
    this.fx('flash', x, h.y - 50 * s, { size: 1, color: '120,225,255' });
    this.dirty();
    return h;
  }

  removeAlly(h, flyAway) {
    const i = this.allies.indexOf(h);
    if (i < 0) return;
    this.allies.splice(i, 1);
    if (h.task) { try { h.task.return(); } catch (e) { /* */ } }
    if (flyAway) this.fx('flash', h.x, h.y - 50 * this.s, { size: 0.8, color: '120,225,255' });
    this.dirty();
  }

  destroyAlly(h) {
    const c = h.chest();
    this.fx('explosion', c.x, c.y, { size: 1.3 });
    this.sound('boomBig', c);
    this.hero.say(`${h.callsign} DOWN`, 'warn');
    this.removeAlly(h);
    if (this.army) this.army.legionAt = Math.max(this.army.legionAt, this.clock + 5000);
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
        if (this.quiet) { for (const e of [...this.enemies]) this.kill(e, true); this.shots = []; this.army = null; this.nuke = null; for (const x of [...this.allies]) this.removeAlly(x, true); }
        if (free) h.run(this.quiet ? h.taskQuiet() : h.taskIdle(1), this.quiet ? 'quiet' : 'idle', 95);
        this.dirty();
        break;
      case 'nuke': {
        let p = at;
        if (a.display != null) {
          const d = this.geo.displays.find((q) => String(q.id) === String(a.display));
          if (d) p = { x: d.work.x + d.work.width / 2, y: d.work.y + d.work.height * 0.55 };
        }
        this.startNuke(p);
        break;
      }
      case 'army': this.startArmy({ ...a, x: a.x != null ? a.x : null, y: a.y }); break;
      case 'callLegion': {
        const n = Math.max(1, Math.min(MAX_LEGION - this.allies.length, a.count || 3));
        const fake = { did: (this.geo.displayAt({ x: h.x, y: h.y - 40 * s }) || this.geo.primary).id, side: chance(0.5) ? 'left' : 'right' };
        for (let i = 0; i < n; i++) this.spawnAlly(fake);
        this.say('LEGION, FORM UP');
        break;
      }
      case 'dismissLegion': for (const x of [...this.allies]) x.run(x.taskAllyLeave(), 'leave', 75); break;
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
    for (const x of [...this.allies]) this.removeAlly(x);
    this.shots = []; this.beams = []; this.press = null; this.nuke = null; this.army = null;
    const h = this.hero;
    if (h.task) { try { h.task.return(); } catch (e) { /* */ } }
    h.task = null; h.taskName = null; h.taskPrio = 0;
    if (h.mode === 'held' || h.mode === 'fall' || h.mode === 'down' || h.mode === 'thrown') { h.mode = 'ground'; h.spin = 0; h.armor = Math.max(h.armor, 35); h.eyes = 1; }
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
    if (realGap && realGap > 5) { this.clock = now(); return; }
    this.clock += dt * 1000;
    this.tickPress();
    this.hero.tick(dt);
    for (const a of [...this.allies]) a.tick(dt);
    if (!this.quiet) {
      this.tickArmy(dt);
      this.tickEnemies(dt);
      this.tickShots(dt);
      this.tickNuke();
      this.tickInvasions();
    }
    const t = this.now;
    for (const h of this.heroes) h.hud = h.hud.filter((x) => t - x.start < 2600);
    if (this.diag && t - this.diag.start > 8000) this.diag = null;
  }

  applyAway() { /* the suit doesn't get hungry */ }

  wantsFast() {
    const h = this.hero;
    return !!(this.press || h.mode !== 'ground' || this.enemies.length || this.shots.length || this.beams.length || h.speed > 1 || this.allies.length || this.nuke || this.army);
  }

  activeIn(near) {
    const h = this.hero;
    if (near({ x: h.x, y: h.y - 50 }, 260)) return true;
    if (this.enemies.some((e) => near(e, 200)) || this.shots.some((p) => near(p, 60)) || this.beams.length) return true;
    if (this.announcement || this.nuke || this.army) return true;
    if (this.allies.some((a) => near({ x: a.x, y: a.y - 50 }, 260))) return true;
    return false;
  }

  info() {
    return { name: 'Iron Man', status: this.hero.statusText(), dead: false };
  }

  wall(tc) { return now() - (this.clock - tc); } // simulation time → wall-clock time

  heroSnap(h) {
    return {
      id: h.id, ally: h.ally, suit: h.suit, callsign: h.callsign, hud: h.hud,
      x: h.x, y: h.y, vx: h.vx, vy: h.vy, facing: h.facing, mode: h.mode, pose: h.pose, poseStart: h.poseStart,
      aim: h.aim, aimArm: h.aimArm, charge: h.charge, beam: h.beamK, eyes: h.eyes, swing: h.swing, spin: h.spin, dist: h.dist, speed: h.speed,
      power: h.power, armor: h.armor, missiles: h.missiles, hitAt: h.hitAt, status: h.statusText(), task: h.taskName,
      ground: this.groundAt(h.x, h.y),
    };
  }

  snapshot() {
    const h = this.hero;
    const t = now();
    const n = this.nuke, a = this.army;
    return {
      t, s: this.s, character: 'ironman', ver: this.ver,
      hero: this.heroSnap(h),
      allies: this.allies.map((x) => this.heroSnap(x)),
      nuke: n && { id: n.id, did: n.did, x: n.x, y: n.y, start: this.wall(n.start), det: this.wall(n.det), dropAt: this.wall(n.dropAt), speed: n.speed, rMax: n.rMax, detonated: n.detonated },
      army: a && { id: a.id, did: a.did, side: a.side, total: a.total, left: a.queue.length + this.enemies.length, legion: this.allies.length, start: this.wall(a.start) },
      enemies: this.enemies.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, vx: e.vx, vy: e.vy, facing: e.facing, hp: e.hp, maxHp: e.maxHp, phase: e.phase, charge: e.charge, hitAt: e.hitAt, aim: e.aim, air: e.air, born: e.born })),
      shots: this.shots.map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, vx: p.vx, vy: p.vy, owner: p.owner })),
      beams: this.beams,
      hud: h.hud,
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
      army: !!this.army, nuke: !!this.nuke, allies: this.allies.length,
      displays: this.geo.displays.map((d, i) => ({ id: d.id, label: `Screen ${i + 1}${d.primary ? ' (main)' : ''}` })),
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
