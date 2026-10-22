'use strict';
/*
 * Desktop Cat — Electron main process.
 *
 * One transparent, always-on-top, click-through overlay window per display.
 * The simulation (world.js) runs here at ~60 Hz and streams snapshots to the
 * overlays, which only draw. An overlay stops being click-through only while
 * the cursor is over something interactive (the cat, a poop with the scoop…)
 * or while its menu is open — so you can keep working underneath.
 */
const {
  app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, Notification,
  globalShortcut, systemPreferences, powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Geo, inside } = require('./geometry');
const { performance } = require('perf_hooks');
const { World } = require('./world');
const { Store } = require('./store');
const { desktopItems } = require('./names');
const Hook = require('./hook');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';
const DEV = process.argv.includes('--dev');
const ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(__dirname, '..', 'preload.js');
const ICON = path.join(ROOT, 'build', 'icon.png');
const MENU_SHORTCUT = 'CommandOrControl+Alt+Shift+K';

// A desktop pet needs free window placement, always-on-top and the global cursor
// position, which native Wayland doesn't allow — run through X11/XWayland instead.
// The backend is chosen before this file runs, so relaunch with the flag if needed.
const needsX11Relaunch = isLinux && !process.env.DESKTOP_CAT_WAYLAND &&
  (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY) &&
  !process.argv.some((a) => a.startsWith('--ozone-platform'));
if (needsX11Relaunch) {
  app.relaunch({ args: process.argv.slice(1).concat(['--ozone-platform=x11']) });
  app.exit(0);
}
if (isLinux) {
  // transparent windows on Linux need these
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.disableHardwareAcceleration();
}
if (isWin) app.setAppUserModelId('app.desktopcat.pet');
if (process.env.CAT_USER_DATA) app.setPath('userData', process.env.CAT_USER_DATA);

let geo, world, store, tray = null, homeWin = null;
const overlays = new Map(); // display.id -> { win, display, ready, interactive, ui, cursor }
let pressOverlay = null;
let lastTick = 0, loop = null, lastSaveAt = 0, lastHomeAt = 0, lastTopAt = 0;
let lastSentVer = -1, lastTrayAt = 0;
let lastMenu = { t: 0, x: 0, y: 0 };
let menuSeq = 0;
let desktopCache = { at: 0, items: [] };
let hookStatus = { ok: false, reason: 'not started' };
let quitting = false;

if (needsX11Relaunch) {
  // relaunching
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // launching the app again brings the cat back (handy without a tray icon)
  app.on('second-instance', () => { if (world && world.hidden) setHidden(false); openHome(); });
  app.whenReady().then(() => setTimeout(init, isLinux ? 400 : 0));
}

// Never let any window navigate away or open new windows (e.g. a file or link dropped on the cat).
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// ------------------------------------------------------------------ setup
function init() {
  if (isMac && app.dock) app.dock.hide();
  if (isMac) {
    // gives the Cat Home window copy/paste shortcuts
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
  }
  store = new Store(app.getPath('userData'));
  const data = store.load();
  geo = new Geo();
  geo.set(displayList());
  world = new World({
    geo,
    data,
    desktopItems: cachedDesktopItems,
    emit: onWorldEvent,
  });
  if (data && data.savedAt) {
    const away = (Date.now() - data.savedAt) / 1000;
    if (away > 60) world.applyAway(away);
  } else {
    setTimeout(() => onWorldEvent({
      type: 'notify',
      title: `🐱 Meet ${world.cat.name}!`,
      body: `Right-click the cat to feed, play and care for it. Drag it to carry it around.${isMac ? ' To right-click anywhere, choose “Enable right-click anywhere…” in its menu.' : ''}`,
    }), 4000);
  }

  syncOverlays();
  screen.on('display-added', debounceDisplays);
  screen.on('display-removed', debounceDisplays);
  screen.on('display-metrics-changed', debounceDisplays);

  setupIpc();
  setupTray();
  try {
    globalShortcut.register(MENU_SHORTCUT, () => {
      if (world.hidden) setHidden(false);
      openMenu(screen.getCursorScreenPoint(), 'shortcut');
    });
  } catch (e) { /* taken */ }
  maybeStartHook();
  if (world.settings.launchAtLogin) applyLoginItem(true);

  powerMonitor.on('suspend', save);
  powerMonitor.on('shutdown', save);

  lastTick = Date.now();
  lastSaveAt = Date.now();
  loop = setInterval(tick, 16);
  if (DEV && process.env.CAT_CMD_FILE) setInterval(devPoll, 250);
  if (DEV && !process.env.CAT_CMD_FILE) openHome();
}

