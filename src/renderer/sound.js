/*
 * Desktop Cat — synthesized sounds (Web Audio, no audio files).
 * Meows use a sawtooth "voice" through formant filters with a pitch contour.
 */
(function (root) {
  'use strict';
  let ac = null, master = null, noiseBuf = null;
  let volume = 0.55, enabled = true;
  let purr = null;

  function ctx() {
    if (!ac) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = volume;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp);
      comp.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }

  function noise() {
    const c = ctx();
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const n = c.createBufferSource();
    n.buffer = noiseBuf;
    n.loop = true;
    return n;
  }

  function gain(v) { const g = ctx().createGain(); g.gain.value = v; return g; }
  function filt(type, f, q) { const b = ctx().createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }

  function envelope(g, t, a, hold, r, peak) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
  }

  function curve(param, t, pts) {
    // pts: [[time offset, value], ...]
    param.cancelScheduledValues(t);
    param.setValueAtTime(pts[0][1], t + pts[0][0]);
    for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(pts[i][1], t + pts[i][0]);
  }

  // ---------------------------------------------------------------- voices
  const MEOWS = {
    short: { dur: 0.42, pitch: [[0, 470], [0.12, 720], [0.42, 430]], f1: [[0, 650], [0.12, 1250], [0.42, 820]], f2: [[0, 1800], [0.12, 2600], [0.42, 1500]] },
    long: { dur: 0.95, pitch: [[0, 440], [0.2, 760], [0.55, 700], [0.95, 400]], f1: [[0, 620], [0.2, 1300], [0.6, 1100], [0.95, 780]], f2: [[0, 1700], [0.2, 2700], [0.6, 2300], [0.95, 1400]] },
    question: { dur: 0.5, pitch: [[0, 430], [0.2, 520], [0.5, 860]], f1: [[0, 650], [0.25, 900], [0.5, 1350]], f2: [[0, 1700], [0.25, 2100], [0.5, 2800]] },
    sad: { dur: 0.9, pitch: [[0, 620], [0.3, 560], [0.9, 360]], f1: [[0, 1100], [0.3, 1000], [0.9, 700]], f2: [[0, 2400], [0.3, 2100], [0.9, 1300]] },
    happy: { dur: 0.32, pitch: [[0, 560], [0.1, 820], [0.32, 700]], f1: [[0, 800], [0.1, 1350], [0.32, 1100]], f2: [[0, 2000], [0.1, 2800], [0.32, 2400]] },
    yawn: { dur: 1.2, pitch: [[0, 380], [0.4, 330], [1.2, 230]], f1: [[0, 900], [0.4, 800], [1.2, 500]], f2: [[0, 1500], [0.4, 1300], [1.2, 900]], amp: 0.45, breath: 0.6 },
  };

  function meow(kind, pitchMul) {
    const c = ctx(); if (!c) return;
    const m = MEOWS[kind] || MEOWS.short;
    const t = c.currentTime + 0.01;
    const pm = (pitchMul || 1) * (0.94 + Math.random() * 0.12);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    curve(o.frequency, t, m.pitch.map(([a, v]) => [a, v * pm]));
    const vib = c.createOscillator(); vib.frequency.value = 5.5 + Math.random() * 2;
    const vibG = gain(10 * pm); vib.connect(vibG); vibG.connect(o.frequency);
    const lp = filt('lowpass', 500, 0.7);
    curve(lp.frequency, t, [[0, 500], [0.07, 3800], [m.dur, 2400]]);
    const f1 = filt('bandpass', 800, 5), f2 = filt('bandpass', 2000, 7);
    curve(f1.frequency, t, m.f1);
    curve(f2.frequency, t, m.f2);
    const g1 = gain(1.0), g2 = gain(0.55);
    const amp = gain(0);
    o.connect(lp); lp.connect(f1); lp.connect(f2);
    f1.connect(g1); f2.connect(g2); g1.connect(amp); g2.connect(amp);
    // breath
    const n = noise(); const nf = filt('bandpass', 1500, 1.2); const ng = gain((m.breath || 0.12));
    n.connect(nf); nf.connect(ng); ng.connect(amp);
    amp.connect(master);
    const peak = (m.amp || 0.6);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.05);
    amp.gain.linearRampToValueAtTime(peak * 0.85, t + m.dur * 0.7);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + m.dur);
    o.start(t); vib.start(t); n.start(t);
    const end = t + m.dur + 0.05;
    o.stop(end); vib.stop(end); n.stop(end);
  }

  function blip(type, f0, f1, dur, vol, at) {
    const c = ctx(); if (!c) return;
    const t = c.currentTime + (at || 0) + 0.005;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = gain(0);
    envelope(g, t, 0.005, dur * 0.3, dur * 0.7, vol);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function hiss(type, f, q, dur, vol, at, sweepTo) {
    const c = ctx(); if (!c) return;
    const t = c.currentTime + (at || 0) + 0.005;
    const n = noise();
    const b = filt(type, f, q);
    if (sweepTo) { b.frequency.setValueAtTime(f, t); b.frequency.exponentialRampToValueAtTime(sweepTo, t + dur); }
    const g = gain(0);
    envelope(g, t, Math.min(0.02, dur * 0.2), dur * 0.3, dur * 0.6, vol);
    n.connect(b); b.connect(g); g.connect(master);
    n.start(t, Math.random()); n.stop(t + dur + 0.05);
  }

  const SFX = {
    'meow-short': () => meow('short'),
    'meow-long': () => meow('long'),
    'meow-question': () => meow('question'),
    'meow-sad': () => meow('sad', 0.95),
    'meow-happy': () => meow('happy'),
    yawn: () => meow('yawn'),
    crunch: () => { for (let i = 0; i < 3; i++) hiss('bandpass', 2600 + Math.random() * 1500, 2.5, 0.045, 0.35, i * (0.07 + Math.random() * 0.05)); },
    lap: () => { for (let i = 0; i < 3; i++) { blip('sine', 1300, 500, 0.035, 0.18, i * 0.11); hiss('highpass', 3000, 0.7, 0.02, 0.08, i * 0.11); } },
    nom: () => { blip('sine', 320, 260, 0.12, 0.25, 0); blip('sine', 300, 240, 0.12, 0.22, 0.16); hiss('bandpass', 2800, 2, 0.04, 0.2, 0.05); },
    squeak: () => { blip('sine', 1800, 2700, 0.09, 0.22, 0); blip('sine', 2000, 2900, 0.08, 0.18, 0.12); },
    plop: () => { blip('sine', 200, 55, 0.18, 0.5, 0); hiss('lowpass', 400, 0.7, 0.08, 0.25, 0.01); },
    dig: () => { for (let i = 0; i < 4; i++) hiss('bandpass', 1400 + Math.random() * 600, 1.5, 0.06, 0.18, i * 0.16); },
    scratch: () => hiss('bandpass', 3200, 3, 0.13, 0.3, 0, 1400),
    pop: () => blip('sine', 500, 1300, 0.07, 0.3),
    thud: () => { blip('sine', 140, 45, 0.14, 0.5); hiss('lowpass', 300, 0.7, 0.06, 0.2); },
    hiss: () => hiss('highpass', 2600, 0.6, 0.6, 0.35, 0, 5000),
    chirp: () => { for (let i = 0; i < 4; i++) blip('triangle', 1500, 1100, 0.05, 0.12, i * 0.085); },
    swat: () => hiss('bandpass', 700, 1.2, 0.12, 0.22, 0, 2200),
    pounce: () => hiss('bandpass', 500, 1, 0.16, 0.18, 0, 1600),
    whoosh: () => hiss('bandpass', 300, 1.2, 0.45, 0.25, 0, 2400),
    spray: () => { hiss('highpass', 4200, 0.7, 0.3, 0.25); SFX.sparkle(); },
    scoop: () => { hiss('bandpass', 900, 1, 0.12, 0.2); SFX.sparkle(); },
    sparkle: () => { [1568, 2093, 2637].forEach((f, i) => blip('sine', f, f * 0.98, 0.12, 0.1, 0.06 + i * 0.06)); },
    bowl: () => { blip('sine', 2300, 2250, 0.35, 0.12); blip('sine', 3450, 3400, 0.25, 0.06); hiss('bandpass', 3000, 2, 0.15, 0.12, 0.05); },
    sniff: () => { for (let i = 0; i < 3; i++) hiss('highpass', 2000, 0.8, 0.05, 0.12, i * 0.12); },
    sad: () => { [659, 523, 440, 330].forEach((f, i) => blip('sine', f, f * 0.99, 0.45, 0.14, i * 0.42)); },
    adopt: () => { [523, 659, 784, 1046].forEach((f, i) => blip('sine', f, f, 0.18, 0.12, i * 0.1)); },

    // ---- armored hero
    repulsor: () => { blip('sine', 900, 2600, 0.07, 0.12); hiss('bandpass', 1800, 0.9, 0.22, 0.32, 0.05, 700); blip('sine', 320, 70, 0.18, 0.3, 0.05); },
    charge: () => { blip('sawtooth', 260, 1500, 0.42, 0.08); blip('sine', 520, 3000, 0.42, 0.06); },
    chargeLong: () => { blip('sawtooth', 160, 1200, 0.7, 0.09); blip('sine', 320, 2400, 0.7, 0.07); },
    blast: () => { hiss('lowpass', 1100, 0.8, 0.55, 0.55); blip('sine', 140, 38, 0.45, 0.5); hiss('highpass', 3000, 0.7, 0.2, 0.2); },
    missile: () => { hiss('bandpass', 600, 1.1, 0.38, 0.22, 0, 2600); blip('square', 220, 120, 0.05, 0.05); },
    boom: () => { hiss('lowpass', 700, 0.8, 0.6, 0.5); blip('sine', 95, 30, 0.5, 0.5); },
    boomBig: () => { hiss('lowpass', 520, 0.8, 1.2, 0.6); blip('sine', 70, 22, 1.0, 0.6); for (let i = 0; i < 4; i++) hiss('bandpass', 1500, 1, 0.08, 0.15, 0.15 + i * 0.12); },
    unibeam: () => {
      const c = ctx(); if (!c) return;
      const t = c.currentTime + 0.01;
      const out = gain(0);
      out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.3, t + 0.08);
      out.gain.setValueAtTime(0.3, t + 1.0); out.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
      const f = filt('bandpass', 900, 1.5);
      f.frequency.setValueAtTime(600, t); f.frequency.linearRampToValueAtTime(1800, t + 1.1);
      for (const fr of [180, 271, 362]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + 1.3); }
      const n = noise(); const ng = gain(0.5); n.connect(ng); ng.connect(f); n.start(t); n.stop(t + 1.3);
      f.connect(out); out.connect(master);
    },
    laser: () => blip('square', 1500, 260, 0.14, 0.07),
    shellFire: () => { blip('sine', 150, 50, 0.2, 0.35); hiss('lowpass', 900, 0.7, 0.15, 0.25); },
    clank: () => { hiss('bandpass', 2600, 7, 0.06, 0.09); blip('triangle', 640, 300, 0.06, 0.05); blip('sine', 120, 60, 0.07, 0.12); },
    landing: () => { blip('sine', 110, 32, 0.4, 0.55); hiss('lowpass', 600, 0.8, 0.35, 0.4); hiss('bandpass', 2400, 6, 0.12, 0.12, 0.02); },
    thrustOn: () => hiss('bandpass', 500, 0.8, 0.5, 0.25, 0, 1800),
    alert: () => { blip('square', 880, 880, 0.12, 0.06); blip('square', 660, 660, 0.12, 0.06, 0.16); blip('square', 880, 880, 0.12, 0.06, 0.32); },
    hudBeep: () => { blip('sine', 1500, 1500, 0.05, 0.08); blip('sine', 2100, 2100, 0.06, 0.07, 0.07); },
    lock: () => { [1200, 1500, 1900].forEach((f, i) => blip('sine', f, f, 0.05, 0.08, i * 0.06)); },
    hit: () => { blip('sine', 1900, 1500, 0.22, 0.12); hiss('highpass', 3000, 0.7, 0.05, 0.2); },
    reboot: () => { blip('sine', 200, 1300, 0.6, 0.12); [1300, 1700].forEach((f, i) => blip('sine', f, f, 0.07, 0.08, 0.65 + i * 0.1)); },
    powerDown: () => blip('sawtooth', 1200, 80, 0.9, 0.1),
    spawn: () => { blip('sine', 900, 200, 0.3, 0.1); hiss('bandpass', 1200, 2, 0.25, 0.1); },
    bossSpawn: () => { blip('sawtooth', 90, 70, 1.1, 0.18); blip('sawtooth', 135, 100, 1.1, 0.12); },
    reminder: () => { [988, 1319, 1568].forEach((f, i) => blip('sine', f, f, 0.18, 0.12, i * 0.13)); },

    // ---- nuke & army
    siren: () => {
      // classic air-raid wail: two slow rise-and-fall cycles
      const c = ctx(); if (!c) return;
      const t = c.currentTime + 0.02, dur = 5.0;
      const out = gain(0);
      out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.22, t + 0.6);
      out.gain.setValueAtTime(0.22, t + dur - 0.6); out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const lp = filt('lowpass', 2200, 0.8);
      lp.connect(out); out.connect(master);
      const curvePts = [[0, 180], [1.3, 760], [1.9, 760], [2.6, 330], [3.6, 780], [4.2, 760], [5.0, 260]];
      for (const [type, mul, vol] of [['sawtooth', 1, 0.5], ['square', 1.005, 0.25], ['sine', 2, 0.25]]) {
        const o = c.createOscillator(); o.type = type;
        curve(o.frequency, t, curvePts.map(([a, v]) => [a, v * mul]));
        const g = gain(vol); o.connect(g); g.connect(lp);
        o.start(t); o.stop(t + dur + 0.1);
      }
    },
    bombWhistle: () => {
      const c = ctx(); if (!c) return;
      const t = c.currentTime + 0.01, dur = 1.9;
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(2600, t); o.frequency.exponentialRampToValueAtTime(420, t + dur);
      const vib = c.createOscillator(); vib.frequency.value = 9; const vg = gain(25); vib.connect(vg); vg.connect(o.frequency);
      const g = gain(0);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
    },
    nukeBoom: () => {
      hiss('highpass', 900, 0.7, 0.3, 0.7);                       // the crack
      hiss('lowpass', 180, 0.7, 4.6, 0.95);                       // the boom
      blip('sine', 52, 20, 3.4, 0.85);                            // sub-bass punch
      hiss('lowpass', 90, 0.6, 7, 0.6, 0.4);                       // long rumble
      for (let i = 0; i < 9; i++) hiss('bandpass', 700 + Math.random() * 900, 1.2, 0.12, 0.18, 0.8 + i * 0.4 + Math.random() * 0.3); // crackles
    },
    shockHit: () => { hiss('bandpass', 220, 0.8, 0.5, 0.45, 0, 1600); blip('sine', 90, 35, 0.4, 0.5); },
    warHorn: () => {
      const c = ctx(); if (!c) return;
      const t = c.currentTime + 0.02, dur = 2.2;
      const out = gain(0);
      out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.28, t + 0.35);
      out.gain.setValueAtTime(0.28, t + dur - 0.5); out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const lp = filt('lowpass', 950, 1.2);
      lp.connect(out); out.connect(master);
      for (const f of [110, 165, 220]) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * 0.94, t); o.frequency.linearRampToValueAtTime(f, t + 0.3);
        const vib = c.createOscillator(); vib.frequency.value = 5; const vg = gain(f * 0.01); vib.connect(vg); vg.connect(o.frequency);
        o.connect(lp); o.start(t); vib.start(t); o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
      }
    },
  };

  // looping engine sounds (thrusters): level 0..1
  const loops = {};
  function setLoop(name, level) {
    if (!enabled) level = 0;
    const c = level > 0.01 ? ctx() : ac;
    if (!c) return;
    let L = loops[name];
    if (level > 0.01 && !L) {
      const n = noise();
      const bp = filt('bandpass', 750, 0.7);
      const lp = filt('lowpass', 2600, 0.7);
      const out = gain(0);
      n.connect(bp); bp.connect(lp); lp.connect(out); out.connect(master);
      n.start();
      L = loops[name] = { n, out, bp };
    }
    if (!L) return;
    const t = c.currentTime;
    L.out.gain.cancelScheduledValues(t);
    L.out.gain.setTargetAtTime(level * 0.22, t, 0.12);
    L.bp.frequency.setTargetAtTime(600 + level * 900, t, 0.2);
    if (level <= 0.01) {
      clearTimeout(L.stopTimer);
      L.stopTimer = setTimeout(() => { if (loops[name] === L && L.out.gain.value < 0.01) { try { L.n.stop(); } catch (e) { /* */ } delete loops[name]; } }, 900);
    } else clearTimeout(L.stopTimer);
  }

  // Read a reminder aloud in the character's voice.
  function speak(text, character) {
    try {
      const synth = root.speechSynthesis;
      if (!synth || !enabled) return;
      synth.cancel();
      const u = new root.SpeechSynthesisUtterance(text);
      const voices = synth.getVoices();
      const en = voices.filter((v) => /^en/i.test(v.lang));
      const iron = character === 'ironman';
      const prefer = iron ? /daniel|alex|aaron|arthur|david|guy|george|male|fred/i : /samantha|karen|zira|aria|female|victoria|moira|tessa/i;
      u.voice = en.find((v) => prefer.test(v.name)) || en[0] || null;
      u.pitch = iron ? 0.85 : 1.45;
      u.rate = iron ? 1.02 : 1.05;
      u.volume = Math.min(1, volume * 1.6);
      synth.speak(u);
    } catch (e) { /* speech not available */ }
  }

  function play(name) {
    if (!enabled || volume <= 0) return;
    const fn = SFX[name];
    if (!fn) return;
    try { fn(); } catch (e) { /* audio not available */ }
  }

  // Continuous purr: rumbling noise pulsed ~24 Hz, swelling on each breath.
  function setPurr(on) {
    if (!enabled) on = false;
    if (on && !purr) {
      const c = ctx(); if (!c) return;
      const n = noise();
      const lp = filt('lowpass', 340, 1);
      const pulse = gain(0);
      const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 24;
      const lfoG = gain(0.5); lfo.connect(lfoG); lfoG.connect(pulse.gain);
      const breath = gain(0.5);
      const slow = c.createOscillator(); slow.frequency.value = 0.55;
      const slowG = gain(0.3); slow.connect(slowG); slowG.connect(breath.gain);
      const out = gain(0);
      n.connect(lp); lp.connect(pulse); pulse.connect(breath); breath.connect(out); out.connect(master);
      const t = c.currentTime;
      out.gain.linearRampToValueAtTime(0.55, t + 0.6);
      n.start(); lfo.start(); slow.start();
      purr = { n, lfo, slow, out };
    } else if (!on && purr) {
      const p = purr; purr = null;
      const t = ac.currentTime;
      p.out.gain.cancelScheduledValues(t);
      p.out.gain.setValueAtTime(p.out.gain.value, t);
      p.out.gain.linearRampToValueAtTime(0.0001, t + 0.5);
      setTimeout(() => { try { p.n.stop(); p.lfo.stop(); p.slow.stop(); } catch (e) { /* */ } }, 700);
    }
  }

  function configure(on, vol) {
    enabled = !!on;
    volume = vol == null ? volume : vol;
    if (master) master.gain.value = volume;
    if (!enabled) { setPurr(false); for (const k of Object.keys(loops)) setLoop(k, 0); }
  }

  root.CatSound = { play, setPurr, setLoop, speak, configure, names: Object.keys(SFX) };
})(typeof window !== 'undefined' ? window : globalThis);
