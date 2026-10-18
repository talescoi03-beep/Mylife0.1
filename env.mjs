// Starts the full stack locally for end-to-end tests:
//   PostgreSQL (real migration + RLS) ← fake Supabase gateway ← built app + real backend.
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pg } from './pg.mjs';
import { PUBLISHABLE_KEY, SECRET_KEY, startFakeSupabase } from './fake-supabase.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../..');
export const PG_SOCKET = '/tmp/.s.PGSQL.54329';
export const DB = 'mylife_e2e';
export const SUPA_PORT = 54321;
export const APP_PORT = 4173;
export const API_PORT = 10010;
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;
export const SUPA_URL = `http://127.0.0.1:${SUPA_PORT}`;
export const API_URL = `http://127.0.0.1:${API_PORT}`;

const psql = (db, args) => execFileSync('psql', ['-h', '/tmp', '-p', '54329', '-U', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args], { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });

export function resetDatabase() {
  psql('postgres', ['-c', `drop database if exists ${DB} with (force)`]);
  psql('postgres', ['-c', `create database ${DB}`]);
  psql(DB, ['-f', path.join(root, 'tests/supabase-shim.sql')]);
  psql(DB, ['-f', path.join(root, 'supabase/migrations/0001_my_life_schema.sql')]);
}

export function buildApp() {
  execFileSync('node', ['scripts/build.mjs'], {
    cwd: path.join(root, 'frontend'),
    env: { ...process.env, PUBLIC_SUPABASE_URL: SUPA_URL, PUBLIC_SUPABASE_KEY: PUBLISHABLE_KEY, PUBLIC_API_URL: API_URL },
    stdio: 'pipe',
  });
}

/** Serves dist/ like a Render static site with a "/* → /index.html" rewrite. */
export function startStatic() {
  const dist = path.join(root, 'frontend/dist');
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
  const server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(dist, p);
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    if (file.endsWith('sw.js') || file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(APP_PORT, '127.0.0.1', () => r(server)));
}

export function startBackend() {
  const child = spawn('node', ['server.mjs'], {
    cwd: path.join(root, 'backend'),
    env: { ...process.env, PORT: String(API_PORT), SUPABASE_URL: SUPA_URL, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY, SUPABASE_SECRET_KEY: SECRET_KEY, ALLOWED_ORIGINS: APP_URL },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(child); });
    child.on('exit', (c) => reject(new Error(`backend exited ${c}`)));
  });
}

export async function startStack() {
  resetDatabase();
  buildApp();
  const supa = await startFakeSupabase({ pgSocket: PG_SOCKET, database: DB, port: SUPA_PORT });
  const web = await startStatic();
  const api = await startBackend();
  const db = new Pg({ socket: PG_SOCKET, database: DB });
  await db.connect();
  return { supa, web, api, db, async stop() { this.api.kill(); web.close(); await supa.close(); db.end(); } };
}
