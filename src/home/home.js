/* Desktop Cat — "Cat Home" window: stats, quick care, settings, memories. */
(function () {
  'use strict';
  const api = window.catAPI;
  const $ = (s) => document.querySelector(s);
  let state = null;
  let editingName = false;

  const NEEDS = [
    ['food', 'Food', '#ff9f43'], ['energy', 'Energy', '#5d7cf0'], ['fun', 'Fun', '#ff5fa2'],
    ['clean', 'Clean', '#2ec4b6'], ['health', 'Health', '#4cd964'], ['love', 'Love', '#ff6b8b'],
  ];
  const QUICK = [
    ['🐟', 'Fish', 'feed', { kind: 'fish' }], ['🍤', 'Treat', 'treat'], ['🛏️', 'Bed', 'bed'], ['⏰', 'Wake', 'wake'],
    ['🐭', 'Mouse', 'toyMouse', null, 'mouse'], ['🔴', 'Laser', 'laser', null, 'laser'], ['🧶', 'Yarn', 'yarn'], ['📦', 'Box', 'box'],
    ['✨', 'Clean all', 'cleanAll'], ['🧴', 'Fix all', 'fixAll'], ['🗂️', 'Tidy files', 'tidyFiles'], ['👋', 'Call', 'call'],
  ];
  const STATS = [
    ['meals', 'meals eaten'], ['treats', 'treats'], ['pets', 'pets'], ['poopsCleaned', 'poops scooped'], ['scratchesFixed', 'scratches fixed'],
    ['filesTidied', 'files tidied'], ['miceCaught', 'mice caught'], ['laserPounces', 'laser pounces'], ['naps', 'naps'],
  ];
  const FUR = { white: '#ffffff', cream: '#f6e3c6', silver: '#c9cdd8', ginger: '#f5a65b', black: '#34353f' };
  const EYES = { blue: '#6cb6ff', green: '#8bd06a', amber: '#f3b443', odd: 'linear-gradient(90deg,#6cb6ff 50%,#f3b443 50%)' };

  const cmd = (name, args) => api.send('cmd', { name, args: args || {} });
  const setting = (key, value) => cmd('setting', { key, value });

  // ------------------------------------------------------------ tabs
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
  }));

  // ------------------------------------------------------------ build static UI
  const needsEl = $('#needs');
  for (const [k, label, color] of NEEDS) {
    const row = document.createElement('div');
    row.className = 'need';
    row.dataset.k = k;
    row.innerHTML = `<span class="lbl"></span><span class="bar"><span class="fill"></span></span><span class="pct"></span>`;
    row.querySelector('.lbl').textContent = label;
    row.querySelector('.fill').style.background = color;
    needsEl.appendChild(row);
  }
  const quickEl = $('#quick');
  for (const [e, label, name, args, toolKind] of QUICK) {
    const b = document.createElement('button');
    b.className = 'qa';
    b.dataset.tool = toolKind || '';
    b.innerHTML = `<span class="e"></span><span></span>`;
    b.firstChild.textContent = e;
    b.lastChild.textContent = label;
    b.addEventListener('click', () => cmd(name, args));
    quickEl.appendChild(b);
  }
  const statsEl = $('#stats');
  for (const [k, label] of STATS) {
    const d = document.createElement('div');
    d.className = 'stat';
    d.dataset.k = k;
    d.innerHTML = '<b>0</b><span></span>';
    d.lastChild.textContent = label;
    statsEl.appendChild(d);
  }
  for (const [k, col] of Object.entries(FUR)) {
    const b = document.createElement('button');
    b.className = 'sw'; b.title = k; b.dataset.v = k; b.style.background = col;
    b.addEventListener('click', (ev) => { ev.preventDefault(); setting('palette', k); });
    $('#fur').appendChild(b);
  }
  for (const [k, col] of Object.entries(EYES)) {
    const b = document.createElement('button');
    b.className = 'sw'; b.title = k === 'odd' ? 'odd-eyed' : k; b.dataset.v = k; b.style.background = col;
    b.addEventListener('click', (ev) => { ev.preventDefault(); setting('eyes', k); });
    $('#eyes').appendChild(b);
  }
  document.querySelectorAll('[data-k]').forEach((input) => {
    if (input.classList.contains('need') || input.classList.contains('stat')) return;
    const k = input.dataset.k;
    const ev = input.type === 'range' ? 'input' : 'change';
    input.addEventListener(ev, () => {
      const v = input.type === 'checkbox' ? input.checked : input.type === 'range' ? +input.value : input.value;
      setting(k, v);
    });
  });
  const nameEl = $('#name');
  nameEl.addEventListener('focus', () => { editingName = true; });
  nameEl.addEventListener('blur', () => { editingName = false; if (nameEl.value.trim()) cmd('rename', { name: nameEl.value.trim() }); });
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameEl.blur(); if (e.key === 'Escape') { nameEl.value = state.cat.name; nameEl.blur(); } });
  $('#hookBtn').addEventListener('click', () => cmd('enableHook'));
  $('#hideBtn').addEventListener('click', () => cmd(state && state.hidden ? 'show' : 'hide'));
  $('#quitBtn').addEventListener('click', () => cmd('quit'));
  for (const ev of ['dragover', 'drop']) window.addEventListener(ev, (e) => e.preventDefault());
  $('#reset').addEventListener('click', () => {
    if (confirm(`Rehome ${state ? state.cat.name : 'your cat'} and adopt a brand-new kitten?`)) cmd('resetCat');
  });

  // ------------------------------------------------------------ render state
  function ageText(born, until) {
    const ms = (until || Date.now()) - born;
    const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000);
    if (d >= 1) return `${d} day${d > 1 ? 's' : ''} old`;
    if (h >= 1) return `${h} hour${h > 1 ? 's' : ''} old`;
    return `${Math.max(1, m)} minute${m > 1 ? 's' : ''} old`;
  }

  function apply(s) {
    state = s;
    document.body.dataset.platform = s.platform;
    const c = s.cat;
    if (!editingName) nameEl.value = c.name;
    $('#age').textContent = c.dead ? `lived ${ageText(c.born, c.died).replace(' old', '')}` : ageText(c.born);
    $('#mood').textContent = c.dead ? 'resting in peace' : c.mood;
    for (const row of needsEl.children) {
      const v = Math.round(c.stats[row.dataset.k]);
      row.querySelector('.fill').style.width = v + '%';
      row.querySelector('.pct').textContent = v + '%';
      row.classList.toggle('low', v < 20 && !c.dead);
    }
    for (const b of quickEl.children) b.classList.toggle('on', !!b.dataset.tool && s.tool === b.dataset.tool);
    $('#hideBtn').textContent = s.hidden ? 'Show cat' : 'Hide cat';
    for (const d of statsEl.children) d.querySelector('b').textContent = (s.counters[d.dataset.k] || 0).toLocaleString();
    // settings
    document.querySelectorAll('select[data-k], input[data-k]').forEach((input) => {
      if (document.activeElement === input) return;
      const v = s.settings[input.dataset.k];
      if (input.type === 'checkbox') input.checked = !!v;
      else if (v != null) input.value = v;
    });
    document.querySelectorAll('#fur .sw').forEach((b) => b.classList.toggle('on', b.dataset.v === s.settings.palette));
    document.querySelectorAll('#eyes .sw').forEach((b) => b.classList.toggle('on', b.dataset.v === c.eyes));
    const mac = s.platform === 'darwin';
    const h = s.hook || {};
    $('#hookRow').style.display = s.settings.rightClick === 'cat' ? 'none' : '';
    $('#hookStatus').textContent = h.ok ? 'Active — right-click anywhere opens the menu.'
      : h.reason === 'permission' ? (mac ? 'Needs Accessibility permission (System Settings → Privacy & Security → Accessibility).' : 'Not available.')
      : h.reason === 'unavailable' ? 'Not available on this system — right-click the cat or use the tray icon.'
      : 'Not running.';
    $('#hookBtn').style.display = h.ok ? 'none' : '';
    $('#hookInfo').textContent = 'Right-clicking the cat always works.';
    $('#sc').textContent = s.shortcut || '';
    renderMemorial(s.memorial);
  }

  let memKey = '';
  function renderMemorial(list) {
    const key = JSON.stringify(list);
    if (key === memKey) return;
    memKey = key;
    const el = $('#memorial');
    el.innerHTML = '';
    $('#memEmpty').style.display = list.length ? 'none' : '';
    for (const m of [...list].reverse()) {
      const d = document.createElement('div');
      d.className = 'mem';
      const cv = document.createElement('canvas');
      cv.width = 108; cv.height = 88;
      const t = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = (m.cause === 'rehomed' ? '🏡 ' : '🌈 ') + m.name;
      const sp = document.createElement('span');
      const days = Math.max(1, Math.round((m.died - m.born) / 86400000));
      sp.textContent = `${new Date(m.born).toLocaleDateString()} – ${new Date(m.died).toLocaleDateString()} · ${days} day${days > 1 ? 's' : ''}${m.cause === 'rehomed' ? ' · rehomed' : ''}`;
      t.appendChild(b); t.appendChild(sp);
      d.appendChild(cv); d.appendChild(t);
      el.appendChild(d);
      const x = cv.getContext('2d');
      x.translate(54, 80); x.scale(1.1, 1.1);
      const pose = CatArt.makePose('curl', { t: 0, T: 1, phase: 0, m: {} });
      CatArt.drawCat(x, pose, { eyes: 'closed' }, { T: 1, palette: m.palette, eyes: m.eyes });
    }
  }

  // ------------------------------------------------------------ live portrait
  const pc = $('#portrait');
  const d = window.devicePixelRatio || 1;
  pc.width = 150 * d; pc.height = 95 * d;
  const px = pc.getContext('2d');
  let lastPortrait = 0;
  function drawPortrait(now) {
    requestAnimationFrame(drawPortrait);
    if (!state || now - lastPortrait < 40) return;
    lastPortrait = now;
    const c = state.cat;
    const T = performance.now() / 1000;
    px.setTransform(d, 0, 0, d, 0, 0);
    px.clearRect(0, 0, 150, 95);
    px.fillStyle = 'rgba(0,0,0,0.1)';
    px.beginPath(); px.ellipse(75, 88, 46, 5, 0, 0, Math.PI * 2); px.fill();
    px.save();
    px.translate(75, 88);
    px.scale(1.15, 1.15);
    const st = c.stats;
    let name = 'sitFront', face = { eyes: 'normal', mouth: 'w', blush: 0.3, lookY: 0.1 };
    if (c.dead) { name = 'curl'; face = { eyes: 'closed' }; px.globalAlpha = 0.5; }
    else if (c.sleeping) { name = 'curl'; face = { eyes: 'closed' }; }
    else if (st.health < 30) { name = 'lieSide'; face = { eyes: 'sad', open: 0.4, mouth: 'frown', sweat: 1 }; }
    else if (st.food < 20) face = { eyes: 'sparkle', mouth: 'o', pupil: 1 };
    else if (st.energy < 25) face = { eyes: 'normal', open: 0.4, mouth: 'w' };
    else if (st.fun > 70 && st.love > 50) face = { eyes: 'happy', mouth: 'smile', blush: 0.6 };
    if (!c.dead && !c.sleeping && Math.sin(T * 0.9) > 0.985) face = Object.assign({}, face, { open: 0.05 });
    const pose = CatArt.makePose(name, { t: T, T, phase: 0, m: { tailUp: st.fun > 50 ? 0.8 : 0.2, thin: st.food < 25 ? (25 - st.food) / 25 : 0 } });
    CatArt.drawCat(px, pose, face, { T, palette: c.palette, eyes: c.eyes });
    px.restore();
  }
  requestAnimationFrame(drawPortrait);

  api.on('home:state', apply);
  api.invoke('home:get').then(apply);
})();
