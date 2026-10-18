import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryPersist } from '../src/data/persist';
import { Store } from '../src/data/store';
import { SyncEngine, type Remote } from '../src/data/sync';
import { ApiError, NetworkError } from '../src/lib/supa';
import type { TableName } from '../src/data/schema';
import { habitLogId } from '../src/logic/habits';

const USER = '11111111-1111-4111-8111-111111111111';

/** In-memory imitation of the Supabase REST behaviour the sync engine relies on. */
class FakeServer implements Remote {
  rows = new Map<string, any>(); // `${t}:${id}`
  clock = Date.parse('2026-10-18T00:00:00Z');
  offline = false;
  /** Apply the next write but lose the response (like a dropped connection). */
  loseNextResponse = false;
  writes = 0;
  unavailable = false;

  private ts() { this.clock += 1000; return new Date(this.clock).toISOString(); }
  private check() {
    if (this.offline) throw new NetworkError();
    if (this.unavailable) throw new ApiError(503, 'Service unavailable');
  }
  private afterWrite<T>(v: T): T {
    this.writes++;
    if (this.loseNextResponse) { this.loseNextResponse = false; throw new NetworkError(); }
    return structuredClone(v);
  }
  private save(t: string, row: any) {
    const k = `${t}:${row.id}`;
    const prev = this.rows.get(k);
    const saved = { ...row, created_at: prev?.created_at ?? row.created_at ?? this.ts(), updated_at: this.ts() };
    this.rows.set(k, saved);
    return saved;
  }
  async insert(t: TableName, row: any) {
    this.check();
    if (this.rows.has(`${t}:${row.id}`)) throw new ApiError(409, 'duplicate key value', '23505');
    return this.afterWrite(this.save(t, row));
  }
  async upsert(t: TableName, row: any) {
    this.check();
    return this.afterWrite(this.save(t, row));
  }
  async updateIfRev(t: TableName, id: string, rev: number, row: any) {
    this.check();
    const cur = this.rows.get(`${t}:${id}`);
    if (!cur || cur.rev !== rev) return null;
    return this.afterWrite(this.save(t, { ...cur, ...row }));
  }
  async getById(t: TableName, id: string) {
    this.check();
    const r = this.rows.get(`${t}:${id}`);
    return r ? structuredClone(r) : null;
  }
  async pull(t: TableName, since: string | null, offset: number, limit: number) {
    this.check();
    return [...this.rows.entries()]
      .filter(([k, r]) => k.startsWith(t + ':') && (!since || r.updated_at > since))
      .map(([, r]) => structuredClone(r))
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
      .slice(offset, offset + limit);
  }
  count(t: string) { return [...this.rows.keys()].filter((k) => k.startsWith(t + ':')).length; }
}

async function device(server: FakeServer) {
  const persist = memoryPersist();
  const store = await Store.open(USER, persist);
  const sync = new SyncEngine(store, server);
  return { store, sync, persist };
}

test('offline changes are kept locally and sync after reconnecting', async () => {
  const server = new FakeServer();
  const { store, sync, persist } = await device(server);
  server.offline = true;
  const task = store.create('tasks', { title: 'Call the bank' });
  store.create('journal_entries', { day: '2026-10-18', body: 'Written offline' });
  await sync.syncNow();
  assert.equal(sync.status.state, 'offline');
  assert.equal(store.pendingCount(), 2);
  await store.flushWrites();
  // Stored durably with its queue entry.
  assert.equal(persist.snapshot().queue.length, 2);

  // App restarts while still offline: data and queue come back.
  const store2 = await Store.open(USER, persist);
  assert.equal(store2.get('tasks', task.id)?.title, 'Call the bank');
  assert.equal(store2.pendingCount(), 2);

  server.offline = false;
  const sync2 = new SyncEngine(store2, server);
  await sync2.syncNow();
  assert.equal(sync2.status.state, 'idle');
  assert.equal(store2.pendingCount(), 0);
  assert.equal(server.count('tasks'), 1);
  assert.equal(server.count('journal_entries'), 1);
  assert.equal(store2.get('tasks', task.id)?.rev, 1);
});

test('a retried upload whose first response was lost is not applied twice', async () => {
  const server = new FakeServer();
  const { store, sync } = await device(server);
  const entry = store.create('journal_entries', { day: '2026-10-18', body: 'Once' });
  server.loseNextResponse = true;
  await sync.syncNow();
  assert.equal(sync.status.state, 'offline');
  assert.equal(server.count('journal_entries'), 1); // landed on the server
  await sync.syncNow(); // retry: insert hits duplicate, sees its own op id
  assert.equal(server.count('journal_entries'), 1);
  assert.equal(store.pendingCount(), 0);
  assert.equal(store.all('journal_entries').length, 1, 'no conflict copy for our own retry');
  assert.equal(store.get('journal_entries', entry.id)!.rev, 1);
});

