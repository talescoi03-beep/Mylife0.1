import { useEffect, useMemo, useState } from 'react';
import { AppContext, useApp, useSettings, useSyncStatus, type AppCtx } from './context';
import { Store } from '../data/store';
import { SyncEngine, supabaseRemote } from '../data/sync';
import { openIndexedDb } from '../data/persist';
import { isConfigured } from '../lib/env';
import { Link, match, navigate, useLocation } from '../lib/router';
import { supabase, type Session } from '../lib/supa';
import { ConfirmHost, Toasts, confirm, toast } from '../ui/kit';
import { IconGrowth, IconJournal, IconMore, IconPlan, IconPlus, IconToday } from '../ui/icons';
import { AuthScreen, SetupNeeded } from '../screens/Auth';
import { TodayScreen } from '../screens/Today';
import { PlanScreen } from '../screens/Plan';
import { GoalDetail, GoalForm } from '../screens/Goal';
import { HabitDetail } from '../screens/HabitDetail';
import { GrowthScreen, LearningDetail } from '../screens/Growth';
import { JournalEditor, JournalScreen } from '../screens/Journal';
import { FreshStart, MonthlyReview, SeasonReflection, WeeklyReview } from '../screens/Reviews';
import { AboutScreen, AreaDetail, AreasScreen, MoreScreen, ProgressScreen, WinsScreen } from '../screens/More';
import { MoneyScreen, PeopleScreen, PersonDetail } from '../screens/Life';
import { DataScreen, SettingsScreen } from '../screens/Settings';
import { Onboarding } from '../screens/Onboarding';
import { HabitEditorHost, QuickAdd, TaskSheetHost, openQuickAdd } from '../screens/shared';

export function Root() {
  const [session, setSession] = useState<Session | null>(() => supabase.getSession());
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => supabase.onAuthChange(setSession), []);
  useEffect(() => {
    if (!isConfigured) return;
    supabase.handleRedirect().then((r) => {
      if (r.error) setNotice(r.error);
      else if (r.type === 'recovery') navigate('/more/settings?reset=1', { replace: true });
      else if (r.type === 'signup') toast('Email confirmed. Welcome!');
    }).catch((e) => setNotice((e as Error).message));
  }, []);
  if (!isConfigured) return <SetupNeeded />;
  if (!session) return <><AuthScreen notice={notice} /><Toasts /></>;
  return <SignedIn key={session.user.id} userId={session.user.id} email={session.user.email} />;
}

function SignedIn({ userId, email }: { userId: string; email: string | null }) {
  const [ctx, setCtx] = useState<AppCtx | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firstSync, setFirstSync] = useState<'pending' | 'done' | 'failed'>('pending');

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      try {
        const persist = await openIndexedDb(userId);
        const store = await Store.open(userId, persist);
        const sync = new SyncEngine(store, supabaseRemote(supabase));
        store.onLocalChange = () => sync.localChanged();
        if (disposed) { store.close(); return; }

        const signOut = async () => {
          if (store.pendingCount() > 0) {
            await sync.syncNow();
            const left = store.pendingCount();
            if (left > 0) {
              const ok = await confirm({
                title: 'Some changes haven’t synced',
                body: `${left} change${left === 1 ? '' : 's'} exist only on this device. Signing out deletes this device’s copy, so they would be lost. Connect to the internet and wait for “Synced”, or download a backup first.`,
                confirmLabel: 'Sign out and lose them', danger: true,
              });
              if (!ok) return;
            }
          }
          sync.dispose();
          await store.destroy();
          try { localStorage.removeItem('mylife.lastPath'); } catch { /* ignore */ }
          await supabase.signOut();
          navigate('/', { replace: true });
        };

        const runSync = () => void sync.syncNow();
        const onVisible = () => { if (document.visibilityState === 'visible') runSync(); };
        window.addEventListener('online', runSync);
        document.addEventListener('visibilitychange', onVisible);
        const timer = setInterval(() => { if (document.visibilityState === 'visible') runSync(); }, 90_000);
        cleanup = () => {
          window.removeEventListener('online', runSync);
          document.removeEventListener('visibilitychange', onVisible);
          clearInterval(timer);
          sync.dispose();
          store.close();
        };

        setCtx({ store, sync, email, signOut });
        if (store.meta.initialPullDone) setFirstSync('done');
        await sync.syncNow();
        setFirstSync(store.meta.initialPullDone ? 'done' : 'failed');
        sync.onConflict = () => toast('A journal entry or idea was edited on two devices. Both versions are kept.', { ms: 7000 });
        // Ask the browser not to clear this site's offline data under storage pressure.
        (navigator.storage as any)?.persist?.().catch(() => {});
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => { disposed = true; cleanup(); };
  }, [userId, email]);

  if (error) return <div className="auth"><h1>My Life</h1><div className="error-box">Couldn’t open local storage: {error}</div></div>;
  if (!ctx) return <div className="splash">Loading…</div>;
  if (firstSync === 'pending') return <div className="splash" role="status">Loading your data…</div>;
  return (
    <AppContext.Provider value={ctx}>
      <Shell />
    </AppContext.Provider>
  );
}

