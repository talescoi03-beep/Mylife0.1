// My Life backend — a tiny, stateless Node.js API for the few things that
// need the Supabase secret key. It stores nothing itself (Render's free
// filesystem is wiped on every restart), so restarts and redeploys never
// affect your data, which lives in Supabase.
//
// Endpoints
//   GET    /health        → { ok: true }        (also used to wake the service)
//   DELETE /api/account   → deletes the caller's login and, by cascade, all their rows
//
// Environment (set in Render; never in the frontend):
//   SUPABASE_URL           https://<project>.supabase.co
//   SUPABASE_PUBLISHABLE_KEY  publishable/anon key (to verify the user's token)
//   SUPABASE_SECRET_KEY    secret/service_role key (to delete the auth user)
//   ALLOWED_ORIGINS        comma-separated list, e.g. https://my-life.onrender.com
//   PORT                   provided by Render
import { createServer } from 'node:http';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const PORT = Number(process.env.PORT || 10000);
const started = new Date().toISOString();

const missing = [['SUPABASE_URL', SUPABASE_URL], ['SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE], ['SUPABASE_SECRET_KEY', SECRET]]
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) console.warn(`[my-life-api] Missing environment variables: ${missing.join(', ')}. Account deletion will fail until they are set.`);
if (!ALLOWED.length) console.warn('[my-life-api] ALLOWED_ORIGINS is empty: browsers will be refused. Set it to your static site URL.');

const isJwt = (k) => k.startsWith('eyJ');
const keyHeaders = (key) => ({ apikey: key, ...(isJwt(key) ? { Authorization: `Bearer ${key}` } : {}) });

function cors(req, res) {
  const origin = (req.headers.origin || '').replace(/\/+$/, '');
  if (origin && ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function fetchWithTimeout(url, init = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); } finally { clearTimeout(t); }
}

/** Asks Supabase who owns this access token. Never trusts a token we didn't verify. */
async function userFromToken(token) {
  const res = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Auth server answered ${res.status}`);
  const user = await res.json();
  return user?.id ? user : null;
}

async function deleteAccount(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return send(res, 401, { error: 'Sign in first.' });
  if (missing.length) return send(res, 500, { error: 'The server is not configured (missing Supabase settings).' });
  let user;
  try { user = await userFromToken(token); } catch (e) {
    return send(res, 503, { error: 'Could not reach the database. It may be paused or waking up — try again shortly.' });
  }
  if (!user) return send(res, 401, { error: 'Your sign-in has expired. Sign in again.' });

  // Deleting the auth user removes every row in every My Life table through
  // ON DELETE CASCADE (see supabase/migrations).
  const del = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
    method: 'DELETE', headers: keyHeaders(SECRET),
  });
  if (!del.ok && del.status !== 404) {
    console.error('[my-life-api] delete failed', del.status, await del.text().catch(() => ''));
    return send(res, 502, { error: 'The account could not be deleted. Nothing was changed; try again later.' });
  }
  console.log(`[my-life-api] deleted account ${user.id}`);
  return send(res, 200, { deleted: true });
}

export const server = createServer(async (req, res) => {
  try {
    cors(req, res);
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      return send(res, 200, { ok: true, service: 'my-life-api', started });
    }
    if (req.method === 'DELETE' && url.pathname === '/api/account') {
      const origin = (req.headers.origin || '').replace(/\/+$/, '');
      if (origin && !ALLOWED.includes(origin)) return send(res, 403, { error: 'Origin not allowed.' });
      return await deleteAccount(req, res);
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('[my-life-api] error', e);
    if (!res.headersSent) send(res, 500, { error: 'Unexpected server error.' });
  }
});

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  server.listen(PORT, () => console.log(`[my-life-api] listening on ${PORT}`));
}
