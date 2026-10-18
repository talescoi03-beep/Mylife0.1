import { useMemo, useState } from 'react';
import { useRows, useSettings, useStore, useToday } from '../app/context';
import { relDay, type ISODate } from '../lib/dates';
import { Link, navigate, useLocation } from '../lib/router';
import { CATEGORY_LABEL, HORIZON_LABEL, HORIZON_ORDER, goalProgress } from '../logic/goals';
import { currentStreak, isPaused, scheduleLabel } from '../logic/habits';
import type { Goal, GoalCategory, Task } from '../data/schema';
import { Empty, PageHead, Progress, Section, Seg, SeminarNote, Sheet, AutoText, Field, toast } from '../ui/kit';
import { IconChevron, IconPlus, IconSearch } from '../ui/icons';
import { HabitWeekStrip, TaskRow, habitConsistencyText, openHabitEditor, openTask, useAreaName, useHabitIndex } from './shared';
import { WeekView } from './Week';

type Tab = 'goals' | 'tasks' | 'habits' | 'week';

export function PlanScreen() {
  const { query } = useLocation();
  const tab = (query.get('tab') as Tab) || 'goals';
  const setTab = (t: Tab) => navigate(`/plan?tab=${t}`, { replace: true });
  return (
    <div className="page">
      <PageHead title="Plan" actions={
        tab === 'goals' ? <button className="btn small" onClick={() => navigate('/plan/goal/new')}><IconPlus size={18} />Goal</button>
          : tab === 'tasks' ? <button className="btn small" onClick={() => openTask(null)}><IconPlus size={18} />Task</button>
            : tab === 'habits' ? <button className="btn small" onClick={() => openHabitEditor(null)}><IconPlus size={18} />Habit</button>
              : undefined
      } />
      <Seg label="Plan section" value={tab} onChange={setTab}
        options={[{ value: 'goals', label: 'Goals' }, { value: 'tasks', label: 'Tasks' }, { value: 'habits', label: 'Habits' }, { value: 'week', label: 'Week' }]} />
      <div className="mt">
        {tab === 'goals' && <GoalsTab />}
        {tab === 'tasks' && <TasksTab />}
        {tab === 'habits' && <HabitsTab />}
        {tab === 'week' && <WeekView />}
      </div>
    </div>
  );
}

// ---------- goals ----------

export function GoalCard({ goal }: { goal: Goal }) {
  const milestones = useRows('milestones');
  const areaName = useAreaName();
  const p = goalProgress(goal, milestones);
  return (
    <Link to={`/plan/goal/${goal.id}`} className="row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
      <div className="inline" style={{ width: '100%', gap: 8 }}>
        <span className="row-title grow" style={{ fontWeight: 600 }}>{goal.title}</span>
        <IconChevron size={18} className="faint" />
      </div>
      <div className="row-meta">
        <span>{CATEGORY_LABEL[goal.category]}</span>
        {areaName(goal.area_id) && <span>{areaName(goal.area_id)}</span>}
        {goal.target_date && <span>By {goal.target_date}</span>}
        {goal.status === 'paused' && <span className="badge">Paused</span>}
        {goal.is_example && <span className="badge example">Example</span>}
      </div>
      {goal.status !== 'completed' && (
        <div style={{ width: '100%' }}>
          <Progress pct={p.pct} />
          <div className="basis">{p.basis}</div>
        </div>
      )}
      {goal.next_action && goal.status === 'active' && <div className="small" style={{ color: 'var(--ink-2)' }}>Next: {goal.next_action}</div>}
    </Link>
  );
}

