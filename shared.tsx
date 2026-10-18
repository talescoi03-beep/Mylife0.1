import { useMemo, useState, type ReactNode } from 'react';
import { useRows, useSettings, useStore, useToday } from '../app/context';
import { dismissTask, setHabitDay, toggleTask } from '../app/actions';
import { addDays, relDay, startOfWeek, weekdayShort, type ISODate } from '../lib/dates';
import { navigate } from '../lib/router';
import {
  completionsThisWeek, consistency, currentStreak, dayState, indexLogs, scheduleLabel, type LogIndex,
} from '../logic/habits';
import { recurrenceLabel } from '../logic/recurrence';
import type { Habit, HabitLog, Recurrence, Task } from '../data/schema';
import { AutoText, Check, Chips, Field, NumberInput, Seg, Sheet, confirm, toast } from '../ui/kit';
import { IconArchive, IconBulb, IconJournal, IconRepeat, IconTrash } from '../ui/icons';

// ---------- pickers ----------

export function AreaSelect({ value, onChange, label = 'Life area' }: { value: string | null; onChange: (v: string | null) => void; label?: string }) {
  const areas = useRows('areas').filter((a) => !a.archived || a.id === value).sort((a, b) => a.sort - b.sort);
  return (
    <Field label={label}>
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">None</option>
        {areas.map((a) => <option key={a.id} value={a.id}>{a.icon ? `${a.icon} ` : ''}{a.name}</option>)}
      </select>
    </Field>
  );
}

export function GoalSelect({ value, onChange, label = 'Goal' }: { value: string | null; onChange: (v: string | null) => void; label?: string }) {
  const goals = useRows('goals').filter((g) => g.status === 'active' || g.status === 'paused' || g.id === value);
  return (
    <Field label={label}>
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">None</option>
        {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
      </select>
    </Field>
  );
}

export function useAreaName() {
  const areas = useRows('areas');
  return useMemo(() => {
    const m = new Map(areas.map((a) => [a.id, a.name]));
    return (id: string | null) => (id ? m.get(id) ?? null : null);
  }, [areas]);
}

// ---------- tasks ----------

export function TaskRow({ task, showDate = true, onOpen }: { task: Task; showDate?: boolean; onOpen?: (t: Task) => void }) {
  const store = useStore();
  const today = useToday();
  const areaName = useAreaName();
  const goals = useRows('goals');
  const tasks = useRows('tasks');
  const goal = task.goal_id ? goals.find((g) => g.id === task.goal_id) : null;
  const subs = tasks.filter((t) => t.parent_id === task.id && !t.archived && t.status !== 'dismissed');
  const late = task.status === 'open' && task.due_date && task.due_date < today;
  const [leaving, setLeaving] = useState(false);
  const done = task.status === 'done';
  return (
    <div className={`row has-check ${done ? 'done' : ''} ${leaving ? 'leaving' : ''}`}>
      <Check on={done} priority={task.priority} label={`Complete ${task.title}`} onToggle={() => {
        if (!done) { setLeaving(true); setTimeout(() => setLeaving(false), 600); }
        toggleTask(store, task, today);
      }} />
      <button className="row-main" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }}
        onClick={() => (onOpen ? onOpen(task) : openTask(task.id))}>
        <div className="row-title">{task.title}</div>
        <div className="row-meta">
          {showDate && task.due_date && <span className={late ? 'late' : ''}>{relDay(task.due_date, today)}{task.due_time ? ` ${task.due_time}` : ''}</span>}
          {!showDate && task.due_time && <span>{task.due_time}</span>}
          {task.recurrence && <span><IconRepeat size={13} /> {recurrenceLabel(task.recurrence)}</span>}
          {task.estimate_min ? <span>{task.estimate_min} min</span> : null}
          {subs.length > 0 && <span>{subs.filter((s) => s.status === 'done').length}/{subs.length} steps</span>}
          {goal && <span>↳ {goal.title}</span>}
          {!goal && areaName(task.area_id) && <span>{areaName(task.area_id)}</span>}
          {task.tags.map((t) => <span key={t} className="tag">#{t}</span>)}
          {task.is_example && <span className="badge example">Example</span>}
        </div>
      </button>
    </div>
  );
}

// A global "open task editor" channel so any screen can open the sheet.
let openTaskListener: ((id: string | null, defaults?: Partial<Task>) => void) | null = null;
export function openTask(id: string | null, defaults?: Partial<Task>) {
  openTaskListener?.(id, defaults);
}

export function TaskSheetHost() {
  const [state, setState] = useState<{ id: string | null; defaults?: Partial<Task>; key: number } | null>(null);
  openTaskListener = (id, defaults) => setState({ id, defaults, key: Date.now() });
  if (!state) return null;
  return <TaskSheet key={state.key} id={state.id} defaults={state.defaults} onClose={() => setState(null)} />;
}

const WEEKDAY_OPTS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: d, label: weekdayShort(d) }));

