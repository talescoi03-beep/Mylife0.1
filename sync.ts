// Sync engine: uploads queued local changes, then downloads changes made on
// other devices. Safe to run any number of times:
//  * each queued change carries an operation id (last_op) — if a retry finds
//    the server already has that operation, it is treated as done, never
//    applied twice;
//  * most tables use "last write wins" via upsert on the row id;
//  * journal entries and ideas are only overwritten if nobody else changed them
//    since this device last saw them; otherwise both versions are kept.
// iPhone does not run web apps in the background, so sync runs when the app
// opens, comes back to the foreground, regains connectivity, or after a change.
import { newId } from '../lib/ids';
import { ApiError, AuthExpiredError, NetworkError, pgValue, type SupabaseClient } from '../lib/supa';
import { PRESERVE_ON_CONFLICT, TABLES, columnsOf, type TableName } from './schema';
import type { QueueEntry } from './persist';
import type { Store } from './store';

export interface Remote {
  insert(t: TableName, row: any): Promise<any>;
  upsert(t: TableName, row: any): Promise<any>;
  /** Updates only if the server row still has `rev`; returns null when it does not. */
  updateIfRev(t: TableName, id: string, rev: number, row: any): Promise<any | null>;
  getById(t: TableName, id: string): Promise<any | null>;
  pull(t: TableName, since: string | null, offset: number, limit: number): Promise<any[]>;
}

export function supabaseRemote(client: SupabaseClient): Remote {
  const one = (rows: any[] | null) => (rows && rows.length ? rows[0] : null);
  return {
    async insert(t, row) {
      return one(await client.rest('POST', t, { body: row, prefer: 'return=representation' }));
    },
    async upsert(t, row) {
      return one(await client.rest('POST', `${t}?on_conflict=id`, {
        body: row, prefer: 'resolution=merge-duplicates,return=representation',
      }));
    },
    async updateIfRev(t, id, rev, row) {
      return one(await client.rest('PATCH', `${t}?id=eq.${pgValue(id)}&rev=eq.${rev}`, {
        body: row, prefer: 'return=representation',
      }));
    },
    async getById(t, id) {
      return one(await client.rest('GET', `${t}?select=*&id=eq.${pgValue(id)}`));
    },
    async pull(t, since, offset, limit) {
      const filter = since ? `&updated_at=gt.${pgValue(since)}` : '';
      return client.rest('GET', `${t}?select=*${filter}&order=updated_at.asc,id.asc&limit=${limit}&offset=${offset}`);
    },
  };
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'unavailable' | 'signin' | 'error';
export interface SyncStatus {
  state: SyncState;
  pending: number;
  failed: number;
  lastSyncedAt: string | null;
  message: string | null;
}

export interface ConflictEvent { table: TableName; id: string; copyId: string }

const PULL_PAGE = 500;
const PULL_OVERLAP_MS = 2 * 60 * 1000;
const BACKOFF = [5_000, 15_000, 60_000, 5 * 60_000];

/** Fields compared to decide whether two versions of precious text actually differ. */
const CONTENT_FIELDS: Partial<Record<TableName, string[]>> = {
  journal_entries: ['day', 'kind', 'title', 'body', 'answers', 'season', 'tags', 'deleted_at'],
  ideas: ['title', 'body', 'tags', 'pinned', 'learning_id', 'area_id', 'deleted_at'],
};

/** Parses Postgres timestamps (which may have microseconds) on every browser. */
export function parseTimestamp(ts: string): number {
  const m = ts.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/);
  if (!m) return Date.parse(ts);
  const frac = (m[3] ?? '.000').slice(0, 4).padEnd(4, '0');
  let tz = m[4] ?? 'Z';
  if (/^[+-]\d{2}$/.test(tz)) tz += ':00';
  if (/^[+-]\d{4}$/.test(tz)) tz = tz.slice(0, 3) + ':' + tz.slice(3);
  return Date.parse(`${m[1]}T${m[2]}${frac}${tz}`);
}

function sameContent(t: TableName, a: any, b: any): boolean {
  const fields = CONTENT_FIELDS[t] ?? columnsOf(t);
  return fields.every((f) => JSON.stringify(a?.[f] ?? null) === JSON.stringify(b?.[f] ?? null));
}

