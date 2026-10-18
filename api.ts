// Calls to the small Render backend. It is only needed for actions that need
// the Supabase secret key (deleting the login account). Everything else talks
// to Supabase directly, so the sleeping free backend never slows normal use.
import { config } from './env';
import { supabase } from './supa';

async function ping(timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.apiUrl}/health`, { signal: ctrl.signal, cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Wakes the backend if Render has put it to sleep (free services sleep after
 * 15 idle minutes and take up to about a minute to start).
 */
export async function wakeBackend(onWaiting: (seconds: number) => void, maxSeconds = 100): Promise<void> {
  if (!config.apiUrl) throw new Error('The backend URL (PUBLIC_API_URL) is not configured for this build.');
  const started = Date.now();
  if (await ping(6000)) return;
  for (;;) {
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (elapsed > maxSeconds) throw new Error('The server did not wake up. Check your connection and try again in a minute.');
    onWaiting(elapsed);
    if (await ping(10000)) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/** Permanently deletes the signed-in account and all its data. */
export async function deleteAccountOnServer(onWaiting: (seconds: number) => void): Promise<void> {
  await wakeBackend(onWaiting);
  const token = await supabase.accessToken();
  const res = await fetch(`${config.apiUrl}/api/account`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let msg = `Deletion failed (${res.status})`;
    try { msg = (await res.json()).error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
}
