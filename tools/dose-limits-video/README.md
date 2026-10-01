# Dose Limits video: narration & rendering

Tooling behind `RT-Dose-Limits-Animation.html`, its voiceover
(`audio/RT-Dose-Limits-narration.mp3`) and the exported
`video/RT-Dose-Limits-Explained.mp4`.

The narration script is the `CAPTIONS` table inside the HTML page. Each line
is synthesized with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx)
(offline, voice `af_heart`). Where a spoken line runs longer than the gap
before the next caption, the build inserts a *hold*: the animation freezes
at a moment when nothing is mid-transition until the narrator finishes. The
holds are written back into the page's `HOLDS` table, so the page, audio and
MP4 always share one timeline.

## Regenerate after editing captions

```sh
pip install kokoro-onnx soundfile
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

# 1. narration + holds (run from the folder holding the model files)
node tools/dose-limits-video/dump_timeline.js | python3 tools/dose-limits-video/build_narration.py

# 2. MP4 (needs Playwright + ffmpeg; about 10 minutes)
node tools/dose-limits-video/render_video.js video/RT-Dose-Limits-Explained.mp4
```

Pronunciation fixes that apply only to speech, not captions (for example
TEDE spelled out as letters), live in the `SAY` list in `build_narration.py`.
