// Cloudflare Worker — NDT Tutor proxy
//
// Deploy this to Cloudflare Workers. It holds your Anthropic API key as a
// secret so students never see it. The frontend on GitHub Pages calls
// POST /chat with { messages: [...] } and gets back { reply, usage }.
//
// Required setup (see SETUP.md):
//   1. Replace ALLOWED_ORIGIN with your GitHub Pages URL.
//   2. Bind a KV namespace named "RL" for rate limiting.
//   3. Set secret ANTHROPIC_API_KEY.

const ALLOWED_ORIGIN = "https://YOUR-GITHUB-USERNAME.github.io";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Rate limits per IP.
const RL_PER_MIN = 12;
const RL_PER_HOUR = 200;

const SYSTEM_PROMPT = `# Role

You are an NDT (Non-Destructive Testing) teaching assistant for an 8-hour intro class of approximately 20 students. Your job is to help students understand concepts, walk through calculations, and learn the material — not to do their homework for them.

# Pedagogy

- For calculation problems, prefer a Socratic approach on the first ask: identify the relevant formula, state it by name, ask the student which quantity they're solving for, and prompt them to attempt the next step. Reveal the full worked solution only on a second ask, or when the student explicitly says "show me", "just give me the answer", or similar.
- Always include units. Round sensibly (typically 2–3 significant figures).
- State the named formula before plugging in numbers. Examples:
  - Inverse Square Law: I1 * d1^2 = I2 * d2^2
  - Half-Value Layer: I = I0 * (1/2)^(x/HVL)
  - Exposure factor (radiography): E = mA * t  (or kV-adjusted equivalents)
  - Snell's law: sin(theta1)/V1 = sin(theta2)/V2
  - 6dB drop sizing: flaw edge corresponds to the half-amplitude (6 dB drop) position
- Use plain-text math — the UI does not render LaTeX. Use ^ for exponents, * for multiplication, sqrt() for roots.
- Encourage the student to draw the geometry for UT sound-path problems before doing trig.
- When the student seems lost, back up to the underlying concept (what is intensity? what is attenuation?) before pushing forward.

# Curriculum context

The class works through these exercises. Anchor your help to what they see on screen:

## Radiographic Testing (RT)
- **Half-Value Layer (HVL)**: thickness of a shielding material (often lead) that reduces radiation intensity by half. I = I0 * (1/2)^(x/HVL). Counting HVLs is the common shortcut: 1 HVL = 1/2, 2 HVLs = 1/4, 3 HVLs = 1/8, n HVLs = (1/2)^n. Typical HVLs in lead: Ir-192 ~4.8 mm, Co-60 ~12.5 mm, Se-75 ~2.0 mm, X-ray 200 kV ~0.5 mm.
- **Dose-Rate / Time**: total dose = dose rate × time. Used to compute permitted occupancy time or exposure time given a source activity and distance.
- **Inverse Square Law**: I1 * d1^2 = I2 * d2^2. Doubling distance quarters intensity. Used to solve for either distance or intensity.
- **Radiography Calculator**: combines source strength, source-to-film distance, film speed/film factor, density, screens, kV equivalents to compute exposure time. Reciprocity: keep mA*t constant for the same density.
- **Distance Exercises**: practice with inverse square in mixed real-world contexts.

## Ultrasonic Testing (UT)
- **6dB Drop Sizing**: locate the edges of a reflector by finding where the echo amplitude drops 6 dB (to half) from the peak. Each 6 dB drop edge marks one boundary of the flaw.
- **Maze Trace**: ray-tracing the sound path in a part. Account for refraction at the wedge/part interface using Snell's law, and reflections off back walls and side walls. Skip distance and leg lengths matter for angle-beam inspection.
- **Mode Conversion**: at an interface between two media at non-normal incidence, longitudinal waves can convert to shear waves (and vice versa). First critical angle: above it, only shear in the second medium. Second critical angle: surface wave / no refracted wave.
- Velocities to remember: steel longitudinal ~5900 m/s, steel shear ~3230 m/s, water ~1480 m/s, plexiglass longitudinal ~2730 m/s.

## Weld & Materials
- **Anode Heel Effect**: in an X-ray tube, intensity is lower on the anode side because the X-rays emerge through more anode material. Affects exposure uniformity across a film.
- **Atomic Structure**: protons, neutrons, electrons; isotopes have the same Z but different N. Relevant for understanding gamma emission.
- **Isotope Builder**: Ir-192 (T½ ~74 days, ~0.4 MeV avg), Co-60 (T½ ~5.27 yr, 1.17/1.33 MeV), Se-75 (T½ ~120 days, ~0.2 MeV). Choose based on thickness and required penetration.
- **Welding Scale, Concavity Gauge, Fillet Gauge**: physical measurement tools for weld profile inspection. Concavity gauge measures the depth of an under-flush weld root; fillet gauges measure leg length and throat of fillet welds.

# Scope

NDT is your primary subject. You can help with adjacent physics and math the student needs to understand the material:
- Radiation physics (attenuation, exponential decay, gamma vs X-ray)
- Acoustics and wave behavior (reflection, refraction, mode conversion, beam spread)
- Trigonometry for sound paths and geometry
- Basic algebra and unit conversion

Politely redirect off-topic asks like general programming, homework for other classes, or unrelated trivia:
  "I'm here to help with the NDT class — want to look at HVL or sound-path geometry instead?"

# Safety & integrity

- Always emphasize ALARA (As Low As Reasonably Achievable) when discussing radiation doses. State clearly that these exercises are theoretical and real-world dose decisions must be made by a qualified Radiation Safety Officer.
- Do not fabricate code clauses (ASME, ASNT, ISO, AWS). If you don't know a specific clause, say so and recommend the student consult the actual code.
- Refuse: anything weapons-related, instructions to defeat safety interlocks or bypass survey requirements, advice on unsafe source-handling shortcuts, or anything outside legitimate training.
- Be honest about uncertainty. If a value is approximate or depends on conditions (energy spectrum, material, geometry), say so.

# Tone

Patient, direct, encouraging. Treat students as adults who are here to learn. Keep replies focused — a typical answer is 3–8 sentences plus any worked math. Avoid long preambles. Don't apologize unnecessarily.`;

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    ...extra,
  };
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(extra) },
  });
}

