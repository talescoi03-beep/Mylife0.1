# My Life

A personal life-management app for your iPhone (and desktop). It helps you answer five questions:

1. What do I want from my life?
2. Why does it matter to me?
3. Who must I become to achieve it?
4. What should I do today?
5. What is working, and what needs changing?

It runs in Safari, installs to your Home Screen like an app, works offline, and keeps your data in your own free Supabase database.

> My Life is built around ideas from a Jim Rohn seminar transcript. It is an independent personal project, **not affiliated with Jim Rohn or his estate**. Ideas from the seminar are paraphrased and marked in the app with *“Idea from the Jim Rohn seminar, paraphrased”*. Everything else is ordinary modern planning.

---

## Contents

1. [What’s in the app](#1-whats-in-the-app)
2. [How the seminar maps to the app](#2-how-the-seminar-maps-to-the-app)
3. [How it’s built](#3-how-its-built)
4. [Free-tier limits you should know](#4-free-tier-limits-you-should-know)
5. [Deploy it: step by step](#5-deploy-it-step-by-step)
6. [Add it to your iPhone Home Screen](#6-add-it-to-your-iphone-home-screen)
7. [Reminders, offline use and backups](#7-reminders-offline-use-and-backups)
8. [Privacy and security](#8-privacy-and-security)
9. [What was tested](#9-what-was-tested)
10. [Known limitations](#10-known-limitations)
11. [Working on the code](#11-working-on-the-code)

---

## 1. What’s in the app

Five tabs at the bottom, plus a **+** button for quick capture (task, idea or journal entry).

| Tab | What you do there |
|---|---|
| **Today** | Today’s date and your personal reminder line · today’s intention · **top three priorities** · reminders (bills, people, birthdays) · scheduled items · habits due · tasks due · overdue items (you decide: today, tomorrow, pick a date, or let it go — deadlines never move on their own) · a goal and *why* it matters · shortcuts to morning, evening, weekly review and fresh start |
| **Plan** | **Goals** (life vision → goals → milestones/projects → tasks; horizons from 10 years to this week; categories *economic / things I want / personal development*, separate from life areas) · **Tasks** (Inbox, Today, Upcoming, Completed, Archived, search, area filter, subtasks, recurring tasks, tags, priority, estimate, notes) · **Habits** (daily, chosen weekdays, or *N times a week*; yes/no or measured; minimum version for hard days; pause/resume; rest days; editable history) · **Week** (week calendar, this week’s priorities, deadlines kept separate from time blocks, calendar export) |
| **Growth** | Books, courses, seminars and skills: progress, key ideas, notes, how you’ll apply it, learning sessions · **Turn this idea into action** (creates a linked task or habit) · searchable **idea notebook** |
| **Journal** | Free writing · morning and evening templates · weekly review · monthly review · optional **Life season** reflection · **Fresh start** workflow · search |
| **More** | Life areas · Progress charts · Wins · Money · Relationships · Settings · Backup and privacy · About |

**Goals** carry: title, life area, the result you want, why it matters and who benefits, target date or horizon, a measurable target, progress, who you need to become, milestones, next action, obstacles with practical responses, and a planned celebration. Progress is calculated in **one clearly labelled way** per goal — a number you update, milestones completed, or your own assessment. Finishing unrelated tasks never moves it. Completed goals are kept, and important changes are recorded in each goal’s history.

**Habits** use your time zone for every day boundary. Planned rest days and paused periods never break a streak or count as misses. The minimum version counts as showing up.

**Progress** charts are built only from what you recorded, with the date range and calculation written under each chart. There is no “life score”, and effort (activity) is shown separately from outcomes (goal progress).

**Money** is manual: income and expenses, savings goals, recurring bills, monthly totals per currency (USD, IQD or any others you add). Different currencies are never added together unless you enter your own conversion rate. **Relationships** has important dates, “reach out every N days” reminders, a log of time together, and linked plans. Nothing is ever sent to anyone.

## 2. How the seminar maps to the app

| From the seminar (paraphrased) | In the app |
|---|---|
| For things to change for you, you must change. Ask what you’re *becoming*, not just what you’re getting. | “Who must you become?” on every goal; the Growth tab |
| Written goals: long-range dreams and short-range confidence builders; economic goals, things, personal development | Vision + horizons + the three goal categories |
| Reasons come first, answers second | “Why it matters / who benefits” on every goal, rotated onto Today |
| Ask clearly: how much, by when | Measurable targets and target dates |
| Start with the small disciplines | Habits with a minimum version |
| Keep a journal; don’t use your head as a filing cabinet; study and read | Journal, idea notebook, learning items, “Turn this idea into action” |
| Each week and month, check you’re not spending major time on minor things | Weekly and monthly reviews comparing plans with what actually happened |
| Life is like the seasons: handle winter, use spring, protect summer’s crops, reap in autumn without complaint | Optional Life season reflection — you choose the season; the app never guesses it |
| It’s not what happens, it’s what you do about it; sometimes hail hits a good crop anyway | Evening review: what got in the way, what you’ll change — without blame |
| The law of use: what you don’t use, you lose | Reviews list goals with no activity |
| Celebrate what you achieve | Planned celebration on each goal, the Wins record |
| Disgust, decision, desire, resolve — then action | The Fresh start workflow, ending in one small task for today |

The in-app **More › About** page repeats this and lists which features are modern additions.

## 3. How it’s built

```
 iPhone / browser
 ┌──────────────────────────────────────────────┐
 │ My Life (React + TypeScript PWA)             │
 │  • IndexedDB: your data, per account,        │
 │    so it opens and works offline             │
 │  • Sync queue → uploads when online          │
 │  • Service worker: caches the app itself     │
 └───────────────┬───────────────────┬──────────┘
                 │ direct, with your  │ only for "Delete account"
                 │ sign-in token      │
        ┌────────▼────────┐   ┌──────▼────────────────────┐
        │ Supabase (free) │◄──│ Render web service (free) │
        │ Auth + Postgres │   │ backend/server.mjs        │
        │ + row-level     │   │ stateless; holds the      │
        │   security      │   │ secret key; stores nothing│
        └─────────────────┘   └───────────────────────────┘
        ▲
        │ static files
 ┌──────┴─────────────────┐
 │ Render static site     │
 │ frontend/dist          │
 └────────────────────────┘
```

- **Everyday actions never wait for the Render backend.** Tasks, habits and journal entries are saved on the device instantly and synced straight to Supabase. The backend is only used to delete your account.
- **Your data lives in Supabase**, never on Render’s disk and never in Render’s expiring free database.
- **Bundler: esbuild, not Vite.** The environment this was built in could not download packages from npm, so Vite and the Supabase JavaScript library could not be installed or tested. Rather than ship untested configuration, the app uses esbuild (the engine Vite itself uses) and a small built-in Supabase client that calls Supabase’s documented REST endpoints. You still get React + TypeScript, `npm run build`, and a Render static site. Switching to Vite later only means replacing `frontend/scripts/build.mjs` and `index.html` placeholders; no app code depends on the bundler.

## 4. Free-tier limits you should know

Checked against the providers’ official pages on **18 October 2026**. Providers change these; check the links before relying on them, and don’t assume the free tiers will exist forever.

**Render** ([render.com/docs/free](https://render.com/docs/free))
- A free web service (the backend) **spins down after 15 minutes without traffic** and takes **about a minute** to start again. The app tells you when it’s waking it.
- 750 free instance hours per workspace per month; sleeping services don’t use hours.
- Free web services have an **ephemeral filesystem** (wiped on every restart/redeploy) — which is why nothing is stored there.
- Free Render Postgres databases **expire 30 days after creation** — which is why it is not used.
- Static sites are free but count against your bandwidth and build-minute allowances; without a payment method on file, going over can suspend free services until next month.

**Supabase** ([supabase.com/pricing](https://supabase.com/pricing))
- 500 MB database per project, 50,000 monthly active users, 5 GB egress, 2 active free projects.
- **Free projects are paused after one week without activity.** If you don’t open the app for a week, sign in to the Supabase dashboard and restore the project. Your local copy keeps working meanwhile, and changes sync once it’s restored.
- **No automatic backups on the free plan** — use **More › Backup and privacy › Download full backup** regularly.

Personal journaling, tasks and habits use very little space; 500 MB is years of text for one person.

## 5. Deploy it: step by step

You need about 30–45 minutes. You’ll create three free accounts: GitHub (to hold the code), Supabase (database and sign-in) and Render (hosting).

### Step 1 — Put the code on GitHub
1. Create an account at [github.com](https://github.com) if you don’t have one.
2. Click **New repository**, name it `my-life`, choose **Private**, and create it.
3. Upload this project: on the new repository page click **uploading an existing file**, drag in the *contents* of this folder (`frontend`, `backend`, `supabase`, `tests`, `render.yaml`, `build-from-flat.mjs`, `README.md`, `.env.example`, `.gitignore`) and commit. (Or use `git push` if you know git.) Don’t upload any `node_modules` or `dist` folders.

**Uploading from an iPhone?** iPhone can’t upload folders: every file lands at the top level of the repository, and files that share a name get renamed (`package (1).json`, `package (2).json`). That’s fine — skip the Blueprint in Step 3 and use **“Flat upload”** settings instead (below). `build-from-flat.mjs` puts the files back into their folders while Render builds the app.

### Step 2 — Create the Supabase project
1. Create an account at [supabase.com](https://supabase.com) and click **New project**.
2. Pick a name (e.g. `my-life`), set a strong database password (save it in your password manager), and choose the region closest to you. Wait until the project is ready.
3. Open **SQL Editor** → **New query**. Open `supabase/migrations/0001_my_life_schema.sql` from this project, copy everything, paste it in, and click **Run**. It should finish with “Success. No rows returned”. (Running it again later is safe.)
4. Check the security rules are on: open **Table Editor** — every My Life table should show RLS as enabled. You can also open **Advisors → Security Advisor**; it should not report “RLS disabled” for these tables.
5. Open **Settings → API Keys** ([docs](https://supabase.com/docs/guides/api/api-keys)). Note down:
   - your **Project URL** (`https://<something>.supabase.co`, also shown in the **Connect** dialog),
   - the **Publishable key** (starts with `sb_publishable_`),
   - the **Secret key** (starts with `sb_secret_`). If no publishable/secret keys exist yet, create them there.
   Treat the secret key like a password: it bypasses every security rule. It must only ever go into the backend’s settings on Render.

   *(Older projects also show legacy `anon` and `service_role` keys. They work too — use `anon` where this guide says publishable and `service_role` where it says secret — but Supabase plans to retire them, so prefer the new keys.)*

### Step 3 — Deploy on Render
1. Create an account at [render.com](https://render.com) and connect your GitHub account when asked.
2. Click **New → Blueprint**, choose your `my-life` repository. Render reads `render.yaml` and shows two services: **my-life** (static site) and **my-life-api** (web service, free plan).
3. Render asks for the environment values. For now fill in:
   - **my-life**: `PUBLIC_SUPABASE_URL` = your Project URL; `PUBLIC_SUPABASE_KEY` = your **publishable** key; `PUBLIC_API_URL` = leave a placeholder like `https://my-life-api.onrender.com` (you’ll correct it in a moment).
   - **my-life-api**: `SUPABASE_URL` = Project URL; `SUPABASE_PUBLISHABLE_KEY` = publishable key; `SUPABASE_SECRET_KEY` = **secret** key; `ALLOWED_ORIGINS` = placeholder `https://my-life.onrender.com`.
4. Click **Apply**. Wait for both deploys to finish (the first build takes a few minutes).
5. Now copy the real addresses from the Render dashboard (shown at the top of each service), e.g. `https://my-life-abcd.onrender.com` and `https://my-life-api-wxyz.onrender.com`. Then:
   - In **my-life-api → Environment**, set `ALLOWED_ORIGINS` to the static site address exactly (no trailing slash). Save — it redeploys.
   - In **my-life → Environment**, set `PUBLIC_API_URL` to the API address. Save, then click **Manual Deploy → Deploy latest commit** (the static site needs a rebuild to pick up changes).
6. Test the API: open `https://<your-api>.onrender.com/health` in a browser. After up to a minute you should see `{"ok":true,…}`.

> The build refuses to run if `PUBLIC_SUPABASE_KEY` looks like a secret/service_role key — a safety net against leaking it.

**Flat upload (files uploaded from an iPhone, no folders):** create the two services by hand.
- **Static Site** → repository `my-life`, root directory empty, build command `node build-from-flat.mjs`, publish directory `dist`, the three `PUBLIC_…` environment variables above, and under **Redirects/Rewrites** a rule: source `/*`, destination `/index.html`, action **Rewrite**.
- **Web Service** → same repository, root directory empty, runtime **Node** (not Docker), build command `npm install`, start command `node server.mjs`, instance type **Free**, health check path `/health`, and the four backend environment variables above.

If you uploaded with folders but would rather not use the Blueprint, create the two services by hand with the same settings: **Static Site** (root directory `frontend`, build command `npm install && npm run build`, publish directory `dist`, plus a **Redirects/Rewrites** rule: source `/*`, destination `/index.html`, action **Rewrite**) and **Web Service** (root directory `backend`, build `npm install`, start `npm start`, instance type **Free**, health check path `/health`).

### Step 4 — Tell Supabase where the app lives
In Supabase open **Authentication → URL Configuration**:
- **Site URL**: your static site address, e.g. `https://my-life-abcd.onrender.com`
- **Redirect URLs**: add `https://my-life-abcd.onrender.com/**`

This makes confirmation and password-reset emails link back to your app.

### Step 5 — Create your account
Open your static site address in Safari, tap **Create an account**, and confirm your email if Supabase asks you to (by default it does; the link opens the app and signs you in). The setup steps then let you choose life areas, your time zone and currencies, a first goal, and optional example content.

**Only you should have an account.** Anyone who finds the address could sign up, but security rules keep every account’s data separate. To stop new sign-ups after you’ve created yours: Supabase → **Authentication → Sign In / Providers → Email** (or **Authentication settings**, depending on the dashboard version) → turn off **Allow new users to sign up**.

## 6. Add it to your iPhone Home Screen

1. Open your app address in **Safari** (not Chrome) and sign in.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open **My Life** from the new icon. It runs full-screen, without Safari’s bars.
4. Sign in once more inside the Home Screen app — iPhone keeps Home Screen apps’ storage separate from Safari.

Tip: an email confirmation or reset link opens in Safari, not in the Home Screen app. After using it, go back to the Home Screen app and sign in normally.

## 7. Reminders, offline use and backups

**Offline.** After the app has loaded once, it opens without a connection. You can view everything and add or change tasks, habit check-ins, journal entries and the rest. The badge at the top of Today shows **Saved on this device**, **Syncing…** or **Synced**; tap it for details and **Sync now**.

**When does it sync?** iPhone doesn’t let web apps run in the background, so syncing happens when you open the app, when you return to it, when the connection comes back, shortly after each change, and every 90 seconds while it’s open. If you edit the same journal entry or idea on two devices before they sync, **both versions are kept** (marked “edited on two devices”) — nothing is silently overwritten. Other records use the most recent change.

**Signing out** deletes this device’s copy of your data. If changes haven’t synced yet, the app warns you first.

**Reminders.** In-app reminders (bills due within 3 days, people you planned to contact, birthdays within a week) appear on Today whenever you open the app. The app does **not** send push notifications: doing that reliably needs an always-on server, and the free Render service sleeps. For alerts that fire while the app is closed, use **Plan › Week › Export to Calendar**: it creates a calendar file with alerts for timed tasks, time blocks, bills and important dates. Open it on your iPhone and tap **Add All**. Exporting again adds copies, so remove the old ones first.

**Backups.** Free Supabase has no automatic backups. Use **More › Backup and privacy**:
- **Download full backup (JSON)** — everything; restore it with **Restore from a backup…** (“Add and update” keeps your current data; “Replace” deletes anything not in the backup).
- **CSV** exports for tasks, habits, journal, goals, learning, money and wins, to open in a spreadsheet.

## 8. Privacy and security

- Every table has **row-level security** enabled and forced, with policies that allow a signed-in user to read and write only rows where `user_id` is their own id. Anonymous requests get no access at all. This was tested (see below).
- The browser only ever receives the **publishable** key. The **secret** key lives only in the backend’s Render environment.
- Ownership of a row can’t be changed after creation, and timestamps are set by the database, not the phone.
- Your offline copy is stored per account on the device and deleted on sign-out.
- **Delete all data** (keeps your login) and **Delete account** (removes the login and every row through database cascades) are in **More › Backup and privacy**, both behind a typed confirmation.
- No AI service, analytics or third-party tracking is used.

## 9. What was tested

These checks were actually run while building the app (18 October 2026):

**Database security** — `tests/rls.test.mjs`, against a real PostgreSQL 16 with the real migration (233 checks across all 23 tables):
RLS enabled and forced on every table; owner can read own rows; another user sees none, can’t read by id, can’t update or delete, can’t insert rows claiming to be the owner, can’t take a row over through an upsert; ownership can’t be transferred; anonymous access denied; timestamps come from the server; duplicate habit check-ins for one day are rejected; deleting an account removes that user’s rows in every table; the migration can be run twice.

**Logic and sync** — `frontend/tests/*.test.ts` (18 tests): day boundaries around midnight in Asia/Riyadh vs other zones and across daylight-saving changes; streaks with rest days, pauses, weekday and weekly-target habits; consistency maths; measured habits and minimum versions; recurring-task dates; goal progress methods; app columns match the database exactly; offline changes survive an app restart and sync later; a retried upload whose response was lost isn’t applied twice; two devices checking the same habit produce one record; conflicting journal edits keep both versions; identical edits don’t; edits during an upload aren’t lost; deletions sync; database outage keeps data local; a refused change is kept and reported.

**End to end in a real browser** — `tests/e2e/app.e2e.mjs` (15 scenarios, Chromium with an iPhone 13 profile, the built app, the real backend, and a local stand-in for Supabase running the real migration on PostgreSQL):
sign-up and settings sync · goal → milestone → task, complete and reopen each, progress unaffected by tasks, wins and history recorded · habit check/uncheck/check stores exactly one record on the correct Riyadh day · recurring task creates one next copy, undo removes it, no duplicates · JSON and CSV export, delete a goal, restore it · offline: add a task and journal entry, reopen the app offline, sync after reconnecting · conflicting journal edits from two devices keep both versions · no horizontal scrolling on 22 screens at 320 px and 390 px · data intact after backend restart and an app redeploy · database unavailable: keep working, sync when it returns · user B can’t see, change or take over user A’s data, and has no local copy of it · account deletion waits for a sleeping backend, then removes the login, all rows and the local copy · Today rolls over at midnight in the user’s time zone and the next check-in lands on the new day · sign-out deletes the local copy · no JavaScript errors.

Screens were also reviewed visually in light and dark mode at iPhone sizes.

## 10. Known limitations

- **Not tested against a live Supabase or Render account.** The auth and data calls follow Supabase’s documented REST API and were tested against a faithful local stand-in, but your first real deployment is the first time they meet the real services. If sign-in or sync fails, check the keys, the URL configuration (Step 4) and that the migration ran.
- **Not tested on a physical iPhone.** Layouts were checked in Chromium with iPhone dimensions; Safari-specific behaviour (Home Screen mode, safe areas, date pickers, the share sheet for exports) should be checked on your phone.
- **React type checking couldn’t run** in the build environment (type packages weren’t downloadable). The data, sync and logic code is type-checked; screens were verified by the browser tests instead. Running `npm run typecheck` after `npm install` on your machine will check everything.
- **No push notifications** (see section 7). Reminders show in the app; use calendar export for alerts.
- **iPhone storage:** Safari may clear website storage for sites you haven’t used in a while. Synced data is safe in Supabase; only unsynced changes are at risk, so let the badge reach “Synced”.
- **Free tiers can change or end**, Supabase pauses idle projects, and the backend sleeps (section 4).
- **Recurring task copies** don’t copy subtasks.
- **Account deletion** needs the backend; if it’s not deployed, use “Delete all data” and delete the login from the Supabase dashboard.

## 11. Working on the code

```
frontend/              React + TypeScript app
  src/app/             shell, routing, context, shared actions, sync badge
  src/screens/         Today, Plan, Goal, Habit, Growth, Journal, Reviews, More, Money/People, Settings, Onboarding
  src/data/            schema types, IndexedDB storage, in-memory store, sync engine, backup/CSV
  src/logic/           habits & streaks, recurrence, goals, stats, reminders, calendar export, journal templates
  src/lib/             dates/time zones, Supabase client, router, ids, backend calls
  src/sw.js            service worker (offline app shell)
  scripts/build.mjs    esbuild build + dev server
  tests/               unit and sync tests
backend/server.mjs     stateless helper API (account deletion, health)
build-from-flat.mjs    builds the app when the files were uploaded without folders
supabase/migrations/   database schema + row-level security
tests/rls.test.mjs     database security test (needs local PostgreSQL)
tests/e2e/             end-to-end tests (PostgreSQL + Playwright)
render.yaml            Render Blueprint
.env.example           environment variable template
```

Local development:

```bash
cd frontend
npm install
cp ../.env.example ../.env     # fill in your Supabase URL and publishable key
npm run dev                    # http://localhost:5173
npm test                       # unit + sync tests
npm run typecheck              # full TypeScript check
```

The repository has no top-level `package.json`, on purpose: an iPhone upload would mix it up with the app’s and backend’s files of the same name.

Database and end-to-end tests need PostgreSQL 16 on port 54329 (socket in `/tmp`) and Playwright with Chromium:

```bash
PGHOST=/tmp PGPORT=54329 node tests/rls.test.mjs
npm i -D playwright@1.56 && npx playwright install chromium
node tests/e2e/app.e2e.mjs
```

Database changes: add a new file in `supabase/migrations/` (don’t edit one that’s already been run), give every new private table a `user_id` column and the same four policies, and add its columns to `frontend/src/data/schema.ts` — the unit tests fail if the two drift apart.