// ------------------------------------------------------------------ dev automation
// With --dev and CAT_CMD_FILE=/path, lines written to that file are executed:
//   <command> {json args}   e.g.  feed {"kind":"fish"}
//   set {"food":10}         change cat stats
//   cursor {"x":..,"y":..}  fake the cursor (cursor null = real one again)
//   down / up               fake left button at the cursor
//   capture {"dir":"/tmp","around":"cat","r":160}
let fakeCursor = null;
let devBusy = false;
async function devPoll() {
  const f = process.env.CAT_CMD_FILE;
  if (devBusy || !fs.existsSync(f)) return;
  devBusy = true;
  try {
    const txt = fs.readFileSync(f, 'utf8');
    fs.unlinkSync(f);
    for (const line of txt.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      const i = l.indexOf(' ');
      const name = i < 0 ? l : l.slice(0, i);
      const args = i < 0 ? {} : JSON.parse(l.slice(i + 1));
      if (name === 'capture') await devCapture(args);
      else if (name === 'sleep') await new Promise((r) => setTimeout(r, args.ms || 300));
      else if (name === 'capturehome') {
        if (homeWin && !homeWin.isDestroyed()) {
          if (args.tab) await homeWin.webContents.executeJavaScript(`document.querySelector('[data-tab="${args.tab}"]').click()`);
          await new Promise((r) => setTimeout(r, 300));
          fs.writeFileSync(path.join(args.dir || os.tmpdir(), `${args.name || 'home'}.png`), (await homeWin.webContents.capturePage()).toPNG());
        }
      }
      else if (name === 'js') {
        for (const [id, o] of overlays) {
          try { console.log(`[js ${id}]`, JSON.stringify(await o.win.webContents.executeJavaScript(args.code))); } catch (e) { console.log(`[js ${id}] error`, e.message); }
        }
      }
      else if (name === 'set') Object.assign(world.cat, args);
      else if (name === 'settings') Object.assign(world.settings, args);
      else if (name === 'cursor') fakeCursor = args && args.x != null ? args : null;
      else if (name === 'down') world.pointerDown(currentCursor(), 0);
      else if (name === 'up') world.pointerUp(currentCursor(), 0);
      else if (name === 'menu') openMenu(args.x != null ? args : currentCursor(), args.native ? 'hook' : 'shortcut');
      else if (name === 'closemenu') for (const o of overlays.values()) closeMenu(o);
      else if (name === 'task') { const c = world.cat; const fn = c[args.name]; if (fn) c.run(fn.apply(c, args.args || []), args.name, args.prio == null ? 90 : args.prio); }
      else if (name === 'dump') fs.writeFileSync(args.file, JSON.stringify({ cat: world.snapshot().cat, task: world.cat.taskName, ents: world.ents, tool: world.tool, displays: geo.displays, press: world.press, ui: [...overlays.values()].map((o) => ({ ui: o.ui, id: o.menuId, rects: o.rects, interactive: o.interactive })), tickMs, tickN, metrics: app.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage })) }, null, 1));
      else handleCmd(name, args);
    }
  } catch (e) {
    console.error('[dev]', e);
  }
  devBusy = false;
}