function RecurrenceEditor({ value, onChange, anchor }: { value: Recurrence | null; onChange: (r: Recurrence | null) => void; anchor: ISODate | null }) {
  const freq = value?.freq ?? 'none';
  return (
    <div className="form" style={{ gap: 10 }}>
      <Field label="Repeat">
        <select className="select" value={freq} onChange={(e) => {
          const f = e.target.value;
          if (f === 'none') onChange(null);
          else onChange({ freq: f as Recurrence['freq'], interval: value?.interval ?? 1, ...(f === 'monthly' && anchor ? { anchor_day: Number(anchor.slice(8)) } : {}) });
        }}>
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </Field>
      {value && (
        <Field label={`Every how many ${value.freq === 'daily' ? 'days' : value.freq === 'weekly' ? 'weeks' : value.freq === 'monthly' ? 'months' : 'years'}`}>
          <NumberInput value={value.interval} onChange={(n) => onChange({ ...value, interval: Math.max(1, Math.round(n ?? 1)) })} />
        </Field>
      )}
      {value?.freq === 'weekly' && (
        <div className="field"><span className="field-label">On these days (optional)</span>
          <Chips label="Weekdays" values={value.weekdays ?? []} options={WEEKDAY_OPTS} onChange={(w) => onChange({ ...value, weekdays: w })} />
        </div>
      )}
      {value && <p className="tiny muted" style={{ margin: 0 }}>When you complete it, the next one is created automatically.</p>}
    </div>
  );
}