function ThemeApplier() {
  const { theme } = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e1311' : '#f2f4f0');
  }, [theme]);
  return null;
}

const NAV = [
  { to: '/', label: 'Today', icon: IconToday, match: (p: string) => p === '/' },
  { to: '/plan', label: 'Plan', icon: IconPlan, match: (p: string) => p.startsWith('/plan') },
  { to: '/growth', label: 'Growth', icon: IconGrowth, match: (p: string) => p.startsWith('/growth') },
  { to: '/journal', label: 'Journal', icon: IconJournal, match: (p: string) => p.startsWith('/journal') || p.startsWith('/review') || p.startsWith('/fresh-start') },
  { to: '/more', label: 'More', icon: IconMore, match: (p: string) => p.startsWith('/more') || p.startsWith('/area') },
];

function Shell() {
  const { path } = useLocation();
  const settings = useSettings();
  const { store } = useApp();
  useSyncStatus(); // re-render when a sync finishes
  const firstSyncFailed = !store.meta.initialPullDone;
  const needsOnboarding = !firstSyncFailed && !settings.onboarding?.done && !settings.onboarding?.skipped;
  useEffect(() => {
    if (needsOnboarding && path !== '/onboarding') navigate('/onboarding', { replace: true });
  }, [needsOnboarding, path]);

  const screen = useMemo(() => route(path), [path]);
  const onboarding = path === '/onboarding';
  return (
    <div className="app">
      <ThemeApplier />
      <a href="#main" className="sr-only">Skip to content</a>
      <main id="main" className="main">
        {firstSyncFailed && path === '/' && (
          <div className="page" style={{ paddingBottom: 0 }}>
            <div className="banner warn">Couldn’t load your account from the server yet. You can keep working — changes are saved on this device and sync when the connection returns.</div>
          </div>
        )}
        {screen}
      </main>
      {!onboarding && (
        <>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} aria-current={n.match(path) ? 'page' : undefined}>
                <n.icon /><span>{n.label}</span>
              </Link>
            ))}
          </nav>
          <button className="fab" aria-label="Quick add a task, idea or journal entry" onClick={openQuickAdd}><IconPlus size={28} /></button>
        </>
      )}
      <QuickAdd />
      <TaskSheetHost />
      <HabitEditorHost />
      <ConfirmHost />
      <Toasts />
    </div>
  );
}

function route(path: string) {
  let m: Record<string, string> | null;
  if (path === '/') return <TodayScreen />;
  if (path === '/onboarding') return <Onboarding />;
  if (path === '/plan') return <PlanScreen />;
  if (path === '/plan/goal/new') return <GoalForm id={null} />;
  if ((m = match('/plan/goal/:id/edit', path))) return <GoalForm key={m.id} id={m.id} />;
  if ((m = match('/plan/goal/:id', path))) return <GoalDetail key={m.id} id={m.id} />;
  if ((m = match('/plan/habit/:id', path))) return <HabitDetail key={m.id} id={m.id} />;
  if (path === '/growth') return <GrowthScreen />;
  if ((m = match('/growth/item/:id', path))) return <LearningDetail key={m.id} id={m.id} />;
  if (path === '/journal') return <JournalScreen />;
  if (path === '/journal/new') return <JournalEditor key={location.search} id={null} />;
  if ((m = match('/journal/:id', path))) return <JournalEditor key={m.id} id={m.id} />;
  if (path === '/review/weekly') return <WeeklyReview key={location.search} />;
  if (path === '/review/monthly') return <MonthlyReview key={location.search} />;
  if (path === '/review/season') return <SeasonReflection />;
  if (path === '/fresh-start') return <FreshStart />;
  if (path === '/more') return <MoreScreen />;
  if (path === '/more/areas') return <AreasScreen />;
  if ((m = match('/area/:id', path))) return <AreaDetail key={m.id} id={m.id} />;
  if (path === '/more/progress') return <ProgressScreen />;
  if (path === '/more/wins') return <WinsScreen />;
  if (path === '/more/money') return <MoneyScreen />;
  if (path === '/more/people') return <PeopleScreen />;
  if ((m = match('/more/people/:id', path))) return <PersonDetail key={m.id} id={m.id} />;
  if (path === '/more/settings') return <SettingsScreen />;
  if (path === '/more/data') return <DataScreen />;
  if (path === '/more/about') return <AboutScreen />;
  return (
    <div className="page"><h1 className="page-title">Page not found</h1><p><Link to="/">Go to Today</Link></p></div>
  );
}
