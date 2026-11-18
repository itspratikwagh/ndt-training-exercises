#!/usr/bin/env python3
"""Record a video's narration with the house voice and lay it out on a timeline.

  python3 tools/video/build_narration.py video/src/<name>

Reads <dir>/script.json ([{id, scene, cap, text}, ...]), records one clip per line into
video/audio/<name>/<id>.mp3 with tools/voiceover/kokoro_say.py (only lines whose text changed),
then writes <dir>/timeline.js (window.TIMELINE) and <dir>/narration.wav (all clips on the timeline).
"""
import hashlib, json, os, subprocess, sys

LEAD, GAP, SCENE_GAP, TAIL, SR = 1.0, 0.45, 1.1, 2.5, 24000
src = os.path.abspath(sys.argv[1])
root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
name = os.path.basename(src)
adir = os.path.join(root, "video", "audio", name)
os.makedirs(adir, exist_ok=True)
lines = json.load(open(os.path.join(src, "script.json")))
stamp_path = os.path.join(adir, "clips.json")
stamps = json.load(open(stamp_path)) if os.path.exists(stamp_path) else {}

todo = []
for ln in lines:
    h = hashlib.sha1(ln["text"].encode()).hexdigest()[:10]
    out = os.path.join(adir, ln["id"] + ".mp3")
    if stamps.get(ln["id"]) != h or not os.path.exists(out):
        todo.append({"text": ln["text"], "out": out})
    stamps[ln["id"]] = h
if todo:
    subprocess.run([sys.executable, os.path.join(root, "tools", "voiceover", "kokoro_say.py"), "--json", "-"],
                   input=json.dumps(todo).encode(), check=True)
keep = {ln["id"] + ".mp3" for ln in lines} | {"clips.json"}
for f in os.listdir(adir):
    if f not in keep:
        os.remove(os.path.join(adir, f))
stamps = {ln["id"]: stamps[ln["id"]] for ln in lines}
json.dump(stamps, open(stamp_path, "w"), indent=1)

def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", p]).decode().strip())

t, tl, inputs, filt = LEAD, [], [], []
for i, ln in enumerate(lines):
    p = os.path.join(adir, ln["id"] + ".mp3")
    d = dur(p)
    last = i == len(lines) - 1
    gap = TAIL if last else (SCENE_GAP if lines[i + 1]["scene"] != ln["scene"] else GAP)
    tl.append({"id": ln["id"], "scene": ln["scene"], "cap": ln.get("cap", ""), "text": ln["text"],
               "s": round(t, 3), "d": round(d, 3), "e": round(t + d + gap, 3)})
    inputs += ["-i", p]
    filt.append(f"[{i}:a]aresample={SR},adelay={int(round(t * 1000))}[a{i}]")
    t += d + gap
total = round(t, 3)
filt.append("".join(f"[a{i}]" for i in range(len(lines))) + f"amix=inputs={len(lines)}:normalize=0,apad=whole_dur={total}[out]")
subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(filt),
                       "-map", "[out]", "-ac", "1", "-ar", str(SR), os.path.join(src, "narration.wav")])
open(os.path.join(src, "timeline.js"), "w").write(
    "window.TIMELINE = " + json.dumps({"total": total, "lines": tl}, indent=1) + ";\n")
print(f"{len(todo)} clips recorded, {len(lines)} lines, total {total:.1f}s")
