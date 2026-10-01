import json, math, re, subprocess, sys, os
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HTML = f'{REPO}/RT-Dose-Limits-Animation.html'
OUT_MP3 = f'{REPO}/audio/RT-Dose-Limits-narration.mp3'
VOICE, SPEED, GAP, SR = 'af_heart', 1.0, 0.45, 24000
SAY = [  # spoken-only substitutions for clearer pronunciation
    (r'\bTEDE\b', 'T E D E'),
    (r'section 20\.1206', 'section twenty, twelve oh six'),
    (r'\bmillirem\b', 'milli-rem'),
]
scenes = json.loads(sys.stdin.read())
k = Kokoro(os.environ.get('KOKORO_MODEL', 'kokoro-v1.0.onnx'), os.environ.get('KOKORO_VOICES', 'voices-v1.0.bin'))

holds, cues, cursor = {}, [], 0.0
for s in scenes:
    caps, D, hs = s['captions'], s['dur'], []
    clips = []
    for t, text in caps:
        spoken = text
        for a, b in SAY: spoken = re.sub(a, b, spoken)
        audio, sr = k.create(spoken, voice=VOICE, speed=SPEED, lang='en-us')
        assert sr == SR
        # trim leading/trailing near-silence so timing is tight
        nz = np.where(np.abs(audio) > 0.01)[0]
        audio = audio[max(0, nz[0] - 600): nz[-1] + 1200] if len(nz) else audio
        clips.append(audio)
    for i, (t, text) in enumerate(caps):
        last = i == len(caps) - 1
        seg_end = D - 0.5 if last else caps[i + 1][0]
        need = len(clips[i]) / SR + GAP
        if need > seg_end - t:
            # freeze at a moment when nothing is mid-animation, as late in the segment as possible
            busy = lambda x: any(a < x < b for a, b in s['anims'])
            steps = [round(seg_end - 0.01 - j * 0.01, 2) for j in range(int((seg_end - t) * 100))]
            d = next((x for x in steps if not busy(x)), seg_end - 0.01)
            hs.append([round(d, 2), math.ceil((need - (seg_end - t)) * 100) / 100])
    hs.sort()
    holds[s['id']] = hs
    for (t, text), clip in zip(caps, clips):
        shift = sum(h for d, h in hs if d < t)
        cues.append((cursor + t + shift, clip, text))
    cursor += D + sum(h for _, h in hs)

total = cursor
track = np.zeros(int(math.ceil(total * SR)) + SR, dtype=np.float32)
for start, clip, _ in cues:
    i = int(round(start * SR)); track[i:i + len(clip)] += clip
track = track[:int(math.ceil(total * SR))]
sf.write('narration.wav', track, SR)
os.makedirs(os.path.dirname(OUT_MP3), exist_ok=True)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', 'narration.wav', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
                '-ar', '44100', '-ac', '1', '-b:a', '96k', OUT_MP3], check=True)

html = open(HTML).read()
compact = {k: v for k, v in holds.items() if v}
html = re.sub(r'/\*HOLDS\*/.*?/\*END-HOLDS\*/', '/*HOLDS*/' + json.dumps(compact, separators=(',', ':')) + '/*END-HOLDS*/', html, flags=re.S)
open(HTML, 'w').write(html)
print(f'total {total:.2f}s, {len(cues)} lines, holds added {sum(h for v in holds.values() for _, h in v):.1f}s')
for k_, v in compact.items(): print(k_, v)
