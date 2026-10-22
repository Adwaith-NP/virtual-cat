'use strict';
const fs = require('fs');
const path = require('path');

// Tiny JSON save file with an atomic write and a backup copy.
// `legacy` lists older save files to import once (e.g. from the "Desktop Cat" days).
class Store {
  constructor(dir, name, legacy) {
    this.dir = dir;
    this.file = path.join(dir, name || 'desktop-buddies-save.json');
    this.backup = this.file + '.bak';
    this.legacy = legacy || [];
  }

  load() {
    for (const f of [this.file, this.backup, ...this.legacy.flatMap((l) => [l, l + '.bak'])]) {
      try {
        const data = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (data && typeof data === 'object') return data;
      } catch (e) { /* try the next one */ }
    }
    return null;
  }

  save(data) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.backup);
      fs.renameSync(tmp, this.file);
      return true;
    } catch (e) {
      console.error('[store] save failed', e);
      return false;
    }
  }
}

module.exports = { Store };