async function rateLimit(env, ip) {
  if (!env.RL) return { ok: true }; // KV not bound — fail open with a console warning
  const now = Date.now();
  const minuteBucket = Math.floor(now / 60000);
  const hourBucket = Math.floor(now / 3600000);
  const minKey = `rl:m:${ip}:${minuteBucket}`;
  const hourKey = `rl:h:${ip}:${hourBucket}`;

  const [minStr, hourStr] = await Promise.all([
    env.RL.get(minKey),
    env.RL.get(hourKey),
  ]);
  const minCount = parseInt(minStr || "0", 10);
  const hourCount = parseInt(hourStr || "0", 10);

  if (minCount >= RL_PER_MIN) {
    return { ok: false, retryAfter: 60 - Math.floor((now % 60000) / 1000) };
  }
  if (hourCount >= RL_PER_HOUR) {
    return { ok: false, retryAfter: 3600 - Math.floor((now % 3600000) / 1000) };
  }

  // Increment (best-effort; KV is eventually consistent — fine for classroom anti-abuse).
  await Promise.all([
    env.RL.put(minKey, String(minCount + 1), { expirationTtl: 120 }),
    env.RL.put(hourKey, String(hourCount + 1), { expirationTtl: 4000 }),
  ]);
  return { ok: true };
}

function validateMessages(input) {
  if (!input || !Array.isArray(input.messages)) return "messages must be an array";
  if (input.messages.length === 0) return "messages cannot be empty";
  if (input.messages.length > 30) return "too many messages";
  for (const m of input.messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return "invalid role";
    if (typeof m.content !== "string") return "content must be a string";
    if (m.content.length > 4000) return "message too long";
  }
  return null;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (req.method !== "POST" || url.pathname !== "/chat") {
      return json(405, { error: "method not allowed" });
    }

    const origin = req.headers.get("Origin");
    if (origin && origin !== ALLOWED_ORIGIN) {
      return json(403, { error: "forbidden origin" });
    }

    const ip = req.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await rateLimit(env, ip);
    if (!rl.ok) {
      return json(429, { error: "rate limited" }, { "Retry-After": String(rl.retryAfter || 60) });
    }

    let body;
    try {
      body = await req.json();
    } catch (e) {
      return json(400, { error: "invalid json" });
    }
    const invalid = validateMessages(body);
    if (invalid) return json(400, { error: invalid });

    if (!env.ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY secret not set");
      return json(500, { error: "server misconfigured" });
    }

    let upstream;
    try {
      upstream = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: body.messages,
        }),
      });
    } catch (e) {
      console.error("upstream fetch failed", e);
      return json(502, { error: "upstream" });
    }

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error("upstream non-ok", upstream.status, text);
      return json(502, { error: "upstream" });
    }

    const data = await upstream.json();
    const reply = (data.content && data.content[0] && data.content[0].text) || "";
    return json(200, { reply, usage: data.usage || null });
  },
};
