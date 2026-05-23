// NDT Tutor — shared classroom Q&A backend.
//
// Every question and answer is stored in Postgres and pushed live to all
// connected students via Server-Sent Events. One student's question
// becomes a learning resource for the whole class.
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

const SYSTEM_PROMPT = `# Role

You are an NDT (Non-Destructive Testing) teaching assistant for an 8-hour intro class of approximately 20 students. You are answering in a shared class feed — every student in the room can see your reply, so be clear and pedagogical. Your job is to help students understand concepts, walk through calculations, and learn the material — not to do their homework for them.

# Pedagogy

- For calculation problems, prefer a Socratic approach on the first ask: identify the relevant formula, state it by name, ask the student which quantity they're solving for, and prompt them to attempt the next step. Reveal the full worked solution only on a second ask, or when the student explicitly says "show me", "just give me the answer", or similar.
- Always include units. Round sensibly (typically 2–3 significant figures).
- State the named formula before plugging in numbers. Examples:
  - Inverse Square Law: I1 * d1^2 = I2 * d2^2
  - Half-Value Layer: I = I0 * (1/2)^(x/HVL)
  - Snell's law: sin(theta1)/V1 = sin(theta2)/V2
- Use plain-text math — the UI does not render LaTeX. Use ^ for exponents, * for multiplication, sqrt() for roots.
- Encourage the student to draw the geometry for UT sound-path problems before doing trig.
- Because the answer is visible to the whole class, include enough explanation that a student who didn't ask the question can still learn from your reply.

# Curriculum context

The class works through these exercises. Anchor your help to what they see on screen:

## Radiographic Testing (RT)
- **Half-Value Layer (HVL)**: thickness of a shielding material (often lead) that reduces radiation intensity by half. I = I0 * (1/2)^(x/HVL). Counting HVLs is the common shortcut: 1 HVL = 1/2, 2 HVLs = 1/4, 3 HVLs = 1/8, n HVLs = (1/2)^n. Typical HVLs in lead: Ir-192 ~4.8 mm, Co-60 ~12.5 mm, Se-75 ~2.0 mm, X-ray 200 kV ~0.5 mm.
- **Dose-Rate / Time**: total dose = dose rate × time. Used to compute permitted occupancy time or exposure time given a source activity and distance.
- **Inverse Square Law**: I1 * d1^2 = I2 * d2^2. Doubling distance quarters intensity.
- **Radiography Calculator**: combines source strength, source-to-film distance, film speed/film factor, density, screens, kV equivalents to compute exposure time. Reciprocity: keep mA*t constant for the same density.
- **Distance Exercises**: practice with inverse square in mixed real-world contexts.

## Ultrasonic Testing (UT)
- **6dB Drop Sizing**: locate the edges of a reflector by finding where the echo amplitude drops 6 dB (to half) from the peak. Each 6 dB drop edge marks one boundary of the flaw.
- **Maze Trace**: ray-tracing the sound path in a part. Account for refraction at the wedge/part interface using Snell's law, and reflections off back walls and side walls. Skip distance and leg lengths matter for angle-beam inspection.
- **Mode Conversion**: at an interface between two media at non-normal incidence, longitudinal waves can convert to shear waves (and vice versa). First critical angle: above it, only shear in the second medium. Second critical angle: surface wave / no refracted wave.
- Velocities: steel longitudinal ~5900 m/s, steel shear ~3230 m/s, water ~1480 m/s, plexiglass longitudinal ~2730 m/s.

## Weld & Materials
- **Anode Heel Effect**: in an X-ray tube, intensity is lower on the anode side because the X-rays emerge through more anode material.
- **Atomic Structure**: protons, neutrons, electrons; isotopes have the same Z but different N. Relevant for understanding gamma emission.
- **Isotope Builder**: Ir-192 (T½ ~74 days, ~0.4 MeV avg), Co-60 (T½ ~5.27 yr, 1.17/1.33 MeV), Se-75 (T½ ~120 days, ~0.2 MeV). Choose based on thickness and required penetration.
- **Welding Scale, Concavity Gauge, Fillet Gauge**: physical measurement tools for weld profile inspection.

# Scope

NDT is your primary subject. You can help with adjacent physics and math the student needs to understand the material (radiation physics, acoustics, wave behavior, trig, basic algebra, unit conversion).

Politely redirect off-topic asks like general programming, homework for other classes, or unrelated trivia:
  "I'm here to help with the NDT class — want to look at HVL or sound-path geometry instead?"

# Safety & integrity

- Always emphasize ALARA when discussing radiation doses. State clearly that these exercises are theoretical and real-world dose decisions must be made by a qualified Radiation Safety Officer.
- Do not fabricate code clauses (ASME, ASNT, ISO, AWS). If you don't know a specific clause, say so.
- Refuse: anything weapons-related, instructions to defeat safety interlocks or bypass survey requirements, advice on unsafe source-handling shortcuts.
- Be honest about uncertainty.

# Tone

Patient, direct, encouraging. Treat students as adults. Keep replies focused — a typical answer is 3–8 sentences plus any worked math.`;

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

function sanitizeName(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, 40);
  return trimmed.length ? trimmed : null;
}

