# PAUT Scan Plan Builder — Feasibility, V1 Scope, and Roadmap

Research date: September 2026. Reference product: Evident (formerly Olympus) **NDT SetupBuilder**.

## 1. What NDT SetupBuilder is

NDT SetupBuilder is a Windows PC application for designing and validating ultrasonic inspection
setups before going to the instrument. The workflow, in order:

1. Pick the acquisition unit (OmniScan MX2, SX, X3, X4) so beam counts and limits match the hardware.
2. Define the **part**: plate or pipe, thickness, material and velocities.
3. Draw a **weld overlay**: bevel geometry (V, double V, J, etc.), root face and gap, cap, HAZ.
4. Pick a **probe and wedge** from the Evident database (frequency, elements, pitch, wedge angle,
   height, offsets). Third-party probes can be entered manually.
5. Add **groups**: phased array sectorial, linear, compound (sectorial + linear hybrid),
   pitch-catch, TOFD, and conventional UT.
6. Run the **beam simulation** (ray tracing): every beam is drawn through the part with skips,
   so the planner can see coverage of the weld volume and any dead zones, and tune index offset,
   angle range, aperture, and focus.
7. **Export** to the instrument as `.ondtsetup` (parameters, recomputed on the OmniScan) or
   `.law` (pre-computed focal laws). The technician imports, calibrates, and scans.

Other facts that matter for us:

- Older 1.x releases required a HASP USB license key; the current build is distributed through
  Evident's downloads portal. Licensing terms should be confirmed with Evident before quoting them.
- The OmniScan X3 now has an onboard scan plan tool with weld overlay and ray tracing, so the
  "pre-build on a PC" niche is narrower than it used to be. The PC tool still wins for
  supervisors planning without an instrument, for documentation, and for training.
- The export formats are proprietary and undocumented. Evident's open `.nde` format (HDF5 + JSON)
  covers acquired data, not instrument setups.

## 2. The rest of the market

| Tool | Vendor | Position | Notes |
|---|---|---|---|
| ESBeamTool | Eclipse Scientific | De facto standard for technique documentation | Weld/part library, beam spread at a chosen dB drop, near-field check, DXF weld import, focal law export, ASME-oriented reports. Paid, dongle or FlashLock license. |
| CIVA | Extende / CEA | Full acoustic simulation | Field, POD, defect response. Expensive, research-grade. |
| UTstudio+ | Sonatest | Setup and review for Veo/Prisma | Full PAUT setups, single and dual axis encoded scans. |
| UltraVision | Eddyfi / Zetec | Acquisition and analysis | Includes scan plan design for Zetec hardware. |
| Free calculators | Various | Focal law or skip distance only | No weld overlay, no coverage picture, no report. |

Forum threads asking for "any free PAUT scan plan software" recur every year. Nobody serves the
free, browser-based, training-first niche.

## 3. Can we build a similar tool?

**Yes, for the parts that matter to us.** The value of these tools is geometry, ray tracing,
coverage visualization, and a printable scan plan. All of that is closed-form math that runs
comfortably in a browser canvas:

- Snell's law at the wedge/part interface, refracted angle from wedge angle and velocities.
- Skip distance, leg count, and sound path per beam.
- Focal law delays per element: time of flight from each element centroid, through the wedge,
  to the focal point. Steering limits from pitch and wavelength (grating lobe check).
- Near field `N = D² f / 4v` on the effective aperture, and beam spread at a chosen dB drop.
- Weld cross-section as a polygon; coverage as beam-polygon intersection.

We already have the seed. `UT-Scan-Plan-Builder.html` in this repo draws a plate, a V-groove
weld, a draggable wedge, up to three legs, skip readouts, and a guided audio tutorial. The PAUT
builder generalizes it from one beam to a fan of beams.

**What we cannot or should not build:**

- **Instrument export.** `.ondtsetup` and `.law` are undocumented. Reverse engineering them is
  legally risky and fragile across MXU versions. V1 exports a human-readable setup sheet the
  technician types into the OmniScan, plus CSV of focal laws.
- **Evident's probe database.** We build a small catalog from public datasheets and let users
  add custom probes and wedges.
- **CIVA-grade acoustic simulation.** Ray tracing plus a beam-spread envelope is enough for
  planning and teaching. Full field simulation is out of scope permanently.

Effort for V1 is roughly four to six weeks for one developer, reusing the existing canvas code
and the single-file, no-dependency pattern the repo uses.

## 4. Positioning

Training-first, technique-documentation second. Primary users are AATA students in the
Introduction to Phased Array topic and their instructors. Secondary users are working technicians
who need a quick, free scan plan sketch and coverage check. The tool is not a replacement for
SetupBuilder's instrument export, and we say so.

## 5. Version 1 feature set

Everything below ships as one static HTML file, hosted on GitHub Pages like the other exercises.

**Part**
- Flat plate. Thickness in mm or inches. Material presets (carbon steel, stainless, aluminum)
  with longitudinal and shear velocities, editable.

**Weld overlay**
- Single V and double V. Inputs: bevel angle, root gap, root face, cap width and reinforcement,
  HAZ width. Weld centerline as the zero reference.

**Probe and wedge**
- Catalog of common weld probes and wedges (for example 5L16-A10 with SA10-N55S, 5L32-A31 with
  SA31-N55S, 5L64-A32 with SA32-N55S). Fields: frequency, element count, pitch, elevation; wedge
  angle, wedge velocity, height of first element, first-element offset to wedge front.
- Custom probe and wedge entry.
- Computed: natural refracted angle, wavelength, element pitch vs half wavelength warning.

**Beam sets (groups)**
- Sectorial: start angle, stop angle, step, first element, aperture size, focus depth or sound path.
- Linear: fixed angle, aperture, first and last element, step.
- Up to two groups, each on either side of the weld, with independent index offsets.
- Drag the wedge to set index offset. Legs drawn up to leg 3.

