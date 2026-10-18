import { useState } from 'react';
import { useRows, useStore, useToday } from '../app/context';
import { completeGoal, logGoalEvent, reopenGoal, toggleMilestone } from '../app/actions';
import { dayOf, relDay } from '../lib/dates';
import { Link, back, navigate } from '../lib/router';
import { CATEGORY_HINT, CATEGORY_LABEL, HORIZON_LABEL, fmtNum, goalProgress } from '../logic/goals';
import type { Goal, GoalCategory, Horizon, Obstacle, ProgressMode } from '../data/schema';
import { AutoText, Check, Empty, Field, NumberInput, PageHead, Progress, Section, Seg, SeminarNote, Sheet, confirm, toast } from '../ui/kit';
import { IconEdit, IconPlus, IconTrash } from '../ui/icons';
import { AreaSelect, HabitRow, TaskRow, openHabitEditor, openTask, useAreaName, useHabitIndex } from './shared';
import { useSettings } from '../app/context';

export function GoalDetail({ id }: { id: string }) {
  const store = useStore();
  const today = useToday();
  const { tz } = useSettings();
  const goal = useRows('goals').find((g) => g.id === id);
  const milestones = useRows('milestones').filter((m) => m.goal_id === id).sort((a, b) => a.sort - b.sort);
  const tasks = useRows('tasks').filter((t) => t.goal_id === id && !t.parent_id && !t.archived);
  const habits = useRows('habits').filter((h) => h.goal_id === id && !h.archived);
  const events = useRows('goal_events').filter((e) => e.goal_id === id).sort((a, b) => b.at.localeCompare(a.at));
  const visions = useRows('visions');
  const areaName = useAreaName();
  const idx = useHabitIndex();
  const [newMs, setNewMs] = useState('');
  const [msKind, setMsKind] = useState<'milestone' | 'project'>('milestone');
  const [progressOpen, setProgressOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showDoneTasks, setShowDoneTasks] = useState(false);

  if (!goal) return <div className="page"><PageHead title="Goal not found" backTo="/plan" /></div>;
  const p = goalProgress(goal, milestones);
  const vision = visions.find((v) => v.id === goal.vision_id);
  const openTasks = tasks.filter((t) => t.status === 'open');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  return (
    <div className="page">
      <PageHead backTo="/plan" title={goal.title}
        sub={<>{CATEGORY_LABEL[goal.category]} · {HORIZON_LABEL[goal.horizon]}{goal.target_date ? ` · by ${goal.target_date}` : ''}{areaName(goal.area_id) ? ` · ${areaName(goal.area_id)}` : ''}</>}
        actions={<button className="icon-btn" aria-label="Edit goal" onClick={() => navigate(`/plan/goal/${goal.id}/edit`)}><IconEdit /></button>} />
      {goal.is_example && <p><span className="badge example">Example — remove all examples in Settings</span></p>}
      {goal.status === 'completed' && <div className="banner warn"><div>Completed {goal.completed_at ? relDay(dayOf(goal.completed_at, tz), today).toLowerCase() : ''}. {goal.celebration ? `Celebration: ${goal.celebration}` : ''}</div></div>}
      {goal.status === 'paused' && <div className="banner"><div>This goal is paused. It won’t appear in reminders until you resume it.</div></div>}

      <div className="card">
        <div className="stat-line"><span style={{ fontWeight: 600 }}>Progress</span><span className="num">{p.pct == null ? '—' : `${p.pct}%`}</span></div>
        <div className="mt-s"><Progress pct={p.pct} /></div>
        <div className="basis">{p.basis}. Completing linked tasks doesn’t change this number.</div>
        {goal.status !== 'completed' && goal.progress_mode !== 'milestones' && (
          <button className="btn small secondary mt" onClick={() => setProgressOpen(true)}>Update progress</button>
        )}
      </div>

      {(goal.why || goal.who_benefits) && (
        <div className="why-card" style={{ marginTop: 14 }}>
          <div className="label">Why it matters{goal.who_benefits ? ` · who benefits: ${goal.who_benefits}` : ''}</div>
          {goal.why && <p className="why">{goal.why}</p>}
        </div>
      )}

      <dl className="kv card mt">
        {goal.description && <div><dt>The result I want</dt><dd>{goal.description}</dd></div>}
        {goal.become && <div><dt>Who I need to become (skills and qualities)</dt><dd>{goal.become}</dd></div>}
        {vision && <div><dt>Part of my vision</dt><dd>{vision.title}</dd></div>}
        {goal.celebration && <div><dt>How I’ll celebrate</dt><dd>{goal.celebration}</dd></div>}
        {!goal.description && !goal.become && !vision && !goal.celebration && <div className="muted small">Add the result you want, who you need to become and how you’ll celebrate — tap edit.</div>}
      </dl>

      {goal.status === 'active' && (
        <Section title="Next action">
          <div className="card">
            {goal.next_action ? (
              <>
                <p style={{ margin: 0 }}>{goal.next_action}</p>
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button className="btn small" onClick={() => openTask(null, { title: goal.next_action!, goal_id: goal.id, area_id: goal.area_id, due_date: today })}>Make it a task for today</button>
                  <button className="btn small secondary" onClick={() => navigate(`/plan/goal/${goal.id}/edit`)}>Change</button>
                </div>
              </>
            ) : <p className="muted" style={{ margin: 0 }}>What is the very next physical step? <button className="link-btn" onClick={() => navigate(`/plan/goal/${goal.id}/edit`)}>Add one</button></p>}
          </div>
        </Section>
      )}

      <Section title="Milestones and projects" count={milestones.length || undefined}>
        <div className="list">
          {milestones.map((m) => (
            <div key={m.id} className={`row has-check ${m.done ? 'done' : ''}`}>
              <Check on={m.done} label={`Complete ${m.title}`} onToggle={() => toggleMilestone(store, m, today)} />
              <div className="row-main">
                <div className="row-title">{m.title}</div>
                <div className="row-meta">{m.kind === 'project' && <span className="badge accent">Project</span>}{m.due_date && <span>By {m.due_date}</span>}
                  <span>{tasks.filter((t) => t.milestone_id === m.id && t.status === 'open').length} open tasks</span></div>
              </div>
              <button className="icon-btn" aria-label={`Add task to ${m.title}`} onClick={() => openTask(null, { goal_id: goal.id, milestone_id: m.id, area_id: goal.area_id })}><IconPlus size={18} /></button>
              <button className="icon-btn" aria-label={`Delete ${m.title}`} onClick={async () => {
                if (await confirm({ title: `Delete “${m.title}”?`, confirmLabel: 'Delete', danger: true })) {
                  store.remove('milestones', m.id);
                  logGoalEvent(store, goal.id, 'milestone_removed', `Removed: ${m.title}`);
                }
              }}><IconTrash size={18} /></button>
            </div>
          ))}
          <form className="row" onSubmit={(e) => {
            e.preventDefault();
            if (!newMs.trim()) return;
            store.create('milestones', { goal_id: goal.id, title: newMs.trim(), kind: msKind, sort: milestones.length, area_id: goal.area_id });
            logGoalEvent(store, goal.id, 'milestone_added', `Added ${msKind}: ${newMs.trim()}`);
            setNewMs('');
          }}>
            <input className="input grow" style={{ border: 0, padding: 0, minHeight: 36 }} placeholder={`Add a ${msKind}`} value={newMs} onChange={(e) => setNewMs(e.target.value)} />
            <select className="select" style={{ width: 'auto', minHeight: 36, padding: '4px 32px 4px 10px', backgroundPosition: 'calc(100% - 18px) 15px, calc(100% - 13px) 15px' }}
              value={msKind} onChange={(e) => setMsKind(e.target.value as 'milestone' | 'project')} aria-label="Kind">
              <option value="milestone">Milestone</option><option value="project">Project</option>
            </select>
          </form>
        </div>
      </Section>

      <Section title="Tasks" count={openTasks.length || undefined}
        action={<button className="link-btn" onClick={() => openTask(null, { goal_id: goal.id, area_id: goal.area_id })}>Add</button>}>
        <div className="list">
          {openTasks.length ? openTasks.map((t) => <TaskRow key={t.id} task={t} />) : <Empty title="No open tasks">Break the next milestone into a task you can do this week.</Empty>}
        </div>
        {doneTasks.length > 0 && <button className="link-btn mt-s" onClick={() => setShowDoneTasks((s) => !s)}>{showDoneTasks ? 'Hide' : 'Show'} {doneTasks.length} completed</button>}
        {showDoneTasks && <div className="list mt-s">{doneTasks.map((t) => <TaskRow key={t.id} task={t} />)}</div>}
      </Section>

      <Section title="Supporting habits" action={<button className="link-btn" onClick={() => openHabitEditor(null, { goal_id: goal.id, area_id: goal.area_id })}>Add</button>}>
        <div className="list">{habits.length ? habits.map((h) => <HabitRow key={h.id} habit={h} idx={idx} day={today} />) : <Empty title="No habits linked">A small daily discipline often moves a goal more than a big push.</Empty>}</div>
      </Section>

      {goal.obstacles.length > 0 && (
        <Section title="Obstacles and responses">
          <div className="list">{goal.obstacles.map((o, i) => (
            <div key={i} className="row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <div className="row-title">{o.obstacle}</div>
              <div className="small" style={{ color: 'var(--accent-text)' }}>→ {o.response || 'No response planned yet'}</div>
            </div>
          ))}</div>
        </Section>
      )}

      {events.length > 0 && <Section title="History" note="Important changes to this goal, newest first." action={<button className="link-btn" onClick={() => setShowHistory((s) => !s)}>{showHistory ? 'Hide' : `Show ${events.length}`}</button>}>
        {showHistory && <div className="list">{events.map((e) => (
          <div key={e.id} className="row"><div className="row-main"><div className="row-title small">{e.summary}</div>
            <div className="row-meta">{relDay(dayOf(e.at, tz), today)}</div></div></div>
        ))}</div>}
      </Section>}

      <div className="btn-row">
        {goal.status === 'active' && <button className="btn" onClick={() => completeGoal(store, goal, today)}>Mark goal complete</button>}
        {goal.status === 'completed' && <button className="btn secondary" onClick={() => reopenGoal(store, goal)}>Reopen goal</button>}
        {goal.status === 'active' && <button className="btn secondary" onClick={() => { store.update('goals', goal.id, { status: 'paused' }); logGoalEvent(store, goal.id, 'paused', 'Goal paused'); }}>Pause</button>}
        {goal.status === 'paused' && <button className="btn secondary" onClick={() => { store.update('goals', goal.id, { status: 'active' }); logGoalEvent(store, goal.id, 'resumed', 'Goal resumed'); }}>Resume</button>}
      </div>
      <div className="btn-row">
        {goal.status !== 'archived'
          ? <button className="btn ghost" onClick={() => { store.update('goals', goal.id, { status: 'archived' }); logGoalEvent(store, goal.id, 'archived', 'Goal archived'); toast('Archived. Find it under Plan › Goals › Archived.'); back('/plan'); }}>Archive</button>
          : <button className="btn ghost" onClick={() => { store.update('goals', goal.id, { status: 'active' }); logGoalEvent(store, goal.id, 'unarchived', 'Goal restored'); }}>Restore from archive</button>}
        <button className="btn ghost danger-text" onClick={async () => {
          if (await confirm({ title: 'Delete this goal?', body: 'Its milestones and history are deleted. Linked tasks and habits are kept but unlinked. Completed goals are usually better archived.', confirmLabel: 'Delete goal', danger: true })) {
            milestones.forEach((m) => store.remove('milestones', m.id));
            events.forEach((e) => store.remove('goal_events', e.id));
            tasks.forEach((t) => store.update('tasks', t.id, { goal_id: null, milestone_id: null }));
            habits.forEach((h) => store.update('habits', h.id, { goal_id: null }));
            store.remove('goals', goal.id);
            toast('Goal deleted');
            back('/plan');
          }
        }}>Delete</button>
      </div>
      {progressOpen && <ProgressSheet goal={goal} onClose={() => setProgressOpen(false)} />}
    </div>
  );
}

