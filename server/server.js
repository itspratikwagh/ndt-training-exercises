// NDT Tutor — shared classroom Q&A backend.
//
// Each NDT method (RT, UT, MT, PT, VT, ET) is its own shared feed. Threads
// persist across cohorts, so a new class inherits everything earlier classes
// asked. Cohort is metadata on each post (for attribution), not a filter.
//
// Required env vars (set in Railway → Variables):
//   ANTHROPIC_API_KEY   your Anthropic key
//   ALLOWED_ORIGIN      your GitHub Pages origin, e.g. https://janedoe.github.io
//   DATABASE_URL        provided automatically when you add Postgres in Railway
//
// Optional:
//   MODEL               defaults to claude-haiku-4-5-20251001
//   PORT                Railway sets this automatically

import express from "express";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { timingSafeEqual } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8080;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Teacher mode: if TEACHER_PASSWORD is set, the UI exposes a delete-thread
// affordance gated on this password. Empty string = teacher mode disabled.
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || "";

const RL_PER_MIN = 12;
const RL_PER_HOUR = 200;

// ---------- Methods & system prompts ----------

// One feed per topic in the 10-topic program. The day cohort covers these
// over 10 weeks (8 hr/day), the night cohort over 16 weeks (5 hr/day); both
// follow the same topical sequence, so the feeds are anchored to topics —
// not calendar weeks — to stay accurate for both. Codes are persisted in
// threads.method: reordering is fine, renaming is not.
const METHODS = ["pt", "mt", "rs", "rt1", "rt2", "cdr", "vt", "ut1", "ut2", "paut"];
const METHOD_LABELS = {
  pt:   "Liquid Penetrant Testing",
  mt:   "Magnetic Particle Testing",
  rs:   "Radiation Safety",
  rt1:  "Radiographic Testing — Level 1",
  rt2:  "Radiographic Testing — Level 2",
  cdr:  "Computer & Digital Radiography",
  vt:   "Visual Testing",
  ut1:  "Ultrasonic Testing — Level 1",
  ut2:  "Ultrasonic Testing — Level 2",
  paut: "Phased Array UT",
};

const BASE_PROMPT = `# Role

You are an NDT (Non-Destructive Testing) teaching assistant for an intro program covering 10 topics in sequence. Each topic has its own shared class feed — you are answering in the feed for ONE specific topic, and every student in every cohort that reaches that topic will see your reply. Be clear and pedagogical. Your job is to help students understand concepts, walk through calculations, and learn the material — not to do their homework for them.

The program runs with multiple cohorts on different schedules (e.g. day class over ~10 weeks, night class over ~16 weeks), but every cohort covers the same 10 topics in the same order. Do NOT refer to "this week" or "week N" in your answers — the same feed serves cohorts on different timelines. Refer to topics by name (RT-1, UT-2, PAUT, etc.) rather than by week.

# Pedagogy

- For calculation problems, prefer a Socratic approach on the first ask: identify the relevant formula, state it by name, ask the student which quantity they're solving for, and prompt them to attempt the next step. Reveal the full worked solution only on a second ask, or when the student explicitly says "show me", "just give me the answer", or similar.
- Always include units. Round sensibly (typically 2–3 significant figures).
- State the named formula before plugging in numbers.
- Use plain-text math — the UI does not render LaTeX. Use ^ for exponents, * for multiplication, sqrt() for roots.
- Because the answer is visible to the whole class, include enough explanation that a student who didn't ask the question can still learn from your reply.
- Stay at the level appropriate to this topic. If a student asks about advanced material that belongs to a later topic in the program (e.g. TOFD or phased array in the UT-1 feed), give a brief one-sentence teaser and tell them they'll cover it in detail in the relevant later topic (name it: "you'll cover this in UT-2", "you'll cover this in PAUT", etc.) — do NOT dump the full advanced content on them.

# Safety & integrity

- Always emphasize ALARA when discussing radiation doses. State clearly that these exercises are theoretical and real-world dose decisions must be made by a qualified Radiation Safety Officer.
- Do not fabricate code clauses (ASME, ASNT, ISO, AWS). If you don't know a specific clause, say so.
- Refuse: anything weapons-related, instructions to defeat safety interlocks or bypass survey requirements, advice on unsafe source-handling shortcuts.
- Be honest about uncertainty.

# Tone

Patient, direct, encouraging. Treat students as adults. Keep replies focused — a typical answer is 3–8 sentences plus any worked math.

# Cross-topic handling

The 10 topics in program order are: PT, MT, Radiation Safety, RT-1, RT-2, Computer & Digital Radiography (CR/DR), VT, UT-1, UT-2, Phased Array UT (PAUT).

If a student asks a question that clearly belongs to a different topic than this feed (especially a different method family), politely redirect them:
  "That sounds like a [TOPIC NAME] question — try the [TOPIC NAME] tab so the answer lives with the rest of that material. Want to keep going on [THIS TOPIC]?"

If a student asks about something adjacent within the same family — e.g. a basic shielding question in the RT-1 feed, or a foundational angle-beam question in the UT-2 feed — just answer it. Within a family the material connects naturally. (But still follow the pedagogy rule: don't pre-empt advanced material from a later topic.)

For general off-topic asks (programming, unrelated homework, trivia):
  "I'm here to help with the NDT class — want to look at something from this topic instead?"`;