async function devCapture(a) {
  const dir = a.dir || os.tmpdir();
  for (const [id, o] of overlays) {
    if (!o.ready) continue;
    let rect;
    if (a.around) {
      const c = world.cat;
      const p = a.around === 'cursor' ? currentCursor() : { x: c.x, y: c.y - c.z - 30 };
      const r = a.r || 160;
      const b = o.display.bounds;
      const x = Math.round(p.x - b.x - r), y = Math.round(p.y - b.y - r);
      rect = { x: Math.max(0, x), y: Math.max(0, y), width: r * 2, height: r * 2 };
      if (!inside(b, p)) continue;
    }
    let img = await o.win.webContents.capturePage();
    if (rect) {
      const sz = img.getSize();
      const sx = sz.width / o.display.bounds.width;
      img = img.crop({ x: Math.round(rect.x * sx), y: Math.round(rect.y * sx), width: Math.round(Math.min(rect.width, o.display.bounds.width - rect.x) * sx), height: Math.round(Math.min(rect.height, o.display.bounds.height - rect.y) * sx) });
    }
    fs.writeFileSync(path.join(dir, `${a.name || 'overlay'}-${id}.png`), img.toPNG());
  }
}

function currentCursor() {
  return fakeCursor ? { x: fakeCursor.x, y: fakeCursor.y } : screen.getCursorScreenPoint();
}

function displayList() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, primary: d.id === primary.id, scaleFactor: d.scaleFactor }));
}

let displayTimer = null;
function debounceDisplays() {
  clearTimeout(displayTimer);
  displayTimer = setTimeout(() => {
    geo.set(displayList());
    syncOverlays();
    world.onDisplaysChanged();
  }, 400);
}

// ------------------------------------------------------------------ overlays
function syncOverlays() {
  const list = screen.getAllDisplays();
  const ids = new Set(list.map((d) => d.id));
  for (const [id, o] of overlays) {
    if (!ids.has(id)) { if (!o.win.isDestroyed()) o.win.destroy(); overlays.delete(id); }
  }
  for (const d of list) {
    const o = overlays.get(d.id);
    if (!o) overlays.set(d.id, createOverlay(d));
    else {
      const changed = JSON.stringify(o.display.bounds) !== JSON.stringify(d.bounds);
      o.display = d;
      if (changed && !o.win.isDestroyed()) {
        o.win.setBounds(overlayBounds(d));
        o.win.webContents.send('init', initPayload(d));
      }
    }
  }
}

function overlayBounds(d) {
  const b = d.bounds;
  // On Windows a window covering the whole monitor is treated as "fullscreen"
  // (hides the taskbar, mutes notifications) — 1px shorter avoids that.
  return { x: b.x, y: b.y, width: b.width, height: isWin ? b.height - 1 : b.height };
}

function initPayload(d) {
  return { id: d.id, bounds: d.bounds, workArea: d.workArea, platform: process.platform, dev: DEV };
}

function createOverlay(d) {
  const win = new BrowserWindow({
    ...overlayBounds(d),
    title: 'Desktop Cat',
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    enableLargerThanScreen: true,
    acceptFirstMouse: true,
    ...(isMac ? { type: 'panel' } : {}),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  });
  const o = { win, display: d, ready: false, interactive: false, ui: false, menuId: 0, rects: null, cursor: 'default' };
  win.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('init', initPayload(o.display));
    o.ready = true;
    o.sentVer = -1;
    o.ui = false; o.menuId = 0; o.rects = null; o.cursor = '';
    o.interactive = true; setInteractive(o, false);
    if (!world.hidden) {
      win.showInactive();
      win.setBounds(overlayBounds(o.display)); // macOS may nudge it below the menu bar on show
    }
  });
  win.webContents.on('render-process-gone', () => {
    o.ready = false; o.ui = false; o.menuId = 0;
    o.interactive = true; setInteractive(o, false);
    setTimeout(() => !win.isDestroyed() && win.reload(), 1000);
  });
  if (isWin) win.on('session-end', save); // logoff/shutdown: before-quit doesn't fire
  if (DEV) {
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') console.log(`[overlay ${e.level}]`, e.message, e.sourceId ? `(${path.basename(e.sourceId)}:${e.lineNumber})` : '');
    });
  }
  return o;
}

function overlayAt(p) {
  for (const o of overlays.values()) if (inside(o.display.bounds, p)) return o;
  return null;
}

function overlayFor(sender) {
  for (const o of overlays.values()) if (!o.win.isDestroyed() && o.win.webContents === sender) return o;
  return null;
}

