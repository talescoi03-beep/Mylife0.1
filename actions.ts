// Operations that touch several records at once. Screens call these so the
// rules (history entries, wins, recurring copies, undo) live in one place.
import { type ISODate } from '../lib/dates';
import { habitLogId } from '../logic/habits';
import { nextDueAfterCompletion, nextInstanceId } from '../logic/recurrence';
import type { Store } from '../data/store';
import type { Goal, Habit, HabitStatus, Milestone, Task, TableName } from '../data/schema';
import { TABLES } from '../data/schema';
import { toast } from '../ui/kit';

export function logGoalEvent(store: Store, goalId: string, kind: string, summary: string, data: Record<string, unknown> | null = null) {
  store.create('goal_events', { goal_id: goalId, at: new Date().toISOString(), kind, summary, data });
}

/** Completes a task. Recurring tasks get their next copy. Returns an undo function. */
export function completeTask(store: Store, task: Task, today: ISODate): () => void {
  store.update('tasks', task.id, { status: 'done', completed_at: new Date().toISOString() });
  let nextId: string | null = null;
  let createdNext = false;
  if (task.recurrence) {
    const series = task.series_id ?? task.id;
    const due = nextDueAfterCompletion(task.recurrence, task.due_date, today);
    nextId = nextInstanceId(series, due);
    const existing = store.get('tasks', nextId);
    if (!existing) {
      createdNext = true;
      store.create('tasks', {
        id: nextId,
        title: task.title, notes: task.notes, area_id: task.area_id, goal_id: task.goal_id, milestone_id: task.milestone_id,
        person_id: task.person_id, learning_id: task.learning_id, priority: task.priority, tags: task.tags,
        estimate_min: task.estimate_min, recurrence: task.recurrence, series_id: series, due_date: due, due_time: task.due_time,
        is_example: task.is_example,
      });
    }
  }
  // Completing a parent task does not silently complete its open subtasks; it just leaves them.
  return () => {
    store.update('tasks', task.id, { status: 'open', completed_at: null });
    if (createdNext && nextId) {
      const n = store.get('tasks', nextId);
      if (n && n.status === 'open') store.remove('tasks', nextId);
    }
  };
}

export function toggleTask(store: Store, task: Task, today: ISODate) {
  if (task.status === 'done') {
    store.update('tasks', task.id, { status: 'open', completed_at: null });
    return;
  }
  const undo = completeTask(store, task, today);
  toast(task.recurrence ? 'Done. Next one scheduled.' : 'Done', { action: { label: 'Undo', run: undo } });
}

export function dismissTask(store: Store, task: Task) {
  store.update('tasks', task.id, { status: 'dismissed' });
  toast('Dismissed', { action: { label: 'Undo', run: () => store.update('tasks', task.id, { status: 'open' }) } });
}

export function rescheduleTask(store: Store, task: Task, day: ISODate | null) {
  const prev = { due_date: task.due_date, top_on: task.top_on };
  store.update('tasks', task.id, { due_date: day });
  toast(day ? 'Rescheduled' : 'Moved to Inbox', { action: { label: 'Undo', run: () => store.update('tasks', task.id, prev) } });
}

/** Sets (or clears) a habit's check-in for a day. One record per habit per day. */
export function setHabitDay(store: Store, habit: Habit, day: ISODate, status: HabitStatus | null, extra: { value?: number | null; note?: string | null } = {}) {
  const id = habitLogId(habit.id, day);
  if (status === null) {
    store.remove('habit_logs', id);
    return;
  }
  store.upsert('habit_logs', id, {
    habit_id: habit.id, day, status,
    value: extra.value !== undefined ? extra.value : store.get('habit_logs', id)?.value ?? null,
    note: extra.note !== undefined ? extra.note : store.get('habit_logs', id)?.note ?? null,
    is_example: habit.is_example,
  });
}

export function completeGoal(store: Store, goal: Goal, today: ISODate) {
  store.update('goals', goal.id, { status: 'completed', completed_at: new Date().toISOString() });
  logGoalEvent(store, goal.id, 'completed', 'Goal completed');
  store.create('wins', {
    day: today, title: goal.title, kind: 'goal', goal_id: goal.id, area_id: goal.area_id,
    note: goal.celebration ? `Planned celebration: ${goal.celebration}` : null, is_example: goal.is_example,
  });
  toast(goal.celebration ? `Goal complete. Time to celebrate: ${goal.celebration}` : 'Goal complete — recorded in your wins.', { kind: 'win', ms: 6000 });
}

export function reopenGoal(store: Store, goal: Goal) {
  store.update('goals', goal.id, { status: 'active', completed_at: null });
  logGoalEvent(store, goal.id, 'reopened', 'Goal reopened');
}

export function toggleMilestone(store: Store, m: Milestone, today: ISODate) {
  if (m.done) {
    store.update('milestones', m.id, { done: false, done_at: null });
    if (m.goal_id) logGoalEvent(store, m.goal_id, 'milestone_reopened', `Reopened: ${m.title}`);
    const win = store.all('wins').find((w) => w.milestone_id === m.id);
    if (win) store.remove('wins', win.id);
    return;
  }
  store.update('milestones', m.id, { done: true, done_at: new Date().toISOString() });
  const goal = store.get('goals', m.goal_id);
  if (m.goal_id) logGoalEvent(store, m.goal_id, 'milestone_done', `${m.kind === 'project' ? 'Project' : 'Milestone'} done: ${m.title}`);
  store.create('wins', {
    day: today, title: m.title, kind: 'milestone', milestone_id: m.id, goal_id: m.goal_id,
    area_id: goal?.area_id ?? m.area_id, is_example: m.is_example,
  });
  toast(`${m.kind === 'project' ? 'Project' : 'Milestone'} reached — added to your wins.`, { kind: 'win' });
}

/** Deletes everything marked as an example. */
export function removeExamples(store: Store): number {
  let n = 0;
  for (const t of TABLES as TableName[]) {
    for (const r of store.all(t)) {
      if ((r as any).is_example) { store.remove(t, r.id); n++; }
    }
  }
  return n;
}

export function countExamples(store: Store): number {
  let n = 0;
  for (const t of TABLES) for (const r of store.all(t)) if ((r as any).is_example) n++;
  return n;
}
