// Row-level security test for every private table.
// Runs the real migration against a throwaway local PostgreSQL database and
// checks that user B can never read, change, delete or take over user A's rows,
// that anonymous requests get nothing, and that deleting an account removes
// that user's data.
//
// Usage: PGHOST=/tmp PGPORT=54329 node tests/rls.test.mjs
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const DB = 'mylife_rls_test';
const base = ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-tA', '-U', 'postgres'];

function psql(db, sql) {
  return execFileSync('psql', [...base, '-d', db, '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function psqlFile(db, file) {
  execFileSync('psql', [...base, '-d', db, '-f', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function asUser(uid, sql) {
  const claims = JSON.stringify({ sub: uid, role: 'authenticated' });
  return psql(DB, `begin; set local role authenticated; select set_config('request.jwt.claims', '${claims}', true);
${sql}; commit;`);
}
function asAnon(sql) {
  return psql(DB, `begin; set local role anon; ${sql}; commit;`);
}
function expectError(fn, label) {
  try { fn(); } catch (e) { return String(e.stderr || e.message); }
  throw new Error(`Expected an error: ${label}`);
}

// Minimal valid column values for each table (besides id / user_id).
const d = '2026-10-18';
const fixtures = {
  settings: (id) => ({ id }), // settings.id must equal user_id
  areas: () => ({ name: 'Health' }),
  visions: () => ({ title: 'Ten-year vision' }),
  goals: () => ({ title: 'Run 10 km' }),
  goal_events: () => ({ goal_id: randomUUID(), kind: 'created', summary: 'Created' }),
  milestones: () => ({ title: 'First 5 km' }),
  tasks: () => ({ title: 'Buy shoes' }),
  time_blocks: () => ({ day: d, start_time: '09:00', end_time: '10:00', title: 'Study' }),
  habits: () => ({ title: 'Read', start_date: d }),
  habit_logs: () => ({ habit_id: randomUUID(), day: d, status: 'done' }),
  day_notes: () => ({ day: d }),
  week_plans: () => ({ week_start: d }),
  journal_entries: () => ({ day: d, body: 'private thoughts' }),
  learning_items: () => ({ title: 'A book' }),
  learning_sessions: () => ({ learning_id: randomUUID(), day: d, minutes: 20 }),
  ideas: () => ({ body: 'An idea' }),
  wins: () => ({ day: d, title: 'Did it' }),
  money_entries: () => ({ day: d, kind: 'expense', amount: 10, currency: 'USD' }),
  savings_goals: () => ({ title: 'Fund', target: 100, currency: 'USD' }),
  bills: () => ({ title: 'Internet', amount: 25, currency: 'USD', next_due: d }),
  people: () => ({ name: 'Brother' }),
  people_dates: () => ({ person_id: randomUUID(), label: 'Birthday', date: d }),
  contact_logs: () => ({ person_id: randomUUID(), day: d }),
};

const lit = (v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
function insertSql(table, row) {
  const cols = Object.keys(row);
  return `insert into public.${table} (${cols.join(',')}) values (${cols.map((c) => lit(row[c])).join(',')})`;
}

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error('FAILED: ' + msg);
  passed++;
}

// --- setup ------------------------------------------------------------------
psql('postgres', `drop database if exists ${DB}`);
psql('postgres', `create database ${DB}`);
psqlFile(DB, path.join(here, 'supabase-shim.sql'));
psqlFile(DB, path.join(root, 'supabase/migrations/0001_my_life_schema.sql'));
// Running the migration a second time must also succeed (idempotent).
psqlFile(DB, path.join(root, 'supabase/migrations/0001_my_life_schema.sql'));

const A = randomUUID();
const B = randomUUID();
psql(DB, `insert into auth.users (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com')`);

const tables = Object.keys(fixtures);
const migration = readFileSync(path.join(root, 'supabase/migrations/0001_my_life_schema.sql'), 'utf8');
const created = [...migration.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
ok(created.length === tables.length && created.every((t) => tables.includes(t)),
  `test covers every table in the migration (${created.length} tables)`);

// RLS must be enabled and forced on every table.
const rlsRows = psql(DB, `select relname || ':' || relrowsecurity || ':' || relforcerowsecurity from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r'`).split('\n');
for (const t of tables) ok(rlsRows.includes(`${t}:true:true`), `${t}: RLS enabled and forced`);

const rowsA = {};
for (const t of tables) {
  const id = t === 'settings' ? A : randomUUID();
  rowsA[t] = id;
  // A creates a row; user_id is filled from the JWT by the column default.
  asUser(A, insertSql(t, { id, ...fixtures[t](id) }));
  ok(asUser(A, `select count(*) from public.${t} where id = '${id}'`).endsWith('1'), `${t}: owner can read own row`);

  // B cannot see it.
  ok(asUser(B, `select count(*) from public.${t}`).endsWith('0'), `${t}: other user sees no rows`);
  ok(asUser(B, `select count(*) from public.${t} where id = '${id}'`).endsWith('0'), `${t}: other user cannot read by id`);

  // B cannot change or delete it (statements silently affect 0 rows).
  asUser(B, `update public.${t} set deleted_at = now() where id = '${id}'`);
  asUser(B, `delete from public.${t} where id = '${id}'`);
  ok(psql(DB, `select count(*) from public.${t} where id = '${id}' and deleted_at is null`) === '1',
    `${t}: other user's update/delete had no effect`);

  // B cannot insert a row claiming to be A.
  const fakeId = t === 'settings' ? A : randomUUID();
  const err1 = expectError(() => asUser(B, insertSql(t, { id: fakeId, user_id: A, ...fixtures[t](fakeId) })), `${t} insert as A`);
  ok(/row-level security|violates|duplicate key/i.test(err1), `${t}: cannot insert rows for another user`);

  // B cannot take over A's row through an upsert on the same id.
  const cols = { id, ...fixtures[t](id) };
  const upsert = insertSql(t, cols) + ` on conflict (id) do update set deleted_at = now()`;
  const err2 = expectError(() => asUser(B, upsert), `${t} upsert takeover`);
  ok(/row-level security|violates/i.test(err2), `${t}: upsert onto another user's id is rejected`);

  // A cannot hand the row to B by rewriting user_id.
  try { asUser(A, `update public.${t} set user_id = '${B}' where id = '${id}'`); } catch { /* rejected is also fine */ }
  ok(psql(DB, `select user_id from public.${t} where id = '${id}'`) === A, `${t}: ownership cannot be transferred`);

  // Anonymous requests have no access at all.
  const err3 = expectError(() => asAnon(`select count(*) from public.${t}`), `${t} anon select`);
  ok(/permission denied/i.test(err3), `${t}: anonymous access denied`);
}

// updated_at is set by the server, not trusted from the client.
asUser(A, `update public.tasks set updated_at = '2000-01-01', title = 'x' where id = '${rowsA.tasks}'`);
ok(psql(DB, `select updated_at > now() - interval '1 minute' from public.tasks where id = '${rowsA.tasks}'`) === 't',
  'updated_at comes from the server clock');

// One habit log per habit per day.
const habitId = randomUUID();
asUser(A, insertSql('habit_logs', { id: randomUUID(), habit_id: habitId, day: d, status: 'done' }));
const dup = expectError(() => asUser(A, insertSql('habit_logs', { id: randomUUID(), habit_id: habitId, day: d, status: 'done' })), 'dup habit log');
ok(/duplicate key/i.test(dup), 'duplicate habit completion for the same day is rejected');

// Deleting the account removes all of that user's rows (cascade works with forced RLS).
psql(DB, `delete from auth.users where id = '${A}'`);
for (const t of tables) {
  ok(psql(DB, `select count(*) from public.${t} where user_id = '${A}'`) === '0', `${t}: account deletion removed rows`);
}

psql('postgres', `drop database ${DB}`);
console.log(`RLS test passed: ${passed} checks across ${tables.length} tables.`);
