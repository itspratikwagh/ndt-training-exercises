# NDT Tutor — Setup Guide (Railway edition)

This guide walks you through deploying the tutor for your students. Total time: ~20 minutes.

## What you're deploying

- **Frontend** (`index.html`, `tutor.html`, exercise files) → free hosting on GitHub Pages
- **Backend** (`server/server.js`) → Railway, holds your API key as an env var

Students get a single URL to bookmark. The Railway service proxies their chat requests to Anthropic without exposing your key.

---

## 1. Get an Anthropic API key

1. Sign up at https://console.anthropic.com
2. Settings → API Keys → Create Key
3. Add at least $5 of credits (this will more than cover a full 8-hour class for 20 students with prompt caching enabled)
4. Copy the key — you'll paste it into Railway in step 3

## 2. Push this repo to GitHub & enable Pages

1. Push this repo to GitHub if you haven't already
2. Repo Settings → Pages → Source: **Deploy from a branch**, Branch: **main**, Folder: **/ (root)**
3. Save. Wait ~1 minute. Your Pages URL will be `https://YOUR-GITHUB-USERNAME.github.io/ndt-training-exercises/`
4. The origin you'll need for step 3 is just `https://YOUR-GITHUB-USERNAME.github.io` (no path, no trailing slash)

## 3. Deploy the backend to Railway

1. Sign up free at https://railway.app (the trial includes ~$5 of credit, plenty for a class day)
2. **New Project → Deploy from GitHub repo** → select this repo and authorize Railway if prompted
3. Once the service is created, open it and go to **Settings → Source** and set:
   - **Root Directory:** `server`
   This tells Railway to build only the `server/` subfolder (it'll detect `package.json` and run `npm install` + `npm start`)
4. **Settings → Networking → Generate Domain** — Railway gives you a public URL like `https://ndt-tutor-production.up.railway.app`. Copy it.
5. **Variables tab → New Variable** — add these two:
   | Name | Value |
   |------|-------|
   | `ANTHROPIC_API_KEY` | your key from step 1 |
   | `ALLOWED_ORIGIN` | your Pages origin from step 2, e.g. `https://janedoe.github.io` |
   Railway will redeploy automatically when you save variables.
6. Wait for the deploy to go green (you can watch logs in the Deployments tab — you should see `NDT tutor server listening on :PORT`)
7. Test it: open `https://YOUR-RAILWAY-URL/health` in a browser. You should see `{"ok":true}`.

## 4. Point the frontend at your Railway service

1. Open `tutor.html` in this repo
2. Find this line near the bottom:
   ```
   const WORKER_URL = "https://ndt-tutor.YOUR-SUBDOMAIN.workers.dev/chat";
   ```
3. Replace it with your Railway URL + `/chat`, e.g.:
   ```
   const WORKER_URL = "https://ndt-tutor-production.up.railway.app/chat";
   ```
4. Commit and push to GitHub. Pages will redeploy in ~1 minute.

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
- `ALLOWED_ORIGIN` Railway variable matches your Pages origin exactly (no trailing slash, no path)
- `WORKER_URL` in `tutor.html` ends with `/chat`
- `ANTHROPIC_API_KEY` Railway variable is set
- Railway service shows a green deploy and `/health` returns `{"ok":true}`
- Anthropic console shows positive credit balance

## Cost

With Haiku 4.5 + prompt caching, a typical 8-hour class of 20 students asking ~30 questions each (~1k output tokens per reply) costs well under **$1 in Anthropic charges**. Monitor in real time at https://console.anthropic.com → Usage.

Railway itself charges based on container resource use — for a small Node service handling a classroom, expect a few cents to ~$0.50 for the day. The trial credit covers this comfortably.

## Switching to a stronger model

Set a Railway variable `MODEL` to `claude-sonnet-4-6` (or any other Claude model) and Railway will redeploy. Sonnet costs roughly 5× Haiku but still cheap for a class.

## Local development (optional)

If you want to test the server locally before deploying:

```
cd server
npm install
export ANTHROPIC_API_KEY=sk-ant-...
export ALLOWED_ORIGIN=http://localhost:8000
npm start          # serves on :8080
```

Then in another terminal, from the repo root:

```
python3 -m http.server 8000
```

Open http://localhost:8000/tutor.html and edit `WORKER_URL` to `http://localhost:8080/chat` for the local test.

## Day-of class checklist

- [ ] Pages site is live
- [ ] Railway service is deployed, `/health` returns ok
- [ ] Anthropic credits > $5
- [ ] Tested smoke + cache + scope + rate-limit
- [ ] Shared the Pages URL with students
- [ ] Bookmarked the Anthropic usage dashboard to keep an eye on cost
