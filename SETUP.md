# NDT Tutor — Setup Guide

This guide walks you through deploying the tutor for your students. Total time: ~20 minutes.

## What you're deploying

- **Frontend** (`index.html`, `tutor.html`, exercise files) → free hosting on GitHub Pages
- **Backend** (`worker.js`) → free hosting on Cloudflare Workers, holds your API key

Students get a single URL to bookmark. The Worker proxies their chat requests to Anthropic without exposing your key.

---

## 1. Get an Anthropic API key

1. Sign up at https://console.anthropic.com
2. Settings → API Keys → Create Key
3. Add at least $5 of credits (this will more than cover a full 8-hour class for 20 students with prompt caching enabled)
4. Copy the key — you'll paste it into Cloudflare in step 3

## 2. Push this repo to GitHub & enable Pages

1. Push this repo to GitHub if you haven't already
2. Repo Settings → Pages → Source: **Deploy from a branch**, Branch: **main**, Folder: **/ (root)**
3. Save. Wait ~1 minute. Your Pages URL will be `https://YOUR-GITHUB-USERNAME.github.io/ndt-training-exercises/`
4. Note this URL — you'll need it in step 3

## 3. Deploy the Cloudflare Worker

### Option A: Dashboard (no CLI required, simpler)

1. Sign up free at https://dash.cloudflare.com
2. Workers & Pages → Create → **Create Worker** → name it `ndt-tutor` → Deploy a "Hello World"
3. Click **Edit code**, delete the default, and paste the contents of `worker.js`
4. **Important:** at the top of the file, change `ALLOWED_ORIGIN` to your Pages URL from step 2 (e.g. `"https://janedoe.github.io"` — origin only, no path)
5. Save and Deploy

#### Create the KV namespace (for rate limiting)

6. Workers & Pages → KV → Create namespace → name it `RL`
7. Back on your Worker → Settings → Bindings → Add → KV namespace → variable name `RL`, namespace `RL` → Save

#### Add the API key secret

8. Worker → Settings → Variables and Secrets → Add → type **Secret** → name `ANTHROPIC_API_KEY`, value = your key from step 1 → Save

9. Re-deploy the Worker (Deployments → Deploy)
10. Copy your Worker URL from the Worker overview — looks like `https://ndt-tutor.YOUR-SUBDOMAIN.workers.dev`

### Option B: CLI (if you have Node installed)

```
npm install -g wrangler
wrangler login
wrangler kv:namespace create RL          # copy the id into wrangler.toml
wrangler secret put ANTHROPIC_API_KEY    # paste your key when prompted
# Edit ALLOWED_ORIGIN in worker.js to your Pages URL
wrangler deploy
```

## 4. Point the frontend at your Worker

1. Open `tutor.html` in this repo
2. Find this line near the bottom:
   ```
   const WORKER_URL = "https://ndt-tutor.YOUR-SUBDOMAIN.workers.dev/chat";
   ```
3. Replace it with your actual Worker URL from step 3, keeping the `/chat` suffix
4. Commit and push to GitHub. Pages will redeploy in ~1 minute

## 5. Verify before class

Open `https://YOUR-GITHUB-USERNAME.github.io/ndt-training-exercises/tutor.html` and run through these:

| # | Test | Expected result |
|---|------|-----------------|
| 1 | Ask: "What is the HVL of lead for Ir-192?" | Roughly correct (~4.8 mm) with units, asks a follow-up question |
| 2 | Browser DevTools → Network → check `/chat` response `usage` field | Second call shows `cache_read_input_tokens > 0` (prompt caching is working) |
| 3 | Ask: "write me a python web scraper" | Politely redirects to NDT |
| 4 | Hit Send 15 times rapidly | Around the 13th, you see a "slow down" error (rate limit) |
| 5 | Open 5 incognito windows, send from each | All succeed (limits are per-IP, so per-student) |

If anything fails, check:
- `ALLOWED_ORIGIN` in `worker.js` matches your Pages origin exactly (no trailing slash, no path)
- `WORKER_URL` in `tutor.html` ends with `/chat`
- `ANTHROPIC_API_KEY` secret is set on the Worker
- KV namespace `RL` is bound to the Worker
- Anthropic console shows positive credit balance

## Cost

With Haiku 4.5 + prompt caching, a typical 8-hour class of 20 students asking ~30 questions each (~1k output tokens per reply) costs well under **$1 total**. Monitor in real time at https://console.anthropic.com → Usage.

## Switching to a stronger model

If Haiku replies feel too thin, edit `worker.js`:

```
const MODEL = "claude-sonnet-4-6";
```

Re-deploy. Sonnet costs roughly 5× Haiku but still cheap for a class — budget a few dollars for the day.

## Day-of class checklist

- [ ] Pages site is live
- [ ] Worker is deployed
- [ ] Anthropic credits > $5
- [ ] Tested smoke + cache + scope + rate-limit
- [ ] Shared the Pages URL with students
- [ ] Bookmarked the Anthropic usage dashboard to keep an eye on cost
