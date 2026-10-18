import { useState } from 'react';
import { supabase, ApiError, NetworkError } from '../lib/supa';

function friendly(e: unknown): string {
  if (e instanceof NetworkError) return 'Can’t reach the server. Check your connection. (A free Supabase project that has been idle for a week is paused — open it in the Supabase dashboard to restore it.)';
  if (e instanceof ApiError) {
    if (/invalid login credentials/i.test(e.message)) return 'Email or password is incorrect.';
    if (/email not confirmed/i.test(e.message)) return 'Confirm your email first — check your inbox for the link.';
    if (/already registered/i.test(e.message)) return 'An account with this email already exists. Sign in instead.';
    return e.message;
  }
  return (e as Error)?.message ?? 'Something went wrong.';
}

export function AuthScreen({ notice }: { notice?: string | null }) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(notice ?? null);
  const redirect = `${location.origin}/`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'signin') await supabase.signIn(email.trim(), password);
      else if (mode === 'signup') {
        const r = await supabase.signUp(email.trim(), password, redirect);
        if (r === 'confirm_email') {
          setInfo('Check your email and tap the confirmation link. If you use the app from your Home Screen, come back here afterwards and sign in.');
          setMode('signin');
        }
      } else {
        await supabase.sendPasswordReset(email.trim(), `${redirect}more/settings?reset=1`);
        setInfo('If that email has an account, a reset link is on its way.');
        setMode('signin');
      }
    } catch (x) {
      setError(friendly(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <h1>My Life</h1>
      <p className="muted" style={{ marginTop: 0 }}>Decide what you want, why it matters, and what to do today.</p>
      <form className="form mt" onSubmit={submit}>
        <label className="field"><span>Email</span>
          <input className="input" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== 'reset' && (
          <label className="field"><span>Password</span>
            <input className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 8 : undefined}
              value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === 'signup' && <span className="hint">At least 8 characters.</span>}
          </label>
        )}
        {error && <div className="error-box" role="alert">{error}</div>}
        {info && <div className="note-box" role="status">{info}</div>}
        <button className="btn block" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>
      </form>
      <div className="mt" style={{ display: 'grid', gap: 4 }}>
        {mode !== 'signin' && <button className="link-btn" onClick={() => { setMode('signin'); setError(null); }}>I have an account — sign in</button>}
        {mode !== 'signup' && <button className="link-btn" onClick={() => { setMode('signup'); setError(null); }}>Create an account</button>}
        {mode !== 'reset' && <button className="link-btn" onClick={() => { setMode('reset'); setError(null); }}>Forgot password?</button>}
      </div>
      <p className="tiny faint mt">A personal planner inspired by a Jim Rohn seminar. Not affiliated with Jim Rohn or his estate.</p>
    </main>
  );
}

export function SetupNeeded() {
  return (
    <main className="auth">
      <h1>My Life</h1>
      <div className="note-box">
        This build has no Supabase settings. Set <code>PUBLIC_SUPABASE_URL</code> and <code>PUBLIC_SUPABASE_KEY</code> in the
        Render static site’s environment, then redeploy. See the README, step 4.
      </div>
    </main>
  );
}