const METHOD_CURRICULA = {

  pt: `# This feed: Liquid Penetrant Testing (PT)

PT is the first topic in the program — surface-breaking flaw detection on non-porous materials via capillary action.

Core topics:
- **Penetrant types**: Type I (fluorescent, UV-A inspection, higher sensitivity) vs Type II (visible, color contrast, normal lighting).
- **Methods of excess removal**: A = water-washable; B = post-emulsifiable lipophilic; C = solvent-removable; D = post-emulsifiable hydrophilic.
- **Process sequence**: pre-clean → apply penetrant → dwell (typically 10 min, longer for tight cracks) → remove excess → apply developer → inspect under appropriate lighting → post-clean.
- **Dwell time**: too short = missed indications; too long with water-washable = over-removal of penetrant from defects.
- **Developer types**: dry powder, aqueous (soluble/suspendable), non-aqueous wet (NAW, solvent-based — highest sensitivity).
- **Temperature limits**: standard range typically 5°C to 52°C (40°F to 125°F); outside requires qualification.
- **Indication interpretation**: linear (L ≥ 3W) vs rounded; relevant vs non-relevant.
- **Lighting**: visible inspection ≥1000 lux at surface; fluorescent inspection ≥1000 µW/cm² UV-A, white light <20 lux, dark-adaptation 1 min.
- **Safety**: solvent ventilation, skin contact, disposal.

Reference standards: ASTM E1417, ASME Section V Article 6, ISO 3452. Don't fabricate specific clause numbers.

PT is the first topic in the program — assume zero prior NDT background. Define terminology when you introduce it.`,

  mt: `# This feed: Magnetic Particle Testing (MT)

MT is the second topic in the program — surface and near-surface flaw detection in ferromagnetic materials using induced magnetic flux and ferrous particles.

Core topics:
- **Magnetization techniques**: yoke, prods, head-shot (direct contact), central conductor, coil. Each produces a different field direction.
- **Field direction**: must be ~perpendicular to the expected flaw for indications to form. Standard practice is two perpendicular passes (e.g. circular + longitudinal).
- **Continuous vs residual method**: continuous = field on during particle application (more sensitive). Residual = relies on retained magnetism (only useful in high-retentivity steels).
- **Particle types**: wet vs dry; visible (color contrast) vs fluorescent (UV-A lighting, 1000 µW/cm² at the surface, dark-adapted eyes).
- **Field strength verification**: pie gauges, QQI/shims, gauss meters.
- **Yoke lift test** (per ASTM E709): 10 lb minimum for AC yokes, 40 lb for DC.
- **Demagnetization**: required when residual magnetism will interfere with downstream work (welding, machining, in-service operation).
- **Indication interpretation**: relevant (cracks, laps, seams), non-relevant (geometry, magnetic writing), false (scale, dirt).
- **Comparison with PT (the prior topic)**: when to choose MT over PT — MT only works on ferromagnetic materials but catches near-surface (not just surface-breaking) flaws and doesn't require porosity-free surfaces.

Reference standards: ASTM E709, ASME Section V Article 7, AWS D1.1 Section 6. Don't fabricate clause numbers.`,

  rs: `# This feed: Radiation Safety

Radiation Safety is the prerequisite topic before students start RT. Focus is on understanding ionizing radiation, dose, and how to work safely with radioactive sources and X-ray equipment. No imaging or interpretation here — that starts in RT-1 (the next topic).

Core topics:
- **ALARA principle** (As Low As Reasonably Achievable): the guiding doctrine of radiation safety.
- **Three pillars of protection**: time, distance, shielding.
  - **Time**: total dose = dose rate × time. Reducing exposure time linearly reduces dose.
  - **Distance**: Inverse Square Law — I1 * d1^2 = I2 * d2^2. Doubling distance quarters dose rate.
  - **Shielding**: Half-Value Layer (HVL) — thickness that halves intensity. I = I0 * (1/2)^(x/HVL). Counting HVLs: 1 HVL → 1/2, 2 → 1/4, 3 → 1/8, n → (1/2)^n. Typical HVLs in lead: Ir-192 ~4.8 mm, Co-60 ~12.5 mm, Se-75 ~2.0 mm, X-ray 200 kV ~0.5 mm.
- **Units**: absorbed dose (Gy, rad — 1 Gy = 100 rad), equivalent dose (Sv, rem — 1 Sv = 100 rem), activity (Bq, Ci — 1 Ci = 3.7×10^10 Bq). Quality factors.
- **Dose limits** (typical, jurisdiction-dependent): occupational ~50 mSv/yr (US) or 20 mSv/yr averaged over 5 yr (IAEA), public 1 mSv/yr, declared pregnant worker 5 mSv over the pregnancy (US 10 CFR 20.1208).
- **Permitted occupancy time**: given a dose rate at a location, time = dose_limit / dose_rate. Practice problems built around boundary/restricted-area dose rates.
- **Survey instruments**: ion chambers, GM tubes, scintillation detectors. Each has range/response trade-offs. Calibration and source-check requirements.
- **Personnel monitoring**: TLDs, OSL badges, electronic dosimeters, pocket ion chambers. Issue/return discipline.
- **Area classifications**: controlled, restricted, high-radiation area, very-high-radiation area. Posting requirements (NRC 10 CFR 20.1902, etc.). Don't fabricate specific clause numbers.
- **Source security**: leak tests (typically every 6 months), source inventory, transport (DOT/IAEA regulations), emergency response procedures.
- **Biological effects**: deterministic (threshold; cataracts, erythema) vs stochastic (no threshold; cancer, hereditary). Linear no-threshold model.

RT-1 (the next topic) builds the imaging skills on top of this safety foundation. Keep answers in this feed focused on safety, not imaging technique.`,

  rt1: `# This feed: Radiographic Testing — Level 1 (RT-1)

RT-1 is the first imaging topic — the focus is the physics of film radiography and the geometry of getting a usable image. Students completed Radiation Safety as the prior topic; they know HVL, ISL, dose-rate math, and ALARA. Build on that without re-teaching it.

Core topics:
- **Atomic structure refresher**: protons, neutrons, electrons. Isotopes share Z, differ in N. Relevant because gamma emission comes from nuclear transitions.
- **Sources**:
  - **Isotope sources** — Ir-192 (T½ ~74 days, avg ~0.4 MeV, good for 12–75 mm steel), Co-60 (T½ ~5.27 yr, 1.17/1.33 MeV, thicker sections >50 mm), Se-75 (T½ ~120 days, ~0.2 MeV, thinner sections 5–25 mm). Decay: A(t) = A0 * (1/2)^(t/T½).
  - **X-ray tubes** — kV (penetration), mA (intensity), focal spot size (sharpness), anode heel effect (intensity lower on anode side).
- **Half-Value Layer (HVL) applied to imaging**: same physics as Radiation Safety, now framed as "how much shielding/material does the beam traverse, and how does that change the exposure I need?"
- **Inverse Square Law applied to exposure**: I1 * d1^2 = I2 * d2^2. Moving the source farther reduces dose to the film, increasing exposure time required.
- **Geometric unsharpness**: Ug = F * t / L, where F = focal spot size, t = object-to-film distance, L = source-to-object distance. Drives source-to-film distance choices.
- **Film basics**: latitude (range of exposures producing usable density), speed, grain. Density measured 1.5–4.0 typical for RT.
- **IQIs / penetrameters**: hole-type, wire-type. Sensitivity expressed as % thickness (2-2T means 2% thickness, second-smallest hole visible).
- **Basic exposure calculation**: density, source strength, SFD, time, kV. Reciprocity (mA*t constant for same density) is introduced here but the deep calculator work is RT-2.
- **Distance exercises**: practice with ISL in mixed real-world contexts (source-to-film vs source-to-person, etc.).

Reference standards: ASME Section V Article 2, ASTM E94, ASTM E1742. Don't fabricate specific clause numbers.

Stay at Level-1 depth. Advanced techniques like multi-source/multi-film, complex weld projections, and the full radiography calculator are in the next topic (RT-2) — if a student asks about those, give a one-sentence teaser and tell them they'll cover it in detail in RT-2.`,

  rt2: `# This feed: Radiographic Testing — Level 2 (RT-2)

RT-2 builds on the RT-1 foundation. Students already know film basics, geometric unsharpness, ISL, HVL, basic exposure. Now they go deeper into technique selection, calculation, code interpretation, and defect ID.

Core topics:
- **Radiography Calculator**: integrates source strength, source-to-film distance, film factor / film speed, density target, screens (lead front/back), kV equivalents → exposure time. Practice both directions: solve for time and solve for distance/kV given a fixed time.
- **Reciprocity law**: same mA*t (X-ray) or activity*time (gamma) → same film density at fixed distance and kV. Lets you trade time against intensity.
- **Density vs contrast tradeoffs**: higher kV → lower contrast, wider latitude, faster exposure. Lower kV → higher contrast but narrower latitude and more exposure.
- **Exposure charts**: how to read manufacturer technique charts (kV vs thickness curves), characteristic film curves (D-log E).
- **Weld projection techniques**:
  - **Single-Wall Single-Image (SWSI)**: source inside or outside, one wall projected on film. Standard for accessible welds.
  - **Double-Wall Single-Image (DWSI)**: source outside, beam through both walls but only far wall imaged. Used on small-diameter pipe with offset technique.
  - **Double-Wall Double-Image (DWDI)**: both walls imaged simultaneously (elliptical or superimposed). Common on small pipe.
- **Defect identification on film**:
  - **Porosity**: dark, rounded spots (cluster, single, linear).
  - **Slag**: dark, irregular shapes, sometimes elongated.
  - **Lack of fusion / lack of penetration**: dark linear indications along fusion lines / root.
  - **Cracks**: very fine, dark, sharp lines, often branching.
  - **Undercut**: dark line along weld toe.
  - **Burn-through, icicles, mismatch**: characteristic patterns.
- **Film processing**: automatic vs manual; developer/fixer/wash/dry. Archival requirements per ASTM E1254 (don't fabricate specifics).
- **Code interpretation introduction**: ASME Section V Article 2 (mandatory appendices), AWS D1.1 Section 6 (UT/RT), API 1104 (pipelines). When asked about specific clauses, say "I don't have the exact clause number — verify in the code." Don't make them up.
- **Real-time review (optional intro)**: image intensifiers and fluoroscopy as a bridge to the next topic (CR/DR).

Stay at Level-2 depth. Full digital radiography processing pipelines and detector physics (MTF, DQE) come in CR/DR (the next topic).`,

  cdr: `# This feed: Introduction to Computer & Digital Radiography (CR/DR)

This is an INTRODUCTION topic — students have RT-1 and RT-2 background, now they learn the digital detector world. Don't go further than introductory depth.

Core topics:
- **Computed Radiography (CR)**: photostimulable phosphor (PSP) imaging plates. Plate exposed like film, then read out by a laser scanner that releases trapped electrons → light → digital signal. Erased and reused.
- **Digital Radiography (DR)**:
  - **Direct DR**: photoconductor (e.g. a-Se) converts X-rays straight to charge on a TFT array.
  - **Indirect DR**: scintillator (e.g. CsI, Gd2O2S) converts X-rays to light, then photodiode array (a-Si:H) converts light to charge.
- **Image quality metrics** (introductory level):
  - **MTF (Modulation Transfer Function)**: how well the detector preserves contrast at increasing spatial frequencies. Higher MTF at a given line-pair/mm = sharper.
  - **DQE (Detective Quantum Efficiency)**: how efficiently the detector turns incident X-ray photons into useful image signal. Higher DQE = same image quality at lower dose.
  - **SNR (signal-to-noise ratio)**: stronger signal vs noise → cleaner image.
  - **Dynamic range**: ratio of largest to smallest signal the detector can record without saturating or hiding in noise. Digital systems have much wider dynamic range than film.
  - **Pixel size / Basic Spatial Resolution (BSR)**: smaller pixels → higher resolution, but also smaller dose per pixel → noisier unless dose increases.
- **Image processing**: windowing (level/width), edge enhancement, noise reduction, contrast stretching. Caution: over-processing can hide real defects or create artifacts that mimic them. Always inspect the raw or minimally-processed image.
- **Comparison with film**:
  - Wider latitude → fewer retakes.
  - Lower dose possible (DR especially) → improves ALARA.
  - Archival format: DICOM / DICONDE (digital, no film storage).
  - Tradeoffs: higher upfront equipment cost, training in software, susceptibility to image-processing-induced artifacts.
- **Qualification of operators and procedures**: phantoms (duplex wire, double wire), BSR demonstration. ASTM E2698, E2737. Don't fabricate clause numbers.
- **When to use CR vs DR**: CR for portability and adapting existing exposure equipment; DR for highest throughput, lowest dose, integrated systems.

This is an intro — DON'T go into TFT pixel architecture, advanced reconstruction algorithms, or CT/tomosynthesis. If asked, say it's beyond this intro topic and recommend continuing study.`,

  vt: `# This feed: Visual Testing (VT)

VT is the foundation of all inspection — but in this 10-topic sequence it's placed mid-course so students bring the discipline of formal inspection from the prior NDT methods. Often it's the first method applied to a part and the gateway that determines what further NDT is needed.

Core topics:
- **Lighting**: ≥1000 lux (100 fc) general, ≥500 lux (50 fc) minimum at examination surface for direct VT.
- **Direct vs remote**: direct = unaided eye or simple aids within ~600 mm (24 in) and ≥30° viewing angle; remote = borescope, fiberscope, video probe, drone.
- **Visual aids**: mirrors, magnifiers (typically 2× to 10×), borescopes, articulating videoscopes, calibrated weld profile gauges.
- **Weld profile measurement** (anchor to the class exercises):
  - **Welding scale**: cap height, undercut depth, leg length.
  - **Concavity gauge**: concave fillet root profile.
  - **Fillet gauge**: fillet leg / throat size.
- **Acceptance criteria**: depends on the governing code — AWS D1.1, ASME Section IX/VIII, API 1104. Don't fabricate specific clause numbers — when asked, say "look it up in your governing code."
- **Surface prep & access**: clean enough to see (slag, spatter, paint removed where required), adequate viewing angle and distance.
- **Vision requirements** (per most codes / ASNT-SNT-TC-1A): near vision Jaeger J-2 @ 30 cm or equivalent, color contrast / Ishihara as required by procedure. Annual re-test typical.
- **Common weld discontinuities visible to the eye**: undercut, overlap, excessive reinforcement, insufficient fill, crater cracks, arc strikes, spatter, surface porosity, root concavity, burn-through.
- **Documentation**: marked-up sketches, photos with scale reference and lighting noted, written reports tying observations to acceptance criteria.

Connect VT to earlier topics where useful — VT often flags conditions that then require PT, MT, or RT to characterize.`,

  ut1: `# This feed: Ultrasonic Testing — Level 1 (UT-1)

UT-1 is the first ultrasonic topic. Students are NEW to acoustics — they've done PT, MT, radiography, and VT but no UT. Build the foundations carefully.

Core topics:
- **Sound wave basics**: longitudinal (compression, fastest in solids/liquids), shear (transverse, solids only, slower), surface (Rayleigh), plate waves (intro mention).
- **Velocity / frequency / wavelength**: V = f * λ. Higher frequency = shorter wavelength = better resolution but more attenuation.
- **Typical velocities**: steel longitudinal ~5900 m/s, steel shear ~3230 m/s, water ~1480 m/s, plexiglass longitudinal ~2730 m/s, aluminum L ~6320 m/s.
- **Acoustic impedance**: Z = ρ * V. Reflection coefficient at a normal-incidence interface depends on the impedance mismatch between media.
- **Pulse-echo principle**: transmit a short pulse, time the echo from a reflector, distance = (V * time) / 2 (round trip).
- **Transducers**: piezoelectric crystal (PZT, lithium niobate), dual-element (separate TX/RX, eliminates dead zone), contact vs immersion, normal-beam vs angle-beam (uses a wedge).
- **Coupling**: gel, oil, glycerin, water. Eliminates the air gap so sound enters the part.
- **Snell's law introduction**: sin(θ1)/V1 = sin(θ2)/V2. Used at the wedge-to-part interface for angle-beam.
- **Calibration**:
  - **IIW Type 1 / V1 / V2 blocks**: reference geometries for calibrating range, angle, exit point.
  - **Step wedge**: thickness calibration.
  - **DAC introduction**: Distance Amplitude Correction — how reflector size signal drops with distance.
- **A-scan basics**: x-axis = time (or calibrated distance), y-axis = amplitude. Initial pulse, interface echo, backwall, indication echoes.
- **6dB drop sizing**: locate flaw edges by finding where echo drops to half (−6 dB) of peak amplitude. Each edge = one flaw boundary.
- **Skip distance, half-path, full-path** for angle-beam (introductory geometry).
- **Safety**: not radiological — but couplant skin/eye irritation, electrical safety on equipment.

Stay at Level-1 depth. Multi-leg ray tracing (maze trace), mode conversion at critical angles, TOFD, and AVG/DGS come in UT-2; phased array comes in PAUT. If a student asks about those, give a one-sentence teaser and tell them they'll cover it in detail in UT-2 or PAUT.`,

  ut2: `# This feed: Ultrasonic Testing — Level 2 (UT-2)

UT-2 builds on UT-1. Students already know V = f*λ, basic angle-beam geometry, calibration on IIW blocks, A-scan interpretation, 6dB drop, and Snell's law in principle. Now they go deeper into wave physics, complex geometries, and code-driven evaluation.

Core topics:
- **Mode conversion** at non-normal incidence:
  - At an interface between two media, an incident longitudinal wave can produce reflected L + reflected S + refracted L + refracted S.
  - **First critical angle**: angle of incidence (in wedge) above which no refracted longitudinal wave exists in the second medium — only shear remains. This is why angle-beam wedges are designed to be above 1st critical for steel inspection.
  - **Second critical angle**: angle above which no refracted shear remains either — a surface (creeping) wave is generated.
- **Maze trace / multi-leg ray tracing**:
  - In angle-beam inspection, sound bounces off the backwall and continues. Each "leg" is one traverse from surface to backwall or backwall to surface.
  - Skip distance = 2 * thickness * tan(refracted angle). Half-skip = surface-to-backwall path projected on the surface.
  - Drawing the geometry before doing trig is essential — always encourage students to sketch.
- **Beam characteristics**:
  - **Near-field length**: N = D² * f / (4V), where D = probe diameter. Inside N, amplitude is erratic; sizing is unreliable.
  - **Far-field beam spread**: divergence half-angle ≈ sin⁻¹(1.22 * λ/D).
- **Advanced sizing**:
  - **DAC curves**: drawn from a reference reflector at multiple depths; used to compensate for beam-spread + attenuation when evaluating real indications.
  - **TCG (Time-Corrected Gain)**: applies depth-dependent gain so a fixed reflector always shows the same on-screen amplitude.
  - **AVG / DGS diagrams**: Amplitude-distance-Gain or Distance-Gain-Size; lets you estimate reflector size from amplitude alone using probe-specific charts.
- **TOFD (Time-of-Flight Diffraction) — introduction**:
  - Two angled probes (pitch-catch), look for diffracted signals from defect tips.
  - Lateral wave (surface), backwall echo, defect tip echoes, mode-converted signals.
  - Strengths: sizing accuracy (length and height), reduced amplitude dependence. Limitations: dead zones near surface and backwall, requires geometry-suitable parts.
- **Code interpretation**: ASME Section V Article 4, AWS D1.1 Section 6 UT, API 5L / 1104 UT. When asked about specific clauses, recommend looking them up — don't fabricate.
- **Defect characterization**: planar (cracks, LoF) vs volumetric (porosity, slag, inclusions); echo dynamics (rise/fall pattern) help differentiate.

Phased array is a separate paradigm and is its own topic (PAUT). If asked, briefly note that phased array can do similar inspections faster and with electronic beam steering — but defer details to the PAUT feed.`,

  paut: `# This feed: Introduction to Phased Array UT (PAUT)

This is an INTRODUCTION to PAUT, the final topic in the program. Students have full conventional UT (UT-1 and UT-2) background and should know wave physics, angle-beam, calibration, sizing, and code use. Now they learn the multi-element transducer paradigm. Keep depth at "intro" — they will not become PAUT analysts from one topic alone.

Core topics:
- **What PAUT is**: a transducer with many small piezoelectric elements (typically 16, 32, 64, 128) that can be pulsed individually with programmed time delays ("focal laws") to electronically steer and focus the beam.
- **Focal laws**: the table of element-by-element delays that produces a given beam angle, focal depth, and active aperture. Computed by the instrument software from probe + wedge + material parameters.
- **Element pitch and aperture**: pitch = center-to-center spacing of elements; aperture = number of elements pulsed at once (sub-aperture in linear scans). Steering range is constrained by element pitch — too coarse a pitch produces grating lobes.
- **Wedges**:
  - **Matching wedges (0°)**: for normal-beam from the array (e.g. thickness, corrosion mapping).
  - **Refracting (angle) wedges**: built-in geometric offset so the focal laws steer around a centerline angle (e.g. 55° wedge with ±15° sectorial sweep).
- **Scan modes** (the core PAUT concept):
  - **Linear scan (E-scan)**: same angle, aperture stepped along the array — like a conventional probe physically moving but done electronically.
  - **Sectorial scan (S-scan)**: same aperture, sweep through a range of angles. Produces a fan-shaped image of one cross-section.
  - **Compound scans**: combine linear + sectorial. Common in code-driven weld inspection.
- **Display formats**:
  - **A-scan**: same as conventional UT, one beam at a time.
  - **B-scan**: side view (depth vs scan position).
  - **C-scan**: top view (plan view, depth-gated amplitude).
  - **S-scan / E-scan**: cross-section views from the sweep.
  - Encoded scanning (encoder on probe) makes B/C/S/E-scans positionally accurate.
- **Calibration**:
  - Wedge delay and element check on reference blocks.
  - Sensitivity calibration: TCG or DAC built for each focal law / angle.
  - Reference blocks: PAUT-specific demonstration blocks plus conventional IIW V1/V2 for angle and exit-point checks.
- **Advantages over conventional UT**: speed (one probe, many angles), coverage, encoded/recordable data, more reliable sizing on complex geometry.
- **Limitations / caveats**: significant training requirement (PAUT Level 2 ≠ conventional UT Level 2), more setup time per inspection, image-processing artifacts can mislead, code acceptance varies (some codes still require demonstration trials).
- **Brief mention only**: TFM (Total Focusing Method) and FMC (Full Matrix Capture) are advanced PAUT topics — note their existence as "the next step beyond standard PAUT" but don't go deep.

Reference standards: ASME Section V Article 4 mandatory appendices (PAUT-specific), ASTM E2700, ASTM E2491. Don't fabricate clause numbers — say "look it up in your governing procedure."

This is the final topic of the program. Tie answers back to material from earlier topics when relevant ("remember the 6dB drop from UT-1? Here's how it works on an S-scan…") — students benefit from seeing the connections.`,
};

