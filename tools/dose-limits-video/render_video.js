const { chromium } = require('playwright');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const FPS = 30, out = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  // Fetch Google Fonts through curl (which trusts the proxy CA bundle).
  await p.route(/fonts\.(googleapis|gstatic)\.com/, async route => {
    const url = route.request().url();
    const body = execFileSync('curl', ['-sS', '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36', url], { maxBuffer: 1 << 26 });
    route.fulfill({ body, contentType: url.includes('googleapis') ? 'text/css' : 'font/woff2', headers: { 'access-control-allow-origin': '*' } });
  });
  await p.goto('file://' + path.resolve(__dirname, '../../RT-Dose-Limits-Animation.html') + '?record');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1000);
  console.log('fonts:', await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).join(',')));
  const dur = await p.evaluate(() => window.__duration);
  const n = Math.round(dur * FPS);
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', path.resolve(__dirname, '../../audio/RT-Dose-Limits-narration.mp3'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i <= n; i++) {
    await p.evaluate(t => window.__seek(t), i / FPS);
    const buf = await p.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 600 === 0) console.log(`frame ${i}/${n}`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await b.close();
  console.log('done');
})();