function TaskSheet({ id, defaults, onClose }: { id: string | null; defaults?: Partial<Task>; onClose: () => void }) {
  const store = useStore();
  const today = useToday();
  const existing = useRows('tasks').find((t) => t.id === id);
  const milestones = useRows('milestones');
  const people = useRows('people');
  const allTasks = useRows('tasks');
  const [d, setD] = useState<Partial<Task>>(() => existing ? { ...existing } : { title: '', priority: 0, tags: [], ...defaults });
  const [tagText, setTagText] = useState((existing?.tags ?? defaults?.tags ?? []).join(', '));
  const [newSub, setNewSub] = useState('');
  const set = (p: Partial<Task>) => setD((x) => ({ ...x, ...p }));
  const subs = existing ? allTasks.filter((t) => t.parent_id === existing.id) : [];
  const goalMilestones = milestones.filter((m) => m.goal_id && m.goal_id === d.goal_id);
  const topToday = allTasks.filter((t) => t.top_on === today && t.status === 'open' && t.id !== id).length;

  const save = () => {
    const title = (d.title ?? '').trim();
    if (!title) { toast('Give the task a title'); return; }
    const tags = tagText.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean);
    const values = {
      title, notes: d.notes || null, due_date: d.due_date || null, due_time: d.due_date && d.due_time ? d.due_time : null,
      priority: d.priority ?? 0, area_id: d.area_id ?? null, goal_id: d.goal_id ?? null, milestone_id: d.milestone_id ?? null,
      person_id: d.person_id ?? null, estimate_min: d.estimate_min ?? null, recurrence: d.recurrence ?? null, tags,
      top_on: d.top_on ?? null, parent_id: d.parent_id ?? null, learning_id: d.learning_id ?? null, idea_id: d.idea_id ?? null,
    };
    if (existing) store.update('tasks', existing.id, values);
    else store.create('tasks', values);
    toast(existing ? 'Saved' : 'Task added');
    onClose();
  };

  return (
    <Sheet open title={existing ? 'Task' : 'New task'} onClose={onClose}>
      <div className="form">
        <Field label="What needs doing">
          <input className="input" value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} data-autofocus
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }} enterKeyHint="done" />
        </Field>
        <div className="field">
          <span className="field-label">Due</span>
          <div className="chips">
            {[
              { l: 'Today', v: today }, { l: 'Tomorrow', v: addDays(today, 1) }, { l: 'Next week', v: addDays(today, 7) }, { l: 'No date', v: null },
            ].map((o) => (
              <button key={o.l} type="button" className="chip" aria-pressed={(d.due_date ?? null) === o.v} onClick={() => set({ due_date: o.v })}>{o.l}</button>
            ))}
          </div>
          <div className="inline mt-s">
            <input className="input" type="date" aria-label="Due date" value={d.due_date ?? ''} onChange={(e) => set({ due_date: e.target.value || null })} />
            <input className="input" type="time" aria-label="Time (optional)" value={d.due_time ?? ''} disabled={!d.due_date} onChange={(e) => set({ due_time: e.target.value || null })} />
          </div>
          <span className="hint">A due date is a deadline. To plan when you’ll work on it, add a time block in Plan › Week.</span>
        </div>
        <label className="toggle">
          <span>One of today’s top three{topToday >= 3 && d.top_on !== today ? <span className="tiny muted" style={{ display: 'block' }}>You already have three</span> : null}</span>
          <input type="checkbox" className="switch" checked={d.top_on === today}
            disabled={topToday >= 3 && d.top_on !== today}
            onChange={(e) => set({ top_on: e.target.checked ? today : null, due_date: e.target.checked && !d.due_date ? today : d.due_date })} />
        </label>
        <div className="field">
          <span className="field-label">Priority</span>
          <Seg label="Priority" value={String(d.priority ?? 0)} onChange={(v) => set({ priority: Number(v) })}
            options={[{ value: '0', label: 'None' }, { value: '1', label: 'Low' }, { value: '2', label: 'Medium' }, { value: '3', label: 'High' }]} />
        </div>
        <AreaSelect value={d.area_id ?? null} onChange={(v) => set({ area_id: v })} />
        <GoalSelect value={d.goal_id ?? null} onChange={(v) => set({ goal_id: v, milestone_id: null })} label="Moves this goal forward" />
        {goalMilestones.length > 0 && (
          <Field label="Milestone or project">
            <select className="select" value={d.milestone_id ?? ''} onChange={(e) => set({ milestone_id: e.target.value || null })}>
              <option value="">None</option>
              {goalMilestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </Field>
        )}
        {people.length > 0 && (
          <Field label="Person (optional)">
            <select className="select" value={d.person_id ?? ''} onChange={(e) => set({ person_id: e.target.value || null })}>
              <option value="">None</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <RecurrenceEditor value={d.recurrence ?? null} onChange={(r) => set({ recurrence: r })} anchor={d.due_date ?? null} />
        <div className="inline">
          <Field label="Estimate (minutes)"><NumberInput value={d.estimate_min ?? null} onChange={(n) => set({ estimate_min: n == null ? null : Math.round(n) })} /></Field>
          <Field label="Tags"><input className="input" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="e.g. calls, errands" autoCapitalize="none" /></Field>
        </div>
        <Field label="Notes"><AutoText value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} minRows={2} /></Field>

        {existing && !existing.parent_id && (
          <div className="field">
            <span className="field-label">Steps</span>
            <div className="list">
              {subs.filter((s) => s.status !== 'dismissed' && !s.archived).map((s) => (
                <div key={s.id} className={`row has-check ${s.status === 'done' ? 'done' : ''}`}>
                  <Check on={s.status === 'done'} label={`Complete ${s.title}`} onToggle={() => store.update('tasks', s.id, s.status === 'done' ? { status: 'open', completed_at: null } : { status: 'done', completed_at: new Date().toISOString() })} />
                  <div className="row-main row-title">{s.title}</div>
                  <button className="icon-btn" aria-label={`Delete step ${s.title}`} onClick={() => store.remove('tasks', s.id)}><IconTrash size={18} /></button>
                </div>
              ))}
              <form className="row" onSubmit={(e) => {
                e.preventDefault();
                if (!newSub.trim()) return;
                store.create('tasks', { title: newSub.trim(), parent_id: existing.id, goal_id: existing.goal_id, area_id: existing.area_id });
                setNewSub('');
              }}>
                <input className="input" style={{ border: 0, padding: 0, minHeight: 34 }} placeholder="Add a step" value={newSub} onChange={(e) => setNewSub(e.target.value)} enterKeyHint="enter" />
              </form>
            </div>
          </div>
        )}
      </div>
      <div className="btn-row">
        <button className="btn" onClick={save}>{existing ? 'Save' : 'Add task'}</button>
      </div>
      {existing && (
        <div className="btn-row">
          {existing.status === 'open' && (
            <button className="btn secondary" onClick={() => { toggleTask(store, existing, today); onClose(); }}>Mark done</button>
          )}
          {existing.status !== 'open' && (
            <button className="btn secondary" onClick={() => { store.update('tasks', existing.id, { status: 'open', completed_at: null }); onClose(); }}>Reopen</button>
          )}
          {existing.status === 'open' && existing.due_date && existing.due_date < today && (
            <button className="btn secondary" onClick={() => { dismissTask(store, existing); onClose(); }}>Dismiss</button>
          )}
          <button className="btn ghost" onClick={() => {
            store.update('tasks', existing.id, { archived: !existing.archived });
            toast(existing.archived ? 'Restored from archive' : 'Archived', { action: { label: 'Undo', run: () => store.update('tasks', existing.id, { archived: existing.archived }) } });
            onClose();
          }}><IconArchive size={18} />{existing.archived ? 'Unarchive' : 'Archive'}</button>
          <button className="btn ghost danger-text" onClick={async () => {
            if (await confirm({ title: 'Delete this task?', body: subs.length ? 'Its steps will be deleted too.' : undefined, confirmLabel: 'Delete', danger: true })) {
              subs.forEach((s) => store.remove('tasks', s.id));
              store.remove('tasks', existing.id);
              toast('Task deleted', { action: { label: 'Undo', run: () => { store.restore('tasks', existing.id); subs.forEach((s) => store.restore('tasks', s.id)); } } });
              onClose();
            }
          }}><IconTrash size={18} />Delete</button>
        </div>
      )}
    </Sheet>
  );
}

