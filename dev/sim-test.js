// Headless simulation test: node dev/sim-test.js
// Runs the cat's brain for hours of simulated time across two fake monitors,
// fires every menu command, drags/throws the cat, starves it to death and adopts again.
'use strict';
const { Geo } = require('../src/main/geometry');
const { World } = require('../src/main/world');

const geo = new Geo();
geo.set([
  { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 800 }, primary: true },
  { id: 2, bounds: { x: 1440, y: -200, width: 1920, height: 1080 }, workArea: { x: 1440, y: -200, width: 1920, height: 1040 } },
]);

const events = { sound: {}, fx: {}, notify: [] };
const world = new World({
  geo,
  data: null,
  desktopItems: () => [{ name: 'Resume.pdf', kind: 'pdf', ext: 'pdf' }],
  emit: (e) => {
    if (e.type === 'sound') events.sound[e.name] = (events.sound[e.name] || 0) + 1;
    else if (e.type === 'fx') events.fx[e.kind] = (events.fx[e.kind] || 0) + 1;
    else if (e.type === 'notify') events.notify.push(e.title);
  },
});

const tasks = {};
const poses = {};
let cursor = { x: 700, y: 500 };
let simT = 0;
const DT = 1 / 60;

function step(n, moveCursor) {
  for (let i = 0; i < n; i++) {
    simT += DT;
    if (moveCursor) {
      cursor = { x: 700 + Math.sin(simT * 0.7) * 500 + Math.sin(simT * 3.1) * 80, y: 450 + Math.cos(simT * 0.5) * 300 };
    }
    world.setCursor(cursor, DT);
    world.tick(DT);
    const c = world.cat;
    tasks[c.taskName || '-'] = (tasks[c.taskName || '-'] || 0) + 1;
    poses[c.pose] = (poses[c.pose] || 0) + 1;
    if (!geo.inAny(c, -2) && c.mode !== 'held') throw new Error(`cat left the screens at ${c.x},${c.y} (${c.taskName})`);
    for (const k of ['food', 'energy', 'fun', 'clean', 'health', 'love']) if (!Number.isFinite(c[k])) throw new Error('NaN stat ' + k);
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) throw new Error('NaN position in ' + c.taskName);
    JSON.stringify(world.snapshot());
  }
}
const sec = (s) => Math.round(s * 60);

world.settings.timeSpeed = 'fast';
console.log('cat:', world.cat.name, world.cat.eyes);
step(sec(60 * 10), true); // 10 minutes of free life
world.command('feed', { kind: 'chicken', x: 400, y: 400 });
step(sec(30), true);

const cmds = [
  ['feed', { kind: 'fish', x: 600, y: 500 }], ['feed', { kind: 'milk', x: 900, y: 400 }],
  ['bed', { x: 300, y: 600 }], ['wake'], ['toyMouse'], ['laser'], ['stopTool'], ['treat'],
  ['yarn', { x: 500, y: 500 }], ['box', { x: 800, y: 600 }], ['catnip', { x: 1000, y: 500 }], ['post', { x: 1200, y: 600 }],
  ['call', { x: 2000, y: 300 }], ['quiet'], ['quiet'], ['brush'], ['scoop'], ['repair'], ['fixAll'], ['tidyFiles'], ['cleanAll'], ['putAwayToys'],
  ['rename', { name: 'Testy' }],
];
for (const [name, args] of cmds) {
  world.command(name, args || {});
  step(sec(20), true);
}

// drag & throw the cat
const c = world.cat;
cursor = { x: c.x, y: c.y - 20 };
world.setCursor(cursor, DT);
world.pointerDown(cursor, 0);
for (let i = 0; i < 60; i++) { cursor = { x: cursor.x + (i % 10 < 5 ? 40 : -40), y: cursor.y - 2 }; step(1, false); }
world.pointerUp(cursor, 0);
step(sec(10), false);
console.log('after throw:', world.cat.taskName, world.cat.pose, 'mode', world.cat.mode);

// a click (boop) storm
for (let i = 0; i < 6; i++) { const p = { x: world.cat.x, y: world.cat.y - 20 }; world.setCursor(p, DT); world.pointerDown(p, 0); world.pointerUp(p, 0); step(5, false); }
step(sec(5), false);

// let mischief happen
world.settings.mischief = 'high';
step(sec(60 * 20), true);
console.log('entities:', Object.fromEntries(Object.entries(world.ents).map(([k, v]) => [k, Array.isArray(v) ? v.length : v ? 1 : 0])));

// a weak cat must still be saveable by feeding
world.settings.timeSpeed = 'turbo';
while (world.cat.health > 25 && !world.cat.dead) { world.ents.bowls = []; step(1, true); }
console.log('weak cat: health', world.cat.health.toFixed(1), 'task', world.cat.taskName);
world.command('feed', { kind: 'fish', x: 3000, y: 100 });
for (let i = 0; i < 20; i++) { step(sec(1), true); if (process.env.DBG) console.log(i, world.cat.taskName, world.cat.pose, world.cat.mode, 'pos', world.cat.x.toFixed(0), world.cat.y.toFixed(0), 'bowls', world.ents.bowls.map((b) => `${b.x.toFixed(0)},${b.y.toFixed(0)}:${b.amount.toFixed(2)}`).join(' '), 'tool', world.tool && world.tool.kind); }
console.log('after feeding weak cat: food', world.cat.food.toFixed(1), 'health', world.cat.health.toFixed(1), 'dead', world.cat.dead, 'meals', world.counters.meals);

// starve to death
world.ents.bowls = [];
let guard = 0;
while (!world.cat.dead && guard++ < 60 * 60 * 60 * 3) { world.ents.bowls = []; step(1, true); }
console.log('dead:', world.cat.dead, 'after sim minutes', (simT / 60).toFixed(1), 'grave:', !!world.ents.grave);
world.command('flowers');
world.command('adopt');
step(sec(30), true);
console.log('new cat:', world.cat.name, 'task', world.cat.taskName);

// save / load roundtrip
const saved = JSON.parse(JSON.stringify(world.serialize()));
const w2 = new World({ geo, data: saved, emit: () => {} });
w2.setCursor(cursor, DT);
for (let i = 0; i < 600; i++) w2.tick(DT);
console.log('reloaded cat:', w2.cat.name, 'food', w2.cat.food.toFixed(1));

const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
console.log('\ntasks:', top(tasks));
console.log('\nposes:', top(poses));
console.log('\nsounds:', top(events.sound));
console.log('\nfx:', top(events.fx));
console.log('\nnotifications:', events.notify);
console.log('\ncounters:', world.counters);
console.log('\nOK');
