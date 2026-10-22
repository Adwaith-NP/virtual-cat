'use strict';
// Lightweight system stats for the hero's "diagnostics" scan.
const os = require('os');

let last = sample();
let cpuPct = 0;

function sample() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const k of Object.keys(c.times)) total += c.times[k];
    idle += c.times.idle;
  }
  return { idle, total, t: Date.now() };
}

function cpu() {
  const s = sample();
  if (s.t - last.t > 400) {
    const dt = s.total - last.total, di = s.idle - last.idle;
    if (dt > 0) cpuPct = Math.round(100 * (1 - di / dt));
    last = s;
  }
  return cpuPct;
}

function info(extra) {
  // macOS counts file cache as "used", which would always look ~100% full
  const mem = process.platform === 'darwin' ? null : 1 - os.freemem() / os.totalmem();
  const up = os.uptime();
  return {
    cpu: cpu(),
    mem: mem == null ? null : Math.round(mem * 100),
    memGB: Math.round(os.totalmem() / 1073741824),
    cores: os.cpus().length,
    uptime: up > 86400 ? `${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h` : `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`,
    platform: { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[process.platform] || process.platform,
    ...(extra || {}),
  };
}

module.exports = { info, cpu };