// ---------- quick add ----------

let openQuickAddListener: (() => void) | null = null;
export function openQuickAdd() { openQuickAddListener?.(); }

export function QuickAdd() {
  const store = useStore();
  const today = useToday();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'task' | 'idea' | 'journal'>('task');
  const [text, setText] = useState('');
  const [when, setWhen] = useState<'today' | 'tomorrow' | 'inbox'>('today');
  openQuickAddListener = () => setOpen(true);
  const close = () => { setOpen(false); setText(''); };
  const save = () => {
    const v = text.trim();
    if (!v) return;
    if (kind === 'task') {
      store.create('tasks', { title: v, due_date: when === 'today' ? today : when === 'tomorrow' ? addDays(today, 1) : null });
      toast(when === 'inbox' ? 'Added to Inbox' : `Added for ${when}`);
    } else if (kind === 'idea') {
      store.create('ideas', { body: v });
      toast('Idea saved');
    } else {
      store.create('journal_entries', { day: today, kind: 'free', body: v });
      toast('Journal entry saved');
    }
    setText('');
    close();
  };
  return (
    <Sheet open={open} onClose={close} title="Quick add">
      <Seg label="Type" value={kind} onChange={setKind}
        options={[{ value: 'task', label: 'Task' }, { value: 'idea', label: 'Idea' }, { value: 'journal', label: 'Journal' }]} />
      <div className="form mt">
        {kind === 'task' ? (
          <>
            <input className="input" placeholder="What needs doing?" value={text} onChange={(e) => setText(e.target.value)} data-autofocus
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }} enterKeyHint="done" aria-label="Task" />
            <Chips label="When" multi={false} values={[when]} onChange={(v) => setWhen(v[0] as typeof when)}
              options={[{ value: 'today', label: 'Today' }, { value: 'tomorrow', label: 'Tomorrow' }, { value: 'inbox', label: 'Inbox (no date)' }]} />
          </>
        ) : (
          <AutoText serif value={text} onChange={(e) => setText(e.target.value)} data-autofocus aria-label={kind === 'idea' ? 'Idea' : 'Journal entry'}
            placeholder={kind === 'idea' ? 'Write it down before it disappears…' : 'What’s on your mind?'} />
        )}
        <button className="btn block" onClick={save} disabled={!text.trim()}>
          {kind === 'task' ? <>Add task</> : kind === 'idea' ? <><IconBulb size={18} />Save idea</> : <><IconJournal size={18} />Save entry</>}
        </button>
      </div>
    </Sheet>
  );
}

