// Headless test for the armored hero: node dev/iron-test.js
'use strict';
const assert = require('assert');
const { Geo } = require('../src/main/geometry');
const { IronWorld } = require('../src/main/ironman');
const { World } = require('../src/main/world');
const { Reminders } = require('../src/main/reminders');

const geo = new Geo();
geo.set([
  { id: 1, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 33, width: 1728, height: 1026 }, primary: true },
  { id: 2, bounds: { x: 1728, y: 0, width: 1440, height: 900 }, workArea: { x: 1728, y: 30, width: 1440, height: 870 } },
]);
const settings = { sound: true, volume: 0.5, notifications: false, autoDefend: true, invasions: 'off', difficulty: 'normal', hudCallouts: true, ironSize: 'small', suit: 'classic', voice: true };
const sounds = {}, fx = {};
const w = new IronWorld({ geo, data: null, settings, emit: (e) => { if (e.type === 'sound') sounds[e.name] = (sounds[e.name] || 0) + 1; if (e.type === 'fx') fx[e.kind] = (fx[e.kind] || 0) + 1; }, sysinfo: () => ({ cpu: 10 }) });
const DT = 1 / 60;
let cur = { x: 600, y: 400 };
const tasks = {}, poses = {};
function step(n) {
  for (let i = 0; i < n; i++) {
    w.setCursor(cur, DT);
    w.tick(DT);
    const h = w.hero;
    tasks[h.taskName || '-'] = (tasks[h.taskName || '-'] || 0) + 1;
    poses[h.pose] = (poses[h.pose] || 0) + 1;
    for (const k of ['x', 'y', 'power', 'armor', 'missiles']) assert(Number.isFinite(h[k]), `NaN ${k} in ${h.taskName}`);
    if (h.mode !== 'held') assert(geo.inAny({ x: h.x, y: h.y - 40 }, -5), `hero off screen at ${h.x.toFixed(0)},${h.y.toFixed(0)} (${h.taskName}, ${h.mode})`);
    for (const e of w.enemies) assert(Number.isFinite(e.x) && Number.isFinite(e.y), 'enemy NaN');
    JSON.stringify(w.snapshot());
  }
}
const sec = (s) => Math.round(s * 60);

w.activate();
step(sec(6));
assert.strictEqual(w.hero.mode, 'ground', 'should land after arriving');
console.log('arrived:', w.hero.taskName, w.hero.pose);
step(sec(60)); // idle life

// every enemy type, one at a time
for (const kind of ['drone', 'walker', 'tank', 'swarm', 'boss']) {
  const d = geo.displays[kind === 'tank' ? 1 : 0];
  w.command('spawn', { kind, x: d.work.x + d.work.width * 0.7, y: d.work.y + d.work.height * 0.3 });
  let t = 0;
  while (w.enemies.length && t < sec(90)) { step(1); t++; if (w.hero.armor < 30) w.hero.armor = 80; }
  console.log(`${kind}: cleared=${!w.enemies.length} in ${(t / 60).toFixed(1)}s, kills=${w.counters.kills}, power=${w.hero.power.toFixed(0)}, missiles=${w.hero.missiles}`);
  assert(!w.enemies.length, `${kind} not defeated`);
  step(sec(4));
}

// directed attacks
for (const kind of ['repulsor', 'missiles', 'unibeam', 'blast']) {
  w.hero.power = 100;
  w.command('attack', { kind, x: 900, y: 300 });
  step(sec(3));
}

// suit goes offline at zero armor and reboots
w.command('spawn', { kind: 'drone', x: 800, y: 300 });
step(sec(1));
w.hero.armor = 1;
w.hurtHero(50, null);
assert.strictEqual(w.hero.taskName, 'reboot');
step(sec(9));
assert.notStrictEqual(w.hero.mode, 'down', 'should reboot');
console.log('rebooted:', w.hero.mode, 'armor', w.hero.armor.toFixed(0));
w.command('clearEnemies');

// pick up, swing, drop
const h = w.hero;
step(sec(3));
cur = { x: h.x, y: h.y - 60 }; w.setCursor(cur, DT);
w.pointerDown(cur, 0);
for (let i = 0; i < 40; i++) { cur = { x: cur.x + (i % 8 < 4 ? 30 : -30), y: cur.y - 4 }; step(1); }
assert.strictEqual(h.mode, 'held');
w.pointerUp(cur, 0);
step(sec(4));
console.log('after drop:', h.mode, h.taskName);
// with no power he falls instead
cur = { x: h.x, y: h.y - 60 }; w.setCursor(cur, DT); step(1);
w.pointerDown(cur, 0); cur = { x: cur.x + 40, y: cur.y - 200 }; step(5);
h.power = 0;
w.pointerUp(cur, 0);
step(sec(3));
assert.strictEqual(h.mode, 'ground', 'falls to the floor');
h.power = 100;

