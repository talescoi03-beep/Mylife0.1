// In-memory copy of the user's data, backed by IndexedDB.
// Every change is applied here first (so the UI updates instantly and works
// offline), saved on the device, and queued for upload to Supabase.
import { newId } from '../lib/ids';
import { DEFAULTS, TABLES, columnsOf, type Base, type Row, type TableName } from './schema';
import type { Persist, QueueEntry, WriteBatch } from './persist';

type Listener = () => void;
export type NewRow<T extends TableName> = Partial<Omit<Row<T>, 'user_id'>>;

export class Store {
  readonly userId: string;
  private persist: Persist;
  private tables = new Map<TableName, Map<string, any>>();
  readonly queue = new Map<string, QueueEntry>();
  meta: Record<string, any> = {};
  private seq = 0;
  private versions = new Map<TableName, number>();
  private listeners = new Set<Listener>();
  private writeChain: Promise<void> = Promise.resolve();
  private writeError: unknown = null;
  /** Keys whose upload is in progress; edits made meanwhile are re-queued. */
  readonly inflight = new Set<string>();
  readonly dirtyDuringFlight = new Set<string>();
  /** Called after every local change, used to schedule a sync. */
  onLocalChange: (() => void) | null = null;
  private cache = new Map<TableName, { v: number; rows: any[] }>();

  private constructor(userId: string, persist: Persist) {
    this.userId = userId;
    this.persist = persist;
    for (const t of TABLES) {
      this.tables.set(t, new Map());
      this.versions.set(t, 0);
    }
  }

  static async open(userId: string, persist: Persist): Promise<Store> {
    const s = new Store(userId, persist);
    const snap = await persist.load();
    for (const { t, id, row } of snap.rows) {
      if (s.tables.has(t) && row.user_id === userId) s.tables.get(t)!.set(id, row);
    }
    for (const q of snap.queue) {
      s.queue.set(q.key, q);
      s.seq = Math.max(s.seq, q.seq);
    }
    s.meta = snap.meta;
    return s;
  }

  // ---- reading -------------------------------------------------------------

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  version(t?: TableName): number {
    if (!t) {
      let sum = 0;
      for (const v of this.versions.values()) sum += v;
      return sum;
    }
    return this.versions.get(t)!;
  }

  private bump(t: TableName) {
    this.versions.set(t, this.versions.get(t)! + 1);
  }

  notify() {
    this.listeners.forEach((l) => l());
  }

  get<T extends TableName>(t: T, id: string | null | undefined): Row<T> | undefined {
    if (!id) return undefined;
    const r = this.tables.get(t)!.get(id);
    return r && !r.deleted_at ? r : undefined;
  }

  /** Includes soft-deleted rows. */
  raw<T extends TableName>(t: T, id: string): Row<T> | undefined {
    return this.tables.get(t)!.get(id);
  }

  /** All live (not deleted) rows of a table. The array is cached until the table changes. */
  all<T extends TableName>(t: T): Row<T>[] {
    const v = this.versions.get(t)!;
    const c = this.cache.get(t);
    if (c && c.v === v) return c.rows;
    const rows = [...this.tables.get(t)!.values()].filter((r) => !r.deleted_at);
    this.cache.set(t, { v, rows });
    return rows;
  }

  rawAll<T extends TableName>(t: T): Row<T>[] {
    return [...this.tables.get(t)!.values()];
  }

  pendingCount(): number {
    return this.queue.size;
  }

  failedEntries(): QueueEntry[] {
    return [...this.queue.values()].filter((q) => q.failed);
  }

  // ---- writing -------------------------------------------------------------

  private persistWrite(batch: WriteBatch) {
    this.writeChain = this.writeChain
      .then(() => this.persist.write(batch))
      .catch((e) => {
        this.writeError = e;
        console.error('Local save failed', e);
      });
    return this.writeChain;
  }

  /** Resolves when everything changed so far is stored on the device. */
  async flushWrites(): Promise<void> {
    await this.writeChain;
    if (this.writeError) {
      const e = this.writeError;
      this.writeError = null;
      throw e;
    }
  }

