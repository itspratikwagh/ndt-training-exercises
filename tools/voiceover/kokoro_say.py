#!/usr/bin/env python3
"""House voice-over: Kokoro v1.0 text-to-speech (kokoro-onnx, Apache 2.0), voice af_heart, speed 1.0.

Runs fully offline once the model files are present, so narration text never leaves the machine.
The model loads once for all lines.

Usage:
  python3 tools/voiceover/kokoro_say.py "Some text." out.mp3          # one line
  python3 tools/voiceover/kokoro_say.py --json lines.json              # many lines
  echo '[{"text": "...", "out": "a.mp3"}]' | python3 tools/voiceover/kokoro_say.py --json -

Output format follows the extension: .wav is written directly, .mp3 / .m4a / .ogg go through ffmpeg.
Each JSON item may also carry "voice" or "speed" to override the defaults for that line.

Setup (done automatically on first run if missing):
  pip install kokoro-onnx soundfile
  model files from github.com/thewh1teagle/kokoro-onnx releases (tag model-files-v1.0):
    kokoro-v1.0.onnx, voices-v1.0.bin  -> KOKORO_DIR (default ~/.cache/kokoro)
  The model files are about 350 MB. Do not commit them.

Env: KOKORO_DIR, KOKORO_VOICE (default af_heart), KOKORO_SPEED (default 1.0)
"""
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = ["kokoro-v1.0.onnx", "voices-v1.0.bin"]
MODEL_DIR = os.path.expanduser(os.environ.get("KOKORO_DIR", "~/.cache/kokoro"))
VOICE = os.environ.get("KOKORO_VOICE", "af_heart")
SPEED = float(os.environ.get("KOKORO_SPEED", "1.0"))


def ensure_setup():
    try:
        import kokoro_onnx, soundfile  # noqa: F401
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "kokoro-onnx", "soundfile"])
    os.makedirs(MODEL_DIR, exist_ok=True)
    for f in FILES:
        p = os.path.join(MODEL_DIR, f)
        if not os.path.exists(p) or os.path.getsize(p) == 0:
            print(f"downloading {f} ...", file=sys.stderr)
            urllib.request.urlretrieve(RELEASE + f, p + ".part")
            os.replace(p + ".part", p)


def write_audio(samples, sr, out):
    import soundfile as sf
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    if out.lower().endswith(".wav"):
        sf.write(out, samples, sr)
        return
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav = tmp.name
    try:
        sf.write(wav, samples, sr)
        subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-b:a", "64k", out])
    finally:
        os.remove(wav)


def main():
    args = sys.argv[1:]
    if len(args) == 2 and args[0] == "--json":
        items = json.load(sys.stdin if args[1] == "-" else open(args[1]))
    elif len(args) == 2:
        items = [{"text": args[0], "out": args[1]}]
    else:
        sys.exit(__doc__)
    ensure_setup()
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(MODEL_DIR, FILES[0]), os.path.join(MODEL_DIR, FILES[1]))
    for it in items:
        samples, sr = k.create(it["text"], voice=it.get("voice", VOICE), speed=float(it.get("speed", SPEED)), lang="en-us")
        write_audio(samples, sr, it["out"])
        print(f"{it['out']}  {len(samples) / sr:.2f}s")


if __name__ == "__main__":
    main()