// ---------- habits ----------

export function useHabitIndex(): LogIndex {
  const logs = useRows('habit_logs');
  return useMemo(() => indexLogs(logs), [logs]);
}

export function HabitRow({ habit, idx, day }: { habit: Habit; idx: LogIndex; day: ISODate }) {
  const store = useStore();
  const today = useToday();
  const { week_starts_on } = useSettings();
  const log = idx.get(`${habit.id}|${day}`);
  const state = dayState(habit, idx, day, today);
  const done = state === 'done' || state === 'minimum';
  const streak = currentStreak(habit, idx, today, week_starts_on);
  const [sheet, setSheet] = useState(false);
  const weekDone = habit.schedule === 'weekly' ? completionsThisWeek(habit, idx, today, week_starts_on) : null;
  return (
    <>
      <div className="row has-check">
        <Check on={done || state === 'rest'} variant={state === 'minimum' ? 'minimum' : state === 'rest' ? 'rest' : undefined}
          label={`${habit.title} ${done ? 'done' : 'not done'}`}
          onToggle={() => {
            if (habit.kind === 'measure' && !done) { setSheet(true); return; }
            setHabitDay(store, habit, day, done || state === 'rest' ? null : 'done', habit.kind === 'measure' ? {} : { value: null });
          }} />
        <button className="row-main" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => setSheet(true)}>
          <div className="row-title">{habit.title}</div>
          <div className="row-meta">
            {state === 'minimum' && <span>Minimum version</span>}
            {state === 'rest' && <span>Rest day</span>}
            {habit.kind === 'measure' && log?.value != null && <span>{log.value}{habit.daily_target ? ` / ${habit.daily_target}` : ''} {habit.unit}</span>}
            {habit.kind === 'measure' && log?.value == null && habit.daily_target && <span>Target {habit.daily_target} {habit.unit}</span>}
            {weekDone != null && <span>{weekDone} of {habit.weekly_target ?? 1} this week</span>}
            {streak.count > 1 && <span>{streak.count} {streak.unit}s in a row</span>}
            {habit.is_example && <span className="badge example">Example</span>}
          </div>
        </button>
      </div>
      {sheet && <HabitCheckinSheet habit={habit} day={day} log={log} onClose={() => setSheet(false)} />}
    </>
  );
}