// flight commands
for (const c of ['takeoff', 'patrol', 'flyby', 'scan', 'diagnostics', 'thumbsUp', 'repair', 'recharge']) { w.command(c, { x: 1000, y: 400 }); step(sec(4)); }
w.command('flyTo', { x: 2500, y: 400 }); step(sec(8));
console.log('flew to second screen:', geo.displayAt({ x: h.x, y: h.y - 40 }).id);

// reminders: announce on the main screen and dismiss
const fired = [];
const rem = new Reminders([], (a) => { fired.push(a); w.announce({ ...a, header: 'MISSION BRIEFING', quip: 'x', speech: 'x' }); });
rem.add({ inMinutes: 0, text: 'Call the client' });
rem.tick();
step(sec(6));
assert(w.announcement && w.announcement.arrived, 'hero should reach the briefing spot');
const prim = geo.primary.work;
assert(Math.abs(h.x - (prim.x + prim.width / 2)) < 20, 'at the centre of the main screen');
console.log('briefing at centre:', h.x.toFixed(0), h.y.toFixed(0), h.pose);
rem.resolve(fired[0].id, 'done'); w.clearAnnouncement(fired[0].id);
step(sec(4));

// quiet mode + switching worlds
w.command('quiet'); step(sec(6)); assert.strictEqual(h.pose, 'powerDown');
w.command('quiet'); step(sec(2));
w.deactivate();
const cat = new World({ geo, data: null, settings: { ...require('../src/main/world').DEFAULT_SETTINGS }, emit: () => {} });
cat.setCursor(cur, DT);
cat.announce({ id: 'r1', text: 'Stretch', time: '10:00' });
for (let i = 0; i < sec(8); i++) cat.tick(DT);
assert(cat.announcement.arrived, 'cat should reach the middle too');
console.log('cat briefing at:', cat.cat.x.toFixed(0), cat.cat.y.toFixed(0), cat.cat.pose);

// ---- army attack: the Iron Legion joins, wins, then leaves
w.command('quiet', { value: false });
w.command('army', { side: 'left', size: 'medium', x: 800, y: 500 });
{
  let t = 0, maxAllies = 0, maxEnemies = 0;
  while ((w.army || w.allies.length) && t < sec(240)) {
    step(1); t++;
    maxAllies = Math.max(maxAllies, w.allies.length);
    maxEnemies = Math.max(maxEnemies, w.enemies.length);
    if (w.hero.armor < 30) w.hero.armor = 80;
    for (const a of w.allies) if (a.armor < 25) a.armor = 70;
  }
  console.log(`army: done=${!w.army} in ${(t / 60).toFixed(1)}s, peak enemies=${maxEnemies}, legion=${maxAllies}, allies left=${w.allies.length}, armiesWon=${w.counters.armiesWon}`);
  assert(!w.army, 'army should be defeated');
  assert.strictEqual(maxAllies, 3, 'a medium army calls 3 suits');
  assert.strictEqual(w.allies.length, 0, 'the Legion flies home afterwards');
}

// ---- legendary battle: 1000 attackers, never more than 7 Legion suits
{
  w.command('army', { side: 'both', size: 'legendary', x: 800, y: 500 });
  assert(w.army && w.army.total === 1000, 'legendary army has 1000 units');
  let t = 0, peakE = 0, peakA = 0;
  const k0 = w.counters.kills;
  while ((w.army || w.allies.length) && t < sec(600)) {
    w.setCursor(cur, DT); w.tick(DT); t++;
    peakE = Math.max(peakE, w.enemies.length); peakA = Math.max(peakA, w.allies.length);
  }
  console.log(`legendary: done=${!w.army} in ${(t / 60).toFixed(0)}s, kills=${w.counters.kills - k0}, peak enemies=${peakE}, legion=${peakA}`);
  assert(!w.army, 'the legendary army should be beaten');
  assert(w.counters.kills - k0 >= 1000, 'all 1000 destroyed');
  assert(peakA <= 7, 'at most 7 Legion suits');
  assert(peakE <= 45, 'front line stays manageable');
}