function broadcast(channel, data) {
  for (const o of overlays.values()) if (o.ready && !o.win.isDestroyed()) o.win.webContents.send(channel, data);
}

function setInteractive(o, on) {
  if (o.interactive === on || o.win.isDestroyed()) return;
  o.interactive = on;
  o.win.setIgnoreMouseEvents(!on);
}

// ------------------------------------------------------------------ main loop
let tickMs = 0, tickN = 0;
function tick() {
  const t0 = performance.now();
  tickInner();
  tickMs += performance.now() - t0; tickN++;
}
function tickInner() {
  const t = Date.now();
  if (!world) return;
  // 60 Hz while the cursor drives things (dragging, tools), otherwise 30 Hz
  const fast = !!(world.press || world.cat.mode === 'held' || world.cat.mode === 'air' || world.tool || anyMenuOpen());
  if (!fast && t - lastTick < 31) return;
  const gapSec = (t - lastTick) / 1000;
  lastTick = t;
  const cur = currentCursor();
  if (gapSec > 5) {
    // the computer slept: treat it like time away
    world.tick(0.016, gapSec);
  } else {
    const dt = Math.min(gapSec, 0.1);
    world.setCursor(cur, dt);
    world.tick(dt);
  }
  if (t - lastSaveAt > 20000) save();
  if (t - lastTrayAt > 1000) { lastTrayAt = t; updateTrayMenuIfNeeded(); }
  if (world.hidden) return;

  // click-through: only grab the mouse over interactive things
  for (const o of overlays.values()) {
    if (!o.ready) continue;
    const here = inside(o.display.bounds, cur);
    // An open menu: with the global hook we can see outside clicks, so only the
    // menu panels catch the mouse; without it the whole display does (click outside = close).
    let want = o.ui && (!hookStatus.ok || !o.rects || inRects(o.rects, cur, 6));
    if (o.ui && t - o.uiAt > 60000) closeMenu(o); // safety net
    if (!want && world.press) want = o === pressOverlay;
    if (!want && here) want = world.isInteractive(cur);
    setInteractive(o, want);
    if (here) {
      const style = o.ui ? 'default' : world.cursorStyle(cur);
      if (style !== o.cursor) { o.cursor = style; o.win.webContents.send('cursor', style); }
    }
  }
  if (!world.press) pressOverlay = null;

  // stream state to each overlay; displays with nothing going on get it rarely,
  // and the (larger) entity list is only sent when it changed
  const snap = world.snapshot();
  const changed = snap.ver !== lastSentVer;
  if (changed) lastSentVer = snap.ver;
  const lean = { ...snap };
  delete lean.ents;
  for (const o of overlays.values()) {
    if (!o.ready || o.win.isDestroyed()) continue;
    const active = o.ui || displayActive(o.display.bounds, cur);
    if (!active && t - (o.sentAt || 0) < 250 && !changed) continue;
    const full = changed || o.sentVer !== snap.ver || t - (o.fullAt || 0) > 1000;
    o.sentAt = t;
    if (full) { o.sentVer = snap.ver; o.fullAt = t; }
    o.win.webContents.send('state', full ? snap : lean);
  }

  if (homeWin && !homeWin.isDestroyed() && homeWin.isVisible() && t - lastHomeAt > 400) {
    lastHomeAt = t;
    homeWin.webContents.send('home:state', homePayload());
  }
  if (isWin && t - lastTopAt > 10000) {
    // some apps push themselves topmost; stay above them
    lastTopAt = t;
    for (const o of overlays.values()) if (!o.win.isDestroyed()) o.win.setAlwaysOnTop(true, 'screen-saver');
  }
}

function inRects(rects, p, pad) {
  return rects.some((r) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad);
}

function anyMenuOpen() {
  for (const o of overlays.values()) if (o.ui) return true;
  return false;
}

