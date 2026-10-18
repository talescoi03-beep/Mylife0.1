// Habit scheduling, streaks and consistency.
// Rules (shown to the user in the app):
//  * A habit only counts on days it is scheduled, from its start date.
//  * Paused periods and planned rest days are neutral: they neither count
//    against you nor break a streak.
//  * The "minimum version" counts as showing up.
//  * Today never breaks a streak — the day is not over yet.
import { addDays, diffDays, startOfWeek, weekday, type ISODate } from '../lib/dates';
import { stableId } from '../lib/ids';
import type { Habit, HabitLog } from '../data/schema';

export type DayState = 'done' | 'minimum' | 'rest' | 'paused' | 'unscheduled' | 'missed' | 'open' | 'before-start';

export function habitLogId(habitId: string, day: ISODate) {
  return stableId('habit_log', habitId, day);
}

export function isPaused(h: Habit, day: ISODate): boolean {
  return (h.pauses ?? []).some((p) => day >= p.from && (!p.to || day <= p.to));
}

export function isScheduled(h: Habit, day: ISODate): boolean {
  if (day < h.start_date) return false;
  if (h.schedule === 'weekdays') return (h.weekdays ?? []).includes(weekday(day));
  return true; // daily, or any day counts toward a weekly target
}

export function isCompletion(log: HabitLog | undefined, h: Habit): boolean {
  if (!log) return false;
  if (log.status === 'minimum') return true;
  if (log.status !== 'done') return false;
  if (h.kind === 'measure' && h.daily_target != null && log.value != null) return log.value >= h.daily_target;
  return true;
}

export type LogIndex = Map<string, HabitLog>; // key `${habit_id}|${day}`
export function indexLogs(logs: HabitLog[]): LogIndex {
  const m: LogIndex = new Map();
  for (const l of logs) m.set(`${l.habit_id}|${l.day}`, l);
  return m;
}
const logOf = (idx: LogIndex, h: Habit, d: ISODate) => idx.get(`${h.id}|${d}`);

export function dayState(h: Habit, idx: LogIndex, day: ISODate, today: ISODate): DayState {
  if (day < h.start_date) return 'before-start';
  const log = logOf(idx, h, day);
  if (log && isCompletion(log, h)) return log.status === 'minimum' ? 'minimum' : 'done';
  if (log?.status === 'rest') return 'rest';
  if (isPaused(h, day)) return 'paused';
  if (!isScheduled(h, day)) return 'unscheduled';
  if (h.schedule === 'weekly') return day >= today ? 'open' : 'unscheduled';
  if (day >= today) return 'open';
  return 'missed';
}

function weekCount(h: Habit, idx: LogIndex, weekStart: ISODate): { done: number; activeDays: number } {
  let done = 0;
  let activeDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    if (d < h.start_date) continue;
    const log = logOf(idx, h, d);
    if (isCompletion(log, h)) done++;
    if (!isPaused(h, d) && log?.status !== 'rest') activeDays++;
  }
  return { done, activeDays };
}

/** Whether the habit should appear in today's list. */
export function dueOn(h: Habit, idx: LogIndex, day: ISODate, weekStartsOn: number): boolean {
  if (h.archived || isPaused(h, day) || day < h.start_date) return false;
  if (h.schedule === 'weekly') {
    const { done } = weekCount(h, idx, startOfWeek(day, weekStartsOn));
    return done < (h.weekly_target ?? 1) || isCompletion(logOf(idx, h, day), h);
  }
  return isScheduled(h, day);
}

/** Current streak in days (daily / weekday habits) or weeks (weekly-target habits). */
export function currentStreak(h: Habit, idx: LogIndex, today: ISODate, weekStartsOn: number): { count: number; unit: 'day' | 'week' } {
  if (h.schedule === 'weekly') {
    const target = h.weekly_target ?? 1;
    let count = 0;
    let ws = startOfWeek(today, weekStartsOn);
    const firstWeek = startOfWeek(h.start_date, weekStartsOn);
    for (let guard = 0; guard < 520 && ws >= firstWeek; guard++, ws = addDays(ws, -7)) {
      const { done, activeDays } = weekCount(h, idx, ws);
      const isCurrent = ws === startOfWeek(today, weekStartsOn);
      if (done >= target) count++;
      else if (activeDays === 0) continue; // whole week paused or rest
      else if (isCurrent || ws === firstWeek) continue; // week still running / partial first week
      else break;
    }
    return { count, unit: 'week' };
  }
  let count = 0;
  let d = today;
  for (let guard = 0; guard < 3660 && d >= h.start_date; guard++, d = addDays(d, -1)) {
    const s = dayState(h, idx, d, today);
    if (s === 'done' || s === 'minimum') count++;
    else if (s === 'missed') break;
    // rest, paused, unscheduled and today's open slot are neutral
  }
  return { count, unit: 'day' };
}

export interface Consistency { done: number; possible: number; pct: number | null }

/**
 * Share of scheduled opportunities completed between `from` and `to` (inclusive).
 * Days that are paused, planned rest, before the start date or still to come are
 * left out. Today only counts once it is completed.
 * Weekly-target habits: completions over target × weeks (partial weeks prorated).
 */
export function consistency(h: Habit, idx: LogIndex, from: ISODate, to: ISODate, today: ISODate): Consistency {
  let done = 0;
  let possible = 0;
  const end = to < today ? to : today;
  if (h.schedule === 'weekly') {
    const perDay = (h.weekly_target ?? 1) / 7;
    let eligibleDays = 0;
    for (let d = from; d <= end; d = addDays(d, 1)) {
      if (d < h.start_date) continue;
      const log = logOf(idx, h, d);
      if (isCompletion(log, h)) done++;
      if (!isPaused(h, d) && log?.status !== 'rest' && (d < today || isCompletion(log, h))) eligibleDays++;
    }
    possible = Math.round(eligibleDays * perDay * 10) / 10;
    done = Math.min(done, Math.ceil(possible));
  } else {
    for (let d = from; d <= end; d = addDays(d, 1)) {
      const s = dayState(h, idx, d, today);
      if (s === 'done' || s === 'minimum') { done++; possible++; }
      else if (s === 'missed') possible++;
    }
  }
  return { done, possible, pct: possible > 0 ? Math.min(100, Math.round((done / possible) * 100)) : null };
}

export function completionsThisWeek(h: Habit, idx: LogIndex, today: ISODate, weekStartsOn: number) {
  return weekCount(h, idx, startOfWeek(today, weekStartsOn)).done;
}

export function scheduleLabel(h: Habit): string {
  if (h.schedule === 'daily') return 'Every day';
  if (h.schedule === 'weekly') return `${h.weekly_target ?? 1}× a week`;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = [...(h.weekdays ?? [])].sort().map((d) => names[d]);
  return days.length ? days.join(', ') : 'No days chosen';
}

export function daysSince(a: ISODate, b: ISODate) {
  return diffDays(b, a);
}
