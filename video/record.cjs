// Renders UT-Probe-Delay-vs-Display-Delay.html to an MP4, frame by frame.
//
//   [PAGE=UT-Epoch-Range.html] NODE_PATH=$(npm root -g) node video/record.cjs [out.mp4]
//   NODE_PATH=$(npm root -g) node video/record.cjs --stills 10,40,90   (PNG stills only)
//
// Needs Playwright and ffmpeg (set FFMPEG=/path/to/ffmpeg if it isn't on PATH).
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Page to record: PAGE=UT-Epoch-Range.html (default: the probe delay lesson)
const PAGE = path.resolve(__dirname, '..', process.env.PAGE || 'UT-Probe-Delay-vs-Display-Delay.html');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = +(process.env.FPS || 30);
const args = process.argv.slice(2);

(async () => {
  const launch = {};
  if (process.env.CHROMIUM) launch.executablePath = process.env.CHROMIUM;
  if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY };
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  // Fetch Google Fonts with curl so they load even where the browser can't reach them directly (e.g. behind a proxy).
  const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => {
    const url = route.request().url();
    try {
      const body = execFileSync('curl', ['-sSL', '-A', UA, url], { maxBuffer: 1 << 26 });
      route.fulfill({ body, contentType: url.includes('googleapis') ? 'text/css' : 'font/woff2', headers: { 'access-control-allow-origin': '*' } });
    } catch (e) { route.abort(); }
  });
  await page.goto('file://' + PAGE + '?record');
  await page.waitForFunction(() => window.__video && window.__video.ready, null, { timeout: 30000 });
  const fontsOk = await page.evaluate(() => [...document.fonts].some(f => f.family.includes('Manrope') && f.status === 'loaded'));
  if (!fontsOk) console.warn('warning: web fonts did not load; falling back to system fonts');
  const dur = await page.evaluate(() => window.__video.duration);

  if (args[0] === '--stills') {
    const dir = args[2] || path.resolve(__dirname, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    for (const t of args[1].split(',').map(Number)) {
      const b64 = await page.evaluate(t => window.__video.frame(t, 0.9), t);
      fs.writeFileSync(path.join(dir, `t${String(t).padStart(5, '0')}.jpg`), Buffer.from(b64, 'base64'));
    }
    await browser.close();
    return;
  }

  const out = path.resolve(args[0] || 'UT-Probe-Delay-vs-Display-Delay.mp4');
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round(dur * FPS);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const b64 = await page.evaluate(t => window.__video.frame(t, 0.95), i / FPS);
    if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    if (i % (FPS * 30) === 0) console.log(`${(i / FPS).toFixed(0)}s / ${dur}s  (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  console.log('wrote ' + out);
})().catch(e => { console.error(e); process.exit(1); });
