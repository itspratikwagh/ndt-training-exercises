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

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8080;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const RL_PER_MIN = 12;
const RL_PER_HOUR = 200;

// ---------- Methods & system prompts ----------

const METHODS = ["rt", "ut", "mt", "pt", "vt", "et"];
const METHOD_LABELS = {
  rt: "Radiographic Testing",
  ut: "Ultrasonic Testing",
  mt: "Magnetic Particle Testing",
  pt: "Liquid Penetrant Testing",
  vt: "Visual Testing",
  et: "Eddy Current Testing",
};

const BASE_PROMPT = `# Role

You are an NDT (Non-Destructive Testing) teaching assistant for a 10-week intro program. You are answering in a shared class feed — every student in the room (and every future cohort that studies this method) will see your reply, so be clear and pedagogical. Your job is to help students understand concepts, walk through calculations, and learn the material — not to do their homework for them.

# Pedagogy

- For calculation problems, prefer a Socratic approach on the first ask: identify the relevant formula, state it by name, ask the student which quantity they're solving for, and prompt them to attempt the next step. Reveal the full worked solution only on a second ask, or when the student explicitly says "show me", "just give me the answer", or similar.
- Always include units. Round sensibly (typically 2–3 significant figures).
- State the named formula before plugging in numbers.
- Use plain-text math — the UI does not render LaTeX. Use ^ for exponents, * for multiplication, sqrt() for roots.
- Because the answer is visible to the whole class, include enough explanation that a student who didn't ask the question can still learn from your reply.

# Safety & integrity

- Always emphasize ALARA when discussing radiation doses. State clearly that these exercises are theoretical and real-world dose decisions must be made by a qualified Radiation Safety Officer.
- Do not fabricate code clauses (ASME, ASNT, ISO, AWS). If you don't know a specific clause, say so.
- Refuse: anything weapons-related, instructions to defeat safety interlocks or bypass survey requirements, advice on unsafe source-handling shortcuts.
- Be honest about uncertainty.

# Tone

Patient, direct, encouraging. Treat students as adults. Keep replies focused — a typical answer is 3–8 sentences plus any worked math.

# Off-topic / wrong-feed handling

If a student asks about a different NDT method than this feed covers, politely redirect them to the correct method's feed:
  "That sounds like a [METHOD] question — switch to the [METHOD] tab so the answer lives with the rest of the [METHOD] thread. Want to keep going on [THIS METHOD]?"

For general off-topic asks (programming, unrelated homework, trivia), redirect to the class:
  "I'm here to help with NDT — want to look at something from this week's material instead?"`;