export class SyncEngine {
  private store: Store;
  private remote: Remote;
  private running: Promise<void> | null = null;
  private again = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private soonTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: SyncStatus) => void>();
  onConflict: ((e: ConflictEvent) => void) | null = null;
  status: SyncStatus;

  constructor(store: Store, remote: Remote) {
    this.store = store;
    this.remote = remote;
    this.status = {
      state: 'idle',
      pending: store.pendingCount(),
      failed: store.failedEntries().length,
      lastSyncedAt: store.meta.lastSyncedAt ?? null,
      message: null,
    };
  }

  subscribe(fn: (s: SyncStatus) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(p: Partial<SyncStatus>) {
    this.status = {
      ...this.status,
      ...p,
      pending: this.store.pendingCount(),
      failed: this.store.failedEntries().length,
    };
    this.listeners.forEach((l) => l(this.status));
  }

  /** Refreshes counts after a local change and schedules a sync shortly. */
  localChanged() {
    this.set({});
    if (this.soonTimer) clearTimeout(this.soonTimer);
    this.soonTimer = setTimeout(() => void this.syncNow(), 1200);
  }

  dispose() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.soonTimer) clearTimeout(this.soonTimer);
    this.listeners.clear();
  }

  /** Runs one full sync. Concurrent calls share the run (and trigger one more pass). */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.runOnce();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async runOnce() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.set({ state: 'syncing', message: null });
    try {
      await this.push();
      await this.pull();
      await this.store.flushWrites();
      this.failures = 0;
      const now = new Date().toISOString();
      this.store.setMeta({ lastSyncedAt: now });
      const failed = this.store.failedEntries().length;
      this.set({
        state: failed ? 'error' : 'idle',
        lastSyncedAt: now,
        message: failed ? `${failed} change${failed > 1 ? 's' : ''} could not be saved to your account.` : null,
      });
    } catch (e) {
      this.handleError(e);
    }
  }

  private handleError(e: unknown) {
    if (e instanceof AuthExpiredError) {
      this.set({ state: 'signin', message: 'Sign in again to sync. Your changes are kept on this device.' });
      return;
    }
    if (e instanceof NetworkError) {
      this.set({ state: 'offline', message: 'Offline. Changes are saved on this device and will sync when you reconnect.' });
    } else if (e instanceof ApiError && e.transient) {
      this.set({
        state: 'unavailable',
        message: 'The database is not responding (it may be waking up). Changes are saved on this device.',
      });
    } else {
      this.set({ state: 'error', message: e instanceof Error ? e.message : 'Sync failed' });
    }
    const delay = BACKOFF[Math.min(this.failures, BACKOFF.length - 1)];
    this.failures++;
    this.retryTimer = setTimeout(() => void this.syncNow(), delay);
  }

  /** Drops a refused local change and replaces it with the account's version. */
  async discard(entry: QueueEntry): Promise<void> {
    const server = await this.remote.getById(entry.table, entry.id);
    this.store.adoptServer(entry, server);
    this.set({});
  }

  // ---- upload ---------------------------------------------------------------

  private async push() {
    const entries = [...this.store.queue.values()].filter((q) => !q.failed).sort((a, b) => a.seq - b.seq);
    for (const entry of entries) {
      if (!this.store.queue.has(entry.key)) continue;
      await this.pushOne(entry);
    }
  }

  private async pushOne(entry: QueueEntry) {
    const { table: t, id, key } = entry;
    const row = this.store.raw(t, id);
    if (!row || (row.deleted_at && row.rev === 0)) {
      // Never reached the server and is now gone: nothing to upload.
      this.store.adoptServer(entry, null);
      return;
    }
    const payload: any = {};
    for (const c of columnsOf(t)) payload[c] = (row as any)[c];
    payload.rev = row.rev + 1;
    payload.last_op = entry.op_id;
    delete payload.updated_at; // set by the server

    this.store.inflight.add(key);
    try {
      if (PRESERVE_ON_CONFLICT.includes(t)) {
        if (row.rev === 0) {
          try {
            this.store.acknowledge(entry, await this.remote.insert(t, payload));
          } catch (e) {
            if (e instanceof ApiError && e.status === 409) await this.resolveConflict(entry, row, payload);
            else throw e;
          }
        } else {
          const updated = await this.remote.updateIfRev(t, id, row.rev, payload);
          if (updated) this.store.acknowledge(entry, updated);
          else await this.resolveConflict(entry, row, payload);
        }
      } else {
        this.store.acknowledge(entry, await this.remote.upsert(t, payload));
      }
    } catch (e) {
      entry.attempts++;
      if (e instanceof ApiError && !e.transient && e.status !== 401) {
        // The server refused this change (e.g. invalid value). Keep it and show it to the user.
        entry.failed = true;
        entry.last_error = e.message;
        this.store.saveQueueEntry(entry);
        return;
      }
      this.store.saveQueueEntry(entry);
      throw e;
    } finally {
      this.store.inflight.delete(key);
    }
  }

  private async resolveConflict(entry: QueueEntry, local: any, payload: any) {
    const t = entry.table;
    const server = await this.remote.getById(t, entry.id);
    if (!server) {
      this.store.acknowledge(entry, await this.remote.upsert(t, payload));
      return;
    }
    if (server.last_op === entry.op_id || sameContent(t, server, local)) {
      // Our earlier attempt already landed, or both sides say the same thing.
      this.store.acknowledge(entry, server);
      return;
    }
    // Someone else changed this text since we last synced: keep both versions.
    const { id: _id, rev: _rev, last_op: _op, created_at: _c, updated_at: _u, ...content } = local;
    const copy = this.store.create(t, { ...content, id: newId(), conflict_of: entry.id, deleted_at: null } as any);
    this.store.adoptServer(entry, server);
    this.onConflict?.({ table: t, id: entry.id, copyId: copy.id });
  }

  // ---- download -------------------------------------------------------------

  private async pull() {
    const cursors: Record<string, string> = { ...(this.store.meta.cursors ?? {}) };
    const queue = [...TABLES];
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift()!;
        cursors[t] = await this.pullTable(t, cursors[t] ?? null);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    this.store.setMeta({ cursors, initialPullDone: true });
  }

  private async pullTable(t: TableName, cursor: string | null): Promise<string> {
    const since = cursor ? new Date(parseTimestamp(cursor) - PULL_OVERLAP_MS).toISOString() : null;
    let offset = 0;
    let max = cursor;
    for (;;) {
      const rows = await this.remote.pull(t, since, offset, PULL_PAGE);
      this.store.applyServerRows(t, rows);
      for (const r of rows) if (!max || r.updated_at > max) max = r.updated_at;
      if (rows.length < PULL_PAGE) break;
      offset += rows.length;
    }
    return max ?? '';
  }
}
