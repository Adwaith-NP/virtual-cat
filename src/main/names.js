'use strict';
const fs = require('fs');
const path = require('path');

const CAT_NAMES = [
  'Mochi', 'Snowball', 'Luna', 'Milo', 'Tofu', 'Cotton', 'Yuki', 'Pearl', 'Marshmallow', 'Coco',
  'Biscuit', 'Nimbus', 'Sugar', 'Casper', 'Dumpling', 'Pixel', 'Muffin', 'Neko', 'Blizzard', 'Frost',
];

const FAKE_FILES = [
  'homework_FINAL_v3.docx', 'taxes_2026.pdf', 'budget.xlsx', 'vacation.jpg', 'resume_new.pdf',
  'todo.txt', 'presentation.pptx', 'secret_plans.txt', 'cat_pics.zip', 'notes.md', 'invoice_042.pdf',
  'Very Important', 'Screenshot 2026.png', 'project.js', 'meeting_notes.docx', 'photos', 'report.pdf',
];

const KIND_BY_EXT = {
  pdf: 'pdf', doc: 'doc', docx: 'doc', rtf: 'doc', pages: 'doc', odt: 'doc', md: 'txt', txt: 'txt',
  xls: 'xls', xlsx: 'xls', csv: 'xls', numbers: 'xls', ods: 'xls',
  ppt: 'ppt', pptx: 'ppt', key: 'ppt', odp: 'ppt',
  png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', heic: 'img', webp: 'img', svg: 'img', bmp: 'img', psd: 'img',
  zip: 'zip', rar: 'zip', '7z': 'zip', gz: 'zip', tar: 'zip', dmg: 'zip', iso: 'zip',
  js: 'code', ts: 'code', py: 'code', java: 'code', c: 'code', cpp: 'code', html: 'code', css: 'code', json: 'code', sh: 'code', go: 'code', rs: 'code',
  app: 'app', exe: 'app', lnk: 'app', desktop: 'app', msi: 'app',
};

function describe(name, isDir) {
  let display = name.replace(/\.(lnk|url|desktop)$/i, '');
  if (isDir) return { name: display, kind: 'folder', ext: '' };
  const m = /\.([a-z0-9]{1,6})$/i.exec(name);
  const ext = m ? m[1].toLowerCase() : '';
  if (/\.(lnk|desktop)$/i.test(name)) return { name: display, kind: 'app', ext: 'app' };
  return { name: display, kind: KIND_BY_EXT[ext] || 'txt', ext: ext || 'file' };
}

// Read-only: only the *names* of items on the Desktop are used, files are never touched.
function desktopItems(desktopPath) {
  try {
    return fs.readdirSync(desktopPath, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.') && !/^(desktop\.ini|thumbs\.db|\$recycle\.bin)$/i.test(d.name))
      .slice(0, 200)
      .map((d) => describe(d.name, d.isDirectory()));
  } catch (e) {
    return [];
  }
}

function fakeItem() {
  const n = FAKE_FILES[Math.floor(Math.random() * FAKE_FILES.length)];
  return describe(n, !/\.[a-z0-9]+$/i.test(n));
}

module.exports = { CAT_NAMES, desktopItems, fakeItem, describe, path };