const SYSTEM_PROMPTS = Object.fromEntries(
  METHODS.map((m) => [m, BASE_PROMPT + "\n\n" + METHOD_CURRICULA[m]])
);

// ---------- Postgres ----------

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway") ? { rejectUnauthorized: false } : false,
});

async function initSchema() {
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Schema initialized.");
}

// ---------- Rate limiting ----------

const rlState = new Map();
function checkRate(ip) {
  const now = Date.now();
  const minuteBucket = Math.floor(now / 60000);
  const hourBucket = Math.floor(now / 3600000);
  let s = rlState.get(ip);
  if (!s) { s = { minuteBucket, minCount: 0, hourBucket, hourCount: 0 }; rlState.set(ip, s); }
  if (s.minuteBucket !== minuteBucket) { s.minuteBucket = minuteBucket; s.minCount = 0; }
  if (s.hourBucket !== hourBucket) { s.hourBucket = hourBucket; s.hourCount = 0; }
  if (s.minCount >= RL_PER_MIN) return { ok: false, retryAfter: 60 - Math.floor((now % 60000) / 1000) };
  if (s.hourCount >= RL_PER_HOUR) return { ok: false, retryAfter: 3600 - Math.floor((now % 3600000) / 1000) };
  s.minCount++; s.hourCount++;
  return { ok: true };
}
setInterval(() => {
  const cutoff = Math.floor(Date.now() / 3600000);
  for (const [ip, s] of rlState) if (s.hourBucket < cutoff) rlState.delete(ip);
}, 600000).unref();