// Is anything happening on this display (cat, ghost, toys, poop, cursor tool…)?
function displayActive(b, cur) {
  const near = (p, m) => p && p.x >= b.x - m && p.x <= b.x + b.width + m && p.y >= b.y - m && p.y <= b.y + b.height + m;
  const c = world.cat;
  if (near({ x: c.x, y: c.y - c.z }, 220)) return true;
  if (c.ghost && Date.now() - c.ghost.start < 8000 && near(c.ghost, 300)) return true;
  if (world.tool && near(cur, 80)) return true;
  if (near(cur, 0) && world.cursorBusy()) return true;
  const E = world.ents;
  for (const k of ['bowls', 'poops', 'scratches', 'files', 'yarns', 'boxes', 'posts', 'catnips']) for (const e of E[k]) if (near(e, 100)) return true;
  return !!((E.bed && near(E.bed, 100)) || (E.grave && near(E.grave, 100)));
}

function onWorldEvent(e) {
  if (e.type === 'sound') {
    const o = overlayAt(e) || overlayAt(world.cat);
    if (o && o.ready && world.settings.sound) o.win.webContents.send('sound', e);
  } else if (e.type === 'fx') {
    broadcast('fx', e);
  } else if (e.type === 'notify') {
    if (Notification.isSupported()) {
      try { new Notification({ title: e.title, body: e.body, icon: fs.existsSync(ICON) ? ICON : undefined, silent: false }).show(); } catch (err) { /* ignore */ }
    }
  }
}

function save() {
  if (!world || !store) return;
  lastSaveAt = Date.now();
  store.save(world.serialize());
}

function cachedDesktopItems() {
  const t = Date.now();
  if (t - desktopCache.at > 30000) {
    desktopCache = { at: t, items: desktopItems(app.getPath('desktop')) };
  }
  return desktopCache.items;
}

// ------------------------------------------------------------------ menu
function openMenu(p, source, mods) {
  if (!world || world.hidden) return;
  const o = overlayAt(p);
  if (!o || !o.ready) return;
  const t = Date.now();
  if (t - lastMenu.t < 350 && Math.hypot(p.x - lastMenu.x, p.y - lastMenu.y) < 12) return;
  lastMenu = { t, x: p.x, y: p.y };
  for (const other of overlays.values()) if (other !== o) closeMenu(other);
  o.ui = true;
  o.uiAt = t;
  o.rects = null;
  o.menuId = ++menuSeq;
  setInteractive(o, true);
  o.win.webContents.send('menu:open', {
    id: o.menuId,
    x: p.x, y: p.y,
    ctx: world.contextAt(p),
    native: source === 'hook',
    hook: hookStatus.ok,
    hookNeedsPermission: isMac && !hookStatus.ok && world.settings.rightClick !== 'cat',
    shortcut: shortcutLabel(),
    mods: mods || null,
  });
}

function shortcutLabel() {
  return isMac ? '⌘⌥⇧K' : 'Ctrl+Alt+Shift+K';
}

function closeMenu(o) {
  if (!o.ui && !o.menuId) return;
  o.ui = false;
  o.menuId = 0;
  o.rects = null;
  if (o.ready && !o.win.isDestroyed()) o.win.webContents.send('menu:close');
}

// ------------------------------------------------------------------ global hook
function maybeStartHook() {
  if (process.env.DESKTOP_CAT_NO_HOOK) { hookStatus = { ok: false, reason: 'disabled' }; return; }
  if (world.settings.rightClick === 'cat') { hookStatus = { ok: false, reason: 'not needed' }; return; }
  if (isMac && !systemPreferences.isTrustedAccessibilityClient(false)) {
    hookStatus = { ok: false, reason: 'permission' };
    return;
  }
  hookStatus = Hook.start({
    mousedown(e) {
      const p = screen.getCursorScreenPoint();
      if (e.button === 2) {
        const mode = world.settings.rightClick;
        if (mode === 'cat') return;
        if (mode === 'alt' && !e.altKey) return;
        const o = overlayAt(p);
        // the overlay itself handles right-clicks on the cat and inside its open menu
        if (o && o.ui && o.rects && inRects(o.rects, p, 6)) return;
        if (o && !o.ui && o.interactive) return;
        // leave right-clicks inside the Cat Home window alone
        if (homeWin && !homeWin.isDestroyed() && homeWin.isVisible() && inside(homeWin.getBounds(), p)) return;
        openMenu(p, 'hook', { alt: e.altKey });
      } else if (e.button === 1) {
        for (const o of overlays.values()) if (o.ui && !(inside(o.display.bounds, p) && o.rects && inRects(o.rects, p, 6))) closeMenu(o);
      }
    },
    mouseup(e) {
      if (e.button === 1 && world.press) world.pointerUp(screen.getCursorScreenPoint(), 0);
    },
    keydown(e) {
      if (e.keycode === Hook.KEY_ESCAPE) {
        let closed = false;
        for (const o of overlays.values()) if (o.ui) { closeMenu(o); closed = true; }
        if (!closed && world.tool) world.command('stopTool');
      }
    },
  });
}

