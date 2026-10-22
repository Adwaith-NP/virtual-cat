/*
 * Desktop Cat — the right-click care menu (rendered inside the overlay).
 */
(function (root) {
  'use strict';
  const api = root.catAPI;
  let rootEl = null, panel = null, flyout = null, flyFor = null;
  let isOpen = false, origin = null, info = null, bounds = null, getState = null, menuId = 0;
  let hoverTimer = null, closeTimer = null, meterTimer = null, lastInside = 0;

  const TOOL_LABEL = { scoop: 'Poop scoop', repair: 'Repair spray', brush: 'Brush', mouse: 'Mouse chase', laser: 'Laser pointer', treat: 'Treat in hand' };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function init(rootElement, boundsGetter, stateGetter) {
    rootEl = rootElement;
    bounds = boundsGetter;
    getState = stateGetter;
    document.addEventListener('pointermove', () => {
      if (isOpen) lastInside = Date.now();
    });
  }

  function items(s, ctx) {
    const c = s.cat, e = s.ents, tool = s.tool && s.tool.kind;
    const poops = e.poops.length, scratches = e.scratches.filter((x) => !x.fixing).length, files = e.files.length;
    const st = c.stats;
    const out = [];
    if (c.dead) {
      out.push({ icon: '🌸', label: 'Lay flowers', cmd: 'flowers' });
      out.push({ icon: '🐱', label: 'Adopt a new kitten', cmd: 'adopt', accent: true });
      if (e.grave) out.push({ icon: '🕊️', label: 'Move memorial to Cat Home', cmd: 'removeGrave' });
      out.push('-');
      out.push({ icon: '🏠', label: 'Cat Home…', cmd: 'home' });
      out.push({ icon: '⏻', label: 'Quit Desktop Cat', cmd: 'quit', danger: true });
      return out;
    }
    if (tool) out.push({ icon: '✋', label: `Put away ${TOOL_LABEL[tool] || 'tool'}`, cmd: 'stopTool', accent: true, hint: 'Esc' });
    out.push({
      icon: '🍽️', label: 'Feed', badge: st.food < 35 ? '!' : null, urgent: st.food < 20,
      sub: [
        { icon: '🐟', label: 'Fish', cmd: 'feed', args: { kind: 'fish' }, hint: 'favourite' },
        { icon: '🥣', label: 'Kibble', cmd: 'feed', args: { kind: 'kibble' } },
        { icon: '🍗', label: 'Chicken', cmd: 'feed', args: { kind: 'chicken' }, hint: 'filling' },
        { icon: '🥛', label: 'Milk', cmd: 'feed', args: { kind: 'milk' }, hint: 'a little' },
        '-',
        { icon: '🍤', label: 'Give a treat by hand', cmd: 'treat', hint: 'cursor holds it' },
      ],
    });
    out.push({
      icon: '🧹', label: 'Clean up', badge: poops || null, urgent: poops && st.clean < 30,
      sub: [
        { icon: '🥄', label: poops ? `Scoop poop (${poops})` : 'Nothing to scoop', cmd: 'scoop', disabled: !poops, hint: 'click each one' },
        { icon: '✨', label: 'Clean everything', cmd: 'cleanAll', disabled: !poops },
      ],
    });
    if (c.sleeping) out.push({ icon: '⏰', label: `Wake ${c.name} up`, cmd: 'wake' });
    else out.push({ icon: '🛏️', label: 'Sleep — put a bed here', cmd: 'bed', badge: st.energy < 28 ? '!' : null, urgent: st.energy < 12 });
    out.push({
      icon: '🧶', label: 'Play', badge: st.fun < 25 ? '!' : null,
      sub: [
        { icon: '🐭', label: tool === 'mouse' ? 'Stop mouse chase' : 'Mouse chase', cmd: 'toyMouse', hint: 'your cursor becomes a mouse', checked: tool === 'mouse' },
        { icon: '🔴', label: tool === 'laser' ? 'Stop laser pointer' : 'Laser pointer', cmd: 'laser', checked: tool === 'laser' },
        { icon: '🧶', label: 'Yarn ball', cmd: 'yarn', hint: 'drag & throw it' },
        { icon: '📦', label: 'Cardboard box', cmd: 'box' },
        { icon: '🌿', label: 'Catnip', cmd: 'catnip', hint: 'silly time' },
        { icon: '🪮', label: tool === 'brush' ? 'Put brush away' : 'Brush fur', cmd: 'brush', hint: 'stroke the cat', checked: tool === 'brush' },
      ],
    });
    out.push({
      icon: '🛠️', label: 'Fix the screen', badge: scratches + files || null,
      sub: [
        { icon: '🧴', label: scratches ? `Repair scratches (${scratches})` : 'No scratches', cmd: 'repair', disabled: !scratches, hint: 'click each one' },
        { icon: '✨', label: 'Fix all scratches', cmd: 'fixAll', disabled: !scratches },
        { icon: '🗂️', label: files ? `Tidy up files (${files})` : 'No files to tidy', cmd: 'tidyFiles', disabled: !files },
        '-',
        { icon: '🪵', label: 'Place a scratching post', cmd: 'post', hint: 'saves your screen' },
      ],
    });
    out.push({ icon: '👋', label: `Call ${c.name} here`, cmd: 'call' });
    out.push('-');
    out.push({ icon: s.quiet ? '🔔' : '🤫', label: s.quiet ? 'End quiet time' : 'Quiet time', cmd: 'quiet', hint: s.quiet ? '' : 'naps, no mess' });
    out.push({ icon: '🏠', label: 'Cat Home…', cmd: 'home', hint: 'stats & settings' });
    if (info && info.hookNeedsPermission) out.push({ icon: '🖱️', label: 'Enable right-click anywhere…', cmd: 'enableHook' });
    out.push({
      icon: '⋯', label: 'More',
      sub: [
        { icon: '🧺', label: 'Put away toys & bed', cmd: 'putAway' },
        { icon: '👻', label: 'Hide cat', cmd: 'hide', hint: 'tray icon brings it back' },
        { icon: '⏻', label: 'Quit Desktop Cat', cmd: 'quit', danger: true },
      ],
    });
    return out;
  }

  function buildList(list, container, isSub) {
    for (const it of list) {
      if (it === '-') { container.appendChild(el('div', 'sep')); continue; }
      const row = el('div', 'item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : '') + (it.accent ? ' accent' : '') + (it.urgent ? ' urgent' : ''));
      row.appendChild(el('span', 'ic', it.icon));
      const lab = el('span', 'lab');
      lab.appendChild(el('span', 'tx', it.label));
      if (it.hint) lab.appendChild(el('span', 'hint', it.hint));
      row.appendChild(lab);
      if (it.checked) row.appendChild(el('span', 'check', '✓'));
      if (it.badge != null) row.appendChild(el('span', 'badge', String(it.badge)));
      if (it.sub) row.appendChild(el('span', 'chev', '›'));
      if (it.sub) {
        row.addEventListener('pointerenter', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => openFly(row, it.sub), 110); });
        row.addEventListener('pointerdown', (e) => { e.stopPropagation(); openFly(row, it.sub); });
      } else {
        if (!isSub) row.addEventListener('pointerenter', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(closeFly, 160); });
        row.addEventListener('pointerdown', (e) => e.stopPropagation());
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          if (it.disabled) return;
          const args = Object.assign({}, it.args || {}, origin ? { x: origin.x, y: origin.y } : {});
          api.send('cmd', { name: it.cmd, args });
          close();
        });
      }
      container.appendChild(row);
    }
  }

  function header(s) {
    const c = s.cat;
    const h = el('div', 'head');
    const av = document.createElement('canvas');
    av.className = 'avatar';
    const d = window.devicePixelRatio || 1;
    av.width = 46 * d; av.height = 46 * d;
    h.appendChild(av);
    drawAvatar(av, s, d);
    const txt = el('div', 'htx');
    txt.appendChild(el('div', 'name', c.name));
    txt.appendChild(el('div', 'mood', c.dead ? 'resting in peace 🌈' : c.mood));
    h.appendChild(txt);
    return h;
  }

  function drawAvatar(cv, s, d) {
    const x = cv.getContext('2d');
    x.setTransform(d, 0, 0, d, 0, 0);
    x.clearRect(0, 0, 46, 46);
    x.fillStyle = 'rgba(140,130,200,0.14)';
    x.beginPath(); x.arc(23, 23, 23, 0, Math.PI * 2); x.fill();
    x.save();
    x.beginPath(); x.arc(23, 23, 23, 0, Math.PI * 2); x.clip();
    x.translate(23, 58);
    x.scale(0.62, 0.62);
    const T = performance.now() / 1000;
    const pose = CatArt.makePose('sitFront', { t: T, T, phase: 0, m: {} });
    const c = s.cat;
    const face = c.dead ? { eyes: 'closed', mouth: 'w' } : c.stats.food < 25 ? { eyes: 'sad', open: 0.8, mouth: 'frown', brows: 'sad' } : c.sleeping ? { eyes: 'closed' } : { eyes: 'normal', open: 1, mouth: 'w', blush: 0.3 };
    CatArt.drawCat(x, pose, face, { T, palette: c.palette, eyes: c.eyes });
    x.restore();
  }

  function meters(s) {
    const m = el('div', 'meters');
    const st = s.cat.stats;
    const rows = [['🍗', 'food', 'Food'], ['⚡', 'energy', 'Energy'], ['🧶', 'fun', 'Fun'], ['🫧', 'clean', 'Clean'], ['❤️', 'health', 'Health']];
    for (const [ic, k, label] of rows) {
      const r = el('div', 'meter');
      r.title = `${label}: ${Math.round(st[k])}%`;
      r.appendChild(el('span', 'mi', ic));
      const bar = el('span', 'bar');
      const fill = el('span', 'fill ' + k);
      fill.dataset.k = k;
      fill.style.width = Math.round(st[k]) + '%';
      if (st[k] < 20) fill.classList.add('low');
      bar.appendChild(fill);
      r.appendChild(bar);
      m.appendChild(r);
    }
    return m;
  }

  function refreshMeters() {
    if (!isOpen || !panel) return;
    const s = getState();
    if (!s) return;
    panel.querySelectorAll('.fill').forEach((f) => {
      const v = s.cat.stats[f.dataset.k];
      f.style.width = Math.round(v) + '%';
      f.classList.toggle('low', v < 20);
    });
    const mood = panel.querySelector('.mood');
    if (mood && !s.cat.dead) mood.textContent = s.cat.mood;
    // close if the mouse wandered off for a while
    if (Date.now() - lastInside > 9000) close();
  }

  // Tell main which screen rectangles the menu occupies (only those catch the mouse).
  function report() {
    if (!isOpen) return;
    const B = bounds();
    const rects = [panel, flyout].filter(Boolean).map((e) => {
      const r = e.getBoundingClientRect();
      return { x: B.x + r.left, y: B.y + r.top, w: r.width, h: r.height };
    });
    api.send('ui', { open: true, id: menuId, rects });
  }

  function open(m) {
    const s = getState();
    close(true);
    menuId = m.id || 0;
    if (!s) { api.send('ui', { open: false, id: menuId }); return; }
    info = m;
    origin = { x: m.x, y: m.y };
    isOpen = true;
    lastInside = Date.now();
    panel = el('div', 'menu');
    panel.appendChild(header(s));
    if (!s.cat.dead) panel.appendChild(meters(s));
    const list = el('div', 'list');
    buildList(items(s, m.ctx || {}), list, false);
    panel.appendChild(list);
    if (!m.hook && !s.cat.dead && m.shortcut) {
      panel.appendChild(el('div', 'foot', `Tip: ${m.shortcut} opens this menu anywhere`));
    }
    rootEl.appendChild(panel);
    // position: native context menus open down-right, so prefer up-left when we came from a global right-click
    const B = bounds();
    const lx = m.x - B.x, ly = m.y - B.y;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    let left, top;
    if (m.native) { left = lx - w - 10; top = ly - Math.min(h * 0.35, 120); }
    else { left = lx + 8; top = ly + 6; }
    if (left < 8) left = Math.min(lx + 10, B.width - w - 8);
    if (left + w > B.width - 8) left = Math.max(8, lx - w - 10);
    if (top + h > B.height - 8) top = B.height - h - 8;
    if (top < 8) top = 8;
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.transformOrigin = `${lx < left ? 0 : w}px ${Math.max(0, Math.min(h, ly - top))}px`;
    requestAnimationFrame(() => panel && panel.classList.add('show'));
    panel.addEventListener('pointerleave', () => { clearTimeout(hoverTimer); });
    meterTimer = setInterval(refreshMeters, 500);
    report();
    setTimeout(report, 220); // again once the pop-in animation has finished
  }

  function openFly(row, sub) {
    if (flyFor === row && flyout) return;
    closeFly();
    flyFor = row;
    row.classList.add('open');
    flyout = el('div', 'menu sub');
    const list = el('div', 'list');
    buildList(sub, list, true);
    flyout.appendChild(list);
    rootEl.appendChild(flyout);
    const B = bounds();
    const r = row.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const w = flyout.offsetWidth, h = flyout.offsetHeight;
    let left = p.right + 4;
    if (left + w > B.width - 8) left = p.left - w - 4;
    let top = r.top - 6;
    if (top + h > B.height - 8) top = B.height - h - 8;
    flyout.style.left = Math.max(8, left) + 'px';
    flyout.style.top = Math.max(8, top) + 'px';
    flyout.addEventListener('pointerenter', () => clearTimeout(hoverTimer));
    requestAnimationFrame(() => flyout && flyout.classList.add('show'));
    report();
    setTimeout(report, 220);
  }

  function closeFly() {
    if (flyFor) flyFor.classList.remove('open');
    flyFor = null;
    if (flyout) { flyout.remove(); flyout = null; report(); }
  }

  // silent: main already knows (it asked us to close, or a new menu replaces this one)
  function close(silent) {
    clearTimeout(hoverTimer); clearTimeout(closeTimer); clearInterval(meterTimer);
    const was = isOpen;
    isOpen = false;
    closeFly();
    if (panel) { panel.remove(); panel = null; }
    if (was && !silent) api.send('ui', { open: false, id: menuId });
  }

  function contains(target) {
    return !!(target && ((panel && panel.contains(target)) || (flyout && flyout.contains(target))));
  }

  root.CatMenu = { init, open, close, contains, isOpen: () => isOpen };
})(typeof window !== 'undefined' ? window : globalThis);