function HabitCheckinSheet({ habit, day, log, onClose }: { habit: Habit; day: ISODate; log?: HabitLog; onClose: () => void }) {
  const store = useStore();
  const today = useToday();
  const [value, setValue] = useState<number | null>(log?.value ?? null);
  const [note, setNote] = useState(log?.note ?? '');
  const save = (status: HabitLog['status'] | null) => {
    setHabitDay(store, habit, day, status, { value, note: note.trim() || null });
    onClose();
  };
  return (
    <Sheet open title={habit.title} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>{relDay(day, today)} · {scheduleLabel(habit)}</p>
      <div className="form">
        {habit.kind === 'measure' && (
          <Field label={`How much${habit.unit ? ` (${habit.unit})` : ''}?`} hint={habit.daily_target ? `Target: ${habit.daily_target} ${habit.unit ?? ''}` : undefined}>
            <NumberInput value={value} onChange={setValue} aria-label="Amount" />
          </Field>
        )}
        <div className="btn-row" style={{ marginTop: 0 }}>
          <button className="btn" onClick={() => save('done')}>Done</button>
          {habit.minimum_version && <button className="btn secondary" onClick={() => save('minimum')}>Did the minimum</button>}
        </div>
        {habit.minimum_version && <p className="small muted" style={{ margin: 0 }}>Minimum version: {habit.minimum_version}</p>}
        <Field label="Note (optional)" hint="What helped, or what got in the way?">
          <AutoText value={note} onChange={(e) => setNote(e.target.value)} minRows={2} />
        </Field>
        <div className="btn-row" style={{ marginTop: 0 }}>
          <button className="btn secondary" onClick={() => save('rest')}>Planned rest day</button>
          {day < today && <button className="btn secondary" onClick={() => save('missed')}>Missed — save note</button>}
          {log && <button className="btn ghost" onClick={() => save(null)}>Clear</button>}
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>Rest days and paused periods never break a streak. A missed day is information, not a verdict — start again tomorrow.</p>
        <button className="link-btn" style={{ justifySelf: 'start' }} onClick={() => { onClose(); navigate(`/plan/habit/${habit.id}`); }}>Habit details and history</button>
      </div>
    </Sheet>
  );
}

let openHabitListener: ((id: string | null, defaults?: Partial<Habit>) => void) | null = null;
export function openHabitEditor(id: string | null, defaults?: Partial<Habit>) { openHabitListener?.(id, defaults); }

export function HabitEditorHost() {
  const [s, setS] = useState<{ id: string | null; defaults?: Partial<Habit>; key: number } | null>(null);
  openHabitListener = (id, defaults) => setS({ id, defaults, key: Date.now() });
  if (!s) return null;
  return <HabitEditor key={s.key} id={s.id} defaults={s.defaults} onClose={() => setS(null)} />;
}

