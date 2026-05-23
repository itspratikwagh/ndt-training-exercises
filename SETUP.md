# NDT Tutor — Setup Guide (Railway + Postgres)

This guide walks you through deploying the shared classroom Q&A tutor. Total time: ~25 minutes.

## What you're deploying

- **Frontend** (`index.html`, `tutor.html`, exercise files) → free hosting on GitHub Pages
- **Backend** (`server/server.js`) → Railway, holds your API key as an env var
- **Database** → Railway Postgres, stores every question and answer so the whole class can see them

Every student gets the same URL. When one asks a question, the answer streams live to everybody — building a shared knowledge feed for the day.

---

## 1. Get an Anthropic API key

1. Sign up at https://console.anthropic.com
2. Settings → API Keys → Create Key
3. Add at least $5 of credits (more than covers a full 8-hour class with prompt caching)
4. Copy the key — you'll paste it into Railway in step 3

## 2. Push this repo to GitHub & enable Pages

1. Push this repo to GitHub
2. Repo Settings → Pages → Source: **Deploy from a branch**, Branch: **main**, Folder: **/ (root)**
3. Save. Wait ~1 minute. Your Pages URL: `https://YOUR-GITHUB-USERNAME.github.io/ndt-training-exercises/`
4. The **origin** you'll need is `https://YOUR-GITHUB-USERNAME.github.io` (no path, no trailing slash)

## 3. Deploy the backend to Railway

1. Sign up free at https://railway.app
2. **New Project → Deploy from GitHub repo** → select this repo and authorize Railway if prompted
3. Once the service is created, open it and go to **Settings → Source** and set:
   - **Root Directory:** `server`
   This tells Railway to build only the `server/` subfolder (it'll auto-detect `package.json` and run `npm install` + `npm start`)
4. **Settings → Networking → Generate Domain** — copy the URL Railway gives you (looks like `https://ndt-tutor-production.up.railway.app`)

## 4. Add a Postgres database

1. In the same Railway project, click **+ Create → Database → Add PostgreSQL**
2. Wait ~20 seconds for it to provision
3. Click into the database → **Variables** tab → copy the `DATABASE_URL` value
4. Back on your **Worker/Service** (not the database) → **Variables tab → New Variable Reference**
   - Or just add a variable named `DATABASE_URL` and paste the value
   - Easier option: click "Add Reference" and point it at the Postgres service's `DATABASE_URL` — Railway wires them up

## 5. Set the other environment variables

On the **service** (not the database) → Variables tab → add:

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | your key from step 1 |
| `ALLOWED_ORIGIN` | your Pages origin from step 2, e.g. `https://janedoe.github.io` |
| `DATABASE_URL` | reference to Postgres (from step 4) |

Railway will redeploy automatically when variables change. Watch the Deployments tab for `Schema initialized.` and `NDT tutor server listening on :PORT` in the logs.

Test it: open `https://YOUR-RAILWAY-URL/health` in a browser. You should see `{"ok":true}`.

## 6. Point the frontend at your Railway service

1. Open `tutor.html` in this repo
2. Near the bottom, find:
   ```
   const API_URL = "https://YOUR-RAILWAY-URL.up.railway.app";
   ```
3. Replace it with your Railway URL (no trailing slash, no path):
   ```
   const API_URL = "https://ndt-tutor-production.up.railway.app";
   ```
4. Commit and push. Pages will redeploy in ~1 minute.

## 7. Verify before class

Open `https://YOUR-GITHUB-USERNAME.github.io/ndt-training-exercises/tutor.html` and run through these (open a second browser window for the multi-student checks):

| # | Test | Expected result |
|---|------|-----------------|
| 1 | First load prompts for your name | Type it once, stored in browser |
| 2 | Top-right shows "live" with a green dot | SSE connection succeeded |
| 3 | Click "+ Ask a new question", ask: "What is the HVL of lead for Ir-192?" | Question appears in the feed; "Tutor is thinking…" then the reply (~4.8 mm with explanation) |
| 4 | In a second browser window, the new question appears **automatically** | SSE live broadcast works |
| 5 | From window 2, click that question and add a follow-up | Both windows update; the tutor's reply uses the prior context |
| 6 | Toggle "Post anonymously" before sending | The post shows "anonymous" in the feed |
| 7 | Ask: "write me a python web scraper" | Tutor politely redirects to NDT |
| 8 | Rapid-fire 15 sends from one window | Around the 13th: "you're sending too quickly" (rate limit) |
| 9 | Reload — feed and threads are still there | Postgres persisted them |

If anything fails, check:
- `ALLOWED_ORIGIN` matches your Pages origin exactly (no trailing slash)
- `API_URL` in `tutor.html` has no `/chat` or other suffix (just the host URL)
- `ANTHROPIC_API_KEY` and `DATABASE_URL` are both set on the service
- Railway logs show `Schema initialized.`
- Anthropic console shows positive credit balance

## Cost

With Haiku 4.5 + prompt caching, a typical 8-hour class of 20 students asking ~30 questions each costs well under **$1 in Anthropic charges**. Railway compute + Postgres for a classroom: a few cents to ~$1 for the day. Railway's trial credit covers it.

## Switching to a stronger model

Set a Railway variable `MODEL` to `claude-sonnet-4-6` (or another Claude model) — Railway redeploys automatically. Sonnet costs ~5× Haiku but still cheap for a class.

## Resetting the feed between classes

The Q&A feed accumulates over time. To clear it before a new class:

1. Open your Postgres service in Railway → **Data** tab
2. Run: `DELETE FROM messages; DELETE FROM threads;`
3. (Or just leave history — it's a nice resource for the next cohort.)

## Local development (optional)

```
cd server
npm install
export ANTHROPIC_API_KEY=sk-ant-...
export ALLOWED_ORIGIN=http://localhost:8000
export DATABASE_URL=postgres://...        # use Railway's URL, or run local Postgres
npm start                                  # serves on :8080
```

In another terminal, from the repo root:

```
python3 -m http.server 8000
```

Open http://localhost:8000/tutor.html and edit `API_URL` to `http://localhost:8080` for the local test.

## Day-of class checklist

- [ ] Pages site is live
- [ ] Railway service is deployed, `/health` returns ok
- [ ] Anthropic credits > $5
- [ ] Tested live updates between two browser windows
- [ ] Tested follow-ups and anonymous posting
- [ ] Shared the Pages URL with students
- [ ] Bookmarked the Anthropic usage dashboard