  private queueEntryFor(t: TableName, id: string): QueueEntry {
    const key = `${t}:${id}`;
    const existing = this.queue.get(key);
    if (existing && this.inflight.has(key)) {
      this.dirtyDuringFlight.add(key);
      return existing;
    }
    if (existing) {
      // Still waiting to upload: one upload will carry all the edits.
      if (existing.failed) {
        existing.failed = false;
        existing.attempts = 0;
        existing.last_error = null;
      }
      return existing;
    }
    const entry: QueueEntry = { key, table: t, id, op_id: newId(), seq: ++this.seq, attempts: 0 };
    this.queue.set(key, entry);
    return entry;
  }

  private sanitize<T extends TableName>(t: T, row: any): Row<T> {
    const out: any = {};
    for (const c of columnsOf(t)) out[c] = row[c] === undefined ? null : row[c];
    return out;
  }

  /** Creates a row with defaults. Pass `id` for deterministic ids. */
  create<T extends TableName>(t: T, values: NewRow<T>): Row<T> {
    const now = new Date().toISOString();
    const id = (values as any).id ?? newId();
    const existing = this.tables.get(t)!.get(id);
    const base: Base = {
      id,
      user_id: this.userId,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      rev: existing?.rev ?? 0,
      last_op: existing?.last_op ?? null,
      is_example: false,
    };
    const row = this.sanitize(t, { ...structuredClone(DEFAULTS[t]), ...base, ...values, id, user_id: this.userId, deleted_at: null, rev: base.rev });
    this.commit(t, [row]);
    return row;
  }

  /** Updates the live row with this id, or creates it (also revives a deleted one). */
  upsert<T extends TableName>(t: T, id: string, values: NewRow<T>): Row<T> {
    const cur = this.tables.get(t)!.get(id);
    if (cur && !cur.deleted_at) return this.update(t, id, values as Partial<Row<T>>)!;
    return this.create(t, { ...values, id } as NewRow<T>);
  }

  update<T extends TableName>(t: T, id: string, patch: Partial<Row<T>>): Row<T> | undefined {
    const cur = this.tables.get(t)!.get(id);
    if (!cur) return undefined;
    const { id: _i, user_id: _u, rev: _r, created_at: _c, last_op: _l, ...rest } = patch as any;
    const row = { ...cur, ...rest, updated_at: new Date().toISOString() };
    this.commit(t, [row]);
    return row;
  }

  /** Soft delete so the deletion reaches other devices. */
  remove(t: TableName, id: string) {
    const cur = this.tables.get(t)!.get(id);
    if (!cur || cur.deleted_at) return;
    this.commit(t, [{ ...cur, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }]);
  }

  /** Re-creates a soft-deleted row (used by undo). */
  restore(t: TableName, id: string) {
    const cur = this.tables.get(t)!.get(id);
    if (!cur || !cur.deleted_at) return;
    this.commit(t, [{ ...cur, deleted_at: null, updated_at: new Date().toISOString() }]);
  }

  private commit(t: TableName, rows: any[]) {
    const map = this.tables.get(t)!;
    const putQueue: QueueEntry[] = [];
    for (const r of rows) {
      map.set(r.id, r);
      putQueue.push(this.queueEntryFor(t, r.id));
    }
    this.bump(t);
    this.persistWrite({ putRows: rows.map((row) => ({ t, id: row.id, row })), putQueue });
    this.notify();
    this.onLocalChange?.();
  }

  /** Imports rows from a backup as local changes (they will upload). */
  importRows<T extends TableName>(t: T, rows: any[]) {
    if (!rows.length) return;
    const now = new Date().toISOString();
    const prepared = rows.map((r) => {
      const local = this.tables.get(t)!.get(r.id);
      return this.sanitize(t, {
        ...structuredClone(DEFAULTS[t]),
        ...r,
        user_id: this.userId,
        rev: local?.rev ?? 0,
        last_op: local?.last_op ?? null,
        deleted_at: null,
        updated_at: now,
        created_at: r.created_at ?? now,
      });
    });
    this.commit(t, prepared);
  }

  // ---- used by the sync engine --------------------------------------------

