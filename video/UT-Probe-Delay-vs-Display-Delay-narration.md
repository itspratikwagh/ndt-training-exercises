# Probe Delay vs Display Delay: narration script

Voice-over script for the animated lesson `UT-Probe-Delay-vs-Display-Delay.html` and its MP4 (1920×1080, 7:02).

**How to use it**
- Each section below is one scene. Its time range matches the video exactly.
- Scene lengths allow for about 140 words per minute, so a steady, unhurried read fits. If you run long, slow the clip slightly in your editor, or pause the page and re-record the video with longer scenes (the `dur` values in the page's `SCENES` list).
- "On-screen cues" are the captions that appear in the video, with times inside the scene. Use them to sync your voice with what's happening.
- Epoch terms used throughout: **ZERO OFFSET** (probe delay, in µs) and **DELAY** (display delay, in mm). The two-point calibration is **CAL ZERO** on the thin step, then **CAL VEL** on the thick step. If your Epoch model labels these differently, adjust the script to match.

**Numbers used in the lesson**
- Steel 5920 m/s, water 1480 m/s.
- Contact probe delay 0.81 µs, which shows up as 2.40 mm of extra depth in steel.
- Immersion: 50 mm of water = 67.57 µs round trip, which looks like 200 mm at steel velocity. 1 mm more water shifts every reading about 4 mm.

---

## 01 · Two knobs, one question  `0:00–0:12`

> Probe delay and display delay. Both controls slide the echoes across the screen — but only one of them changes the number you write down. Let's see why.

*28 words · 12 s*

## 02 · Same probe, two answers  `0:12–0:36`

> Two technicians. Same Epoch, same probe, same test block. The reflector is twenty-five millimeters deep — we checked it with calipers. Technician A reads twenty-seven point four. Technician B reads twenty-five point zero. Velocity is set correctly on both instruments. So where did the extra two point four millimeters come from?

On-screen cues:

- `+0s` Same Epoch. Same probe. Same block. Reflector at 25.0 mm.
- `+5s` Tech A reads 27.40 mm
- `+11s` Tech B reads 25.00 mm
- `+16s` Velocity is right on both. Where did the extra 2.40 mm come from?

*51 words · 24 s*

## 03 · Where does time zero start?  `0:36–1:08`

> Watch what happens when the crystal fires. The Epoch starts its clock right then — at the crystal. But the sound isn't in the steel yet. First it has to cross the wear plate and the couplant, and that takes about eight-tenths of a microsecond. The instrument can't tell that this time wasn't spent in steel, so it adds it to every depth. On this probe, that's two point four millimeters.

On-screen cues:

- `+0s` The Epoch starts its clock when the crystal fires
- `+3.5s` …but the sound is still crossing the wear plate and couplant
- `+10s` Each echo is drawn when it gets back to the crystal (slow motion)
- `+19s` That probe time is added to every depth: +2.40 mm

*71 words · 32 s*

## 04 · Probe delay = ZERO OFFSET  `1:08–1:44`

> The fix is ZERO OFFSET — that's the Epoch's name for probe delay. We tell the instrument to ignore the first zero point eight one microseconds. Watch the orange probe time drop off the start of the time base. Zero moves from the crystal to the test surface. The echoes slide left, and the reading drops from twenty-seven point four to twenty-five point zero. The back wall corrects itself too — fifty-two point four becomes fifty. Zero offset shifts every reading by the same amount.

On-screen cues:

- `+0s` The fix: ZERO OFFSET (the Epoch’s name for probe delay)
- `+5s` Subtract 0.81 µs: zero moves from the crystal to the test surface
- `+15s` Flaw 27.40 → 25.00      Back wall 52.40 → 50.00
- `+25s` Zero offset shifts every reading by the same amount

*85 words · 36 s*

## 05 · Finding zero offset: two-point calibration  `1:44–2:20`

> You rarely type zero offset in by hand. You find it with a two-point calibration on a step block. On the Epoch, gate the echo from the thin step — ten millimeters — and use CAL ZERO. Then gate the thick step — twenty-five millimeters — and use CAL VEL. Plot time against depth and the two points make a straight line. Velocity sets the slope. Zero offset is where the line starts. Two known thicknesses pin down both.

On-screen cues:

- `+0s` Find it with a two-point calibration on a step block
- `+3.5s` Thin step (10 mm): gate the echo → CAL ZERO, enter 10.00
- `+12s` Thick step (25 mm): gate the echo → CAL VEL, enter 25.00
- `+21s` Velocity = slope   ·   Zero offset = where the line starts

*79 words · 36 s*

## 06 · Display delay = DELAY  `2:20–3:12`

> Now a different job: a two-hundred-millimeter block, and we care about the region near the back wall. At a range of two hundred ten, everything is squeezed into the right side of the screen. Shrink the range to fifty for a closer look — and now we only see the first fifty millimeters. So we turn up DELAY. The Epoch's DELAY is display delay. It slides the window deeper into the part, like panning a camera. At one fifty-five, the window runs from one fifty-five to two-oh-five, and the flaw and back wall are spread across the screen. Now watch the reading while the delay moves. The echo slides across the screen — the reading stays at one hundred eighty.

On-screen cues:

- `+0s` New job: a 200 mm block, flaw near the back wall
- `+4s` RANGE 210: everything is squeezed to the right
- `+12s` RANGE 50: a closer look… at the wrong place
- `+18s` DELAY slides the window deeper, like panning a camera
- `+31s` The echo moves on screen. The reading stays 180.00 mm
- `+47s` DELAY moves the window, not zero

*120 words · 52 s*

## 07 · Side by side  `3:12–3:36`

> Here are both controls side by side. Each knob moves the echo the same distance to the left. On the left, zero offset — the reading changes. On the right, delay — the reading doesn't. Zero offset moves zero. Delay moves the window.

On-screen cues:

- `+0s` Same job, two different knobs…
- `+6s` …and the echo moves the same distance on both screens
- `+14s` Zero offset moves ZERO → reading changes.   Delay moves the WINDOW → reading stays.

*43 words · 24 s*

## 08 · Immersion: the water path and DELAY  `3:36–4:26`

> What about immersion? Here the probe sits fifty millimeters above a twenty-five millimeter steel part, with water in between. Water carries sound at about a quarter of steel's velocity, so with the Epoch set to steel velocity, fifty millimeters of water looks like two hundred millimeters of steel. The water path takes up most of the screen. DELAY is the usual way to push it off-screen: put the interface echo at the left edge, and set the range to cover just the part. Now the part fills the screen. But look at the reading — two hundred twelve millimeters. DELAY only moved the view. The reading is still measured from the probe.

On-screen cues:

- `+0s` Immersion: 50 mm of water above a 25 mm steel part
- `+8s` Water ≈ ¼ steel velocity → at steel velocity it looks like 200 mm
- `+14s` The water path takes up most of the screen
- `+22s` DELAY slides the window to the interface echo
- `+34s` View fixed, but the reading still includes the water: 212.00 mm

*112 words · 50 s*

## 09 · Immersion: the water path and ZERO OFFSET  `4:26–5:28`

> To read depth from the part's front surface, treat the water column like a very long delay line and put it into ZERO OFFSET — here, sixty-seven point six microseconds more. Bring the delay back to zero. The interface echo is now at zero, and the flaw reads twelve millimeters. In practice, calibrating on a reference block in the tank, at the same water path, does this for you. The catch: it only holds while the water path stays the same. Change it by one millimeter and every reading moves by four, because the instrument turns water time into steel distance. If the water path varies, re-standardize — or use an interface gate if your instrument has one. And one setup check: make the water path at least a quarter of the steel thickness, so the second interface echo lands beyond the back wall.

On-screen cues:

- `+0s` To read depth from the front surface…
- `+4s` …put the water time into ZERO OFFSET (+67.57 µs), like a long delay line
- `+16s` DELAY back to 0: interface echo = zero, flaw reads 12.00 mm
- `+24s` In practice: calibrate on a reference block in the tank, same water path
- `+32s` Catch: water path +1 mm → every reading +4 mm
- `+46s` Water path varies? Re-standardize, or use an interface gate if you have one
- `+53s` Setup check: water path ≥ ¼ × steel thickness → 2nd interface echo lands past the back wall

*144 words · 62 s*

## 10 · When is each one used?  `5:28–6:04`

> So when do you use each one? Zero offset — always. You set it in every calibration, and you recheck it whenever you change the probe, the cable, the delay line or the couplant, and as the wear face wears. Display delay is optional. Use it to zoom into a depth band on thick parts, to push the water path off-screen in immersion, or to spread out the region near the back wall — and set it back to zero when you're done.

On-screen cues:

- `+27s` Zero offset: every calibration.   Delay: only when you need to zoom.

*83 words · 36 s*

## 11 · Two classic mistakes  `6:04–6:36`

> Two classic mistakes. First: trying to calibrate with DELAY. The echo moves on the screen, but the reading still says twenty-seven point four. Only zero offset fixes the number. Second: leaving DELAY set from the last job. Here the first ten millimeters are off-screen. The back wall looks normal, and the flaw at three millimeters is never seen. Check DELAY before every scan.

On-screen cues:

- `+0s` Mistake 1: “calibrating” with DELAY
- `+3s` The echo moved… the reading didn’t. Only zero offset fixes the number.
- `+15s` Mistake 2: DELAY left at 10 mm from the last job
- `+20s` The back wall looks fine. The flaw at 3 mm is off-screen.
- `+26.5s` Check DELAY before every scan

*63 words · 32 s*

## 12 · Remember it this way  `6:36–6:54`

> Remember it this way. Zero offset is where the tape measure starts. Delay is where you point the camera. Zero offset changes the reading. Delay only changes what you see.

On-screen cues:

- `+10s` Zero offset changes the reading.  Delay changes the view.

*30 words · 18 s*

## 13 · Try it yourself  `6:54–7:02`

> Now try it yourself in the interactive sandbox on the training page.

*12 words · 8 s*
