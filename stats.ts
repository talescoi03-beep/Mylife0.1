// Numbers for the Progress screen, computed only from what you recorded.
import { addDays, dayOf, startOfMonth, startOfWeek, type ISODate } from '../lib/dates';
import type { Habit, HabitLog, LearningSession, Task, Win } from '../data/schema';
import { consistency, indexLogs, isCompletion } from './habits';

export interface Bucket { key: ISODate; label: string; value: number }

export function weekBuckets(today: ISODate, weeks: number, weekStartsOn: number): { start: ISODate; end: ISODate }[] {
  const cur = startOfWeek(today, weekStartsOn);
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(cur, -7 * (weeks - 1 - i));
    return { start, end: addDays(start, 6) };
  });
}

export function monthBuckets(today: ISODate, months: number): { start: ISODate; end: ISODate }[] {
  const out: { start: ISODate; end: ISODate }[] = [];
  let m = startOfMonth(today);
  for (let i = 0; i < months; i++) {
    const start = m;
    const next = startOfMonth(addDays(start, 32));
    out.unshift({ start, end: addDays(next, -1) });
    m = startOfMonth(addDays(start, -1));
  }
  return out;
}

const shortLabel = (d: ISODate) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
const monthShort = (d: ISODate) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(d.slice(5, 7)) - 1];

export function bucketsFor(range: 'weeks4' | 'weeks12' | 'months12', today: ISODate, weekStartsOn: number) {
  if (range === 'months12') return monthBuckets(today, 12).map((b) => ({ ...b, label: monthShort(b.start) }));
  return weekBuckets(today, range === 'weeks4' ? 4 : 12, weekStartsOn).map((b) => ({ ...b, label: shortLabel(b.start) }));
}

export function tasksCompleted(tasks: Task[], buckets: { start: ISODate; end: ISODate; label: string }[], tz: string): Bucket[] {
  const days = tasks.filter((t) => t.status === 'done' && t.completed_at).map((t) => dayOf(t.completed_at!, tz));
  return buckets.map((b) => ({ key: b.start, label: b.label, value: days.filter((d) => d >= b.start && d <= b.end).length }));
}

export function learningMinutes(sessions: LearningSession[], buckets: { start: ISODate; end: ISODate; label: string }[]): Bucket[] {
  return buckets.map((b) => ({ key: b.start, label: b.label, value: sessions.filter((s) => s.day >= b.start && s.day <= b.end).reduce((n, s) => n + (s.minutes ?? 0), 0) }));
}

export function winsPer(wins: Win[], buckets: { start: ISODate; end: ISODate; label: string }[]): Bucket[] {
  return buckets.map((b) => ({ key: b.start, label: b.label, value: wins.filter((w) => w.day >= b.start && w.day <= b.end).length }));
}

/** Overall habit consistency per bucket: completed ÷ scheduled across all habits. */
export function habitConsistency(habits: Habit[], logs: HabitLog[], buckets: { start: ISODate; end: ISODate; label: string }[], today: ISODate): (Bucket & { done: number; possible: number })[] {
  const idx = indexLogs(logs);
  return buckets.map((b) => {
    let done = 0;
    let possible = 0;
    for (const h of habits) {
      const c = consistency(h, idx, b.start, b.end, today);
      done += c.done;
      possible += c.possible;
    }
    return { key: b.start, label: b.label, value: possible > 0 ? Math.round((done / possible) * 100) : 0, done, possible: Math.round(possible * 10) / 10 };
  });
}

/** Completed tasks + habit check-ins + learning sessions per life area. */
export function activityByArea(opts: { tasks: Task[]; logs: HabitLog[]; habits: Habit[]; sessions: LearningSession[]; learningArea: Map<string, string | null>; from: ISODate; to: ISODate; tz: string }) {
  const counts = new Map<string, { tasks: number; habits: number; learning: number }>();
  const get = (a: string | null | undefined) => {
    const k = a ?? '';
    if (!counts.has(k)) counts.set(k, { tasks: 0, habits: 0, learning: 0 });
    return counts.get(k)!;
  };
  for (const t of opts.tasks) {
    if (t.status !== 'done' || !t.completed_at) continue;
    const d = dayOf(t.completed_at, opts.tz);
    if (d >= opts.from && d <= opts.to) get(t.area_id).tasks++;
  }
  const habitById = new Map(opts.habits.map((h) => [h.id, h]));
  for (const l of opts.logs) {
    const h = habitById.get(l.habit_id);
    if (h && l.day >= opts.from && l.day <= opts.to && isCompletion(l, h)) get(h.area_id).habits++;
  }
  for (const s of opts.sessions) if (s.day >= opts.from && s.day <= opts.to) get(opts.learningArea.get(s.learning_id) ?? null).learning++;
  return counts;
}