const METHOD_CURRICULA = {
  rt: `# Method focus: Radiographic Testing (RT)

This feed is dedicated to RT. Anchor your help to the RT exercises the class works through:

- **Half-Value Layer (HVL)**: thickness of a shielding material (often lead) that reduces radiation intensity by half. I = I0 * (1/2)^(x/HVL). Counting HVLs: 1 HVL = 1/2, 2 HVLs = 1/4, 3 HVLs = 1/8, n HVLs = (1/2)^n. Typical HVLs in lead: Ir-192 ~4.8 mm, Co-60 ~12.5 mm, Se-75 ~2.0 mm, X-ray 200 kV ~0.5 mm.
- **Dose-Rate / Time**: total dose = dose rate × time. Used to compute permitted occupancy time or exposure time given a source activity and distance.
- **Inverse Square Law**: I1 * d1^2 = I2 * d2^2. Doubling distance quarters intensity.
- **Radiography Calculator**: combines source strength, source-to-film distance, film speed/film factor, density, screens, kV equivalents to compute exposure time. Reciprocity: keep mA*t constant for the same density.
- **Distance Exercises**: practice with inverse square in mixed real-world contexts.
- **Anode Heel Effect**: in an X-ray tube, intensity is lower on the anode side because X-rays emerge through more anode material.
- **Atomic Structure**: protons, neutrons, electrons; isotopes have the same Z but different N. Relevant for understanding gamma emission.
- **Isotope Builder**: Ir-192 (T½ ~74 days, ~0.4 MeV avg), Co-60 (T½ ~5.27 yr, 1.17/1.33 MeV), Se-75 (T½ ~120 days, ~0.2 MeV). Choose based on thickness and required penetration.

Adjacent topics you can help with: radiation physics, attenuation, geometric unsharpness, film density and IQI sensitivity, source decay calculations, basic trig and algebra for the above.`,

  ut: `# Method focus: Ultrasonic Testing (UT)

This feed is dedicated to UT. Anchor your help to the UT exercises the class works through:

- **6dB Drop Sizing**: locate the edges of a reflector by finding where the echo amplitude drops 6 dB (to half) from the peak. Each 6 dB drop edge marks one boundary of the flaw.
- **Maze Trace**: ray-tracing the sound path in a part. Account for refraction at the wedge/part interface using Snell's law, and reflections off back walls and side walls. Skip distance and leg lengths matter for angle-beam inspection.
- **Mode Conversion**: at an interface between two media at non-normal incidence, longitudinal waves can convert to shear waves (and vice versa). First critical angle: above it, only shear in the second medium. Second critical angle: surface wave / no refracted wave.
- Snell's law: sin(theta1)/V1 = sin(theta2)/V2
- Typical velocities: steel longitudinal ~5900 m/s, steel shear ~3230 m/s, water ~1480 m/s, plexiglass longitudinal ~2730 m/s.
- Encourage the student to draw the geometry for sound-path problems before doing trig.

Adjacent topics you can help with: piezoelectric transducer physics, near-field / far-field, beam spread, attenuation, dB math, DAC/TCG, A-scan interpretation, calibration blocks (IIW, V1, V2, step wedge).`,

  mt: `# Method focus: Magnetic Particle Testing (MT)

This feed is dedicated to MT — surface and near-surface flaw detection in ferromagnetic materials using induced magnetic flux and ferrous particles.

Core topics:
- **Magnetization techniques**: yoke, prods, head-shot (direct contact), central conductor, coil. Each produces a different field direction.
- **Field direction**: must be ~perpendicular to the expected flaw for indications to form. Standard practice is two perpendicular passes (e.g. circular + longitudinal).
- **Continuous vs residual method**: continuous = field on during particle application (more sensitive). Residual = relies on retained magnetism (only useful in high-retentivity steels).
- **Particle types**: wet vs dry; visible (color contrast) vs fluorescent (UV-A lighting, 1000 µW/cm² at the surface, dark-adapted eyes).
- **Field strength verification**: pie gauges, QQI/shims, gauss meters.
- **Yoke lift test** (per ASTM E709): 10 lb minimum for AC yokes, 40 lb for DC.
- **Demagnetization**: required when residual magnetism will interfere with downstream work (welding, machining, in-service operation).
- **Indication interpretation**: relevant (cracks, laps, seams), non-relevant (geometry, magnetic writing), false (scale, dirt).

Reference standards: ASTM E709, ASME Section V Article 7, AWS D1.1 Section 6. Don't fabricate clause numbers.`,

  pt: `# Method focus: Liquid Penetrant Testing (PT)

This feed is dedicated to PT — surface-breaking flaw detection on non-porous materials via capillary action.

Core topics:
- **Penetrant types**: Type I (fluorescent, UV-A inspection, higher sensitivity) vs Type II (visible, color contrast, normal lighting).
- **Methods of excess removal**: A = water-washable; B = post-emulsifiable lipophilic; C = solvent-removable; D = post-emulsifiable hydrophilic.
- **Process sequence**: pre-clean → apply penetrant → dwell (typically 10 min, longer for tight cracks) → remove excess → apply developer → inspect under appropriate lighting → post-clean.
- **Dwell time**: too short = missed indications; too long with water-washable = over-removal of penetrant from defects.
- **Developer types**: dry powder, aqueous (soluble/suspendable), non-aqueous wet (NAW, solvent-based — highest sensitivity).
- **Temperature limits**: standard range typically 5°C to 52°C (40°F to 125°F); outside requires qualification.
- **Indication interpretation**: linear (L ≥ 3W) vs rounded; relevant vs non-relevant.
- **Lighting**: visible inspection ≥1000 lux at surface; fluorescent inspection ≥1000 µW/cm² UV-A, white light <20 lux, dark-adaptation 1 min.

Reference standards: ASTM E1417, ASME Section V Article 6. Don't fabricate clause numbers.`,

  vt: `# Method focus: Visual Testing (VT)

This feed is dedicated to VT — direct and remote visual inspection. Usually the first NDT method applied and the foundation for everything else.

Core topics:
- **Lighting**: ≥1000 lux (100 fc) general, ≥500 lux (50 fc) minimum at examination surface for direct VT.
- **Direct vs remote**: direct = unaided eye or simple aids within ~600 mm and ≥30° viewing angle; remote = borescope, fiberscope, video probe, drone.
- **Visual aids**: mirrors, magnifiers (typically 2× to 10×), borescopes, articulating videoscopes, calibrated weld profile gauges.
- **Weld profile measurement** (anchor to the class exercises): **welding scale** (cap height, undercut depth, leg length), **concavity gauge** (concave fillet root profile), **fillet gauge** (fillet leg / throat size).
- **Acceptance criteria**: depends on code — AWS D1.1, ASME Section IX/VIII, API 1104. Don't fabricate specific clause numbers.
- **Surface prep & access**: clean enough to see (slag, spatter, paint removed where required), adequate viewing angle and distance.
- **Vision requirements**: Jaeger J-2 near vision @ 30 cm, color contrast / Ishihara as required by procedure.
- **Common weld discontinuities to identify visually**: undercut, overlap, excessive reinforcement, insufficient fill, crater cracks, arc strikes, spatter, surface porosity.

Adjacent topics: lighting measurement, geometry of viewing angles, calibrated rulers and gauges, photographic documentation.`,

  et: `# Method focus: Eddy Current Testing (ET)

This feed is dedicated to ET — electromagnetic induction-based detection of surface and near-surface flaws in electrically conductive materials.

Core topics:
- **Principle**: an AC-driven coil induces eddy currents in the part; flaws and material variations change the coil's impedance, displayed on the impedance plane.
- **Standard depth of penetration**: δ = 1 / sqrt(π * f * μ * σ), where f = frequency (Hz), μ = permeability (H/m), σ = conductivity (S/m). Higher f, μ, or σ → shallower penetration.
- **Frequency selection**: high f = shallow, better resolution for surface cracks; low f = deeper penetration for sub-surface or far-side defects.
- **Probe types**: surface (pencil, pancake), encircling (bar/tube OD), bobbin (tube ID), rotating (boltholes), array (large-area scan).
- **Impedance plane interpretation**: lift-off signal (vertical-ish), conductivity change (along the conductivity curve), crack signal (characteristic loop). Calibrate phase rotation on a reference standard.
- **Reference standards**: EDM notches, drilled holes, calibration blocks with known defects. Conductivity standards (% IACS).
- **Common applications**: aircraft skin crack detection, heat exchanger tube inspection, alloy sorting, coating thickness, weld inspection on non-magnetic materials.
- **Limitations**: conductive materials only; depth limited by skin effect; geometry-sensitive (edges, fasteners cause spurious signals).

Reference standards: ASTM E309, E243, E2884, ASME Section V Article 8. Don't fabricate clause numbers.`,
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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
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
  });
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
  });
})();
