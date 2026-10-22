// Renders the app icon and tray icons from the real artwork: `npm run icon`
//   build/icon.png (1024²), build/tray-cat.png and build/tray-ironman.png (64²)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const html = `<!doctype html><html><body style="margin:0;background:transparent">
<canvas id="c" width="1024" height="1024"></canvas><canvas id="t1" width="64" height="64"></canvas><canvas id="t2" width="64" height="64"></canvas>
<script src="../src/renderer/catArt.js"></script>
<script src="../src/renderer/ironArt.js"></script>
<script>
  const c = document.getElementById('c'), x = c.getContext('2d');
  const r = 220;
  x.beginPath(); x.moveTo(r, 40); x.arcTo(984, 40, 984, 984, r); x.arcTo(984, 984, 40, 984, r); x.arcTo(40, 984, 40, 40, r); x.arcTo(40, 40, 984, 40, r); x.closePath();
  const g = x.createLinearGradient(0, 40, 0, 984); g.addColorStop(0, '#b9a8ff'); g.addColorStop(1, '#7a66ff');
  x.fillStyle = g; x.fill();
  x.save(); x.clip();
  x.fillStyle = 'rgba(255,255,255,0.12)';
  x.beginPath(); x.ellipse(512, 1010, 470, 150, 0, 0, Math.PI * 2); x.fill();
  x.translate(512, 975);
  x.scale(11.5, 11.5);
  const pose = CatArt.makePose('sitFront', { t: 0, T: 0.4, phase: 0, m: { tailUp: 1 } });
  CatArt.drawCat(x, pose, { eyes: 'normal', open: 1, pupil: 0.7, mouth: 'w', blush: 0.6, lookX: 0, lookY: 0.1 }, { T: 0.4, palette: 'white', eyes: 'blue' });
  x.restore();

  // tray: cat face
  const t1 = document.getElementById('t1').getContext('2d');
  t1.translate(32, 82); t1.scale(1.55, 1.55);
  CatArt.drawCat(t1, CatArt.makePose('sitFront', { t: 0, T: 0.4, phase: 0, m: {} }), { eyes: 'normal', open: 1, pupil: 0.8, mouth: 'w' }, { T: 0.4, palette: 'white', eyes: 'blue' });

  // tray: arc reactor
  const t2 = document.getElementById('t2').getContext('2d');
  const R = 30;
  t2.translate(32, 32);
  t2.beginPath(); t2.arc(0, 0, R, 0, Math.PI * 2); t2.fillStyle = '#1a2230'; t2.fill();
  t2.lineWidth = 3; t2.strokeStyle = '#9aa6b8'; t2.stroke();
  const gg = t2.createRadialGradient(0, 0, 2, 0, 0, R - 4); gg.addColorStop(0, '#ffffff'); gg.addColorStop(0.35, '#bff6ff'); gg.addColorStop(1, '#2aa6e0');
  t2.beginPath(); t2.arc(0, 0, R - 6, 0, Math.PI * 2); t2.fillStyle = gg; t2.fill();
  t2.strokeStyle = 'rgba(20,40,60,0.6)'; t2.lineWidth = 2.4;
  for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; t2.beginPath(); t2.moveTo(Math.cos(a) * 11, Math.sin(a) * 11); t2.lineTo(Math.cos(a) * (R - 7), Math.sin(a) * (R - 7)); t2.stroke(); }
  t2.beginPath(); t2.arc(0, 0, 9, 0, Math.PI * 2); t2.fillStyle = '#ffffff'; t2.fill();

  window.done = [c.toDataURL('image/png'), document.getElementById('t1').toDataURL('image/png'), document.getElementById('t2').toDataURL('image/png')];
</script></body></html>`;

app.whenReady().then(async () => {
  const tmp = path.join(__dirname, '_icon.html');
  fs.writeFileSync(tmp, html);
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, webPreferences: { offscreen: true } });
  await win.loadFile(tmp);
  const urls = await win.webContents.executeJavaScript('window.done');
  const out = path.join(__dirname, '..', 'build');
  fs.mkdirSync(out, { recursive: true });
  ['icon.png', 'tray-cat.png', 'tray-ironman.png'].forEach((f, i) => fs.writeFileSync(path.join(out, f), Buffer.from(urls[i].split(',')[1], 'base64')));
  fs.unlinkSync(tmp);
  console.log('wrote build/icon.png, build/tray-cat.png, build/tray-ironman.png');
  app.quit();
});