  /** Applies rows downloaded from the server, skipping rows with local unsent edits. */
  applyServerRows(t: TableName, rows: any[]): number {
    const map = this.tables.get(t)!;
    const putRows: { t: TableName; id: string; row: any }[] = [];
    const deleteRows: { t: TableName; id: string }[] = [];
    for (const r of rows) {
      if (r.user_id !== this.userId) continue;
      if (this.queue.has(`${t}:${r.id}`)) continue;
      const cur = map.get(r.id);
      if (cur && cur.rev === r.rev && cur.updated_at === r.updated_at && !!cur.deleted_at === !!r.deleted_at) continue;
      if (r.deleted_at) {
        if (cur) {
          map.delete(r.id);
          deleteRows.push({ t, id: r.id });
        }
      } else {
        const row = this.sanitize(t, r);
        map.set(r.id, row);
        putRows.push({ t, id: r.id, row });
      }
    }
    if (putRows.length || deleteRows.length) {
      this.bump(t);
      this.persistWrite({ putRows, deleteRows });
      this.notify();
    }
    return putRows.length + deleteRows.length;
  }

  /** Records that the server accepted our upload. Keeps any edits made meanwhile. */
  acknowledge(entry: QueueEntry, server: any) {
    const t = entry.table;
    const map = this.tables.get(t)!;
    const cur = map.get(entry.id);
    const key = entry.key;
    const batch: WriteBatch = {};
    if (cur) {
      const merged = { ...cur, rev: server.rev, created_at: server.created_at, last_op: server.last_op };
      if (!this.dirtyDuringFlight.has(key)) merged.updated_at = server.updated_at;
      if (merged.deleted_at && !this.dirtyDuringFlight.has(key)) {
        // Deletion confirmed by the server; drop the local tombstone.
        map.delete(entry.id);
        batch.deleteRows = [{ t, id: entry.id }];
      } else {
        map.set(entry.id, merged);
        batch.putRows = [{ t, id: entry.id, row: merged }];
      }
    }
    if (this.dirtyDuringFlight.has(key)) {
      this.dirtyDuringFlight.delete(key);
      entry.op_id = newId();
      entry.attempts = 0;
      batch.putQueue = [entry];
    } else {
      this.queue.delete(key);
      batch.deleteQueue = [key];
    }
    this.bump(t);
    this.persistWrite(batch);
    this.notify();
  }

  /** Replaces the local row with the server's version and drops the queued upload. */
  adoptServer(entry: QueueEntry, server: any | null) {
    const t = entry.table;
    const map = this.tables.get(t)!;
    const batch: WriteBatch = { deleteQueue: [entry.key] };
    this.queue.delete(entry.key);
    this.dirtyDuringFlight.delete(entry.key);
    if (server && !server.deleted_at) {
      const row = this.sanitize(t, server);
      map.set(entry.id, row);
      batch.putRows = [{ t, id: entry.id, row }];
    } else {
      map.delete(entry.id);
      batch.deleteRows = [{ t, id: entry.id }];
    }
    this.bump(t);
    this.persistWrite(batch);
    this.notify();
  }

  saveQueueEntry(entry: QueueEntry) {
    this.queue.set(entry.key, entry);
    this.persistWrite({ putQueue: [entry] });
    this.notify();
  }

  setMeta(values: Record<string, any>) {
    Object.assign(this.meta, values);
    this.persistWrite({ putMeta: values });
  }

  /** Removes every local row of this user (used after server-side data deletion). */
  async wipeLocal() {
    const deleteRows: { t: TableName; id: string }[] = [];
    for (const t of TABLES) {
      for (const id of this.tables.get(t)!.keys()) deleteRows.push({ t, id });
      this.tables.get(t)!.clear();
      this.bump(t);
    }
    const deleteQueue = [...this.queue.keys()];
    this.queue.clear();
    this.meta = {};
    await this.persistWrite({ deleteRows, deleteQueue, putMeta: { cursors: {}, initialPullDone: false } });
    this.notify();
  }

  close() {
    this.persist.close();
  }

  async destroy() {
    await this.writeChain;
    await this.persist.destroy();
  }
}