function requestHookPermission() {
  if (!isMac) { maybeStartHook(); return; }
  if (systemPreferences.isTrustedAccessibilityClient(true)) { maybeStartHook(); return; }
  // poll until the user flips the switch in System Settings
  let n = 0;
  const timer = setInterval(() => {
    n++;
    if (systemPreferences.isTrustedAccessibilityClient(false)) { clearInterval(timer); maybeStartHook(); }
    else if (n > 90) clearInterval(timer);
  }, 2000);
}

// ------------------------------------------------------------------ commands
function handleCmd(name, args) {
  args = args || {};
  switch (name) {
    case 'home': openHome(); break;
    case 'quit': app.quit(); break;
    case 'hide': setHidden(!world.hidden); break;
    case 'show': setHidden(false); break;
    case 'putAway': world.command('putAwayToys'); world.command('putAwayBed'); break;
    case 'enableHook': requestHookPermission(); break;
    case 'setting':
      world.command('setting', args);
      if (args.key === 'launchAtLogin') applyLoginItem(!!args.value);
      if (args.key === 'rightClick') { if (args.value === 'cat') { Hook.stop(); hookStatus = { ok: false, reason: 'not needed' }; } else maybeStartHook(); }
      break;
    default:
      world.command(name, args);
  }
  trayDirty = true;
  if (['rename', 'setting', 'adopt', 'resetCat', 'quiet'].includes(name)) save();
}

function setHidden(h) {
  world.hidden = !!h;
  for (const o of overlays.values()) {
    if (o.win.isDestroyed()) continue;
    if (h) { closeMenu(o); o.win.hide(); }
    else { o.win.showInactive(); o.win.setBounds(overlayBounds(o.display)); }
  }
  trayDirty = true;
}

function setupIpc() {
  ipcMain.on('pointer', (e, m) => {
    if (!m || typeof m.x !== 'number') return;
    if (m.type === 'down') { pressOverlay = overlayFor(e.sender); world.pointerDown(m, m.button); }
    else if (m.type === 'up') world.pointerUp(m, m.button);
  });
  ipcMain.on('context', (_e, p) => { if (p && typeof p.x === 'number') openMenu(p, 'overlay'); });
  ipcMain.on('ui', (e, m) => {
    const o = overlayFor(e.sender);
    if (!o || !m || m.id !== o.menuId) return; // ignore stale messages from an older menu
    if (m.open) {
      o.ui = true;
      o.rects = Array.isArray(m.rects) ? m.rects.filter((r) => r && typeof r.x === 'number').slice(0, 4) : null;
    } else {
      o.ui = false; o.menuId = 0; o.rects = null;
    }
  });
  ipcMain.on('cmd', (_e, m) => { if (m && typeof m.name === 'string') handleCmd(m.name, m.args); });
  ipcMain.handle('home:get', () => homePayload());
}

function homePayload() {
  return { ...world.homeState(), hidden: world.hidden, hook: hookStatus, platform: process.platform, shortcut: shortcutLabel(), version: app.getVersion() };
}

