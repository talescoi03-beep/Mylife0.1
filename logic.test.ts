import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addDays, addMonths, diffDays, nextYearly, startOfWeek, today, weekday } from '../src/lib/dates';
import { consistency, currentStreak, dueOn, habitLogId, indexLogs } from '../src/logic/habits';
import { nextDueAfterCompletion, nextInstanceId, nextOccurrence } from '../src/logic/recurrence';
import { goalProgress } from '../src/logic/goals';
import { DEFAULTS, TABLES, columnsOf } from '../src/data/schema';
import type { Goal, Habit, HabitLog, Milestone } from '../src/data/schema';

const base = { user_id: 'u', created_at: '', updated_at: '', deleted_at: null, rev: 1, last_op: null, is_example: false };

test('day boundaries follow the chosen time zone around midnight', () => {
  // Riyadh is UTC+3: 20:59:59Z is 23:59:59 local, 21:00:00Z is 00:00:00 next day.
  assert.equal(today('Asia/Riyadh', Date.parse('2026-10-17T20:59:59Z')), '2026-10-17');
  assert.equal(today('Asia/Riyadh', Date.parse('2026-10-17T21:00:00Z')), '2026-10-18');
  // Same instant is still the 17th in New York and UTC.
  assert.equal(today('America/New_York', Date.parse('2026-10-17T21:00:00Z')), '2026-10-17');
  assert.equal(today('UTC', Date.parse('2026-10-17T23:59:59.999Z')), '2026-10-17');
  // Across a DST change (US, 1 Nov 2026) day arithmetic stays exact.
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(diffDays('2026-11-02', '2026-10-31'), 2);
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('week, month and yearly helpers', () => {
  assert.equal(weekday('2026-10-18'), 0); // Sunday
  assert.equal(startOfWeek('2026-10-18', 1), '2026-10-12'); // Monday start
  assert.equal(startOfWeek('2026-10-18', 6), '2026-10-17'); // Saturday start
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-02-28', 1, 31), '2026-03-31');
  assert.equal(nextYearly('1990-03-05', '2026-10-18'), '2027-03-05');
  assert.equal(nextYearly('1990-12-25', '2026-10-18'), '2026-12-25');
  assert.equal(nextYearly('2000-02-29', '2026-10-18'), '2027-02-28');
});

function habit(p: Partial<Habit>): Habit {
  return { ...(DEFAULTS.habits as any), ...base, id: 'h1', title: 'Read', start_date: '2026-10-01', ...p };
}
function log(day: string, status: HabitLog['status'] = 'done', value: number | null = null): HabitLog {
  return { ...(DEFAULTS.habit_logs as any), ...base, id: habitLogId('h1', day), habit_id: 'h1', day, status, value };
}

test('daily streak: rest days and pauses do not break it; a miss does', () => {
  const h = habit({ pauses: [{ from: '2026-10-10', to: '2026-10-11' }] });
  const logs = [log('2026-10-08'), log('2026-10-09'), log('2026-10-12'), log('2026-10-13', 'rest'), log('2026-10-14', 'minimum'), log('2026-10-15'), log('2026-10-16'), log('2026-10-17')];
  const idx = indexLogs(logs);
  // Today (18th) not done yet: does not break the streak.
  assert.deepEqual(currentStreak(h, idx, '2026-10-18', 1), { count: 7, unit: 'day' });
  // A real miss on the 7th stops the count at the 8th.
  const c = consistency(h, idx, '2026-10-01', '2026-10-18', '2026-10-18');
  assert.equal(c.done, 7);
  assert.equal(c.possible, 7 + 7); // 1st–7th missed, 10–11 paused, 13 rest, 18 open
  // A paused habit is never due.
  assert.equal(dueOn(h, idx, '2026-10-10', 1), false);
});

test('weekday habits only count chosen days', () => {
  const h = habit({ schedule: 'weekdays', weekdays: [1, 3, 5] }); // Mon Wed Fri
  const idx = indexLogs([log('2026-10-12'), log('2026-10-14'), log('2026-10-16')]);
  assert.equal(currentStreak(h, idx, '2026-10-18', 1).count, 3);
  assert.equal(dueOn(h, idx, '2026-10-18', 1), false); // Sunday
  assert.equal(dueOn(h, idx, '2026-10-19', 1), true); // Monday
});

test('weekly target habits count weeks and disappear once met', () => {
  const h = habit({ schedule: 'weekly', weekly_target: 3, start_date: '2026-09-28' });
  const idx = indexLogs([
    log('2026-09-28'), log('2026-09-30'), log('2026-10-02'), // week of 28 Sep: 3
    log('2026-10-05'), log('2026-10-07'), log('2026-10-09'), // week of 5 Oct: 3
    log('2026-10-12'), log('2026-10-13'), log('2026-10-14'), // week of 12 Oct: 3
    log('2026-10-19'), // current week (Mon 19 Oct start): 1 so far
  ]);
  assert.deepEqual(currentStreak(h, idx, '2026-10-20', 1), { count: 3, unit: 'week' });
  assert.equal(dueOn(h, idx, '2026-10-17', 1), false); // target met that week
  assert.equal(dueOn(h, idx, '2026-10-20', 1), true);
});

test('measurable habits need the target value, or the minimum version', () => {
  const h = habit({ kind: 'measure', daily_target: 30, unit: 'min' });
  const idx = indexLogs([log('2026-10-16', 'done', 20), log('2026-10-17', 'minimum', 5)]);
  const c = consistency(h, idx, '2026-10-16', '2026-10-17', '2026-10-18');
  assert.deepEqual([c.done, c.possible], [1, 2]);
});

test('one habit check-in per habit per day: same id on every device', () => {
  assert.equal(habitLogId('h1', '2026-10-18'), habitLogId('h1', '2026-10-18'));
  assert.notEqual(habitLogId('h1', '2026-10-18'), habitLogId('h1', '2026-10-19'));
});

test('recurring tasks', () => {
  assert.equal(nextOccurrence({ freq: 'daily', interval: 1 }, '2026-10-18'), '2026-10-19');
  assert.equal(nextOccurrence({ freq: 'weekly', interval: 1, weekdays: [1, 3] }, '2026-10-14'), '2026-10-19');
  assert.equal(nextOccurrence({ freq: 'weekly', interval: 1, weekdays: [1, 3] }, '2026-10-12'), '2026-10-14');
  assert.equal(nextOccurrence({ freq: 'weekly', interval: 2, weekdays: [1] }, '2026-10-12'), '2026-10-26');
  assert.equal(nextOccurrence({ freq: 'monthly', interval: 1, anchor_day: 31 }, '2026-02-28'), '2026-03-31');
  // Completing an overdue daily task schedules the next copy after today, not in the past.
  assert.equal(nextDueAfterCompletion({ freq: 'daily', interval: 1 }, '2026-10-10', '2026-10-18'), '2026-10-19');
  assert.equal(nextInstanceId('s', '2026-10-19'), nextInstanceId('s', '2026-10-19'));
});

test('goal progress only comes from what the goal measures', () => {
  const g = { ...(DEFAULTS.goals as any), ...base, id: 'g', title: 'Save' } as Goal;
  assert.equal(goalProgress({ ...g, progress_mode: 'numeric', start_value: 0, target_value: 1000, current_value: 250, unit: 'USD' }, []).pct, 25);
  const ms = (done: boolean, id: string) => ({ ...(DEFAULTS.milestones as any), ...base, id, goal_id: 'g', done }) as Milestone;
  const p = goalProgress({ ...g, progress_mode: 'milestones' }, [ms(true, 'a'), ms(false, 'b'), ms(false, 'c'), ms(true, 'x')]);
  assert.equal(p.pct, 50);
  assert.match(p.basis, /2 of 4/);
  assert.equal(goalProgress({ ...g, progress_mode: 'milestones' }, []).pct, null);
  assert.equal(goalProgress({ ...g, progress_mode: 'manual', manual_progress: 40 }, []).basis, 'Your assessment: 40%');
});

test('client columns match the database migration exactly', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/0001_my_life_schema.sql', import.meta.url), 'utf8');
  for (const t of TABLES) {
    const m = sql.match(new RegExp(`create table if not exists public\\.${t} \\(([\\s\\S]*?)\\n\\);`));
    assert.ok(m, `table ${t} in migration`);
    const cols = m![1].split('\n').map((l) => l.trim()).filter((l) => /^[a-z_]+ /.test(l) && !l.startsWith('constraint')).map((l) => l.split(' ')[0]);
    assert.deepEqual([...cols].sort(), [...columnsOf(t)].sort(), `columns of ${t}`);
  }
});