test('completing the same habit twice (two devices) stores one check-in', async () => {
  const server = new FakeServer();
  const a = await device(server);
  const b = await device(server);
  const id = habitLogId('habit-1', '2026-10-18');
  a.store.upsert('habit_logs', id, { habit_id: 'habit-1', day: '2026-10-18', status: 'done' });
  b.store.upsert('habit_logs', id, { habit_id: 'habit-1', day: '2026-10-18', status: 'done' });
  await a.sync.syncNow();
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(server.count('habit_logs'), 1);
  assert.equal(a.store.all('habit_logs').length, 1);
  assert.equal(b.store.all('habit_logs').length, 1);
});

test('conflicting journal edits keep both versions', async () => {
  const server = new FakeServer();
  const a = await device(server);
  const b = await device(server);
  const e = a.store.create('journal_entries', { day: '2026-10-18', body: 'Original' });
  await a.sync.syncNow();
  await b.sync.syncNow();
  assert.equal(b.store.get('journal_entries', e.id)?.body, 'Original');

  const conflicts: string[] = [];
  b.sync.onConflict = (c) => conflicts.push(c.copyId);
  a.store.update('journal_entries', e.id, { body: 'Edited on phone' });
  b.store.update('journal_entries', e.id, { body: 'Edited on laptop' });
  await a.sync.syncNow();
  await b.sync.syncNow();

  assert.equal(conflicts.length, 1);
  const bodies = b.store.all('journal_entries').map((x) => x.body).sort();
  assert.deepEqual(bodies, ['Edited on laptop', 'Edited on phone']);
  const copy = b.store.get('journal_entries', conflicts[0])!;
  assert.equal(copy.conflict_of, e.id);
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.deepEqual(a.store.all('journal_entries').map((x) => x.body).sort(), ['Edited on laptop', 'Edited on phone']);
  assert.equal(server.count('journal_entries'), 2);
});

test('identical edits on two devices do not create a conflict copy', async () => {
  const server = new FakeServer();
  const a = await device(server);
  const b = await device(server);
  const e = a.store.create('ideas', { body: 'idea' });
  await a.sync.syncNow();
  await b.sync.syncNow();
  a.store.update('ideas', e.id, { body: 'same text' });
  b.store.update('ideas', e.id, { body: 'same text' });
  await a.sync.syncNow();
  await b.sync.syncNow();
  assert.equal(b.store.all('ideas').length, 1);
});

test('edits made while an upload is in flight are not lost', async () => {
  const server = new FakeServer();
  const { store, sync } = await device(server);
  const t = store.create('tasks', { title: 'v1' });
  const orig = server.upsert.bind(server);
  server.upsert = async (tb, row) => {
    store.update('tasks', t.id, { title: 'v2' }); // user types during the request
    server.upsert = orig;
    return orig(tb, row);
  };
  await sync.syncNow();
  assert.equal(store.get('tasks', t.id)!.title, 'v2');
  await sync.syncNow();
  assert.equal(store.pendingCount(), 0);
  assert.equal((await server.getById('tasks', t.id)).title, 'v2');
});

test('deletions sync to other devices; server outage keeps data local', async () => {
  const server = new FakeServer();
  const a = await device(server);
  const b = await device(server);
  const t = a.store.create('tasks', { title: 'temp' });
  await a.sync.syncNow();
  await b.sync.syncNow();
  assert.ok(b.store.get('tasks', t.id));
  a.store.remove('tasks', t.id);
  server.unavailable = true;
  await a.sync.syncNow();
  assert.equal(a.sync.status.state, 'unavailable');
  assert.equal(a.store.pendingCount(), 1);
  server.unavailable = false;
  await a.sync.syncNow();
  await b.sync.syncNow();
  assert.equal(b.store.get('tasks', t.id), undefined);
});

test('a change the server rejects is kept and reported, others still sync', async () => {
  const server = new FakeServer();
  const { store, sync } = await device(server);
  const bad = store.create('tasks', { title: 'bad' });
  store.create('tasks', { title: 'good' });
  const orig = server.upsert.bind(server);
  server.upsert = async (t, row) => {
    if (row.id === bad.id) throw new ApiError(400, 'invalid input value');
    return orig(t, row);
  };
  await sync.syncNow();
  assert.equal(sync.status.state, 'error');
  assert.equal(sync.status.failed, 1);
  assert.equal(server.count('tasks'), 1);
  assert.ok(store.get('tasks', bad.id), 'rejected change still on the device');
});
