// JSON backup / restore and CSV exports.
import { dayOf } from '../lib/dates';
import { newId, stableId } from '../lib/ids';
import { habitLogId } from '../logic/habits';
import { entryText } from '../logic/templates';
import { TABLES, columnsOf, type TableName } from './schema';
import type { Store } from './store';

export const BACKUP_FORMAT = 'my-life-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exported_at: string;
  user_id: string;
  tables: Partial<Record<TableName, any[]>>;
}

export function makeBackup(store: Store): Backup {
  const tables: Partial<Record<TableName, any[]>> = {};
  for (const t of TABLES) tables[t] = store.all(t).map((r) => ({ ...r }));
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exported_at: new Date().toISOString(), user_id: store.userId, tables };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBackup(text: string): { backup: Backup; counts: Record<string, number>; total: number } {
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  if (data?.format !== BACKUP_FORMAT || typeof data.tables !== 'object') throw new Error('This is not a My Life backup file.');
  if (data.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of My Life. Update the app first.');
  const counts: Record<string, number> = {};
  let total = 0;
  for (const [t, rows] of Object.entries(data.tables)) {
    if (!TABLES.includes(t as TableName)) continue; // ignore unknown tables
    if (!Array.isArray(rows)) throw new Error(`Backup section “${t}” is damaged.`);
    for (const r of rows) {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !UUID.test(r.id)) throw new Error(`A record in “${t}” has no valid id.`);
    }
    counts[t] = rows.length;
    total += rows.length;
  }
  return { backup: data as Backup, counts, total };
}

const REF_COLUMNS = (t: TableName) => columnsOf(t).filter((c) => c !== 'user_id' && c !== 'id' && (c.endsWith('_id') || c === 'conflict_of'));

/**
 * Restores a backup into the current account. Records are matched by id:
 * existing ones are replaced by the backup's version, new ones are added.
 * In "replace" mode everything not in the backup is deleted first.
 * A backup from a different account gets fresh ids (links between records are kept).
 */
export function restoreBackup(store: Store, backup: Backup, mode: 'merge' | 'replace'): number {
  const sameAccount = backup.user_id === store.userId;
  const idMap = new Map<string, string>();
  if (!sameAccount) {
    for (const t of TABLES) for (const r of backup.tables[t] ?? []) idMap.set(r.id, newId());
  }
  const mapId = (id: string | null | undefined) => (id && idMap.has(id) ? idMap.get(id)! : id ?? null);

  const prepared: Partial<Record<TableName, any[]>> = {};
  for (const t of TABLES) {
    const rows = (backup.tables[t] ?? []).map((r) => {
      const out: any = { ...r, id: mapId(r.id) };
      if (!sameAccount) for (const c of REF_COLUMNS(t)) if (out[c]) out[c] = mapId(out[c]);
      return out;
    });
    // Records whose id is derived from their content keep that rule after a restore.
    for (const r of rows) {
      if (t === 'settings') r.id = store.userId;
      if (t === 'habit_logs') r.id = habitLogId(r.habit_id, r.day);
      if (t === 'day_notes') r.id = stableId('day_note', store.userId, r.day);
      if (t === 'week_plans') r.id = stableId('week_plan', store.userId, r.week_start);
    }
    prepared[t] = t === 'settings' ? rows.slice(0, 1) : rows;
  }

  if (mode === 'replace') {
    for (const t of TABLES) {
      const keep = new Set((prepared[t] ?? []).map((r) => r.id));
      for (const r of store.all(t)) if (!keep.has(r.id)) store.remove(t, r.id);
    }
  }
  let n = 0;
  for (const t of TABLES) {
    const rows = prepared[t] ?? [];
    store.importRows(t, rows);
    n += rows.length;
  }
  return n;
}

// ---------- CSV ----------

function cell(v: unknown): string {
  if (v == null) return '';
  let s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Stop spreadsheet apps from running cell contents as formulas.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export type CsvKind = 'tasks' | 'habits' | 'journal' | 'money' | 'goals' | 'learning' | 'wins';

export function buildCsv(store: Store, kind: CsvKind, tz: string): string {
  const area = new Map(store.all('areas').map((a) => [a.id, a.name]));
  const goal = new Map(store.all('goals').map((g) => [g.id, g.title]));
  switch (kind) {
    case 'tasks':
      return toCsv(['title', 'status', 'due_date', 'due_time', 'completed_on', 'priority', 'life_area', 'goal', 'tags', 'estimate_min', 'archived', 'notes'],
        store.all('tasks').map((t) => [t.title, t.status, t.due_date, t.due_time, t.completed_at ? dayOf(t.completed_at, tz) : '', t.priority, area.get(t.area_id ?? ''), goal.get(t.goal_id ?? ''), t.tags, t.estimate_min, t.archived, t.notes]));
    case 'habits': {
      const habit = new Map(store.all('habits').map((h) => [h.id, h]));
      return toCsv(['date', 'habit', 'status', 'value', 'unit', 'note'],
        store.all('habit_logs').sort((a, b) => a.day.localeCompare(b.day)).map((l) => [l.day, habit.get(l.habit_id)?.title ?? '(deleted habit)', l.status, l.value, habit.get(l.habit_id)?.unit, l.note]));
    }
    case 'journal':
      return toCsv(['date', 'type', 'title', 'text'],
        store.all('journal_entries').sort((a, b) => a.day.localeCompare(b.day)).map((e) => [e.day, e.kind, e.title, entryText(e)]));
    case 'money':
      return toCsv(['date', 'type', 'amount', 'currency', 'category', 'note'],
        store.all('money_entries').sort((a, b) => a.day.localeCompare(b.day)).map((m) => [m.day, m.kind, m.amount, m.currency, m.category, m.note]));
    case 'goals':
      return toCsv(['title', 'category', 'horizon', 'status', 'life_area', 'target_date', 'progress_method', 'current', 'target', 'unit', 'manual_%', 'why', 'who_benefits', 'become', 'next_action', 'celebration', 'completed_on'],
        store.all('goals').map((g) => [g.title, g.category, g.horizon, g.status, area.get(g.area_id ?? ''), g.target_date, g.progress_mode, g.current_value, g.target_value, g.unit, g.manual_progress, g.why, g.who_benefits, g.become, g.next_action, g.celebration, g.completed_at ? dayOf(g.completed_at, tz) : '']));
    case 'learning':
      return toCsv(['title', 'kind', 'by', 'status', 'progress', 'total', 'unit', 'key_ideas', 'application', 'notes', 'finished_on'],
        store.all('learning_items').map((i) => [i.title, i.kind, i.creator, i.status, i.progress_current, i.progress_total, i.progress_unit, i.key_ideas, i.application, i.notes, i.finished_on]));
    case 'wins':
      return toCsv(['date', 'win', 'kind', 'life_area', 'goal', 'note'],
        store.all('wins').sort((a, b) => a.day.localeCompare(b.day)).map((w) => [w.day, w.title, w.kind, area.get(w.area_id ?? ''), goal.get(w.goal_id ?? ''), w.note]));
  }
}