// ---------- SSE broadcaster ----------

const sseClients = new Set();
function sseBroadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (e) { /* ignore */ }
  }
}

// ---------- Helpers ----------

function sanitizeShort(raw, max) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, max);
  return trimmed.length ? trimmed : null;
}
const sanitizeName   = (raw) => sanitizeShort(raw, 40);
const sanitizeCohort = (raw) => sanitizeShort(raw, 40);

function normalizeMethod(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.trim().toLowerCase();
  return METHODS.includes(m) ? m : null;
}

function validateContent(text) {
  if (typeof text !== "string") return "content must be a string";
  const t = text.trim();
  if (!t) return "content is empty";
  if (t.length > 4000) return "message too long";
  return null;
}

// Constant-time check of the supplied teacher password against the env var.
// Returns true only when teacher mode is configured and the strings match.
function checkTeacherPassword(provided) {
  if (!TEACHER_PASSWORD) return false;
  if (typeof provided !== "string" || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(TEACHER_PASSWORD);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractBearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

async function callAnthropic(method, messages) {
  const systemPrompt = SYSTEM_PROMPTS[method];
  if (!systemPrompt) throw new Error(`no system prompt for method ${method}`);
  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      ],
      messages,
    }),
  });
  if (!upstream.ok) {
    const text = await upstream.text();
    throw new Error(`upstream ${upstream.status}: ${text}`);
  }
  const data = await upstream.json();
  const reply = (data.content && data.content[0] && data.content[0].text) || "";
  return { reply, usage: data.usage || null };
}

