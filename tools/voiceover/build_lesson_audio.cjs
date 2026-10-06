#!/usr/bin/env node
// Record the voice-over for a narrated lesson page with Kokoro (see CLAUDE.md) and update its clip manifest.
//
//   node tools/voiceover/build_lesson_audio.cjs ET-Impedance-Plane.html video/audio/ET-Impedance-Plane
//
// The page must define allSpokenLines() -> [{ id, caption, speak }] and contain the marker
//   /*VO-MANIFEST*/var VO = {...};/*END-VO-MANIFEST*/
// Only lines without a clip are recorded, clips no longer used are deleted, and VO is rewritten
// with each clip's length in seconds. Needs Playwright (preinstalled in the cloud environment) and ffmpeg.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const [page = 'ET-Impedance-Plane.html', outDir = 'video/audio/ET-Impedance-Plane'] = process.argv.slice(2);
const root = path.resolve(__dirname, '..', '..');
const pagePath = path.resolve(root, page);
const dir = path.resolve(root, outDir);

(async () => {
  const browser = await chromium.launch();
  const tab = await browser.newPage();
  await tab.goto('file://' + pagePath);
  const lines = await tab.evaluate(() => allSpokenLines());
  await browser.close();
  fs.mkdirSync(dir, { recursive: true });

  const todo = lines.filter(l => !fs.existsSync(path.join(dir, l.id + '.mp3')));
  console.log(`${lines.length} lines, ${todo.length} to record`);
  if (todo.length) {
    const job = path.join(dir, '.job.json');
    fs.writeFileSync(job, JSON.stringify(todo.map(l => ({ text: l.speak, out: path.join(dir, l.id + '.mp3') }))));
    try { execFileSync('python3', [path.join(__dirname, 'kokoro_say.py'), '--json', job], { stdio: 'inherit' }); }
    finally { fs.rmSync(job, { force: true }); }
  }

  const keep = new Set(lines.map(l => l.id + '.mp3'));
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.mp3') && !keep.has(f)) { fs.rmSync(path.join(dir, f)); console.log('removed stale', f); }

  const vo = {};
  for (const l of lines) {
    const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(dir, l.id + '.mp3')]).toString().trim();
    vo[l.id] = Math.round(parseFloat(d) * 100) / 100;
  }
  const html = fs.readFileSync(pagePath, 'utf8');
  const re = /\/\*VO-MANIFEST\*\/[\s\S]*?\/\*END-VO-MANIFEST\*\//;
  if (!re.test(html)) throw new Error('VO-MANIFEST marker not found in ' + page);
  fs.writeFileSync(pagePath, html.replace(re, '/*VO-MANIFEST*/var VO = ' + JSON.stringify(vo) + ';/*END-VO-MANIFEST*/'));
  const total = Object.values(vo).reduce((a, b) => a + b, 0);
  console.log(`manifest written: ${lines.length} clips, ${(total / 60).toFixed(1)} min of audio`);
})();
