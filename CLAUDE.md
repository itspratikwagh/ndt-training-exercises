# Notes for Claude Code

## Voice-overs: always use Kokoro (af_heart)

Every voice-over, narration track or spoken audio made for this repo (exercise pages, lesson videos,
narrated animations) uses the same house voice:

- **Engine:** Kokoro v1.0 (82M parameters) through the `kokoro-onnx` Python package. It runs offline,
  so narration text is never sent to an outside service.
- **Voice:** `af_heart` (US English, female) at speed 1.0.
- **License:** Apache 2.0, so the audio is fine to use in training materials, including commercially.

Generate audio with `tools/voiceover/kokoro_say.py`. It installs `kokoro-onnx` and downloads the model
files from GitHub on first run (Hugging Face is blocked in the cloud environment, so Piper voices and
other Hugging Face-hosted models will not download; Kokoro's files come from GitHub releases).

```
python3 tools/voiceover/kokoro_say.py "Text to speak." video/audio/clip.mp3
python3 tools/voiceover/kokoro_say.py --json lines.json   # [{"text": ..., "out": ...}, ...]
```

- Narrated lesson pages play pre-recorded clips (see `ET-Impedance-Plane.html`). After changing any
  narration or feedback text, rerun `node tools/voiceover/build_lesson_audio.cjs <page> <audio dir>`:
  it records only new or changed lines, deletes unused clips and updates the page's clip manifest.
- Do not commit the model files (`kokoro-v1.0.onnx`, `voices-v1.0.bin`, about 350 MB). They live in
  `~/.cache/kokoro` (or `KOKORO_DIR`).
- Commit the generated audio (mp3, mono 64 kbps) next to the page or under `video/audio/`.
- Do not use other TTS engines or the browser's Web Speech API for shipped narration
  unless the user asks for it.
- Write the narration so it reads well aloud: spell out units ("kilohertz", "percent I A C S"),
  and avoid symbols the model would read literally.
