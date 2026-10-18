// Minimal Supabase client: email/password auth (GoTrue) and table access
// (PostgREST), using Supabase's documented HTTP endpoints.
// Only the public URL and publishable/anon key are used here. Every data
// request carries the signed-in user's access token, so row-level security in
// the database decides what that user may read or write.
import { config } from './env';

export interface SessionUser { id: string; email: string | null }
export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  user: SessionUser;
}

/** The request never reached Supabase (offline, DNS, CORS, paused project with no response). */
export class NetworkError extends Error {
  constructor(message = 'Could not reach the server') { super(message); this.name = 'NetworkError'; }
}
/** Supabase answered with an error. */
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Worth retrying later (server busy, project paused/waking, gateway errors). */
  get transient() { return this.status === 408 || this.status === 429 || this.status >= 500; }
}
/** The saved session can no longer be refreshed; the user must sign in again. */
export class AuthExpiredError extends Error {
  constructor() { super('Your sign-in has expired. Please sign in again.'); this.name = 'AuthExpiredError'; }
}

const SESSION_KEY = 'mylife.session';
const isJwt = (k: string) => k.startsWith('eyJ');

type Listener = (s: Session | null) => void;

async function request(url: string, init: RequestInit, timeoutMs = 20000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    throw new NetworkError(ctrl.signal.aborted ? 'The server took too long to respond' : undefined);
  } finally {
    clearTimeout(timer);
  }
}

async function readError(res: Response): Promise<ApiError> {
  let body: any = null;
  try { body = await res.json(); } catch { /* not json */ }
  const msg = body?.msg || body?.message || body?.error_description || body?.error || `Request failed (${res.status})`;
  return new ApiError(res.status, String(msg), body?.code ?? body?.error_code, body?.details ?? body?.hint);
}

class SupabaseClient {
  private session: Session | null = null;
  private listeners = new Set<Listener>();
  private refreshing: Promise<Session> | null = null;

  constructor(private url: string, private key: string) {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) this.session = JSON.parse(raw);
    } catch { this.session = null; }
  }

  // ---- auth ---------------------------------------------------------------

  getSession(): Session | null { return this.session; }

  onAuthChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setSession(s: Session | null) {
    this.session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch { /* storage unavailable */ }
    this.listeners.forEach((l) => l(s));
  }

  private baseHeaders(): Record<string, string> {
    const h: Record<string, string> = { apikey: this.key, 'Content-Type': 'application/json' };
    // Legacy anon keys are JWTs and may be sent as a bearer token; the newer
    // publishable keys (sb_publishable_…) must only go in the apikey header.
    if (isJwt(this.key)) h.Authorization = `Bearer ${this.key}`;
    return h;
  }

  private toSession(body: any): Session {
    const expires_at = body.expires_at ?? Math.floor(Date.now() / 1000) + Number(body.expires_in ?? 3600);
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at,
      user: { id: body.user?.id, email: body.user?.email ?? null },
    };
  }

  /** Returns 'signed_in' or 'confirm_email' (when the project requires email confirmation). */
  async signUp(email: string, password: string, redirectTo: string): Promise<'signed_in' | 'confirm_email'> {
    const res = await request(`${this.url}/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST', headers: this.baseHeaders(), body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw await readError(res);
    const body = await res.json();
    if (body.access_token) {
      this.setSession(this.toSession(body));
      return 'signed_in';
    }
    return 'confirm_email';
  }

  async signIn(email: string, password: string): Promise<Session> {
    const res = await request(`${this.url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: this.baseHeaders(), body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw await readError(res);
    const s = this.toSession(await res.json());
    this.setSession(s);
    return s;
  }

  async sendPasswordReset(email: string, redirectTo: string): Promise<void> {
    const res = await request(`${this.url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST', headers: this.baseHeaders(), body: JSON.stringify({ email }),
    });
    if (!res.ok) throw await readError(res);
  }

  async updatePassword(password: string): Promise<void> {
    const token = await this.accessToken();
    const res = await request(`${this.url}/auth/v1/user`, {
      method: 'PUT', headers: { ...this.baseHeaders(), Authorization: `Bearer ${token}` }, body: JSON.stringify({ password }),
    });
    if (!res.ok) throw await readError(res);
  }

  /**
   * Completes sign-in from an email link (confirmation or password recovery).
   * Supabase puts the tokens in the URL fragment: #access_token=…&refresh_token=…
   */
  async handleRedirect(): Promise<{ type: string | null; error: string | null }> {
    const hash = typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : '';
    if (!hash.includes('access_token') && !hash.includes('error')) return { type: null, error: null };
    const p = new URLSearchParams(hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (p.get('error')) return { type: null, error: p.get('error_description') || p.get('error') };
    const access_token = p.get('access_token')!;
    const res = await request(`${this.url}/auth/v1/user`, { headers: { ...this.baseHeaders(), Authorization: `Bearer ${access_token}` } });
    if (!res.ok) throw await readError(res);
    const user = await res.json();
    this.setSession({
      access_token,
      refresh_token: p.get('refresh_token') || '',
      expires_at: Number(p.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(p.get('expires_in') || 3600),
      user: { id: user.id, email: user.email ?? null },
    });
    return { type: p.get('type'), error: null };
  }

  /** A valid access token, refreshing it first if it is about to expire. */
  async accessToken(): Promise<string> {
    const s = this.session;
    if (!s) throw new AuthExpiredError();
    if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
    return (await this.refresh()).access_token;
  }

  refresh(): Promise<Session> {
    if (this.refreshing) return this.refreshing;
    const s = this.session;
    if (!s) return Promise.reject(new AuthExpiredError());
    this.refreshing = (async () => {
      try {
        const res = await request(`${this.url}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST', headers: this.baseHeaders(), body: JSON.stringify({ refresh_token: s.refresh_token }),
        });
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          // The refresh token was revoked or already used. Keep local data, ask to sign in again.
          throw new AuthExpiredError();
        }
        if (!res.ok) throw await readError(res);
        const next = this.toSession(await res.json());
        if (!next.user.id) next.user = s.user;
        this.setSession(next);
        return next;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Signs out on this device. The server call is best-effort. */
  async signOut(): Promise<void> {
    const s = this.session;
    this.setSession(null);
    if (!s) return;
    try {
      await request(`${this.url}/auth/v1/logout`, {
        method: 'POST', headers: { ...this.baseHeaders(), Authorization: `Bearer ${s.access_token}` },
      }, 5000);
    } catch { /* offline: the token simply expires */ }
  }

  // ---- data (PostgREST) ---------------------------------------------------

  /**
   * Calls /rest/v1/<path>. Retries once with a refreshed token on 401.
   * Returns the parsed JSON body (or null for empty responses).
   */
  async rest<T = any>(method: string, path: string, opts: { body?: unknown; prefer?: string } = {}): Promise<T> {
    const doFetch = async (token: string) => request(`${this.url}/rest/v1/${path}`, {
      method,
      headers: {
        ...this.baseHeaders(),
        Authorization: `Bearer ${token}`,
        ...(opts.prefer ? { Prefer: opts.prefer } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    let res = await doFetch(await this.accessToken());
    if (res.status === 401) {
      const s = await this.refresh();
      res = await doFetch(s.access_token);
      if (res.status === 401) throw new AuthExpiredError();
    }
    if (!res.ok) throw await readError(res);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}

export const supabase = new SupabaseClient(config.supabaseUrl, config.supabaseKey);
export type { SupabaseClient };

/** Encodes a value for a PostgREST filter (eq.<value>). */
export function pgValue(v: string | number): string {
  return encodeURIComponent(String(v));
}