**Coverage view**
- Every beam ray traced through the plate with skips. Weld volume, fusion faces, root, cap, and
  HAZ drawn as zones.
- Zone hit report: which zones are crossed on leg 1 and leg 2, by which angles.
- Coverage percentage of the weld cross-section (rasterized fan versus weld polygon).
- Optional beam-spread envelope at -6 dB to show realistic coverage, not just center rays.

**Readouts**
- Exit point, index offset, half and full skip, sound path to root and cap at the chosen angle.
- Near field length for the active aperture, and a warning when the focus is beyond it.
- Steering range check for the selected probe.

**Focal law table**
- Per-beam element delays. Export as CSV. Shown mainly as a teaching aid: students can see why a
  60° beam needs a different delay profile than a 45° beam.

**Scan plan sheet**
- Print-ready page (browser print to PDF) with the sketch plus the items ASME Section V,
  Article 4 expects in a scan plan: part details and weld design, probe and wedge, focal law
  configuration, index offsets, number and direction of scans, and instrument settings the
  technician must enter by hand.

**Persistence and teaching**
- Save and load plans as JSON (localStorage and download).
- Guided mode in the style of the existing builder: step-by-step voice guide that asks the student
  to reach root, fusion face, and cap coverage before it advances.
- Three or four classroom presets (for example 1 in plate 60° V, 0.5 in plate 70° V) so an
  instructor can start every session from the same state.

## 6. Roadmap

**V1.0 (weeks 1 to 6)**: the feature set above.

**V1.1 (weeks 7 to 10): pipes and TOFD**
- Curved parts: pipe OD and wall, circumferential welds, ID/OD curvature effects on skip and
  coverage, wedge contouring note.
- TOFD group: probe center separation from thickness and angle, lateral wave and backwall dead
  zones drawn on the overlay.
- Compound S-scan.

**V1.2 (weeks 11 to 14): more geometry and import**
- J, U, K, and compound bevels; single-sided and offset bevels.
- DXF or SVG import of a weld profile.
- Two-sided plans with up to four groups, and a per-zone coverage matrix.

**V2.0 (quarter 2): documentation and classroom**
- Full technique sheet generator with company header, revision, and sign-off blocks.
- Code-aware checklists (ASME V Article 4, AWS D1.1 Annex for PAUT) that flag missing essential
  variables rather than trying to certify compliance.
- Instructor mode using the existing Railway server and Postgres: students submit plans, the
  class feed shows them, instructors comment and grade. Integration with the tutor so a student can
  ask "why does my 45° beam miss the root?" with the plan attached.

**V2.x: instrument hand-off**
- Setup checklist per instrument family (OmniScan MX2/SX/X3, Sonatest Veo, Zetec) that mirrors
  the menu order on the device.
- Watch for Evident publishing a setup schema inside the `.nde` ecosystem; add native export only
  if a documented format appears.

**V3 (later): better physics**
- Beam spread and focusing model validated against ESBeamTool and real instrument screenshots.
- TFM/FMC zone planning and grid-resolution helper.
- Immersion and composite (0° linear, corrosion mapping) presets.

## 7. Risks

- **Accuracy trust.** A wrong coverage picture is worse than none. Mitigation: validate V1
  geometry against hand calculations and against ESBeamTool or instrument screenshots on three
  reference plans before release, and keep the validation set in the repo.
- **Scope creep toward CIVA.** Mitigation: the roadmap stops at ray tracing plus beam spread.
- **Probe data errors.** Mitigation: cite the datasheet per catalog entry and keep custom entry
  first-class.
- **Export expectations.** Users will ask for `.ondtsetup`. Mitigation: state the limitation on
  the page and ship the setup checklist instead.

## 8. Sources

- Evident, NDT SetupBuilder product page: https://ims.evidentscientific.com/en/products/software/ndt-setupbuilder
- Evident, "Build your scan plan on your PC" (OmniScan X4): https://ims.evidentscientific.com/en/insights/make-the-most-of-your-omniscan
- Evident, OmniScan X3 onboard scan plan tool: https://ims.evidentscientific.com/en/insights/3-ways-the-omniscan-x3-flaw-detectors-scan-plan-tool-simplifies-your-set-up
- Evident, compound S-scan strategy: https://ims.evidentscientific.com/en/applications/improved-scan-plan-strategy-with-compound-s-scan-for-weld-inspection
- NDT SetupBuilder v1.0 user manual (DMTA-20024-01EN): https://www.scribd.com/document/500412180/DMTA-20024-01EN-Rev-a-NDT-SetupBuilder-v10-User
- NDT Exchange listing: https://ndtexchange.com/ndt-setup-builder
- Eclipse Scientific ESBeamTool: https://www.eclipsescientific.com/beamtool.html
- ndt.net forum, "Any free PAUT scan plan software?": https://www.ndt.net/forum/thread.php?rootID=45714
- ndt.net forum, ESBeamTool to OmniScan/TomoView: https://www.ndt.net/forum/thread.php?rootID=56268
- NDE Open File Format: https://ndeformat.com/4.1/getting-started/ and https://github.com/Evident-Industrial/NDE_Open_File_Format
- Evident probe 5L16-A10 specs: https://www.directindustry.com/prod/evident-olympus-scientific-solutions/product-17434-2823046.html
- Evident wedge SA10-N55S: https://ims.evidentscientific.com/en/products/phased-array-wedges/u8720545
- Ginzel, near field and focusing with wedges: https://www.ndt.net/article/ndtnet/2009/ginzel2.pdf
- Weld Fabrication World, PAUT technical guide (scan plan contents): https://www.weldfabworld.com/paut/