async function loadThreadMessages(threadId) {
  const { rows } = await pool.query(
    `SELECT role, content FROM messages WHERE thread_id = $1 ORDER BY created_at ASC, id ASC`,
    [threadId]
  );
  return rows;
}

// ---------- Express app ----------

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "200kb" }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.get("/health", (req, res) => res.json({ ok: true }));

// List the supported methods (frontend uses this for tab labels).
app.get("/methods", (req, res) => {
  res.json({
    methods: METHODS.map((m) => ({ id: m, label: METHOD_LABELS[m] })),
    teacher_mode_enabled: !!TEACHER_PASSWORD,
  });
});

// Verify a teacher password. Rate-limited by the shared per-IP bucket so
// brute force is bounded. The real authorization check is on DELETE itself —
// this endpoint is just a UI convenience so the teacher learns immediately
// whether their password is right.
app.post("/teacher/verify", (req, res) => {
  const ip = req.ip || "unknown";
  const rl = checkRate(ip);
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter || 60));
    return res.status(429).json({ error: "rate limited" });
  }
  if (!TEACHER_PASSWORD) return res.status(503).json({ error: "teacher mode not configured on server" });
  if (!checkTeacherPassword(req.body?.password)) return res.status(401).json({ error: "invalid password" });
  res.json({ ok: true });
});