function HabitEditor({ id, defaults, onClose }: { id: string | null; defaults?: Partial<Habit>; onClose: () => void }) {
  const store = useStore();
  const today = useToday();
  const existing = useRows('habits').find((h) => h.id === id);
  const [d, setD] = useState<Partial<Habit>>(() => existing ? { ...existing } : { title: '', kind: 'check', schedule: 'daily', weekdays: [1, 2, 3, 4, 5], weekly_target: 3, start_date: today, ...defaults });
  const set = (p: Partial<Habit>) => setD((x) => ({ ...x, ...p }));
  const save = () => {
    if (!d.title?.trim()) { toast('Give the habit a name'); return; }
    const values = {
      title: d.title.trim(), kind: d.kind ?? 'check', unit: d.kind === 'measure' ? (d.unit || null) : null,
      daily_target: d.kind === 'measure' ? d.daily_target ?? null : null, schedule: d.schedule ?? 'daily',
      weekdays: d.schedule === 'weekdays' ? d.weekdays ?? [] : [], weekly_target: d.schedule === 'weekly' ? d.weekly_target ?? 1 : null,
      minimum_version: d.minimum_version || null, why: d.why || null, area_id: d.area_id ?? null, goal_id: d.goal_id ?? null,
      start_date: d.start_date || today, learning_id: d.learning_id ?? null, idea_id: d.idea_id ?? null,
    };
    if (values.schedule === 'weekdays' && !values.weekdays.length) { toast('Choose at least one day'); return; }
    if (existing) store.update('habits', existing.id, values);
    else store.create('habits', values);
    toast(existing ? 'Saved' : 'Habit added');
    onClose();
  };
  return (
    <Sheet open title={existing ? 'Edit habit' : 'New habit'} onClose={onClose}>
      <div className="form">
        <Field label="Habit"><input className="input" value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Read, Gym, Study" data-autofocus /></Field>
        <div className="field"><span className="field-label">Type</span>
          <Seg label="Type" value={d.kind ?? 'check'} onChange={(v) => set({ kind: v })}
            options={[{ value: 'check', label: 'Yes / no' }, { value: 'measure', label: 'Measured' }]} />
        </div>
        {d.kind === 'measure' && (
          <div className="inline">
            <Field label="Daily target"><NumberInput value={d.daily_target ?? null} onChange={(n) => set({ daily_target: n })} /></Field>
            <Field label="Unit"><input className="input" value={d.unit ?? ''} onChange={(e) => set({ unit: e.target.value })} placeholder="min, pages" /></Field>
          </div>
        )}
        <div className="field"><span className="field-label">How often</span>
          <Seg label="Schedule" value={d.schedule ?? 'daily'} onChange={(v) => set({ schedule: v })}
            options={[{ value: 'daily', label: 'Every day' }, { value: 'weekdays', label: 'Chosen days' }, { value: 'weekly', label: 'Times per week' }]} />
        </div>
        {d.schedule === 'weekdays' && <Chips label="Days" values={d.weekdays ?? []} options={WEEKDAY_OPTS} onChange={(w) => set({ weekdays: w })} />}
        {d.schedule === 'weekly' && (
          <Field label="Times per week"><NumberInput value={d.weekly_target ?? 3} onChange={(n) => set({ weekly_target: Math.min(7, Math.max(1, Math.round(n ?? 1))) })} /></Field>
        )}
        <Field label="Minimum version for hard days" hint="The smallest step that still counts — it keeps the habit alive.">
          <input className="input" value={d.minimum_version ?? ''} onChange={(e) => set({ minimum_version: e.target.value })} placeholder="e.g. Read one page" />
        </Field>
        <Field label="Why this matters"><input className="input" value={d.why ?? ''} onChange={(e) => set({ why: e.target.value })} /></Field>
        <AreaSelect value={d.area_id ?? null} onChange={(v) => set({ area_id: v })} />
        <GoalSelect value={d.goal_id ?? null} onChange={(v) => set({ goal_id: v })} label="Supports goal (optional)" />
        <Field label="Start date"><input className="input" type="date" value={d.start_date ?? today} onChange={(e) => set({ start_date: e.target.value || today })} /></Field>
      </div>
      <div className="btn-row"><button className="btn" onClick={save}>{existing ? 'Save' : 'Add habit'}</button></div>
    </Sheet>
  );
}

export function HabitWeekStrip({ habit, idx }: { habit: Habit; idx: LogIndex }) {
  const today = useToday();
  const { week_starts_on } = useSettings();
  const start = startOfWeek(today, week_starts_on);
  return (
    <div className="heat strip" aria-label="This week">
      {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => {
        const s = dayState(habit, idx, d, today);
        const cls = { done: 'd', minimum: 'm', rest: 'r', paused: 'p', missed: 'x', open: 'n', unscheduled: 'n', 'before-start': 'n' }[s];
        return <i key={d} className={cls} title={`${d}: ${s}`} />;
      })}
    </div>
  );
}

export function habitConsistencyText(h: Habit, idx: LogIndex, today: ISODate): string {
  const c = consistency(h, idx, addDays(today, -27), today, today);
  if (c.pct == null) return 'No scheduled days yet';
  return `${c.pct}% of scheduled days in the last 4 weeks (${c.done} of ${c.possible})`;
}

export function Linkish({ to, children }: { to: string; children: ReactNode }) {
  return <button className="link-btn" onClick={() => navigate(to)}>{children}</button>;
}