function ProgressSheet({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const store = useStore();
  const [value, setValue] = useState<number | null>(goal.progress_mode === 'numeric' ? goal.current_value ?? goal.start_value ?? 0 : goal.manual_progress ?? 0);
  const save = () => {
    if (goal.progress_mode === 'numeric') {
      store.update('goals', goal.id, { current_value: value });
      logGoalEvent(store, goal.id, 'progress', `Progress updated: ${fmtNum(goal.current_value)} → ${fmtNum(value)}${goal.unit ? ` ${goal.unit}` : ''}`, { from: goal.current_value, to: value });
    } else {
      const v = Math.max(0, Math.min(100, Math.round(value ?? 0)));
      store.update('goals', goal.id, { manual_progress: v });
      logGoalEvent(store, goal.id, 'progress', `Assessment updated: ${goal.manual_progress ?? 0}% → ${v}%`, { from: goal.manual_progress, to: v });
    }
    onClose();
  };
  return (
    <Sheet open title="Update progress" onClose={onClose}>
      {goal.progress_mode === 'numeric' ? (
        <Field label={`Current value${goal.unit ? ` (${goal.unit})` : ''}`} hint={`Target: ${fmtNum(goal.target_value)}${goal.unit ? ` ${goal.unit}` : ''}`}>
          <NumberInput value={value} onChange={setValue} />
        </Field>
      ) : (
        <Field label={`Your honest assessment: ${value ?? 0}%`}>
          <input type="range" min={0} max={100} step={5} value={value ?? 0} onChange={(e) => setValue(Number(e.target.value))} style={{ width: '100%', minHeight: 44, accentColor: 'var(--accent)' }} />
        </Field>
      )}
      <button className="btn block mt" onClick={save}>Save progress</button>
    </Sheet>
  );
}

// ---------- form ----------

export function GoalForm({ id }: { id: string | null }) {
  const store = useStore();
  const existing = useRows('goals').find((g) => g.id === id);
  const visions = useRows('visions');
  const [d, setD] = useState<Partial<Goal>>(() => existing ? structuredClone(existing) : {
    title: '', category: 'personal', horizon: '1y', progress_mode: 'milestones', obstacles: [],
  });
  const set = (p: Partial<Goal>) => setD((x) => ({ ...x, ...p }));
  const obstacles = d.obstacles ?? [];
  const setObstacle = (i: number, p: Partial<Obstacle>) => set({ obstacles: obstacles.map((o, j) => (j === i ? { ...o, ...p } : o)) });

  const save = () => {
    if (!d.title?.trim()) { toast('What do you want? Add a title.'); return; }
    const values: Partial<Goal> = {
      title: d.title.trim(), description: d.description?.trim() || null, why: d.why?.trim() || null,
      who_benefits: d.who_benefits?.trim() || null, category: d.category ?? 'personal', horizon: d.horizon ?? '1y',
      target_date: d.target_date || null, area_id: d.area_id ?? null, vision_id: d.vision_id ?? null,
      progress_mode: d.progress_mode ?? 'milestones', start_value: d.start_value ?? null, target_value: d.target_value ?? null,
      current_value: d.current_value ?? d.start_value ?? null, unit: d.unit?.trim() || null,
      manual_progress: d.progress_mode === 'manual' ? d.manual_progress ?? 0 : d.manual_progress ?? null,
      become: d.become?.trim() || null, obstacles: obstacles.filter((o) => o.obstacle.trim()),
      next_action: d.next_action?.trim() || null, celebration: d.celebration?.trim() || null,
    };
    if (existing) {
      store.update('goals', existing.id, values);
      const changes: string[] = [];
      if (existing.title !== values.title) changes.push('title');
      if ((existing.why ?? null) !== values.why) changes.push('why');
      if (existing.target_value !== values.target_value || existing.target_date !== values.target_date) changes.push('target');
      if (existing.progress_mode !== values.progress_mode) changes.push('progress method');
      if (existing.horizon !== values.horizon) changes.push('horizon');
      if (changes.length) logGoalEvent(store, existing.id, 'edited', `Changed ${changes.join(', ')}`, { before: { title: existing.title, why: existing.why, target_value: existing.target_value, target_date: existing.target_date, horizon: existing.horizon } });
      navigate(`/plan/goal/${existing.id}`, { replace: true });
    } else {
      const g = store.create('goals', values);
      logGoalEvent(store, g.id, 'created', 'Goal written down');
      navigate(`/plan/goal/${g.id}`, { replace: true });
    }
    toast('Goal saved');
  };

  return (
    <div className="page">
      <PageHead backTo={existing ? `/plan/goal/${existing.id}` : '/plan'} title={existing ? 'Edit goal' : 'New goal'} />
      <div className="form">
        <Field label="What do you want?"><input className="input" value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="Be specific: how much, by when" data-autofocus /></Field>
        <Field label="Describe the result"><AutoText value={d.description ?? ''} onChange={(e) => set({ description: e.target.value })} minRows={2} placeholder="What will be true when this is done?" /></Field>
        <Field label="Why does it matter to you?" hint="Strong reasons make the effort worth it. This shows on your Today screen.">
          <AutoText serif value={d.why ?? ''} onChange={(e) => set({ why: e.target.value })} minRows={2} />
        </Field>
        <Field label="Who benefits?"><input className="input" value={d.who_benefits ?? ''} onChange={(e) => set({ who_benefits: e.target.value })} placeholder="e.g. my family, my future self" /></Field>
        <div className="field"><span className="field-label">Kind of goal</span>
          <Seg label="Kind of goal" value={d.category ?? 'personal'} onChange={(v) => set({ category: v as GoalCategory })}
            options={[{ value: 'economic', label: 'Economic' }, { value: 'things', label: 'Things I want' }, { value: 'personal', label: 'Personal dev.' }]} />
          <span className="hint">{CATEGORY_HINT[(d.category ?? 'personal') as GoalCategory]}</span>
        </div>
        <div className="inline">
          <Field label="Horizon">
            <select className="select" value={d.horizon} onChange={(e) => set({ horizon: e.target.value as Horizon })}>
              {Object.entries(HORIZON_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Target date"><input className="input" type="date" value={d.target_date ?? ''} onChange={(e) => set({ target_date: e.target.value || null })} /></Field>
        </div>
        <AreaSelect value={d.area_id ?? null} onChange={(v) => set({ area_id: v })} />
        {visions.length > 0 && (
          <Field label="Part of which life vision?">
            <select className="select" value={d.vision_id ?? ''} onChange={(e) => set({ vision_id: e.target.value || null })}>
              <option value="">None</option>
              {visions.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
            </select>
          </Field>
        )}

        <div className="field"><span className="field-label">How will you measure progress?</span>
          <Seg label="Progress method" value={d.progress_mode ?? 'milestones'} onChange={(v) => set({ progress_mode: v as ProgressMode })}
            options={[{ value: 'milestones', label: 'Milestones' }, { value: 'numeric', label: 'A number' }, { value: 'manual', label: 'My judgement' }]} />
          <span className="hint">{d.progress_mode === 'numeric' ? 'You update the current number yourself.' : d.progress_mode === 'manual' ? 'You set a percentage based on your honest assessment.' : 'Progress = milestones completed ÷ total milestones.'} Finishing tasks never changes it automatically.</span>
        </div>
        {d.progress_mode === 'numeric' && (
          <div className="inline">
            <Field label="Start"><NumberInput value={d.start_value ?? null} onChange={(n) => set({ start_value: n })} placeholder="0" /></Field>
            <Field label="Target"><NumberInput value={d.target_value ?? null} onChange={(n) => set({ target_value: n })} /></Field>
            <Field label="Unit"><input className="input" value={d.unit ?? ''} onChange={(e) => set({ unit: e.target.value })} placeholder="USD, kg…" /></Field>
          </div>
        )}

        <Field label="Who must you become?" hint="Skills and qualities to develop for this goal.">
          <AutoText value={d.become ?? ''} onChange={(e) => set({ become: e.target.value })} minRows={2} placeholder="e.g. more patient, better at saying no, skilled at C#" />
        </Field>
        <Field label="Next action" hint="The very next physical step."><input className="input" value={d.next_action ?? ''} onChange={(e) => set({ next_action: e.target.value })} /></Field>

        <div className="field">
          <span className="field-label">Obstacles and how you’ll respond</span>
          {obstacles.map((o, i) => (
            <div key={i} className="card" style={{ padding: 12 }}>
              <input className="input" placeholder="Obstacle" value={o.obstacle} onChange={(e) => setObstacle(i, { obstacle: e.target.value })} aria-label={`Obstacle ${i + 1}`} />
              <input className="input mt-s" placeholder="Practical response" value={o.response} onChange={(e) => setObstacle(i, { response: e.target.value })} aria-label={`Response ${i + 1}`} />
              <button type="button" className="link-btn danger-text" onClick={() => set({ obstacles: obstacles.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn small secondary" style={{ justifySelf: 'start' }} onClick={() => set({ obstacles: [...obstacles, { obstacle: '', response: '' }] })}><IconPlus size={16} />Add obstacle</button>
        </div>
        <Field label="How will you celebrate?" hint="Decide now, so finishing has a reward waiting.">
          <input className="input" value={d.celebration ?? ''} onChange={(e) => set({ celebration: e.target.value })} />
        </Field>
      </div>
      <SeminarNote>Be specific when you ask for what you want — how much, by when — and make plans like an adult while believing in them like a child.</SeminarNote>
      <div className="btn-row"><button className="btn block" onClick={save}>Save goal</button></div>
      {!existing && <p className="tiny muted">You can add milestones, tasks and habits after saving.</p>}
      <Link to="/plan" className="sr-only">Back to Plan</Link>
    </div>
  );
}