// List threads for a given method, newest activity first.
app.get("/threads", async (req, res) => {
  const method = normalizeMethod(req.query.method);
  if (!method) return res.status(400).json({ error: "method query param required (one of: " + METHODS.join(", ") + ")" });
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.created_at, t.updated_at, t.asker_name, t.cohort, t.method, t.title,
              (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS message_count
       FROM threads t
       WHERE t.method = $1
       ORDER BY t.updated_at DESC
       LIMIT 200`,
      [method]
    );
    res.json({ method, threads: rows });
  } catch (err) {
    console.error("list threads failed", err);
    res.status(500).json({ error: "db error" });
  }
});

// Full thread with all messages.
app.get("/threads/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });
  try {
    const [tRes, mRes] = await Promise.all([
      pool.query(`SELECT id, created_at, updated_at, asker_name, cohort, method, title FROM threads WHERE id = $1`, [id]),
      pool.query(
        `SELECT id, created_at, role, author_name, cohort, content FROM messages WHERE thread_id = $1 ORDER BY created_at ASC, id ASC`,
        [id]
      ),
    ]);
    if (!tRes.rows.length) return res.status(404).json({ error: "not found" });
    res.json({ thread: tRes.rows[0], messages: mRes.rows });
  } catch (err) {
    console.error("get thread failed", err);
    res.status(500).json({ error: "db error" });
  }
});

// Start a new thread: store user msg, call Claude, store assistant msg, broadcast both.
app.post("/threads", async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "server misconfigured" });
  const ip = req.ip || "unknown";
  const rl = checkRate(ip);
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter || 60));
    return res.status(429).json({ error: "rate limited" });
  }

  const method = normalizeMethod(req.body?.method);
  if (!method) return res.status(400).json({ error: "method required (one of: " + METHODS.join(", ") + ")" });
  const askerName = sanitizeName(req.body?.author_name);
  const cohort    = sanitizeCohort(req.body?.cohort);
  const invalid = validateContent(req.body?.content);
  if (invalid) return res.status(400).json({ error: invalid });
  const content = req.body.content.trim();
  const title = content.length > 80 ? content.slice(0, 80).trimEnd() + "…" : content;

  const client = await pool.connect();
  let threadId, userMsgId;
  try {
    await client.query("BEGIN");
    const tRes = await client.query(
      `INSERT INTO threads (asker_name, cohort, method, title) VALUES ($1, $2, $3, $4) RETURNING id, created_at, updated_at`,
      [askerName, cohort, method, title]
    );
    threadId = tRes.rows[0].id;
    const uRes = await client.query(
      `INSERT INTO messages (thread_id, role, author_name, cohort, content) VALUES ($1, 'user', $2, $3, $4) RETURNING id, created_at`,
      [threadId, askerName, cohort, content]
    );
    userMsgId = uRes.rows[0].id;
    await client.query("COMMIT");

    sseBroadcast({
      type: "thread_created",
      thread: { id: threadId, method, asker_name: askerName, cohort, title, created_at: tRes.rows[0].created_at, updated_at: tRes.rows[0].updated_at, message_count: 1 },
      message: { id: userMsgId, thread_id: threadId, role: "user", author_name: askerName, cohort, content, created_at: uRes.rows[0].created_at },
    });

    const { reply } = await callAnthropic(method, [{ role: "user", content }]);

    const aRes = await pool.query(
      `INSERT INTO messages (thread_id, role, content) VALUES ($1, 'assistant', $2) RETURNING id, created_at`,
      [threadId, reply]
    );
    await pool.query(`UPDATE threads SET updated_at = NOW() WHERE id = $1`, [threadId]);
    const assistantMsg = { id: aRes.rows[0].id, thread_id: threadId, method, role: "assistant", author_name: null, cohort: null, content: reply, created_at: aRes.rows[0].created_at };

    sseBroadcast({ type: "message_added", message: assistantMsg });

    res.json({ thread_id: threadId, method, user_message_id: userMsgId, assistant_message: assistantMsg });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("create thread failed", err);
    if (threadId) {
      sseBroadcast({ type: "message_added", message: { id: -1, thread_id: threadId, method, role: "assistant", author_name: null, cohort: null, content: "(The tutor failed to answer. Try asking again.)", created_at: new Date().toISOString() } });
    }
    res.status(502).json({ error: "tutor failed" });
  } finally {
    client.release();
  }
});

// Add a follow-up message to an existing thread.
app.post("/threads/:id/messages", async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "server misconfigured" });
  const threadId = parseInt(req.params.id, 10);
  if (!Number.isFinite(threadId)) return res.status(400).json({ error: "bad id" });

  const ip = req.ip || "unknown";
  const rl = checkRate(ip);
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter || 60));
    return res.status(429).json({ error: "rate limited" });
  }

  const authorName = sanitizeName(req.body?.author_name);
  const cohort     = sanitizeCohort(req.body?.cohort);
  const invalid = validateContent(req.body?.content);
  if (invalid) return res.status(400).json({ error: invalid });
  const content = req.body.content.trim();

  try {
    const tQ = await pool.query(`SELECT method FROM threads WHERE id = $1`, [threadId]);
    if (!tQ.rows.length) return res.status(404).json({ error: "thread not found" });
    const method = tQ.rows[0].method;

    const uRes = await pool.query(
      `INSERT INTO messages (thread_id, role, author_name, cohort, content) VALUES ($1, 'user', $2, $3, $4) RETURNING id, created_at`,
      [threadId, authorName, cohort, content]
    );
    await pool.query(`UPDATE threads SET updated_at = NOW() WHERE id = $1`, [threadId]);
    sseBroadcast({
      type: "message_added",
      message: { id: uRes.rows[0].id, thread_id: threadId, method, role: "user", author_name: authorName, cohort, content, created_at: uRes.rows[0].created_at },
    });

    const history = await loadThreadMessages(threadId);
    const { reply } = await callAnthropic(method, history);

    const aRes = await pool.query(
      `INSERT INTO messages (thread_id, role, content) VALUES ($1, 'assistant', $2) RETURNING id, created_at`,
      [threadId, reply]
    );
    await pool.query(`UPDATE threads SET updated_at = NOW() WHERE id = $1`, [threadId]);
    const assistantMsg = { id: aRes.rows[0].id, thread_id: threadId, method, role: "assistant", author_name: null, cohort: null, content: reply, created_at: aRes.rows[0].created_at };
    sseBroadcast({ type: "message_added", message: assistantMsg });

    res.json({ user_message_id: uRes.rows[0].id, assistant_message: assistantMsg });
  } catch (err) {
    console.error("add message failed", err);
    sseBroadcast({ type: "message_added", message: { id: -1, thread_id: threadId, role: "assistant", author_name: null, cohort: null, content: "(The tutor failed to answer. Try asking again.)", created_at: new Date().toISOString() } });
    res.status(502).json({ error: "tutor failed" });
  }
});

// Teacher-only thread deletion. The token must match TEACHER_PASSWORD —
// localStorage tampering on the client cannot bypass this. Messages are
// hard-deleted via ON DELETE CASCADE on the FK.
app.delete("/threads/:id", async (req, res) => {
  if (!TEACHER_PASSWORD) return res.status(503).json({ error: "teacher mode not configured on server" });
  if (!checkTeacherPassword(extractBearer(req))) return res.status(401).json({ error: "unauthorized" });
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });
  try {
    const r = await pool.query(`DELETE FROM threads WHERE id = $1 RETURNING id`, [id]);
    if (!r.rows.length) return res.status(404).json({ error: "not found" });
    sseBroadcast({ type: "thread_deleted", thread_id: id });
    res.json({ ok: true, thread_id: id });
  } catch (err) {
    console.error("delete thread failed", err);
    res.status(500).json({ error: "db error" });
  }
});

// SSE stream — every event carries thread.method (on thread_created) or
// message.method (on message_added); the client filters to its current tab.
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (ALLOWED_ORIGIN) res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.flushHeaders?.();
  res.write(`: connected\n\n`);
  sseClients.add(res);

  const keepalive = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch {}
  }, 25000);

  req.on("close", () => {
    clearInterval(keepalive);
    sseClients.delete(res);
  });
});

// ---------- Startup ----------

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set — add a Postgres database in Railway and link it.");
    process.exit(1);
  }
  try {
    await initSchema();
  } catch (err) {
    console.error("schema init failed", err);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`NDT tutor server listening on :${PORT}`);
    console.log(`ALLOWED_ORIGIN = ${ALLOWED_ORIGIN || "(not set — CORS will block all browsers!)"}`);
    console.log(`MODEL = ${MODEL}`);
    console.log(`METHODS = ${METHODS.join(", ")}`);
    console.log(`TEACHER_MODE = ${TEACHER_PASSWORD ? "enabled" : "disabled (set TEACHER_PASSWORD to enable)"}`);
  });
})();
