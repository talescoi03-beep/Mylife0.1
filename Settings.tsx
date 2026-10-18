import { useEffect, useRef, useState } from 'react';
import { updateSettings, useApp, useRows, useSettings, useStore, useSyncStatus, useToday } from '../app/context';
import { countExamples, removeExamples } from '../app/actions';
import { buildCsv, makeBackup, parseBackup, restoreBackup, type Backup, type CsvKind } from '../data/backup';
import { TABLES } from '../data/schema';
import { addExamples } from '../data/starter';
import { deviceTimeZone, isValidTimeZone, weekdayName } from '../lib/dates';
import { deleteAccountOnServer } from '../lib/api';
import { config } from '../lib/env';
import { navigate, useLocation } from '../lib/router';
import { shareOrDownload } from '../logic/ics';
import { supabase } from '../lib/supa';
import { AutoText, Field, NumberInput, PageHead, Section, Seg, Sheet, confirm, toast } from '../ui/kit';
import type { Theme } from '../data/schema';

export function SettingsScreen() {
  const store = useStore();
  const { email, signOut, sync } = useApp();
  const s = useSettings();
  const status = useSyncStatus();
  const today = useToday();
  const { query } = useLocation();
  useRows('goals');
  const [reminder, setReminder] = useState(s.reminder_text ?? '');
  const [currencies, setCurrencies] = useState((s.currencies ?? []).join(', '));
  const [tzInput, setTzInput] = useState(s.timezone ?? '');
  const examples = countExamples(store);
  const zones: string[] = (Intl as any).supportedValuesOf?.('timeZone') ?? [];
  const reminderRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (location.hash === '#reminder') reminderRef.current?.scrollIntoView({ block: 'center' });
  }, []);
  const set = (patch: Parameters<typeof updateSettings>[1]) => updateSettings(store, patch);
  const others = (s.currencies ?? []).filter((c) => c !== s.default_currency);

  return (
    <div className="page">
      <PageHead backTo="/more" title="Settings" />
      {query.get('reset') === '1' && <PasswordReset />}

      <Section title="Appearance">
        <Seg label="Theme" value={s.theme} onChange={(v) => set({ theme: v as Theme })}
          options={[{ value: 'system', label: 'Automatic' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </Section>

      <div ref={reminderRef} id="reminder">
        <Section title="Morning reminder line" note="A sentence you want to read at the top of Today — your theme, in your own words.">
          <AutoText serif value={reminder} onChange={(e) => setReminder(e.target.value)} onBlur={() => set({ reminder_text: reminder.trim() || null })} minRows={2}
            placeholder="e.g. The person I become decides the life I get." aria-label="Morning reminder line" />
        </Section>
      </div>

      <Section title="Time and week" note={`Days start and end at midnight in this time zone. Now: ${today}.`}>
        <div className="form">
          <Field label="Time zone">
            {zones.length ? (
              <select className="select" value={s.timezone ?? ''} onChange={(e) => set({ timezone: e.target.value || null })}>
                <option value="">This device ({deviceTimeZone()})</option>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            ) : (
              <input className="input" value={tzInput} placeholder={deviceTimeZone()} onChange={(e) => setTzInput(e.target.value)}
                onBlur={() => { if (!tzInput || isValidTimeZone(tzInput)) set({ timezone: tzInput || null }); else toast('Unknown time zone'); }} />
            )}
          </Field>
          <Field label="Week starts on">
            <select className="select" value={s.week_starts_on} onChange={(e) => set({ week_starts_on: Number(e.target.value) })}>
              {[6, 0, 1].map((d) => <option key={d} value={d}>{weekdayName(d)}</option>)}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Money">
        <div className="form">
          <Field label="Currencies you use" hint="Comma separated codes, e.g. USD, IQD">
            <input className="input" value={currencies} onChange={(e) => setCurrencies(e.target.value)} autoCapitalize="characters"
              onBlur={() => {
                const list = [...new Set(currencies.split(',').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)))];
                if (!list.length) { toast('Add at least one 3-letter currency code'); return; }
                set({ currencies: list, default_currency: list.includes(s.default_currency) ? s.default_currency : list[0] });
                setCurrencies(list.join(', '));
              }} />
          </Field>
          <Field label="Main currency">
            <select className="select" value={s.default_currency} onChange={(e) => set({ default_currency: e.target.value })}>
              {(s.currencies ?? []).map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          {others.map((c) => (
            <Field key={c} label={`Conversion rate: 1 ${c} = ? ${s.default_currency}`} hint="Optional. Totals stay separate unless you enter a rate. You keep it up to date.">
              <NumberInput value={s.fx?.[`${c}>${s.default_currency}`] ?? null}
                onChange={(n) => { const fx = { ...(s.fx ?? {}) }; if (n && n > 0) fx[`${c}>${s.default_currency}`] = n; else delete fx[`${c}>${s.default_currency}`]; set({ fx }); }} />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Setup and examples">
        <div className="list">
          <button className="row" onClick={() => navigate('/onboarding')}><span className="row-main row-title">Run the setup steps again</span></button>
          {examples > 0
            ? <button className="row" onClick={async () => {
              if (await confirm({ title: `Remove ${examples} example items?`, body: 'Only items labelled “Example” are removed. Anything you created stays.', confirmLabel: 'Remove examples', danger: true })) {
                toast(`${removeExamples(store)} examples removed`);
              }
            }}><span className="row-main"><span className="row-title danger-text">Remove all examples</span><span className="row-meta">{examples} example items</span></span></button>
            : <button className="row" onClick={() => { addExamples(store, today, s.week_starts_on); toast('Examples added — each is labelled “Example”.'); }}>
              <span className="row-main"><span className="row-title">Add example content</span><span className="row-meta">A gym routine, trading study, a game project, reading and family time</span></span></button>}
        </div>
      </Section>

      <Section title="Account" id="account">
        <div className="card">
          <div className="small muted">Signed in as</div>
          <div>{email}</div>
        </div>
        {status.state === 'signin' && <Reauth email={email ?? ''} onDone={() => void sync.syncNow()} />}
        <div className="btn-row">
          <ChangePassword />
          <button className="btn danger-soft" onClick={() => void signOut()}>Sign out</button>
        </div>
      </Section>
    </div>
  );
}

function PasswordReset() {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="banner"><div className="grow">
      <strong>Choose a new password</strong>
      <input className="input mt-s" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" />
      <button className="btn small mt-s" disabled={pw.length < 8 || busy} onClick={async () => {
        setBusy(true);
        try { await supabase.updatePassword(pw); toast('Password updated'); navigate('/more/settings', { replace: true }); }
        catch (e) { toast((e as Error).message); }
        finally { setBusy(false); }
      }}>Save password</button>
    </div></div>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button className="btn secondary" onClick={() => setOpen(true)}>Change password</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Change password">
        <Field label="New password" hint="At least 8 characters."><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <button className="btn block mt" disabled={pw.length < 8 || busy} onClick={async () => {
          setBusy(true);
          try { await supabase.updatePassword(pw); toast('Password changed'); setOpen(false); setPw(''); }
          catch (e) { toast((e as Error).message); }
          finally { setBusy(false); }
        }}>Save</button>
      </Sheet>
    </>
  );
}

function Reauth({ email, onDone }: { email: string; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="card mt" onSubmit={async (e) => {
      e.preventDefault();
      setErr(null);
      try { await supabase.signIn(email, pw); toast('Signed in. Syncing your changes.'); onDone(); }
      catch (x) { setErr((x as Error).message); }
    }}>
      <p className="small" style={{ marginTop: 0 }}>Your sign-in expired. Enter your password to resume syncing — your unsynced changes are safe on this device.</p>
      <input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" />
      {err && <div className="error-box mt-s">{err}</div>}
      <button className="btn small mt-s" disabled={!pw}>Sign in</button>
    </form>
  );
}

// ---------- data, export and privacy ----------

export function DataScreen() {
  const store = useStore();
  const { signOut, sync } = useApp();
  const s = useSettings();
  const today = useToday();
  const status = useSyncStatus();
  const [restore, setRestore] = useState<{ backup: Backup; counts: Record<string, number>; total: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useRows('settings');
  const total = TABLES.reduce((n, t) => n + store.all(t).length, 0);

  const exportJson = async () => {
    const r = await shareOrDownload(`my-life-backup-${today}.json`, JSON.stringify(makeBackup(store), null, 1), 'application/json');
    if (r !== 'cancelled') { store.setMeta({ lastBackupAt: new Date().toISOString() }); toast('Backup created'); }
  };
  const exportCsv = async (k: CsvKind) => {
    await shareOrDownload(`my-life-${k}-${today}.csv`, buildCsv(store, k, s.tz), 'text/csv');
  };

  const deleteAllData = async () => {
    const ok = await confirm({
      title: 'Delete all your data?',
      body: <>This permanently deletes every goal, task, habit, journal entry, money record and note in your account and on this device. Your login stays. <strong>Make a backup first if you might want anything back.</strong> Other signed-in devices should sign out and in again afterwards.</>,
      confirmLabel: 'Delete all data', danger: true, typeToConfirm: 'delete',
    });
    if (!ok) return;
    setBusy('Deleting your data…');
    try {
      for (const t of TABLES) await supabase.rest('DELETE', `${t}?user_id=eq.${store.userId}`);
      await store.wipeLocal();
      toast('All data deleted');
      navigate('/', { replace: true });
    } catch (e) {
      toast(`Couldn’t finish deleting: ${(e as Error).message}. Connect to the internet and try again — it continues where it stopped.`);
    } finally { setBusy(null); }
  };

  const deleteAccount = async () => {
    const ok = await confirm({
      title: 'Delete your account?',
      body: <>Your login and all data in it are permanently deleted from the server and this device. This cannot be undone. <strong>Make a backup first</strong> if you want to keep anything.</>,
      confirmLabel: 'Delete account', danger: true, typeToConfirm: 'delete',
    });
    if (!ok) return;
    setBusy('Contacting the server…');
    try {
      await deleteAccountOnServer((sec) => setBusy(`Waking the server (free servers sleep when idle)… ${sec}s`));
      toast('Account deleted');
      await signOut();
    } catch (e) {
      toast((e as Error).message);
    } finally { setBusy(null); }
  };

  return (
    <div className="page">
      <PageHead backTo="/more" title="Backup and privacy" />
      <Section title="Backup" note={`${total} records. Free Supabase projects have no automatic backups, so download one now and then.${store.meta.lastBackupAt ? ` Last backup: ${store.meta.lastBackupAt.slice(0, 10)}.` : ''}`}>
        <button className="btn block" onClick={exportJson}>Download full backup (JSON)</button>
        <button className="btn secondary block mt-s" onClick={() => fileRef.current?.click()}>Restore from a backup…</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try { setRestore(parseBackup(await f.text())); } catch (x) { toast((x as Error).message); }
        }} />
      </Section>

      <Section title="Export for spreadsheets (CSV)">
        <div className="chips">
          {(['tasks', 'habits', 'journal', 'goals', 'learning', 'money', 'wins'] as CsvKind[]).map((k) => (
            <button key={k} className="chip" onClick={() => void exportCsv(k)}>{k[0].toUpperCase() + k.slice(1)}</button>
          ))}
        </div>
      </Section>

      <Section title="Where your data lives">
        <div className="prose small" style={{ color: 'var(--ink-2)' }}>
          <p>Your records are stored in your Supabase database. Database rules (row-level security) let each account read and change only its own rows — journals, money and notes are visible to no one else.</p>
          <p>A copy is kept on this device so the app works offline. It is deleted when you sign out. The backend server never stores your data; it is only used to delete your account.</p>
          <p>No AI service is used. Nothing is sent to anyone else, and the app never sends messages for you.</p>
        </div>
      </Section>

      <Section title="Delete">
        {status.pending > 0 && <p className="small" style={{ color: 'var(--warn)' }}>{status.pending} change(s) haven’t synced yet.</p>}
        <div className="btn-row" style={{ marginTop: 0 }}>
          <button className="btn danger-soft" onClick={deleteAllData} disabled={!!busy}>Delete all data</button>
          <button className="btn danger" onClick={deleteAccount} disabled={!!busy || !config.apiUrl}>Delete account</button>
        </div>
        {!config.apiUrl && <p className="tiny muted">Account deletion needs the backend URL (PUBLIC_API_URL) to be configured.</p>}
        {busy && <p className="small" role="status">{busy}</p>}
      </Section>

      {restore && (
        <Sheet open title="Restore backup" onClose={() => setRestore(null)}>
          <p className="small" style={{ marginTop: 0 }}>Backup from {restore.backup.exported_at.slice(0, 10)} with {restore.total} records
            {restore.backup.user_id !== store.userId ? ' (from a different account — records get new ids)' : ''}.</p>
          <div className="list small">{Object.entries(restore.counts).filter(([, n]) => n > 0).map(([t, n]) => (
            <div key={t} className="row" style={{ minHeight: 40 }}><span className="row-main">{t.replace(/_/g, ' ')}</span><span className="num">{n}</span></div>
          ))}</div>
          <p className="small"><strong>Add and update</strong> keeps everything you have and brings back what’s in the backup (records in both are set to the backup’s version). <strong>Replace</strong> also deletes anything not in the backup.</p>
          <div className="btn-row">
            <button className="btn" onClick={() => {
              const n = restoreBackup(store, restore.backup, 'merge');
              setRestore(null);
              void sync.syncNow();
              toast(`${n} records restored`);
            }}>Add and update</button>
            <button className="btn danger-soft" onClick={async () => {
              if (!(await confirm({ title: 'Replace all data with this backup?', body: 'Anything created after this backup will be deleted.', confirmLabel: 'Replace', danger: true }))) return;
              const n = restoreBackup(store, restore.backup, 'replace');
              setRestore(null);
              void sync.syncNow();
              toast(`Replaced with ${n} records from the backup`);
            }}>Replace</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
