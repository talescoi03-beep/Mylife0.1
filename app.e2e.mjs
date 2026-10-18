// End-to-end tests: real browser (Chromium, iPhone 13 profile), built app,
// real backend, local Supabase stand-in over real PostgreSQL with the real
// migration and RLS policies.
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/e2e/app.e2e.mjs
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_URL, SUPA_URL, buildApp, startBackend, startStack } from './env.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();

const results = [];
let stack;
let browser;

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    await globalThis.__page?.screenshot({ path: path.join(SHOTS, `fail-${results.length}.png`) }).catch(() => {});
    console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
async function waitFor(fn, msg, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out: ${msg} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}
const q = (sql) => stack.db.query(sql);
const one = async (sql) => (await q(sql))[0]?.[0];

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], timezoneId: 'Asia/Riyadh', acceptDownloads: true, ...opts });
  // Desktop-style downloads in tests (a real iPhone shows its share sheet instead).
  await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true }); });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) page.errors.push(m.text()); });
  return { ctx, page };
}
async function go(page, to) {
  await page.evaluate((to) => { history.pushState({ d: 1 }, '', to); dispatchEvent(new PopStateEvent('popstate')); }, to);
  await page.waitForTimeout(150);
}
async function signUp(page, email) {
  await page.goto(APP_URL);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByText('Top three').waitFor();
}
async function signIn(page, email) {
  await page.goto(APP_URL);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Top three').waitFor({ timeout: 15000 });
}
const userId = (email) => one(`select id from auth.users where email = '${email}'`);

