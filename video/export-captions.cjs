// Writes the subtitle file (.srt) and the voice-over script (.md) for an Epoch lesson video,
// straight from the page's timeline so the timings always match the recorded MP4.
//
//   NODE_PATH=$(npm root -g) node video/export-captions.cjs UT-Epoch-Range.html
//
// Output: video/<page-name>.srt and video/<page-name>-voiceover.md
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const pageFile = process.argv[2];
if (!pageFile) { console.error('usage: export-captions.cjs <page.html>'); process.exit(1); }
const base = path.basename(pageFile, '.html');

const srtTime = s => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
const mmss = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(__dirname, '..', pageFile) + '?record');
  await page.waitForFunction(() => window.__video && window.__video.ready, null, { timeout: 30000 });
  const v = await page.evaluate(() => ({ title: window.__video.title, duration: window.__video.duration, cues: window.__video.cues }));
  await browser.close();

  const srt = v.cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
  fs.writeFileSync(path.join(__dirname, base + '.srt'), srt);

  const words = v.cues.reduce((n, c) => n + c.text.split(/\s+/).length, 0);
  const md = [
    `# Voice-over script: ${v.title}`,
    '',
    `For \`${pageFile}\` and its MP4 (1920×1080, ${mmss(v.duration)}). The subtitles in the video and in \`${base}.srt\` use exactly these lines.`,
    '',
    '**How to record**',
    '- Read each line starting at its timecode. Each line is timed for a steady pace of about 150 words per minute, and the on-screen action (key presses, knob turns) happens during the line.',
    '- If you stretch a line, slow the clip slightly in your editor, or leave a small pause before the next line.',
    `- ${v.cues.length} lines, ${words} words in total.`,
    '',
    '| Time | Line |',
    '|---|---|',
    ...v.cues.map(c => `| \`${mmss(c.start)}\` | ${c.text} |`),
    ''
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, base + '-voiceover.md'), md);
  console.log(`wrote video/${base}.srt and video/${base}-voiceover.md (${v.cues.length} cues, ${mmss(v.duration)})`);
})().catch(e => { console.error(e); process.exit(1); });
