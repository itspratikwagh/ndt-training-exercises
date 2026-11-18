#!/usr/bin/env node
/* Render a scene page to MP4.

   node tools/video/render_video.cjs video/src/<name> video/<name>.mp4          # full video
   node tools/video/render_video.cjs video/src/<name> --stills out_dir 5 12.5   # PNG stills at given times

   The scene page (<dir>/scene.html) must expose window.renderAt(seconds) and window.TOTAL and draw
   on a 1920x1080 <canvas id="c">. Audio comes from <dir>/narration.wav (tools/video/build_narration.py). */
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const FPS = 30, WORKERS = Math.max(1, Math.min(4, os.cpus().length));

(async () => {
  const src = path.resolve(process.argv[2]);
  const url = 'file://' + path.join(src, 'scene.html') + '?render';
  const browser = await chromium.launch();
  const open = async () => {
    const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    p.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
    await p.goto(url); await p.evaluate(() => document.fonts.ready); return p;
  };
  if (process.argv[3] === '--stills') {
    const dir = path.resolve(process.argv[4]); fs.mkdirSync(dir, { recursive: true });
    const p = await open();
    for (const ts of process.argv.slice(5)) {
      const data = await p.evaluate(t => { window.renderAt(t); return document.getElementById('c').toDataURL('image/jpeg', .8); }, +ts);
      fs.writeFileSync(path.join(dir, `t${(+ts).toFixed(1).padStart(6, '0')}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
    }
    await browser.close(); return;
  }
  const out = path.resolve(process.argv[3]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
  const p0 = await open(); const total = await p0.evaluate(() => window.TOTAL); await p0.close();
  const frames = Math.ceil(total * FPS), per = Math.ceil(frames / WORKERS);
  let done = 0;
  const timer = setInterval(() => console.log(`${done}/${frames} frames`), 30000);
  await Promise.all([...Array(WORKERS)].map(async (_, w) => {
    const p = await open(), a = w * per, b = Math.min(frames, a + per);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), path.join(tmp, `part${w}.mp4`)],
      { stdio: ['pipe', 'inherit', 'inherit'] });
    const closed = new Promise((res, rej) => ff.on('close', c => c ? rej(new Error('ffmpeg ' + c)) : res()));
    for (let f = a; f < b; f++) {
      const data = await p.evaluate(t => { window.renderAt(t); return document.getElementById('c').toDataURL('image/jpeg', .93); }, f / FPS);
      if (!ff.stdin.write(Buffer.from(data.split(',')[1], 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
      done++;
    }
    ff.stdin.end(); await closed; await p.close();
  }));
  clearInterval(timer); await browser.close();
  fs.writeFileSync(path.join(tmp, 'list.txt'), [...Array(WORKERS)].map((_, w) => `file 'part${w}.mp4'`).join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-i', path.join(src, 'narration.wav'),
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', out], { stdio: 'inherit' });
  fs.rmSync(tmp, { recursive: true });
  console.log('wrote', out);
})();