function GoalsTab() {
  const goals = useRows('goals');
  const visions = useRows('visions');
  const areas = useRows('areas');
  const [cat, setCat] = useState<'all' | GoalCategory>('all');
  const [area, setArea] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [visionEdit, setVisionEdit] = useState<string | 'new' | null>(null);
  const filtered = goals.filter((g) => (cat === 'all' || g.category === cat) && (!area || g.area_id === area));
  const active = filtered.filter((g) => g.status === 'active' || g.status === 'paused');
  const done = filtered.filter((g) => g.status === 'completed').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const archived = filtered.filter((g) => g.status === 'archived');
  return (
    <>
      <Section title="Life vision" action={<button className="link-btn" onClick={() => setVisionEdit('new')}>Add</button>}
        note="Where do you want your life to be in 3, 5 or 10 years? Goals below can point back to these.">
        <div className="list">
          {visions.length ? visions.map((v) => (
            <button key={v.id} className="row" onClick={() => setVisionEdit(v.id)}>
              <span className="row-main"><span className="row-title serif" style={{ fontSize: 18 }}>{v.title}</span>
                <span className="row-meta"><span>{HORIZON_LABEL[v.horizon]}</span>
                  <span>{goals.filter((g) => g.vision_id === v.id).length} goals</span></span>
                {v.body && <span className="small muted" style={{ display: 'block', marginTop: 4 }}>{v.body}</span>}</span>
            </button>
          )) : <Empty title="No vision written yet">Describe the life you’re building, in your own words.</Empty>}
        </div>
      </Section>

      <div className="mt">
        <Seg label="Goal category" value={cat} onChange={setCat}
          options={[{ value: 'all', label: 'All' }, { value: 'economic', label: 'Economic' }, { value: 'things', label: 'Things' }, { value: 'personal', label: 'Personal' }]} />
        {areas.length > 0 && (
          <select className="select mt-s" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Filter by life area">
            <option value="">All life areas</option>
            {areas.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      {HORIZON_ORDER.map((h) => {
        const list = active.filter((g) => g.horizon === h).sort((a, b) => a.sort - b.sort || (a.target_date ?? '9').localeCompare(b.target_date ?? '9'));
        if (!list.length) return null;
        return (
          <Section key={h} title={HORIZON_LABEL[h]} count={list.length}>
            <div className="list">{list.map((g) => <GoalCard key={g.id} goal={g} />)}</div>
          </Section>
        );
      })}
      {!active.length && (
        <Section title="Goals">
          <div className="list"><Empty title={goals.length ? 'No goals match these filters' : 'No goals yet'}>
            Write down what you want, why it matters, and the next step.
            <div className="mt-s"><button className="btn small" onClick={() => navigate('/plan/goal/new')}>Write a goal</button></div>
          </Empty></div>
        </Section>
      )}
      <SeminarNote>Write your goals down, both long-range dreams and short-range goals that build confidence — and give each one strong enough reasons.</SeminarNote>
      {done.length > 0 && (
        <Section title="Completed" count={done.length} action={<button className="link-btn" onClick={() => setShowDone((s) => !s)}>{showDone ? 'Hide' : 'Show'}</button>}>
          {showDone && <div className="list">{done.map((g) => <GoalCard key={g.id} goal={g} />)}</div>}
        </Section>
      )}
      {archived.length > 0 && (
        <Section title="Archived" count={archived.length} action={<button className="link-btn" onClick={() => setShowArchived((s) => !s)}>{showArchived ? 'Hide' : 'Show'}</button>}>
          {showArchived && <div className="list">{archived.map((g) => <GoalCard key={g.id} goal={g} />)}</div>}
        </Section>
      )}
      {visionEdit && <VisionSheet id={visionEdit === 'new' ? null : visionEdit} onClose={() => setVisionEdit(null)} />}
    </>
  );
}

function VisionSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const store = useStore();
  const v = useRows('visions').find((x) => x.id === id);
  const [title, setTitle] = useState(v?.title ?? '');
  const [body, setBody] = useState(v?.body ?? '');
  const [horizon, setHorizon] = useState<string>(v?.horizon ?? '10y');
  const save = () => {
    if (!title.trim()) return;
    const values = { title: title.trim(), body: body.trim() || null, horizon: horizon as any };
    if (v) store.update('visions', v.id, values); else store.create('visions', values);
    onClose();
  };
  return (
    <Sheet open title={v ? 'Life vision' : 'New vision'} onClose={onClose}>
      <div className="form">
        <Field label="In a few words"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. A calm, healthy family life with my own business" /></Field>
        <Field label="Horizon">
          <select className="select" value={horizon} onChange={(e) => setHorizon(e.target.value)}>
            <option value="10y">10 years</option><option value="5y">5 years</option><option value="3y">3 years</option><option value="1y">This year</option>
          </select>
        </Field>
        <Field label="Describe it"><AutoText serif value={body} onChange={(e) => setBody(e.target.value)} placeholder="What does a normal day look like? Where do you live? Who is with you?" /></Field>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={save} disabled={!title.trim()}>Save</button>
        {v && <button className="btn ghost danger-text" onClick={() => { store.remove('visions', v.id); toast('Vision deleted', { action: { label: 'Undo', run: () => store.restore('visions', v.id) } }); onClose(); }}>Delete</button>}
      </div>
    </Sheet>
  );
}

// ---------- tasks ----------

type TaskView = 'inbox' | 'today' | 'upcoming' | 'completed' | 'archived';

function TasksTab() {
  const tasks = useRows('tasks');
  const areas = useRows('areas');
  const today = useToday();
  const { query } = useLocation();
  const [view, setView] = useState<TaskView>((query.get('view') as TaskView) || 'today');
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const top = tasks.filter((t) => !t.parent_id);
  const search = q.trim().toLowerCase();
  const matches = (t: Task) => (!area || t.area_id === area) && (!search || `${t.title} ${t.notes ?? ''} ${t.tags.join(' ')}`.toLowerCase().includes(search));
  const lists: Record<TaskView, Task[]> = useMemo(() => ({
    inbox: top.filter((t) => t.status === 'open' && !t.archived && !t.due_date),
    today: top.filter((t) => t.status === 'open' && !t.archived && t.due_date && t.due_date <= today),
    upcoming: top.filter((t) => t.status === 'open' && !t.archived && t.due_date && t.due_date > today),
    completed: top.filter((t) => (t.status === 'done' || t.status === 'dismissed') && !t.archived),
    archived: top.filter((t) => t.archived),
  }), [top, today]);
  let shown = (search ? top.filter((t) => !t.archived || view === 'archived') : lists[view]).filter(matches);
  if (view === 'completed' && !search) shown = shown.sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at)).slice(0, 200);
  else shown = shown.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || (a.due_time ?? '').localeCompare(b.due_time ?? '') || b.priority - a.priority);

  const groups = new Map<string, Task[]>();
  if (view === 'upcoming' && !search) for (const t of shown) groups.set(t.due_date!, [...(groups.get(t.due_date!) ?? []), t]);

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <IconSearch size={18} />
          <input className="input" type="search" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" />
        </div>
      </div>
      <Seg label="Task view" value={view} onChange={setView} options={[
        { value: 'today', label: `Today ${lists.today.length || ''}`.trim() },
        { value: 'inbox', label: `Inbox ${lists.inbox.length || ''}`.trim() },
        { value: 'upcoming', label: 'Upcoming' },
        { value: 'completed', label: 'Completed' },
        { value: 'archived', label: 'Archived' },
      ]} />
      {areas.length > 0 && (
        <select className="select mt-s" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Filter by life area">
          <option value="">All life areas</option>
          {areas.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      <div className="mt">
        {view === 'upcoming' && !search ? (
          groups.size ? [...groups.entries()].map(([day, list]) => (
            <Section key={day} title={relDay(day as ISODate, today)} count={list.length}>
              <div className="list">{list.map((t) => <TaskRow key={t.id} task={t} showDate={false} />)}</div>
            </Section>
          )) : <div className="list"><Empty title="Nothing scheduled ahead">Tasks with a future due date appear here.</Empty></div>
        ) : (
          <div className="list">
            {shown.length ? shown.map((t) => <TaskRow key={t.id} task={t} />) : (
              <Empty title={search ? 'No tasks match' : view === 'inbox' ? 'Inbox is empty' : view === 'today' ? 'Nothing due today' : view === 'completed' ? 'No completed tasks yet' : 'Nothing archived'}>
                {view === 'inbox' && !search ? 'Tasks without a date land here. Give them a date when you’re ready.' : null}
              </Empty>
            )}
          </div>
        )}
      </div>
      {view === 'today' && <p className="tiny muted mt">Includes overdue tasks. Overdue dates never change on their own.</p>}
    </>
  );
}

// ---------- habits ----------

function HabitsTab() {
  const habits = useRows('habits');
  const idx = useHabitIndex();
  const today = useToday();
  const { week_starts_on } = useSettings();
  const [showArchived, setShowArchived] = useState(false);
  const active = habits.filter((h) => !h.archived && !isPaused(h, today)).sort((a, b) => a.sort - b.sort);
  const paused = habits.filter((h) => !h.archived && isPaused(h, today));
  const archived = habits.filter((h) => h.archived);
  const row = (h: typeof habits[number]) => {
    const s = currentStreak(h, idx, today, week_starts_on);
    return (
      <Link key={h.id} to={`/plan/habit/${h.id}`} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="inline" style={{ gap: 8 }}>
          <span className="row-title grow" style={{ fontWeight: 600 }}>{h.title}</span>
          <span className="small muted">{s.count > 0 ? `${s.count} ${s.unit}${s.count === 1 ? '' : 's'}` : ''}</span>
          <IconChevron size={18} className="faint" />
        </div>
        <div className="row-meta" style={{ marginTop: -4 }}><span>{scheduleLabel(h)}</span>{h.is_example && <span className="badge example">Example</span>}</div>
        <HabitWeekStrip habit={h} idx={idx} />
        <div className="tiny muted">{habitConsistencyText(h, idx, today)}</div>
      </Link>
    );
  };
  return (
    <>
      <SeminarNote>Start with the small disciplines. Doing them builds the strength for the bigger challenges.</SeminarNote>
      <Section title="Active" count={active.length || undefined}>
        <div className="list">{active.length ? active.map(row) : <Empty title="No habits yet">Add one small daily discipline to start.
          <div className="mt-s"><button className="btn small" onClick={() => openHabitEditor(null)}>Add a habit</button></div></Empty>}</div>
      </Section>
      {paused.length > 0 && <Section title="Paused" count={paused.length}><div className="list">{paused.map(row)}</div></Section>}
      {archived.length > 0 && (
        <Section title="Archived" count={archived.length} action={<button className="link-btn" onClick={() => setShowArchived((s) => !s)}>{showArchived ? 'Hide' : 'Show'}</button>}>
          {showArchived && <div className="list">{archived.map(row)}</div>}
        </Section>
      )}
      <div className="legend mt">
        <span><i style={{ background: 'var(--accent)' }} />Done</span>
        <span><i style={{ background: 'color-mix(in srgb, var(--accent) 45%, var(--line))' }} />Minimum</span>
        <span><i style={{ border: '1px dashed var(--line-strong)' }} />Rest / paused</span>
        <span><i style={{ background: 'var(--danger-soft)' }} />Missed</span>
      </div>
    </>
  );
}
