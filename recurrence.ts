import { addDays, addMonths, weekday, type ISODate } from '../lib/dates';
import { stableId } from '../lib/ids';
import type { Recurrence } from '../data/schema';

/** The next occurrence strictly after `from`. */
export function nextOccurrence(rule: Recurrence, from: ISODate): ISODate {
  const interval = Math.max(1, Math.floor(rule.interval || 1));
  switch (rule.freq) {
    case 'daily':
      return addDays(from, interval);
    case 'weekly': {
      const days = (rule.weekdays ?? []).length ? [...rule.weekdays!].sort() : [weekday(from)];
      // A later chosen weekday in the same week (weeks counted Sunday–Saturday)…
      const wd = weekday(from);
      const later = days.find((x) => x > wd);
      if (later !== undefined) return addDays(from, later - wd);
      // …otherwise the first chosen weekday `interval` weeks on.
      return addDays(from, 7 - wd + days[0] + 7 * (interval - 1));
    }
    case 'monthly':
      return addMonths(from, interval, rule.anchor_day ?? Number(from.slice(8)));
    case 'yearly':
      return addMonths(from, 12 * interval, rule.anchor_day ?? Number(from.slice(8)));
  }
}

/**
 * When a recurring task is completed, the next copy is due at the first
 * occurrence after its due date that is also after today — completing an
 * overdue daily task does not create a pile of past copies.
 */
export function nextDueAfterCompletion(rule: Recurrence, due: ISODate | null, today: ISODate): ISODate {
  let next = nextOccurrence(rule, due ?? today);
  for (let guard = 0; guard < 1000 && next <= today; guard++) next = nextOccurrence(rule, next);
  return next;
}

/** Same id on every device, so completing on two offline phones creates one next copy. */
export function nextInstanceId(seriesId: string, due: ISODate) {
  return stableId('task_instance', seriesId, due);
}

export function recurrenceLabel(r: Recurrence | null): string {
  if (!r) return 'Does not repeat';
  const n = Math.max(1, r.interval || 1);
  const every = (unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
  if (r.freq === 'weekly' && r.weekdays?.length) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${every('week')} on ${[...r.weekdays].sort().map((d) => names[d]).join(', ')}`;
  }
  return every({ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq]);
}
