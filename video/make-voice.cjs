// Synthesizes the voice-over for an Epoch lesson video and times the video to it.
//
//   NODE_PATH=$(npm root -g) node video/make-voice.cjs UT-Epoch-Range.html
//
// 1. Speaks every cue's line (cue.speak, or cue.say) with an offline TTS voice.
// 2. Writes the measured length of each line into the page (between /*VOICE*/ and /*END*/),
//    so each line gets exactly its spoken time and the actions and subtitles stay in sync.
// 3. Mixes one narration track: video/audio/<page>-voice.mp3, which the page's player and
//    video/record.cjs (AUDIO=...) use.
//
// Voices (TTS env): pico (default, SVOX Pico en-US), slt (Festival HTS), mbrola (espeak-ng + mbrola us1).
// Needs: apt install libttspico-utils festival festvox-us-slt-hts espeak-ng mbrola-us1, and ffmpeg (FFMPEG=...).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pageFile = process.argv[2];
if (!pageFile) { console.error('usage: make-voice.cjs <page.html>'); process.exit(1); }
const ROOT = path.resolve(__dirname, '..');
const base = path.basename(pageFile, '.html');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const TTS = process.env.TTS || 'pico';
const work = path.join(process.env.TMPDIR || '/tmp', 'voice-' + base);
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(path.join(__dirname, 'audio'), { recursive: true });

function speak(text, out) {
  if (TTS === 'pico') execFileSync('pico2wave', ['-l', 'en-US', '-w', out, text]);
  else if (TTS === 'slt') execFileSync('text2wave', ['-eval', '(voice_cmu_us_slt_arctic_hts)', '-o', out], { input: text });
  else if (TTS === 'mbrola') execFileSync('espeak-ng', ['-v', 'mb-us1', '-s', '150', '-w', out, text]);
  else throw new Error('unknown TTS ' + TTS);
}
function duration(file) {
  try { execFileSync(FFMPEG, ['-hide_banner', '-i', file], { stdio: 'pipe' }); } catch (e) {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(e.stderr.toString());
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  }
  throw new Error('no duration for ' + file);
}
async function readVideo(browser) {
  const page = await browser.newPage();
  await page.goto('file://' + path.join(ROOT, pageFile) + '?record');
  await page.waitForFunction(() => window.__video && window.__video.ready, null, { timeout: 30000 });
  const v = await page.evaluate(() => ({ duration: window.__video.duration, lead: window.__video.voiceLead, cues: window.__video.cues, all: window.__video.allCues }));
  await page.close();
  return v;
}

(async () => {
  const browser = await chromium.launch();
  let v = await readVideo(browser);

  // 1. speak each line (trimmed of the TTS engine's leading/trailing silence)
  const files = [], lens = [];
  v.all.forEach((c, i) => {
    const raw = path.join(work, `raw${i}.wav`), clip = path.join(work, `cue${i}.wav`);
    speak(c.speak, raw);
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', raw, '-af',
      'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse',
      '-ar', '44100', '-ac', '1', clip]);
    files.push(clip); lens.push(+duration(clip).toFixed(2));
  });

  // 2. write the measured lengths into the page so the timeline follows the voice
  const pagePath = path.join(ROOT, pageFile);
  const src = fs.readFileSync(pagePath, 'utf8');
  if (!/\/\*VOICE\*\/[\s\S]*?\/\*END\*\//.test(src)) throw new Error('page has no /*VOICE*/.../*END*/ marker');
  fs.writeFileSync(pagePath, src.replace(/\/\*VOICE\*\/[\s\S]*?\/\*END\*\//, `/*VOICE*/${JSON.stringify(lens)}/*END*/`));

  // 3. re-read the (now voice-timed) cue starts and mix one narration track
  v = await readVideo(browser);
  await browser.close();
  const args = ['-y', '-loglevel', 'error'];
  files.forEach(f => args.push('-i', f));
  const parts = files.map((f, i) => `[${i}]adelay=${Math.round((v.cues[i].start + v.lead) * 1000)}:all=1[a${i}]`);
  const mix = `${parts.join(';')};${files.map((f, i) => `[a${i}]`).join('')}amix=inputs=${files.length}:normalize=0,apad=whole_dur=${v.duration.toFixed(2)},loudnorm=I=-16:TP=-1.5[out]`;
  const out = path.join(__dirname, 'audio', base + '-voice.mp3');
  args.push('-filter_complex', mix, '-map', '[out]', '-ac', '1', '-ar', '44100', '-b:a', '96k', '-t', v.duration.toFixed(2), out);
  execFileSync(FFMPEG, args);
  console.log(`voice (${TTS}): ${files.length} lines, ${lens.reduce((a, b) => a + b, 0).toFixed(1)} s of speech, video ${v.duration.toFixed(1)} s`);
  console.log('wrote ' + path.relative(ROOT, out) + ' and updated the timings in ' + pageFile);
})().catch(e => { console.error(e); process.exit(1); });