function validateContent(text) {
  if (typeof text !== "string") return "content must be a string";
  const t = text.trim();
  if (!t) return "content is empty";
  if (t.length > 4000) return "message too long";
  return null;
}

async function callAnthropic(messages) {
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
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
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

// List all threads, newest activity first.
app.get("/threads", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.created_at, t.updated_at, t.asker_name, t.title,
              (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS message_count
       FROM threads t
       ORDER BY t.updated_at DESC
       LIMIT 200`
    );
    res.json({ threads: rows });
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
      pool.query(`SELECT id, created_at, updated_at, asker_name, title FROM threads WHERE id = $1`, [id]),
      pool.query(
        `SELECT id, created_at, role, author_name, content FROM messages WHERE thread_id = $1 ORDER BY created_at ASC, id ASC`,
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

  const askerName = sanitizeName(req.body?.author_name);
  const invalid = validateContent(req.body?.content);
  if (invalid) return res.status(400).json({ error: invalid });
  const content = req.body.content.trim();
  const title = content.length > 80 ? content.slice(0, 80).trimEnd() + "…" : content;

  const client = await pool.connect();
  let threadId, userMsgId, assistantMsg;
  try {
    await client.query("BEGIN");
    const tRes = await client.query(
      `INSERT INTO threads (asker_name, title) VALUES ($1, $2) RETURNING id, created_at, updated_at`,
      [askerName, title]
    );
    threadId = tRes.rows[0].id;
    const uRes = await client.query(
      `INSERT INTO messages (thread_id, role, author_name, content) VALUES ($1, 'user', $2, $3) RETURNING id, created_at`,
      [threadId, askerName, content]
    );
    userMsgId = uRes.rows[0].id;
    await client.query("COMMIT");

    // Broadcast the new thread + user message immediately so others see "thinking..."
    sseBroadcast({
      type: "thread_created",
      thread: { id: threadId, asker_name: askerName, title, created_at: tRes.rows[0].created_at, updated_at: tRes.rows[0].updated_at, message_count: 1 },
      message: { id: userMsgId, thread_id: threadId, role: "user", author_name: askerName, content, created_at: uRes.rows[0].created_at },
    });

    // Call Claude with just this one user turn.
    const { reply } = await callAnthropic([{ role: "user", content }]);

    const aRes = await pool.query(
      `INSERT INTO messages (thread_id, role, content) VALUES ($1, 'assistant', $2) RETURNING id, created_at`,
      [threadId, reply]
    );
    await pool.query(`UPDATE threads SET updated_at = NOW() WHERE id = $1`, [threadId]);
    assistantMsg = { id: aRes.rows[0].id, thread_id: threadId, role: "assistant", author_name: null, content: reply, created_at: aRes.rows[0].created_at };

    sseBroadcast({ type: "message_added", message: assistantMsg });

    res.json({ thread_id: threadId, user_message_id: userMsgId, assistant_message: assistantMsg });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("create thread failed", err);
    if (threadId) {
      sseBroadcast({ type: "message_added", message: { id: -1, thread_id: threadId, role: "assistant", author_name: null, content: "(The tutor failed to answer. Try asking again.)", created_at: new Date().toISOString() } });
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
  const invalid = validateContent(req.body?.content);
  if (invalid) return res.status(400).json({ error: invalid });
  const content = req.body.content.trim();

  try {
    const exists = await pool.query(`SELECT 1 FROM threads WHERE id = $1`, [threadId]);
    if (!exists.rows.length) return res.status(404).json({ error: "thread not found" });

    const uRes = await pool.query(
      `INSERT INTO messages (thread_id, role, author_name, content) VALUES ($1, 'user', $2, $3) RETURNING id, created_at`,
      [threadId, authorName, content]
    );
    await pool.query(`UPDATE threads SET updated_at = NOW() WHERE id = $1`, [threadId]);
    sseBroadcast({
      type: "message_added",
      message: { id: uRes.rows[0].id, thread_id: threadId, role: "user", author_name: authorName, content, created_at: uRes.rows[0].created_at },
    });

    // Build full conversation history for Claude.
    const history = await loadThreadMessages(threadId);
    const { reply } = await callAnthropic(history);

    const aRes = await pool.query(
      `INSERT INTO messages (thread_id, role, content) VALUES ($1, 'assistant', $2) RETURNING id, created_at`,
      [threadId, reply]
    );
    await pool.query(`UPDATE threads SET updated_at = NOW() WHERE id = $1`, [threadId]);
    const assistantMsg = { id: aRes.rows[0].id, thread_id: threadId, role: "assistant", author_name: null, content: reply, created_at: aRes.rows[0].created_at };
    sseBroadcast({ type: "message_added", message: assistantMsg });

    res.json({ user_message_id: uRes.rows[0].id, assistant_message: assistantMsg });
  } catch (err) {
    console.error("add message failed", err);
    sseBroadcast({ type: "message_added", message: { id: -1, thread_id: threadId, role: "assistant", author_name: null, content: "(The tutor failed to answer. Try asking again.)", created_at: new Date().toISOString() } });
    res.status(502).json({ error: "tutor failed" });
  }
});

// SSE stream — anyone in the class connects and gets live updates.
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
  });
})();
