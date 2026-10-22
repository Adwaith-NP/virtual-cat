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
  };

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
    if (!enabled) setPurr(false);
  }

  root.CatSound = { play, setPurr, configure, names: Object.keys(SFX) };
})(typeof window !== 'undefined' ? window : globalThis);
