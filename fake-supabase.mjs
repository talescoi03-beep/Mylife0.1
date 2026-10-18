// TEST-ONLY local stand-in for Supabase (GoTrue auth + the PostgREST subset
// My Life uses), backed by a real PostgreSQL database running the real
// migration. Every data request runs as the `authenticated` role with the
// caller's JWT claims, so row-level security is enforced exactly by the
// migration's policies. Never deploy this.
import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Pg, dollar, lit } from './pg.mjs';

const JWT_SECRET = 'test-secret-not-for-production';
export const PUBLISHABLE_KEY = 'sb_publishable_test';
export const SECRET_KEY = 'sb_secret_test';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function signJwt(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64(payload);
  return `${h}.${p}.${createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
function verifyJwt(token) {
  const [h, p, s] = String(token).split('.');
  if (!s || createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null;
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}
const hashPw = (pw) => createHash('sha256').update('salt:' + pw).digest('hex');

export async function startFakeSupabase({ pgSocket, database, port = 54321, tokenTtl = 3600 }) {
  const pg = new Pg({ socket: pgSocket, database });
  await pg.connect();
  const refresh = new Map(); // token -> user id
  const state = { down: false, requests: 0, tokenTtl };
  const columns = new Map();
  for (const [t, cols] of await pg.query(`select table_name, string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema='public' group by 1`)) {
    columns.set(t, cols.split(','));
  }

  function session(user) {
    const now = Math.floor(Date.now() / 1000);
    const access_token = signJwt({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + state.tokenTtl });
    const refresh_token = randomBytes(16).toString('hex');
    refresh.set(refresh_token, user.id);
    return { access_token, refresh_token, token_type: 'bearer', expires_in: state.tokenTtl, expires_at: now + state.tokenTtl, user: { id: user.id, email: user.email } };
  }

  async function asUser(claims, sql) {
    const c = dollar(JSON.stringify(claims));
    const rows = await pg.transaction(`begin; set local role authenticated; select set_config('request.jwt.claims', ${c}, true); ${sql}; commit;`);
    return rows[rows.length - 1]?.[0];
  }

  function parseFilters(url, table) {
    const cols = columns.get(table);
    const where = [];
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
      if (!cols.includes(k)) throw Object.assign(new Error(`column ${k} does not exist`), { status: 400 });
      const m = v.match(/^(eq|gt|gte|lt|lte|neq)\.(.*)$/s);
      if (!m) throw Object.assign(new Error(`unsupported filter ${v}`), { status: 400 });
      const op = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=', neq: '<>' }[m[1]];
      where.push(`"${k}" ${op} ${lit(m[2])}`);
    }
    return where;
  }

  function pgError(res, e) {
    const map = { '23505': 409, '42501': 403, '23514': 400, '22P02': 400, '23502': 400, '42703': 400, '22007': 400, '22008': 400 };
    const status = e.status ?? map[e.code] ?? 500;
    send(res, status, { code: e.code ?? 'PGRST', message: e.message, details: e.detail ?? null, hint: null });
  }

  function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }

  const server = createServer(async (req, res) => {
    state.requests++;
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'apikey, authorization, content-type, prefer, x-client-info');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/__control/')) {
      const what = url.pathname.split('/')[2];
      if (what === 'down') state.down = true;
      if (what === 'up') state.down = false;
      if (what === 'ttl') state.tokenTtl = Number(url.searchParams.get('s'));
      return send(res, 200, { ...state });
    }
    if (state.down) return send(res, 503, { message: 'Service unavailable (simulated paused project)' });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : null;
    const apikey = req.headers.apikey;
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    try {
      // ---------------- auth ----------------
      if (url.pathname.startsWith('/auth/v1/')) {
        if (apikey !== PUBLISHABLE_KEY && apikey !== SECRET_KEY) return send(res, 401, { message: 'Invalid API key' });
        const route = url.pathname.slice('/auth/v1/'.length);
        if (route === 'signup' && req.method === 'POST') {
          const exists = await pg.query(`select 1 from auth.users where email = ${lit(body.email)}`);
          if (exists.length) return send(res, 422, { code: 'user_already_exists', msg: 'User already registered' });
          const id = randomUUID();
          await pg.query(`insert into auth.users (id, email, encrypted_password) values (${lit(id)}, ${lit(body.email)}, ${lit(hashPw(body.password))})`);
          return send(res, 200, session({ id, email: body.email }));
        }
        if (route === 'token' && req.method === 'POST') {
          if (url.searchParams.get('grant_type') === 'password') {
            const rows = await pg.query(`select id, email from auth.users where email = ${lit(body.email)} and encrypted_password = ${lit(hashPw(body.password))}`);
            if (!rows.length) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
            return send(res, 200, session({ id: rows[0][0], email: rows[0][1] }));
          }
          const uid = refresh.get(body.refresh_token);
          if (!uid) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
          refresh.delete(body.refresh_token);
          const rows = await pg.query(`select id, email from auth.users where id = ${lit(uid)}`);
          if (!rows.length) return send(res, 400, { error: 'invalid_grant', error_description: 'User not found' });
          return send(res, 200, session({ id: rows[0][0], email: rows[0][1] }));
        }
        if (route === 'user') {
          const claims = verifyJwt(bearer);
          if (!claims) return send(res, 401, { msg: 'invalid JWT' });
          const rows = await pg.query(`select id, email from auth.users where id = ${lit(claims.sub)}`);
          if (!rows.length) return send(res, 401, { msg: 'User not found' });
          if (req.method === 'PUT' && body?.password) await pg.query(`update auth.users set encrypted_password = ${lit(hashPw(body.password))} where id = ${lit(claims.sub)}`);
          return send(res, 200, { id: rows[0][0], email: rows[0][1] });
        }
        if (route === 'logout') return send(res, 204);
        if (route === 'recover') return send(res, 200, {});
        const m = route.match(/^admin\/users\/([0-9a-f-]+)$/);
        if (m && req.method === 'DELETE') {
          if (apikey !== SECRET_KEY) return send(res, 401, { message: 'service key required' });
          await pg.query(`delete from auth.users where id = ${lit(m[1])}`);
          return send(res, 200, {});
        }
        return send(res, 404, { message: 'not found' });
      }

      // ---------------- rest ----------------
      if (url.pathname.startsWith('/rest/v1/')) {
        if (apikey !== PUBLISHABLE_KEY) return send(res, 401, { message: 'Invalid API key' });
        const claims = verifyJwt(bearer);
        if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT expired or invalid' });
        const table = url.pathname.slice('/rest/v1/'.length);
        const cols = columns.get(table);
        if (!cols) return send(res, 404, { code: '42P01', message: `relation ${table} does not exist` });
        const where = parseFilters(url, table);
        const whereSql = where.length ? `where ${where.join(' and ')}` : '';
        const prefer = req.headers.prefer || '';
        const wrap = (inner) => `with r as (${inner}) select coalesce(json_agg(r), '[]'::json) from r`;
        let sql;
        if (req.method === 'GET') {
          const order = (url.searchParams.get('order') || '').split(',').filter(Boolean).map((o) => {
            const [c, dir] = o.split('.');
            if (!cols.includes(c)) throw Object.assign(new Error('bad order'), { status: 400 });
            return `"${c}" ${dir === 'desc' ? 'desc' : 'asc'}`;
          });
          const limit = Number(url.searchParams.get('limit') || 1000);
          const offset = Number(url.searchParams.get('offset') || 0);
          sql = `select coalesce(json_agg(r), '[]'::json) from (select * from public.${table} ${whereSql} ${order.length ? 'order by ' + order.join(',') : ''} limit ${Math.min(limit, 1000)} offset ${offset}) r`;
        } else if (req.method === 'POST') {
          const rows = Array.isArray(body) ? body : [body];
          const unknown = rows.flatMap((r) => Object.keys(r)).find((k) => !cols.includes(k));
          if (unknown) return send(res, 400, { code: 'PGRST204', message: `Could not find the '${unknown}' column of '${table}'` });
          const keys = Object.keys(rows[0]);
          const sel = keys.map((k) => `"${k}"`).join(',');
          const src = `select ${sel} from json_populate_recordset(null::public.${table}, ${dollar(JSON.stringify(rows))}::json)`;
          let conflict = '';
          if (/resolution=merge-duplicates/.test(prefer)) {
            const on = url.searchParams.get('on_conflict') || 'id';
            conflict = `on conflict ("${on}") do update set ${keys.filter((k) => k !== on).map((k) => `"${k}" = excluded."${k}"`).join(', ')}`;
          }
          sql = wrap(`insert into public.${table} (${sel}) ${src} ${conflict} returning *`);
        } else if (req.method === 'PATCH') {
          const keys = Object.keys(body);
          const unknown = keys.find((k) => !cols.includes(k));
          if (unknown) return send(res, 400, { code: 'PGRST204', message: `Could not find the '${unknown}' column of '${table}'` });
          const src = `json_populate_record(null::public.${table}, ${dollar(JSON.stringify(body))}::json)`;
          sql = wrap(`update public.${table} t set ${keys.map((k) => `"${k}" = (select "${k}" from ${src})`).join(', ')} ${whereSql.replace(/"(\w+)"/g, 't."$1"')} returning t.*`);
        } else if (req.method === 'DELETE') {
          if (!where.length) return send(res, 400, { code: '21000', message: 'DELETE requires a WHERE clause' });
          sql = wrap(`delete from public.${table} ${whereSql} returning *`);
        } else return send(res, 405, { message: 'method not allowed' });
        const out = await asUser(claims, sql);
        if (req.method !== 'GET' && !/return=representation/.test(prefer)) return send(res, 204);
        res.writeHead(req.method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' });
        return res.end(out ?? '[]');
      }
      return send(res, 404, { message: 'not found' });
    } catch (e) {
      return pgError(res, e);
    }
  });
  await new Promise((r) => server.listen(port, r));
  return { server, state, pg, close: () => new Promise((r) => { server.close(r); pg.end(); }) };
}
