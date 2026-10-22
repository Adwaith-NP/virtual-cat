'use strict';
/*
 * Optional global input hook (uiohook-napi). Listen-only: it never blocks or
 * changes your input. Used for "right-click anywhere", closing the menu when
 * you click elsewhere, and Esc to put a tool away.
 * On macOS it needs Accessibility permission; without it the app still works
 * (right-click the cat, use the tray icon, or the keyboard shortcut).
 */
let mod = null;
let running = false;

function start(handlers) {
  if (running) return { ok: true };
  try {
    mod = mod || require('uiohook-napi');
  } catch (e) {
    return { ok: false, reason: 'unavailable' };
  }
  try {
    const { uIOhook } = mod;
    uIOhook.removeAllListeners && uIOhook.removeAllListeners();
    uIOhook.on('mousedown', (e) => safe(handlers.mousedown, e));
    uIOhook.on('mouseup', (e) => safe(handlers.mouseup, e));
    uIOhook.on('keydown', (e) => safe(handlers.keydown, e));
    uIOhook.start();
    running = true;
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
}

function safe(fn, e) {
  try { fn && fn(e); } catch (err) { console.error('[hook]', err); }
}

function stop() {
  if (!running || !mod) return;
  try { mod.uIOhook.stop(); } catch (e) { /* ignore */ }
  running = false;
}

const KEY_ESCAPE = 1; // libuiohook VC_ESCAPE

module.exports = { start, stop, KEY_ESCAPE, isRunning: () => running };
