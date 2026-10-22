// node dev/geo-test.js — the cat must be able to walk across monitor borders
'use strict';
const assert = require('assert');
const { Geo } = require('../src/main/geometry');
const { World } = require('../src/main/world');

const layouts = {
  'side by side (like a laptop + external)': [
    { id: 1, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 33, width: 1728, height: 1026 }, primary: true },
    { id: 2, bounds: { x: 1728, y: 0, width: 1440, height: 900 }, workArea: { x: 1728, y: 30, width: 1440, height: 870 } },
  ],
  'external on the left, offset': [
    { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 800 }, primary: true },
    { id: 2, bounds: { x: -1920, y: -300, width: 1920, height: 1080 }, workArea: { x: -1920, y: -300, width: 1920, height: 1040 } },
  ],
  'stacked vertically': [
    { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 800 }, primary: true },
    { id: 2, bounds: { x: 100, y: -1080, width: 1920, height: 1080 }, workArea: { x: 100, y: -1080, width: 1920, height: 1040 } },
  ],
};

const DT = 1 / 60;
for (const [name, ds] of Object.entries(layouts)) {
  const geo = new Geo();
  geo.set(ds);
  const w = new World({ geo, data: null, emit: () => {} });
  w.setCursor({ x: 10, y: 10 }, DT);
  const c = w.cat;
  for (const d2 of geo.displays) {
    for (const d1 of geo.displays) {
      if (d1 === d2) continue;
      for (let trial = 0; trial < (+process.env.TRIALS || 20); trial++) {
        const from = geo.randomIn(d1, 80), to = geo.randomIn(d2, 80);
        c.x = from.x; c.y = from.y;
        c.run(c.walkTo(to, { speed: 'run', timeout: 60 }), 'test', 99);
        let ok = false;
        for (let i = 0; i < 60 * 60; i++) {
          c.tick(DT);
          if (Math.hypot(c.x - to.x, c.y - to.y) <= 3) { ok = true; break; }
          if (!c.task) break;
        }
        assert(ok, `${name}: stuck at ${c.x.toFixed(0)},${c.y.toFixed(0)} going ${from.x.toFixed(0)},${from.y.toFixed(0)} -> ${to.x.toFixed(0)},${to.y.toFixed(0)}`);
      }
    }
  }
  // standing right on the border is allowed (no snapping back)
  const edge = ds[1].bounds.x === ds[0].bounds.x + ds[0].bounds.width ? { x: ds[1].bounds.x - 1, y: 400 } : null;
  if (edge) { const q = geo.clampBounds(edge, 4); assert(q.x === edge.x, `${name}: border point was moved`); }
  console.log('ok -', name);
}
console.log('all crossings fine');
