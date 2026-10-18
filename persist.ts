// Durable on-device storage. Each signed-in user gets their own IndexedDB
// database, so one person's cached data is never visible to another account
// on the same phone. Rows and their pending sync operations are written in the
// same transaction: a change is never stored without its queue entry.
import type { TableName } from './schema';

export interface QueueEntry {
  key: string; // `${table}:${id}`
  table: TableName;
  id: string;
  op_id: string; // unique per attempt-chain; lets the server recognise a retry
  seq: number; // order of first change
  attempts: number;
  failed?: boolean; // permanent error; needs the user's attention
  last_error?: string | null;
}

export interface StoredRow { t: TableName; id: string; row: any }

export interface Snapshot {
  rows: StoredRow[];
  queue: QueueEntry[];
  meta: Record<string, any>;
}

export interface WriteBatch {
  putRows?: StoredRow[];
  deleteRows?: { t: TableName; id: string }[];
  putQueue?: QueueEntry[];
  deleteQueue?: string[];
  putMeta?: Record<string, any>;
}

export interface Persist {
  load(): Promise<Snapshot>;
  write(batch: WriteBatch): Promise<void>;
  close(): void;
  destroy(): Promise<void>;
}

export function dbNameFor(userId: string) {
  return `mylife-${userId}`;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function openIndexedDb(userId: string): Promise<Persist> {
  const name = dbNameFor(userId);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      const d = open.result;
      if (!d.objectStoreNames.contains('rows')) d.createObjectStore('rows', { keyPath: ['t', 'id'] });
      if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('Local database is open in another tab. Close other tabs and reload.'));
  });

  return {
    async load() {
      const tx = db.transaction(['rows', 'queue', 'meta'], 'readonly');
      const [rows, queue, meta] = await Promise.all([
        req(tx.objectStore('rows').getAll()),
        req(tx.objectStore('queue').getAll()),
        req(tx.objectStore('meta').getAll()),
      ]);
      const m: Record<string, any> = {};
      for (const x of meta as { k: string; v: any }[]) m[x.k] = x.v;
      return { rows: rows as StoredRow[], queue: queue as QueueEntry[], meta: m };
    },
    write(batch) {
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['rows', 'queue', 'meta'], 'readwrite');
        const rows = tx.objectStore('rows');
        const queue = tx.objectStore('queue');
        const meta = tx.objectStore('meta');
        batch.putRows?.forEach((r) => rows.put(r));
        batch.deleteRows?.forEach((r) => rows.delete([r.t, r.id]));
        batch.putQueue?.forEach((q) => queue.put(q));
        batch.deleteQueue?.forEach((k) => queue.delete(k));
        if (batch.putMeta) for (const [k, v] of Object.entries(batch.putMeta)) meta.put({ k, v });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Local save was aborted'));
      });
    },
    close() { db.close(); },
    async destroy() {
      db.close();
      await new Promise<void>((resolve, reject) => {
        const d = indexedDB.deleteDatabase(name);
        d.onsuccess = () => resolve();
        d.onerror = () => reject(d.error);
        d.onblocked = () => resolve(); // deletion completes once other tabs close
      });
    },
  };
}

/** In-memory implementation used by tests. */
export function memoryPersist(initial?: Snapshot): Persist & { snapshot(): Snapshot } {
  const rows = new Map<string, StoredRow>();
  const queue = new Map<string, QueueEntry>();
  const meta: Record<string, any> = {};
  initial?.rows.forEach((r) => rows.set(`${r.t}:${r.id}`, structuredClone(r)));
  initial?.queue.forEach((q) => queue.set(q.key, structuredClone(q)));
  Object.assign(meta, structuredClone(initial?.meta ?? {}));
  const snapshot = (): Snapshot => ({
    rows: structuredClone([...rows.values()]),
    queue: structuredClone([...queue.values()]),
    meta: structuredClone(meta),
  });
  return {
    async load() { return snapshot(); },
    async write(b) {
      b.putRows?.forEach((r) => rows.set(`${r.t}:${r.id}`, structuredClone(r)));
      b.deleteRows?.forEach((r) => rows.delete(`${r.t}:${r.id}`));
      b.putQueue?.forEach((q) => queue.set(q.key, structuredClone(q)));
      b.deleteQueue?.forEach((k) => queue.delete(k));
      if (b.putMeta) Object.assign(meta, structuredClone(b.putMeta));
    },
    close() {},
    async destroy() { rows.clear(); queue.clear(); for (const k of Object.keys(meta)) delete meta[k]; },
    snapshot,
  };
}
