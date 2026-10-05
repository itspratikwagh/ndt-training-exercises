# Kokoro v1.0 text-to-speech (kokoro-onnx, Apache 2.0), run fully offline.
# Reads a JSON list of {"text": ..., "out": ...} on stdin and writes one WAV per line.
#
#   pip install kokoro-onnx soundfile
#   model files (from github.com/thewh1teagle/kokoro-onnx releases, model-files-v1.0):
#     kokoro-v1.0.onnx, voices-v1.0.bin  -> put them in KOKORO_DIR
#
# Env: KOKORO_DIR (model folder), KOKORO_VOICE (default af_heart), KOKORO_SPEED (default 1.0)
import json, os, sys
import soundfile as sf
from kokoro_onnx import Kokoro

d = os.environ.get("KOKORO_DIR", ".")
voice = os.environ.get("KOKORO_VOICE", "af_heart")
speed = float(os.environ.get("KOKORO_SPEED", "1.0"))
k = Kokoro(os.path.join(d, "kokoro-v1.0.onnx"), os.path.join(d, "voices-v1.0.bin"))
for item in json.load(sys.stdin):
    samples, sr = k.create(item["text"], voice=voice, speed=speed, lang="en-us")
    sf.write(item["out"], samples, sr)
