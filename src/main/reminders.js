'use strict';
/*
 * Reminders: "at this time, tell me to do this". When one is due, the active
 * character comes to the middle of the main screen and announces it.
 * Item: { id, time 'HH:MM', date 'YYYY-MM-DD'|null, repeat, text, enabled,
 *         lastFired (ms), snoozeUntil (ms)|null, done }
 * repeat: once | daily | weekdays | weekends
 */
const REPEATS = new Set(['once', 'daily', 'weekdays', 'weekends']);
const CATCH_UP_MS = 15 * 60 * 1000; // fire if we're up to 15 min late (computer asleep, app starting)

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
let SEQ = 1;
const uid = () => `r${Date.now().toString(36)}${(SEQ++).toString(36)}`;

function validTime(t) { return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }

function at(day, time) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
  return d;
}

function appliesOn(item, day) {
  const wd = day.getDay();
  switch (item.repeat) {
    case 'once': return item.date === ymd(day);
    case 'weekdays': return wd >= 1 && wd <= 5;
    case 'weekends': return wd === 0 || wd === 6;
    default: return true;
  }
}

function clean(item) {
  if (!item || typeof item !== 'object') return null;
  const out = {
    id: typeof item.id === 'string' ? item.id : uid(),
    time: validTime(item.time) ? item.time : '09:00',
    date: typeof item.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(item.date) ? item.date : null,
    repeat: REPEATS.has(item.repeat) ? item.repeat : 'once',
    text: String(item.text || '').slice(0, 200),
    enabled: item.enabled !== false,
    lastFired: Number.isFinite(item.lastFired) ? item.lastFired : 0,
    snoozeUntil: Number.isFinite(item.snoozeUntil) ? item.snoozeUntil : null,
    done: !!item.done,
  };
  if (out.repeat === 'once' && !out.date) out.date = nextDateFor(out.time);
  return out;
}

// For a one-off reminder: today if that time is still ahead, otherwise tomorrow.
function nextDateFor(time, from) {
  const n = from || new Date();
  const today = at(n, time);
  if (today.getTime() > n.getTime() - 30000) return ymd(n);
  const t = new Date(n); t.setDate(t.getDate() + 1);
  return ymd(t);
}

class Reminders {
  constructor(list, onFire) {
    this.list = (Array.isArray(list) ? list : []).map(clean).filter(Boolean);
    this.onFire = onFire || (() => {});
    this.queue = [];
    this.active = null;
  }

  add(a) {
    let item;
    if (a && Number.isFinite(a.inMinutes)) {
      const d = new Date(Date.now() + a.inMinutes * 60000);
      item = clean({ time: hm(d), date: ymd(d), repeat: 'once', text: a.text || `${a.inMinutes}-minute timer is up` });
    } else {
      item = clean({ ...(a || {}), id: undefined, date: a && a.repeat === 'once' ? (a.date || null) : null });
      if (item.repeat === 'once' && !(a && a.date)) item.date = nextDateFor(item.time);
    }
    this.list.push(item);
    this.sort();
    return item;
  }

  update(id, patch) {
    const it = this.list.find((r) => r.id === id);
    if (!it || !patch) return null;
    const merged = clean({ ...it, ...patch, id });
    if (('time' in patch || 'repeat' in patch) && merged.repeat === 'once') { merged.date = nextDateFor(merged.time); merged.done = false; merged.enabled = true; }
    if ('time' in patch || 'date' in patch) merged.lastFired = 0;
    Object.assign(it, merged);
    this.sort();
    return it;
  }

  remove(id) {
    this.list = this.list.filter((r) => r.id !== id);
    this.queue = this.queue.filter((q) => q.id !== id);
  }

  sort() { this.list.sort((a, b) => a.time.localeCompare(b.time)); }

  tick() {
    const n = new Date();
    const t = n.getTime();
    for (const it of this.list) {
      if (!it.enabled || !it.text.trim()) continue;
      if (it.snoozeUntil && t >= it.snoozeUntil) { it.snoozeUntil = null; this.fire(it, true); continue; }
      if (it.snoozeUntil) continue;
      if (!appliesOn(it, n)) continue;
      const occ = at(n, it.time).getTime();
      if (t >= occ && t - occ < CATCH_UP_MS && it.lastFired < occ) {
        it.lastFired = t;
        this.fire(it, false);
      }
    }
  }

  fire(it, snoozed) {
    if (this.queue.some((q) => q.id === it.id) || (this.active && this.active.id === it.id)) return;
    this.queue.push({ id: it.id, text: it.text, time: it.time, snoozed });
    if (!this.active) this.next();
  }

  next() {
    this.active = this.queue.shift() || null;
    if (this.active) this.onFire(this.active);
  }

  // user pressed Done / Snooze / it timed out
  resolve(id, action, minutes) {
    const it = this.list.find((r) => r.id === id);
    if (it) {
      if (action === 'snooze') it.snoozeUntil = Date.now() + (minutes || 5) * 60000;
      else if (it.repeat === 'once') { it.done = true; it.enabled = false; }
    }
    if (this.active && this.active.id === id) this.next();
  }

  // next upcoming reminder (for the UI)
  upcoming() {
    const n = new Date();
    let best = null;
    for (const it of this.list) {
      if (!it.enabled) continue;
      for (let dd = 0; dd < 8; dd++) {
        const day = new Date(n); day.setDate(day.getDate() + dd);
        if (!appliesOn(it, day)) continue;
        const o = it.snoozeUntil || at(day, it.time).getTime();
        if (o < n.getTime() && !it.snoozeUntil) continue;
        if (!best || o < best.at) best = { id: it.id, at: o, text: it.text };
        break;
      }
    }
    return best;
  }

  serialize() { return this.list.map((r) => ({ ...r })); }
}

module.exports = { Reminders, ymd, hm, nextDateFor };