// ---- nuke on screen 1 with two screens: he escapes to screen 2 and gets thrown by the wave
function runNuke(world, gz, label) {
  const hh = world.hero;
  hh.power = 100; hh.armor = 100;
  for (const e of [...world.enemies]) world.kill(e, true);
  const g1 = geo.displays[0];
  for (let i = 0; i < 4; i++) world.spawn(i % 2 ? 'walker' : 'drone', { x: g1.work.x + 200 + i * 250, y: g1.work.y + 300 });
  if (geo.displays[1]) world.spawn('drone', { x: geo.displays[1].work.x + 400, y: 300 });
  for (let i = 0; i < 30; i++) { world.setCursor(cur, DT); world.tick(DT); }
  const onTarget = world.enemies.filter((e) => e.x < g1.bounds.x + g1.bounds.width).length;
  world.command('nuke', gz);
  assert(world.nuke, 'nuke started');
  let thrown = false, escaped = false, t = 0, killsBefore = world.counters.kills;
  while (world.nuke && t < sec(25)) {
    world.setCursor(cur, DT); world.tick(DT); t++;
    if (hh.mode === 'thrown') thrown = true;
    if (!world.nuke || !world.nuke.detonated) { const d = geo.displayAt({ x: hh.x, y: hh.y - 40 }); if (d && d.id !== g1.id) escaped = true; }
    for (const k of ['x', 'y', 'armor']) assert(Number.isFinite(hh[k]), 'NaN ' + k);
    if (hh.mode !== 'held') assert(geo.inAny({ x: hh.x, y: hh.y - 40 }, -5), `${label}: hero off screen ${hh.x.toFixed(0)},${hh.y.toFixed(0)} ${hh.mode}`);
  }
  for (let i = 0; i < sec(10); i++) { world.setCursor(cur, DT); world.tick(DT); }
  const leftOnTarget = world.enemies.filter((e) => e.x < g1.bounds.x + g1.bounds.width).length;
  console.log(`${label}: on-target enemies ${onTarget}→${leftOnTarget}, escaped=${escaped}, thrown=${thrown}, hero ${hh.mode}/${hh.pose} armor=${hh.armor.toFixed(0)}, kills +${world.counters.kills - killsBefore}`);
  assert.strictEqual(leftOnTarget, 0, 'everything on the target screen is destroyed');
  assert(thrown, 'the shockwave throws the hero');
  assert(hh.mode === 'ground' || hh.mode === 'air', 'hero recovers');
  return escaped;
}
assert(runNuke(w, { x: 700, y: 600 }, 'nuke (2 screens)'), 'hero escapes to the other screen');
{
  const geo1 = new Geo();
  geo1.set([geo.displays[0]].map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.work, primary: true })));
  const w1 = new IronWorld({ geo: geo1, data: null, settings, emit: () => {} });
  w1.activate();
  for (let i = 0; i < sec(6); i++) { w1.setCursor(cur, DT); w1.tick(DT); }
  const old = geo; // runNuke reads `geo` for display checks
  global.geoSave = old;
  runNukeSingle(w1, geo1);
}
function runNukeSingle(world, g) {
  const hh = world.hero;
  world.spawn('walker', { x: 900, y: 600 });
  world.command('nuke', { x: 500, y: 600 });
  let thrown = false, t = 0;
  while (world.nuke && t < sec(25)) { world.setCursor(cur, DT); world.tick(DT); t++; if (hh.mode === 'thrown') thrown = true; assert(g.inAny({ x: hh.x, y: hh.y - 40 }, -5), 'off screen (single)'); }
  for (let i = 0; i < sec(10); i++) { world.setCursor(cur, DT); world.tick(DT); }
  console.log(`nuke (1 screen): enemies=${world.enemies.length}, thrown=${thrown}, hero x=${hh.x.toFixed(0)} ${hh.mode}`);
  assert.strictEqual(world.enemies.length, 0);
  assert(thrown);
}

const saved = JSON.parse(JSON.stringify(w.serialize()));
const w2 = new IronWorld({ geo, data: saved, settings, emit: () => {} });
for (let i = 0; i < 60; i++) w2.tick(DT);

const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${k}:${v}`).join(' ');
console.log('\ntasks:', top(tasks));
console.log('poses:', top(poses));
console.log('sounds:', top(sounds));
console.log('fx:', top(fx));
console.log('counters:', w.counters);
console.log('\nOK');