async function main() {
  console.log('Starting stack (PostgreSQL + fake Supabase + backend + static site)…');
  stack = await startStack();
  browser = await chromium.launch();
  const { ctx: ctxA, page: A } = await newPage();
  globalThis.__page = A;
  let uidA;

  await step('Sign up, skip onboarding, settings saved to the account', async () => {
    await signUp(A, 'a@example.com');
    uidA = await userId('a@example.com');
    await waitFor(async () => (await one(`select onboarding->>'skipped' from settings where user_id='${uidA}'`)) === 'true', 'settings row synced');
    assert(await A.getByText('Setup isn’t finished').isVisible(), 'resume-setup banner shown');
  });

  await step('Goal → milestone → task: complete and reopen; progress only from milestones', async () => {
    await go(A, '/plan/goal/new');
    await A.getByLabel('What do you want?').fill('Run a 10 km race');
    await A.getByLabel('Why does it matter to you?').fill('Feel strong for my family');
    await A.getByRole('button', { name: 'Save goal' }).click();
    await A.getByText('Milestones: add milestones to measure progress').waitFor();
    await A.getByPlaceholder('Add a milestone').fill('Run 5 km without stopping');
    await A.getByPlaceholder('Add a milestone').press('Enter');
    await A.getByRole('button', { name: 'Add', exact: true }).first().click();
    await A.getByLabel('What needs doing').fill('Buy running shoes');
    await A.getByRole('button', { name: 'Add task', exact: true }).click();
    await A.getByRole('checkbox', { name: 'Complete Buy running shoes' }).click();
    await A.getByText('Milestones: 0 of 1 complete').waitFor();
    assert(await A.getByText('0%').first().isVisible(), 'progress stays 0% after completing a task');
    await A.getByRole('checkbox', { name: 'Complete Run 5 km without stopping' }).click();
    await A.getByText('Milestones: 1 of 1 complete').waitFor();
    const gid = await waitFor(() => one(`select id from goals where title='Run a 10 km race'`), 'goal synced');
    await waitFor(async () => Number(await one(`select count(*) from wins where goal_id='${gid}' and deleted_at is null and kind='milestone'`)) === 1, 'milestone win recorded');
    await A.getByRole('checkbox', { name: 'Complete Run 5 km without stopping' }).click(); // reopen
    await A.getByText('Milestones: 0 of 1 complete').waitFor();
    await waitFor(async () => Number(await one(`select count(*) from wins where goal_id='${gid}' and deleted_at is null and kind='milestone'`)) === 0, 'milestone win removed on reopen');
    // Reopen the completed task.
    await A.getByRole('button', { name: /Show 1 completed/ }).click();
    await A.getByRole('checkbox', { name: 'Complete Buy running shoes' }).click();
    await waitFor(async () => (await one(`select status from tasks where title='Buy running shoes'`)) === 'open', 'task reopened in DB');
    await A.getByRole('button', { name: 'Mark goal complete' }).click();
    await waitFor(async () => (await one(`select status from goals where id='${gid}'`)) === 'completed', 'goal completed in DB');
    await waitFor(async () => Number(await one(`select count(*) from wins where goal_id='${gid}' and kind='goal' and deleted_at is null`)) === 1, 'goal win');
    await A.getByRole('button', { name: 'Reopen goal' }).click();
    await waitFor(async () => (await one(`select status from goals where id='${gid}'`)) === 'active', 'goal reopened');
    const events = Number(await waitFor(async () => { const n = Number(await one(`select count(*) from goal_events where goal_id='${gid}'`)); return n >= 6 ? n : 0; }, 'history events'));
    assert(events >= 6, 'history recorded');
  });

  await step('Recurring habit: check, uncheck, check again → exactly one record for the day', async () => {
    await go(A, '/plan?tab=habits');
    await A.getByRole('button', { name: 'Habit', exact: true }).click();
    await A.getByLabel('Habit', { exact: true }).fill('Read');
    await A.getByRole('button', { name: 'Add habit' }).click();
    await go(A, '/');
    const box = A.getByRole('checkbox', { name: /^Read (done|not done)$/ });
    await box.click();
    await A.waitForTimeout(400);
    await box.click();
    await A.waitForTimeout(400);
    await box.click();
    await waitFor(async () => {
      const r = await q(`select count(*), count(*) filter (where l.deleted_at is null), max(l.status) from habit_logs l join habits h on h.id=l.habit_id where h.title='Read'`);
      return r[0][0] === '1' && r[0][1] === '1' && r[0][2] === 'done';
    }, 'one live done record');
    const day = await one(`select l.day::text from habit_logs l join habits h on h.id=l.habit_id where h.title='Read'`);
    const riyadh = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
    assert(day === riyadh, `check-in stored on the Riyadh calendar day (${day} vs ${riyadh})`);
  });

  await step('Recurring task: completing creates one next copy; undo removes it; no duplicates', async () => {
    await go(A, '/plan?tab=tasks');
    await A.getByRole('button', { name: 'Task', exact: true }).click();
    await A.getByLabel('What needs doing').fill('Water the plants');
    await A.getByRole('dialog').getByRole('button', { name: 'Today', exact: true }).click();
    await A.getByLabel('Repeat').selectOption('daily');
    await A.getByRole('button', { name: 'Add task', exact: true }).click();
    await go(A, '/');
    await A.getByRole('checkbox', { name: 'Complete Water the plants' }).first().click();
    await waitFor(async () => Number(await one(`select count(*) from tasks where title='Water the plants' and deleted_at is null`)) === 2, 'next copy created');
    await A.getByRole('button', { name: 'Undo' }).click();
    await waitFor(async () => Number(await one(`select count(*) from tasks where title='Water the plants' and deleted_at is null`)) === 1, 'undo removed next copy');
    await A.getByRole('checkbox', { name: 'Complete Water the plants' }).first().click();
    await waitFor(async () => {
      const r = await q(`select count(*) filter (where status='open' and deleted_at is null), count(*) filter (where status='done') from tasks where title='Water the plants'`);
      return r[0][0] === '1' && r[0][1] === '1';
    }, 'exactly one open next copy and one done');
    const due = await one(`select due_date::text from tasks where title='Water the plants' and status='open'`);
    const tomorrow = new Date(Date.now() + 86400000);
    assert(due === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(tomorrow), `next copy due tomorrow (${due})`);
  });

  let backupFile;
  await step('Export JSON backup, delete a goal, restore it', async () => {
    await go(A, '/more/data');
    const [dl] = await Promise.all([A.waitForEvent('download'), A.getByRole('button', { name: 'Download full backup (JSON)' }).click()]);
    backupFile = path.join(SHOTS, 'backup-test.json');
    await dl.saveAs(backupFile);
    const data = JSON.parse(readFileSync(backupFile, 'utf8'));
    assert(data.format === 'my-life-backup' && data.tables.goals.some((g) => g.title === 'Run a 10 km race'), 'backup contains the goal');
    assert(data.tables.habit_logs.length === 1, 'backup contains habit log');
    const [csv] = await Promise.all([A.waitForEvent('download'), A.getByRole('button', { name: 'Tasks', exact: true }).click()]);
    const csvPath = path.join(SHOTS, 'tasks-test.csv');
    await csv.saveAs(csvPath);
    assert(readFileSync(csvPath, 'utf8').includes('Water the plants'), 'CSV export has tasks');

    await go(A, '/plan?tab=goals');
    await A.getByText('Run a 10 km race').click();
    await A.getByRole('button', { name: 'Delete', exact: true }).click();
    await A.getByRole('button', { name: 'Delete goal' }).click();
    await waitFor(async () => (await one(`select deleted_at is not null from goals where title='Run a 10 km race'`)) === 't', 'goal deleted in DB');
    await go(A, '/more/data');
    await A.locator('input[type=file]').setInputFiles(backupFile);
    await A.getByRole('button', { name: 'Add and update' }).click();
    await waitFor(async () => (await one(`select deleted_at is null from goals where title='Run a 10 km race'`)) === 't', 'goal restored in DB');
    await waitFor(async () => Number(await one(`select count(*) from milestones m join goals g on g.id=m.goal_id where g.title='Run a 10 km race' and m.deleted_at is null`)) === 1, 'milestone restored');
  });

  await step('Offline: capture task + journal, reopen app offline, sync after reconnecting', async () => {
    await A.goto(APP_URL + '/'); // ensure the service worker controls the page
    await A.getByText('Top three').waitFor();
    await waitFor(() => A.evaluate(() => !!navigator.serviceWorker.controller), 'service worker active');
    await ctxA.setOffline(true);
    await A.getByRole('button', { name: /Quick add/ }).click();
    await A.getByLabel('Task', { exact: true }).fill('Written while offline');
    await A.getByRole('button', { name: 'Add task', exact: true }).click();
    await A.getByRole('button', { name: /Quick add/ }).click();
    await A.getByRole('button', { name: 'Journal', exact: true }).first().click();
    await A.getByLabel('Journal entry', { exact: true }).fill('Offline journal entry');
    await A.getByRole('button', { name: 'Save entry' }).click();
    await A.getByRole('button', { name: /Sync status: (Saved on this device|Offline)/ }).waitFor({ timeout: 10000 });
    await A.reload(); // app shell from the service worker, data from IndexedDB
    await A.getByText('Written while offline').waitFor({ timeout: 10000 });
    assert(Number(await one(`select count(*) from tasks where title='Written while offline'`)) === 0, 'not on server while offline');
    await ctxA.setOffline(false);
    await A.evaluate(() => dispatchEvent(new Event('online')));
    await waitFor(async () => Number(await one(`select count(*) from tasks where title='Written while offline'`)) === 1, 'task synced after reconnect');
    await waitFor(async () => Number(await one(`select count(*) from journal_entries where body='Offline journal entry'`)) === 1, 'journal synced');
    await A.getByRole('button', { name: 'Sync status: Synced. Details' }).waitFor({ timeout: 10000 });
  });

  await step('Conflicting journal edits on two devices: both versions kept', async () => {
    const { ctx: ctx2, page: A2 } = await newPage();
    await signIn(A2, 'a@example.com');
    const id = await one(`select id from journal_entries where body='Offline journal entry'`);
    await go(A2, `/journal/${id}`);
    await ctx2.setOffline(true);
    await A2.getByLabel('Entry', { exact: true }).fill('Edited on the phone');
    await A2.waitForTimeout(1200);
    await go(A, `/journal/${id}`);
    await A.getByLabel('Entry', { exact: true }).fill('Edited on the laptop');
    await A.getByRole('button', { name: 'Done' }).click();
    await waitFor(async () => (await one(`select body from journal_entries where id='${id}'`)) === 'Edited on the laptop', 'laptop edit synced');
    await ctx2.setOffline(false);
    await A2.evaluate(() => dispatchEvent(new Event('online')));
    await waitFor(async () => {
      const r = await q(`select body, conflict_of from journal_entries where deleted_at is null and (id='${id}' or conflict_of='${id}') order by conflict_of nulls first`);
      return r.length === 2 && r[0][0] === 'Edited on the laptop' && r[1][0] === 'Edited on the phone';
    }, 'both versions stored');
    await ctx2.close();
  });

  await step('Narrow iPhone layouts (320 px and 390 px): no horizontal scrolling', async () => {
    const routes = ['/', '/plan?tab=goals', '/plan?tab=tasks', '/plan?tab=habits', '/plan?tab=week', '/growth', '/growth?tab=ideas', '/journal', '/journal/new?kind=morning', '/review/weekly', '/review/monthly', '/review/season', '/fresh-start', '/more', '/more/areas', '/more/progress', '/more/wins', '/more/money', '/more/people', '/more/settings', '/more/data', '/more/about'];
    const bad = [];
    for (const w of [320, 390]) {
      await A.setViewportSize({ width: w, height: 700 });
      for (const r of routes) {
        await go(A, r);
        await A.waitForTimeout(120);
        const over = await A.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 0) bad.push(`${w}px ${r} (+${over}px)`);
      }
      await go(A, '/');
      await A.screenshot({ path: path.join(SHOTS, `today-${w}.png`) });
    }
    await A.setViewportSize({ width: 390, height: 844 });
    assert(!bad.length, `overflow: ${bad.join(', ')}`);
  });

  await step('Data survives backend restart and a redeploy of the app', async () => {
    stack.api.kill();
    await new Promise((r) => setTimeout(r, 300));
    stack.api = await startBackend();
    buildApp(); // new build = redeploy
    await A.reload();
    await A.getByText('Top three').waitFor();
    await go(A, '/plan?tab=goals');
    await A.getByText('Run a 10 km race').waitFor();
    assert(Number(await one(`select count(*) from tasks where user_id='${uidA}' and deleted_at is null`)) >= 4, 'tasks still in database');
  });

  await step('Database unavailable: app keeps working locally, syncs when it returns', async () => {
    await fetch(`${SUPA_URL}/__control/down`);
    await A.reload();
    await go(A, '/');
    await A.getByText('Top three').waitFor();
    await A.getByRole('button', { name: /Quick add/ }).click();
    await A.getByLabel('Task', { exact: true }).fill('Added while database was down');
    await A.getByRole('button', { name: 'Add task', exact: true }).click();
    await A.getByRole('button', { name: /Sync status: (Saved on this device|Offline)/ }).click();
    await A.getByText(/not responding|Offline/).first().waitFor();
    await fetch(`${SUPA_URL}/__control/up`);
    await A.getByRole('button', { name: 'Sync now' }).click();
    await waitFor(async () => Number(await one(`select count(*) from tasks where title='Added while database was down'`)) === 1, 'synced after DB returned');
    await A.keyboard.press('Escape');
  });

  const { ctx: ctxB, page: B } = await newPage();
  await step('User B cannot see or change user A’s data', async () => {
    await signUp(B, 'b@example.com');
    await go(B, '/plan?tab=tasks');
    await B.getByRole('searchbox', { name: 'Search tasks' }).fill('Water');
    await B.getByText('No tasks match').waitFor();
    const taskA = await one(`select id from tasks where user_id='${uidA}' limit 1`);
    const r = await B.evaluate(async ({ url, taskA }) => {
      const s = JSON.parse(localStorage.getItem('mylife.session'));
      const h = { apikey: 'sb_publishable_test', Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
      const all = await (await fetch(`${url}/rest/v1/tasks?select=*`, { headers: h })).json();
      const byId = await (await fetch(`${url}/rest/v1/tasks?select=*&id=eq.${taskA}`, { headers: h })).json();
      const patch = await (await fetch(`${url}/rest/v1/tasks?id=eq.${taskA}`, { method: 'PATCH', headers: h, body: JSON.stringify({ title: 'hacked' }) })).json();
      const up = await fetch(`${url}/rest/v1/tasks?on_conflict=id`, { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ id: taskA, user_id: s.user.id, title: 'hacked' }) });
      const journal = await (await fetch(`${url}/rest/v1/journal_entries?select=*`, { headers: h })).json();
      return { mine: all.every((t) => t.user_id === s.user.id), byId: byId.length, patch: patch.length, upStatus: up.status, journal: journal.length };
    }, { url: SUPA_URL, taskA });
    assert(r.mine && r.byId === 0 && r.patch === 0 && r.upStatus === 403 && r.journal === 0, `isolation: ${JSON.stringify(r)}`);
    assert((await one(`select title from tasks where id='${taskA}'`)) !== 'hacked', 'A’s task unchanged');
    const dbs = await B.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    assert(!dbs.some((n) => n.includes(uidA)), 'B’s browser has no copy of A’s data');
  });

  await step('Account deletion waits for a sleeping backend (cold start), then deletes everything', async () => {
    const uidB = await userId('b@example.com');
    await B.getByRole('button', { name: /Quick add/ }).click();
    await B.getByLabel('Task', { exact: true }).fill('B task');
    await B.getByRole('button', { name: 'Add task', exact: true }).click();
    await waitFor(async () => Number(await one(`select count(*) from tasks where user_id='${uidB}'`)) === 1, 'B task synced');
    stack.api.kill(); // simulate a sleeping Render service
    await go(B, '/more/data');
    await B.getByRole('button', { name: 'Delete account' }).click();
    await B.getByLabel('Type “delete” to confirm').fill('delete');
    await B.getByRole('alertdialog').getByRole('button', { name: 'Delete account' }).click();
    await B.getByText(/Waking the server/).waitFor({ timeout: 15000 });
    stack.api = await startBackend(); // wakes up
    await B.getByRole('button', { name: 'Create an account' }).waitFor({ timeout: 60000 });
    assert(!(await userId('b@example.com')), 'auth user deleted');
    assert(Number(await one(`select count(*) from tasks where user_id='${uidB}'`)) === 0, 'B rows deleted');
    const dbs = await B.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    assert(!dbs.some((n) => n.includes(uidB)), 'local copy deleted');
  });

  await step('Midnight in the user’s time zone: Today rolls over; check-in lands on the right day', async () => {
    await fetch(`${SUPA_URL}/__control/ttl?s=500000`);
    const { ctx, page } = await newPage();
    // 23:59:30 in Riyadh on the current Riyadh date.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
    const t = new Date(`${day}T23:59:30+03:00`);
    await page.clock.install({ time: t });
    await signIn(page, 'a@example.com');
    const label = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', weekday: 'long', day: 'numeric', month: 'long' }).format(d).replace(/^(\w+) /, '$1, ');
    await page.getByRole('heading', { level: 1, name: label(t) }).waitFor();
    await page.clock.runFor(60_000);
    const next = new Date(t.getTime() + 60_000);
    await page.getByRole('heading', { level: 1, name: label(next) }).waitFor({ timeout: 10000 });
    const box = page.getByRole('checkbox', { name: /^Read (done|not done)$/ });
    assert((await box.getAttribute('aria-checked')) === 'false', 'yesterday’s check-in does not count for the new day');
    await box.click();
    const nextDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(next);
    await page.clock.runFor(3000);
    await waitFor(async () => Number(await one(`select count(*) from habit_logs where day='${nextDay}' and deleted_at is null`)) === 1, 'check-in on the new day');
    await ctx.close();
  });

  await step('Sign out removes this device’s private copy', async () => {
    await go(A, '/more/settings');
    await A.getByRole('button', { name: 'Sign out' }).click();
    await A.getByRole('button', { name: 'Create an account' }).waitFor();
    const dbs = await A.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    assert(!dbs.some((n) => n.includes(uidA)), 'IndexedDB deleted');
    assert(await A.evaluate(() => localStorage.getItem('mylife.session') === null), 'session removed');
  });

  await step('No JavaScript errors during the run', async () => {
    const errs = [...A.errors, ...B.errors];
    assert(!errs.length, errs.slice(0, 5).join(' | '));
  });

  await ctxA.close();
  await ctxB.close();
}

try {
  await main();
} catch (e) {
  console.error('Harness error:', e);
  results.push({ name: 'harness', ok: false, error: e.message });
} finally {
  await browser?.close();
  await stack?.stop();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} end-to-end checks passed.`);
  writeFileSync(path.join(SHOTS, 'e2e-results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}