// ------------------------------------------------------------------ Cat Home window
function openHome() {
  if (homeWin && !homeWin.isDestroyed()) { homeWin.show(); homeWin.focus(); return; }
  homeWin = new BrowserWindow({
    width: 480, height: 760, minWidth: 420, minHeight: 560,
    title: 'Cat Home',
    show: false,
    backgroundColor: '#f7f5fc',
    autoHideMenuBar: true,
    icon: fs.existsSync(ICON) ? ICON : undefined,
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  homeWin.loadFile(path.join(__dirname, '..', 'home', 'home.html'));
  homeWin.once('ready-to-show', () => {
    homeWin.show();
    if (isMac) app.focus({ steal: true });
  });
  homeWin.on('closed', () => { homeWin = null; });
}

// ------------------------------------------------------------------ tray
let trayDirty = true, trayKey = '';
function setupTray() {
  try {
    let img = fs.existsSync(ICON) ? nativeImage.createFromPath(ICON) : nativeImage.createEmpty();
    if (!img.isEmpty()) img = img.resize({ width: isMac ? 18 : isWin ? 16 : 22, quality: 'best' });
    tray = new Tray(img);
    tray.setToolTip('Desktop Cat');
    tray.on('click', () => { if (!isMac) openHome(); });
    trayDirty = true;
    updateTrayMenuIfNeeded();
  } catch (e) {
    console.warn('[tray] not available', e.message);
  }
}

function updateTrayMenuIfNeeded() {
  if (!tray) return;
  const c = world.cat;
  const key = [c.name, c.dead, world.hidden, world.quiet, world.settings.sound, Math.round(c.food / 10), c.moodText()].join('|');
  if (!trayDirty && key === trayKey) return;
  trayDirty = false; trayKey = key;
  const cur = () => screen.getCursorScreenPoint();
  const tpl = [
    { label: `${c.name} — ${c.moodText()}`, enabled: false },
    { type: 'separator' },
    { label: 'Open Cat Home…', click: () => openHome() },
    { label: 'Open cat menu here', accelerator: MENU_SHORTCUT, click: () => openMenu(cur(), 'tray') },
  ];
  if (!c.dead) {
    tpl.push(
      { label: 'Feed', submenu: ['fish', 'kibble', 'milk', 'chicken'].map((k) => ({ label: k[0].toUpperCase() + k.slice(1), click: () => handleCmd('feed', { kind: k, ...cur() }) })) },
      { label: `Call ${c.name}`, click: () => handleCmd('call', cur()) },
    );
  } else {
    tpl.push({ label: 'Adopt a new kitten', click: () => handleCmd('adopt') });
  }
  tpl.push(
    { type: 'separator' },
    { label: 'Quiet time (do not disturb)', type: 'checkbox', checked: world.quiet, click: () => handleCmd('quiet') },
    { label: 'Hide cat', type: 'checkbox', checked: world.hidden, click: () => handleCmd('hide') },
    { label: 'Sounds', type: 'checkbox', checked: !!world.settings.sound, click: (mi) => handleCmd('setting', { key: 'sound', value: mi.checked }) },
    { type: 'separator' },
    { label: 'Quit Desktop Cat', click: () => app.quit() },
  );
  tray.setContextMenu(Menu.buildFromTemplate(tpl));
}

// ------------------------------------------------------------------ launch at login
function applyLoginItem(on) {
  try {
    if (isMac || isWin) {
      const portable = isWin && process.env.PORTABLE_EXECUTABLE_FILE;
      app.setLoginItemSettings(portable ? { openAtLogin: !!on, path: portable } : { openAtLogin: !!on });
    } else if (isLinux) {
      const dir = path.join(os.homedir(), '.config', 'autostart');
      const file = path.join(dir, 'desktop-cat.desktop');
      if (on) {
        const exec = process.env.APPIMAGE || process.execPath;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Desktop Cat\nExec="${exec}"\nX-GNOME-Autostart-enabled=true\n`);
      } else if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  } catch (e) { console.warn('[login item]', e.message); }
}

// ------------------------------------------------------------------ lifecycle
app.on('before-quit', () => {
  quitting = true;
  save();
  Hook.stop();
  clearInterval(loop);
});
app.on('will-quit', () => globalShortcut.unregisterAll());
// keep running when the Cat Home window is closed
app.on('window-all-closed', (e) => { if (!quitting) e.preventDefault && e.preventDefault(); });
