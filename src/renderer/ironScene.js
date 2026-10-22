/*
 * Desktop Buddies — overlay renderer for the armored hero.
 * Created by overlay.js with shared helpers (sprites, particles, bounds).
 */
(function (root) {
  'use strict';
  const { clamp, lerp, smooth } = CatArt.util;
  const A = IronArt;

  function create(env) {
    const { Sprite, inB, spawn } = env;
    const heroSprite = new Sprite();
    const shadowSprite = new Sprite();
    const enemySprites = new Map();
    const R = { rig: null, key: '', from: null, blendStart: 0, blendDur: 0.2, hoverSince: 0, trailAt: 0, pts: null };
    let last = null;

    function interpHero(now) {
      const snaps = env.snaps(), s = env.latest();
      const h = s.hero;
      if (h.mode === 'held') return { x: h.x, y: h.y, dist: h.dist };
      const rt = now - 40;
      for (let i = snaps.length - 1; i > 0; i--) {
        const a = snaps[i - 1], b = snaps[i];
        if (!a.hero || !b.hero) break;
        if (a.t <= rt) {
          if (Math.hypot(b.hero.x - a.hero.x, b.hero.y - a.hero.y) > 300) break;
          const k = clamp((rt - a.t) / Math.max(1, b.t - a.t), 0, 1.25);
          return { x: lerp(a.hero.x, b.hero.x, k), y: lerp(a.hero.y, b.hero.y, k), dist: lerp(a.hero.dist, b.hero.dist, k) };
        }
      }
      return { x: h.x, y: h.y, dist: h.dist };
    }

    function buildRig(h, now, T, S, gx, gy) {
      const name = h.mode === 'held' ? 'held' : h.mode === 'down' ? 'down' : h.pose;
      let aim = null;
      if (h.aim) {
        const sh = { x: gx + h.facing * -10.5 * S, y: gy - 74 * S };
        const dx = (h.aim.x - sh.x) * h.facing, dy = h.aim.y - sh.y, d = Math.hypot(dx, dy) || 1;
        aim = { x: dx / d, y: dy / d };
      }
      const sp = Math.hypot(h.vx, h.vy) || 1;
      const c = {
        t: (now - h.poseStart) / 1000, T, phase: (h.dist / (30 * S)) * Math.PI * 2, aim,
        m: { air: h.mode === 'air', charge: h.charge, beam: h.beam, lean: clamp(h.vx * h.facing / (400 * S), -1, 1), climb: clamp(-h.vy / sp, -1, 1), swing: h.swing, eyes: h.eyes, reactor: h.mode === 'down' ? 0.15 : undefined },
      };
      const live = A.makeRig(name, c);
      live.eyes = name === 'down' || name === 'powerDown' ? live.eyes : h.eyes;
      if (name !== R.key) {
        R.from = R.rig || live; R.blendStart = now; R.key = name;
        R.blendDur = name === 'land' || name === 'held' ? 0.12 : name === 'fly' ? 0.28 : 0.2;
      }
      const k = smooth(clamp((now - R.blendStart) / (R.blendDur * 1000), 0, 1));
      const rig = k >= 1 ? live : A.lerpRig(R.from, live, k);
      R.rig = rig;
      return { rig, name };
    }

    function renderHero(s, now, T, dt) {
      const h = s.hero, S = s.s;
      const hp = interpHero(now);
      const gx = hp.x, gy = hp.y;
      const here = inB({ x: gx, y: gy - 50 * S }, 40);
      CatSound.setLoop('thrust', here && (h.mode === 'air' || h.mode === 'held') ? (h.mode === 'held' ? 0.15 : 0.35 + Math.min(0.65, h.speed / (700 * S))) : 0);
      // floor shadow
      const ground = h.ground == null ? gy : h.ground;
      const height = Math.max(0, ground - gy);
      shadowSprite.size(120 * S, 20 * S, 60 * S, 10 * S);
      if (height < 420 * S && h.mode !== 'held' && shadowSprite.place(gx, ground, Math.round(ground) - 5)) {
        const c = shadowSprite.begin();
        const k = 1 - height / (420 * S);
        c.fillStyle = `rgba(0,0,0,${0.18 * k})`;
        c.beginPath(); c.ellipse(0, 0, (h.pose === 'down' ? 46 : 22) * S * (0.5 + 0.5 * k), 4.5 * S * (0.5 + 0.5 * k), 0, 0, Math.PI * 2); c.fill();
      } else shadowSprite.hide();

      heroSprite.size(300 * S, 300 * S, 150 * S, 190 * S);
      const visible = heroSprite.place(gx, gy, Math.round(gy) + 10);
      if (!visible) { R.rig = null; R.key = ''; R.pts = null; return; }
      const { rig, name } = buildRig(h, now, T, S, gx, gy);
      const ctx = heroSprite.begin();
      ctx.save();
      ctx.scale(S * h.facing, S);
      A.drawHero(ctx, rig, { suit: s.suit, T });
      ctx.restore();
      // hit flash
      if (now - h.hitAt < 130) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(0, 0, heroSprite.c.width, heroSprite.c.height);
        ctx.restore();
      }
      // effect anchor points in global coords (beams start from the real palm / reactor)
      const P = A.points(rig);
      const toG = (p) => ({ x: gx + p.x * S * h.facing, y: gy + p.y * S });
      R.pts = { reactor: toG(P.reactor), palms: P.palms.map(toG), head: toG(P.head), at: now };
      // thruster trail
      if (h.mode === 'air' && h.speed > 160 * S && now - R.trailAt > 40) {
        R.trailAt = now;
        const fp = toG({ x: rig.legs[0].foot.x, y: rig.legs[0].foot.y });
        spawn({ kind: 'thrust', x: fp.x - h.vx * 0.02, y: fp.y - h.vy * 0.02, n: 1, color: '120,220,255' });
      }
      // HUD callouts + status card
      ctx.save();
      ctx.scale(S, S);
      const top = (P.head.y - 20);
      const hud = s.hud || [];
      hud.forEach((x, i) => {
        const age = (Date.now() - x.start) / 1000;
        const a = clamp(Math.min(age / 0.15, (2.6 - age) / 0.4), 0, 1);
        A.hudText(ctx, x.text, h.facing * P.head.x, top - (hud.length - 1 - i) * 17, a, x.tone === 'warn' ? '#ffb347' : null);
      });
      const over = hoverHero(s, gx, gy, S, h);
      if (over && !hud.length) statusCard(ctx, h, h.facing * P.head.x, top + 4);
      ctx.restore();
    }

    function hoverHero(s, gx, gy, S, h) {
      const c = s.cursor;
      const inside = Math.abs(c.x - gx) < (h.pose === 'fly' ? 50 : 20) * S && c.y < gy + 4 * S && c.y > gy - 100 * S && h.mode !== 'held';
      if (!inside) { R.hoverSince = 0; return false; }
      if (!R.hoverSince) R.hoverSince = Date.now();
      return Date.now() - R.hoverSince > 400;
    }

    function statusCard(ctx, h, x, bottom) {
      const w = 92, hh = 50;
      ctx.save();
      ctx.translate(x - w / 2, bottom - hh);
      ctx.fillStyle = 'rgba(6,18,30,0.82)';
      ctx.fillRect(0, 0, w, hh);
      ctx.strokeStyle = 'rgba(110,225,255,0.9)'; ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, hh - 1);
      ctx.font = '600 8px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#8ff0ff';
      ctx.fillText('MK-XLII · ' + h.status.toUpperCase().slice(0, 18), 6, 8);
      const rows = [['PWR', h.power, '#4fd8ff'], ['ARM', h.armor, '#ffd166'], ['MSL', (h.missiles / 12) * 100, '#ff7a6b']];
      rows.forEach(([l, v, col], i) => {
        const y = 19 + i * 10;
        ctx.fillStyle = 'rgba(143,240,255,0.8)'; ctx.fillText(l, 6, y);
        ctx.fillStyle = 'rgba(143,240,255,0.15)'; ctx.fillRect(26, y - 2.5, w - 34, 5);
        ctx.fillStyle = v < 20 ? '#ff4d5e' : col; ctx.fillRect(26, y - 2.5, (w - 34) * clamp(v / 100, 0, 1), 5);
      });
      ctx.restore();
    }

    const ENEMY_BOX = {
      drone: { w: 60, h: 50, ax: 30, ay: 28 },
      mini: { w: 30, h: 30, ax: 15, ay: 15 },
      walker: { w: 70, h: 60, ax: 35, ay: 50 },
      tank: { w: 90, h: 50, ax: 45, ay: 42 },
      boss: { w: 180, h: 240, ax: 90, ay: 228 },
    };

    function renderEnemies(s, now, T) {
      const S = s.s;
      const seen = new Set();
      const ageOf = (e) => (now - e.born) / 1000;
      for (const e of s.enemies) {
        seen.add(e.id);
        const box = ENEMY_BOX[e.kind];
        let sp = enemySprites.get(e.id);
        if (!sp) { sp = new Sprite(); enemySprites.set(e.id, sp); }
        sp.size(box.w * S, box.h * S, box.ax * S, box.ay * S);
        // extrapolate a little (enemies move every tick)
        const k = clamp((Date.now() - s.t) / 1000, 0, 0.05);
        const x = e.x + e.vx * k, y = e.y + (e.air ? e.vy * k : 0);
        if (!sp.place(x, y, Math.round(y) + (e.air ? 2000 : 0))) continue;
        const ctx = sp.begin();
        ctx.save();
        ctx.scale(S, S);
        const grow = clamp(ageOf(e) / 0.35, 0, 1);
        if (grow < 1) { ctx.scale(0.4 + 0.6 * grow, 0.4 + 0.6 * grow); ctx.globalAlpha = grow; }
        A.drawEnemy(ctx, e, T);
        ctx.restore();
        if (now - e.hitAt < 110) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.fillRect(0, 0, sp.c.width, sp.c.height);
          ctx.restore();
        }
        if (s.lockId === e.id) {
          ctx.save(); ctx.scale(S, S);
          const cy = e.kind === 'boss' ? -62 : e.kind === 'walker' ? -24 : e.kind === 'tank' ? -13 : 0;
          A.reticle(ctx, 0, cy, (e.kind === 'boss' ? 56 : e.kind === 'mini' ? 12 : 22), T);
          ctx.restore();
        }
      }
      for (const [id, sp] of enemySprites) if (!seen.has(id)) { sp.destroy(); enemySprites.delete(id); }
    }

    // ---------------------------------------------------------------- fx layer (beams, projectiles)
    function fxBusy(s) {
      if (s.beams && s.beams.length) return true;
      return !!(s.shots && s.shots.some((p) => inB(p, 80)));
    }

    function drawFx(ctx, s, now, T) {
      const S = s.s;
      const k = clamp((Date.now() - s.t) / 1000, 0, 0.06);
      for (const p of s.shots || []) {
        const x = p.x + p.vx * k, y = p.y + p.vy * k;
        if (!inB({ x, y }, 40)) continue;
        if (p.kind === 'laser') A.drawLaser(ctx, x, y, p.vx, p.vy);
        else if (p.kind === 'shell') A.drawShell(ctx, x, y, T);
        else A.drawMissile(ctx, x, y, Math.atan2(p.vy, p.vx), T, p.kind === 'emissile');
        if ((p.kind === 'missile' || p.kind === 'emissile') && Math.random() < 0.35) spawn({ kind: 'smoke', x: x - p.vx * 0.015, y: y - p.vy * 0.015, n: 1, small: true });
      }
      for (const b of s.beams || []) {
        let x1 = b.x1, y1 = b.y1;
        if (b.owner === 'hero' && R.pts && now - R.pts.at < 200) {
          const st = b.kind === 'unibeam' ? R.pts.reactor : R.pts.palms[0];
          x1 = st.x; y1 = st.y;
        }
        const age = (Date.now() - b.start) / 1000;
        const life = clamp(1 - age / b.dur, 0, 1);
        const halo = b.owner === 'enemy' ? '255,40,60' : '120,225,255';
        const core = b.owner === 'enemy' ? 'rgba(255,220,220,0.95)' : null;
        if (b.kind === 'blast') {
          ctx.save();
          ctx.globalAlpha = life;
          A.drawBeam(ctx, x1, y1, b.x2, b.y2, b.w * S * (0.6 + 0.6 * (1 - life)), age, halo, core);
          ctx.restore();
        } else {
          ctx.save();
          ctx.globalAlpha = b.kind === 'repulsor' ? Math.min(1, life * 1.8) : Math.min(1, life * 4, age * 8);
          A.drawBeam(ctx, x1, y1, b.x2, b.y2, b.w * S, age, halo, core);
          ctx.restore();
        }
      }
    }

    // ---------------------------------------------------------------- fx events from the simulation
    function expandFx(e, S) {
      const r = () => Math.random();
      switch (e.kind) {
        case 'explosion': {
          const z = (e.size || 1) * S;
          spawn({ kind: 'flash', x: e.x, y: e.y, n: 1, size: 1.4 * z, life: 0.35, color: '255,200,120' });
          spawn({ kind: 'fire', x: e.x, y: e.y, n: Math.round(5 + 4 * (e.size || 1)), spread: 14 * z, size: z, life: 0.7 });
          spawn({ kind: 'smoke', x: e.x, y: e.y, n: Math.round(4 + 3 * (e.size || 1)), spread: 18 * z, size: z, life: 1.6, rise: 30 });
          spawn({ kind: 'debris', x: e.x, y: e.y, n: Math.round(6 + 6 * (e.size || 1)), speed: 220 * z, size: z, life: 1.1, g: 600 });
          spawn({ kind: 'ring', x: e.x, y: e.y, n: 1, size: z, life: 0.5 });
          return true;
        }
        case 'impact':
          spawn({ kind: 'flash', x: e.x, y: e.y, n: 1, size: 0.8 * S, life: 0.25 });
          spawn({ kind: 'spark', x: e.x, y: e.y, n: 6, speed: 160 * S, size: S, life: 0.35, color: '160,235,255' });
          return true;
        case 'spark':
        case 'hitspark':
          spawn({ kind: 'spark', x: e.x, y: e.y, n: e.kind === 'hitspark' ? 9 : 5, speed: 180 * S, size: S, life: 0.4 });
          if (e.kind === 'hitspark') spawn({ kind: 'flash', x: e.x, y: e.y, n: 1, size: 0.7 * S, life: 0.2, color: '255,200,120' });
          return true;
        case 'flash':
          spawn({ kind: 'flash', x: e.x, y: e.y, n: 1, size: (e.size || 1) * S, life: 0.35, color: e.color });
          return true;
        case 'shockwave': {
          const z = (e.size || 1) * S;
          spawn({ kind: 'ring', x: e.x, y: e.y, n: 1, size: 1.4 * z, life: 0.55, flat: 0.25 });
          spawn({ kind: 'dust', x: e.x, y: e.y - 2, n: 10, spread: 30 * z, size: z, life: 0.7 });
          return true;
        }
        case 'portal':
          spawn({ kind: 'portal', x: e.x, y: e.y, n: 1, size: S, life: 0.6 });
          return true;
        case 'scan':
          spawn({ kind: 'ring', x: e.x, y: e.y, n: 3, size: 3 * S, life: 1.6, color: '110,225,255', stagger: 0.35 });
          return true;
        case 'repair':
          spawn({ kind: 'sparkle', x: e.x, y: e.y, n: 12, spread: 30 * S, color: '#8ff0ff' });
          return true;
        default:
          void r;
          return false;
      }
    }

    function busyHere(s) {
      const S = s.s, h = s.hero;
      if (inB({ x: h.x, y: h.y - 50 * S }, 200 * S)) return true;
      if (s.enemies.some((e) => inB(e, 120 * S))) return true;
      return fxBusy(s) || !!s.announce || !!s.diag;
    }

    function wantFps(s) {
      const h = s.hero;
      if (s.enemies.length || (s.shots && s.shots.length) || (s.beams && s.beams.length) || h.mode !== 'ground' || s.hud.length) return 60;
      if (h.speed > 1 || (h.pose !== 'stand' && h.pose !== 'powerDown')) return 40;
      return 12;
    }

    function render(s, now, T, dt) {
      last = s;
      renderEnemies(s, now, T);
      renderHero(s, now, T, dt);
    }

    function heroAnchor(s) {
      const h = s.hero, S = s.s;
      return { x: h.x, y: h.y - 108 * S, pts: R.pts };
    }

    function dispose() {
      heroSprite.hide(); shadowSprite.hide();
      for (const sp of enemySprites.values()) sp.destroy();
      enemySprites.clear();
      R.rig = null; R.key = '';
      CatSound.setLoop('thrust', 0);
    }

    return { render, drawFx, fxBusy, expandFx, busyHere, wantFps, dispose, heroAnchor };
  }

  root.IronScene = { create };
})(typeof window !== 'undefined' ? window : globalThis);
