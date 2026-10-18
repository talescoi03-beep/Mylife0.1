import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { deviceTimeZone, isValidTimeZone, today as todayIn, type ISODate } from '../lib/dates';
import type { Store } from '../data/store';
import type { SyncEngine, SyncStatus } from '../data/sync';
import { DEFAULTS, type Row, type Settings, type TableName } from '../data/schema';

export interface AppCtx {
  store: Store;
  sync: SyncEngine;
  email: string | null;
  signOut: () => Promise<void>;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error('App context missing');
  return c;
}

export function useStore(): Store {
  return useApp().store;
}

/** Live rows of a table; re-renders when that table changes. */
export function useRows<T extends TableName>(t: T): Row<T>[] {
  const store = useStore();
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.version(t),
    () => store.version(t),
  );
  return store.all(t);
}

export function useRow<T extends TableName>(t: T, id: string | null | undefined): Row<T> | undefined {
  useRows(t);
  return useStore().get(t, id);
}

export function useSettings(): Settings & { tz: string } {
  const { store } = useApp();
  useRows('settings');
  const s = store.get('settings', store.userId);
  return useMemo(() => {
    const base = (s ?? {
      ...DEFAULTS.settings, id: store.userId, user_id: store.userId, created_at: '', updated_at: '',
      deleted_at: null, rev: 0, last_op: null, is_example: false,
    }) as Settings;
    const tz = base.timezone && isValidTimeZone(base.timezone) ? base.timezone : deviceTimeZone();
    return { ...base, tz };
  }, [s, store.userId]);
}

export function updateSettings(store: Store, patch: Partial<Settings>) {
  const existing = store.get('settings', store.userId);
  if (existing) store.update('settings', store.userId, patch);
  else store.create('settings', { ...patch, id: store.userId } as any);
}

/** Today's date in the user's time zone. Updates itself at midnight and when the app is reopened. */
export function useToday(): ISODate {
  const { tz } = useSettings();
  const [day, setDay] = useState(() => todayIn(tz));
  useEffect(() => {
    const check = () => setDay(todayIn(tz));
    check();
    const timer = setInterval(check, 30_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [tz]);
  return day;
}

export function useSyncStatus(): SyncStatus {
  const { sync } = useApp();
  return useSyncExternalStore(
    (cb) => sync.subscribe(cb),
    () => sync.status,
    () => sync.status,
  );
}
