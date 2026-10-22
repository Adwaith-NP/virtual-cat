// Renders build/icon.png (1024²) from the real cat artwork: `npm run icon`
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const html = `<!doctype html><html><body style="margin:0;background:transparent">
<canvas id="c" width="1024" height="1024"></canvas>
<script src="../src/renderer/catArt.js"></script>
<script>
  const c = document.getElementById('c'), x = c.getContext('2d');
  // rounded-square background
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
  window.done = c.toDataURL('image/png');
</script></body></html>`;

app.whenReady().then(async () => {
  const tmp = path.join(__dirname, '_icon.html');
  fs.writeFileSync(tmp, html);
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, webPreferences: { offscreen: true } });
  await win.loadFile(tmp);
  const url = await win.webContents.executeJavaScript('window.done');
  fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), Buffer.from(url.split(',')[1], 'base64'));
  fs.unlinkSync(tmp);
  console.log('wrote build/icon.png');
  app.quit();
});
