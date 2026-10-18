import { useMemo, useState } from 'react';
import { useApp, useRows, useSettings, useStore, useToday } from '../app/context';
import { addDays, dayOf, relDay } from '../lib/dates';
import { Link, navigate } from '../lib/router';
import { goalProgress } from '../logic/goals';
import { consistency } from '../logic/habits';
import { activityByArea, bucketsFor, habitConsistency, learningMinutes, tasksCompleted, winsPer } from '../logic/stats';
import type { Area, WinKind } from '../data/schema';
import { BarList, ColumnChart } from '../ui/Chart';
import { AutoText, Empty, Field, PageHead, Progress, Section, Seg, Sheet, confirm, toast } from '../ui/kit';
import {
  IconAreas, IconArchive, IconChart, IconChevron, IconDownload, IconEye, IconEyeOff, IconInfo, IconMoney, IconPeople,
  IconPlus, IconSearch, IconSettings, IconTrophy,
} from '../ui/icons';
import { GoalCard } from './Plan';
import { HabitRow, TaskRow, openHabitEditor, openTask, useHabitIndex } from './shared';

export function MoreScreen() {
  const { email } = useApp();
  const items = [
    { to: '/more/areas', icon: IconAreas, label: 'Life areas' },
    { to: '/more/progress', icon: IconChart, label: 'Progress' },
    { to: '/more/wins', icon: IconTrophy, label: 'Wins and achievements' },
    { to: '/more/money', icon: IconMoney, label: 'Money' },
    { to: '/more/people', icon: IconPeople, label: 'Relationships' },
    { to: '/more/settings', icon: IconSettings, label: 'Settings and account' },
    { to: '/more/data', icon: IconDownload, label: 'Backup, export and privacy' },
    { to: '/more/about', icon: IconInfo, label: 'About this app and its ideas' },
  ];
  return (
    <div className="page">
      <PageHead title="More" sub={email ?? undefined} />
      <div className="list">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="row">
            <span style={{ color: 'var(--accent-text)' }}><i.icon /></span>
            <span className="row-main row-title">{i.label}</span>
            <IconChevron size={18} className="faint" />
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------- life areas ----------

export function AreasScreen() {
  const store = useStore();
  const areas = useRows('areas').sort((a, b) => a.sort - b.sort);
  const [edit, setEdit] = useState<Area | 'new' | null>(null);
  const active = areas.filter((a) => !a.archived);
  const archived = areas.filter((a) => a.archived);
  const move = (a: Area, dir: -1 | 1) => {
    const list = active;
    const i = list.findIndex((x) => x.id === a.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const reordered = [...list];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    reordered.forEach((x, k) => { if (x.sort !== k) store.update('areas', x.id, { sort: k }); });
  };
  return (
    <div className="page">
      <PageHead backTo="/more" title="Life areas" sub="Use the ones that matter to you. Hidden areas stay out of reviews and pickers."
        actions={<button className="btn small" onClick={() => setEdit('new')}><IconPlus size={18} />Area</button>} />
      <div className="list">
        {active.length ? active.map((a, i) => (
          <div key={a.id} className="row">
            <Link to={`/area/${a.id}`} className="row-main" style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className="row-title">{a.icon} {a.name}</span>
              {a.hidden && <span className="row-meta">Hidden</span>}
            </Link>
            <button className="icon-btn" aria-label={`Move ${a.name} up`} disabled={i === 0} onClick={() => move(a, -1)}>↑</button>
            <button className="icon-btn" aria-label={`Move ${a.name} down`} disabled={i === active.length - 1} onClick={() => move(a, 1)}>↓</button>
            <button className="icon-btn" aria-label={`Edit ${a.name}`} onClick={() => setEdit(a)}><IconSettings size={18} /></button>
          </div>
        )) : <Empty title="No life areas">Add the parts of life you want to keep in balance.</Empty>}
      </div>
      {archived.length > 0 && (
        <Section title="Archived" count={archived.length}>
          <div className="list">{archived.map((a) => (
            <div key={a.id} className="row"><span className="row-main row-title muted">{a.icon} {a.name}</span>
              <button className="btn small secondary" onClick={() => store.update('areas', a.id, { archived: false })}>Restore</button></div>
          ))}</div>
        </Section>
      )}
      {edit && <AreaSheet area={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function AreaSheet({ area, onClose }: { area: Area | null; onClose: () => void }) {
  const store = useStore();
  const areas = useRows('areas');
  const [name, setName] = useState(area?.name ?? '');
  const [icon, setIcon] = useState(area?.icon ?? '');
  const [description, setDescription] = useState(area?.description ?? '');
  const save = () => {
    if (!name.trim()) return;
    const values = { name: name.trim().slice(0, 80), icon: icon.trim().slice(0, 4) || null, description: description.trim() || null };
    if (area) store.update('areas', area.id, values);
    else store.create('areas', { ...values, sort: areas.length });
    onClose();
  };
  return (
    <Sheet open title={area ? 'Edit life area' : 'New life area'} onClose={onClose}>
      <div className="form">
        <div className="inline">
          <Field label="Icon"><input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} style={{ maxWidth: 80 }} placeholder="🙂" /></Field>
          <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} data-autofocus /></Field>
        </div>
        <Field label="What this area means to you (optional)"><AutoText value={description} onChange={(e) => setDescription(e.target.value)} minRows={2} /></Field>
      </div>
      <div className="btn-row"><button className="btn" onClick={save} disabled={!name.trim()}>Save</button></div>
      {area && (
        <div className="btn-row">
          <button className="btn ghost" onClick={() => { store.update('areas', area.id, { hidden: !area.hidden }); onClose(); }}>
            {area.hidden ? <><IconEye size={18} />Show</> : <><IconEyeOff size={18} />Hide</>}
          </button>
          <button className="btn ghost" onClick={() => { store.update('areas', area.id, { archived: true }); toast('Archived. Its goals and tasks are kept.'); onClose(); }}><IconArchive size={18} />Archive</button>
          <button className="btn ghost danger-text" onClick={async () => {
            if (await confirm({ title: `Delete “${area.name}”?`, body: 'Goals, tasks and habits in this area are kept, just without an area.', confirmLabel: 'Delete area', danger: true })) {
              for (const t of ['goals', 'tasks', 'habits', 'milestones', 'learning_items', 'ideas', 'wins', 'time_blocks', 'visions'] as const) {
                for (const r of store.all(t)) if ((r as any).area_id === area.id) store.update(t, r.id, { area_id: null } as any);
              }
              store.remove('areas', area.id);
              onClose();
            }
          }}>Delete</button>
        </div>
      )}
    </Sheet>
  );
}

export function AreaDetail({ id }: { id: string }) {
  const today = useToday();
  const { tz } = useSettings();
  const area = useRows('areas').find((a) => a.id === id);
  const goals = useRows('goals').filter((g) => g.area_id === id);
  const projects = useRows('milestones').filter((m) => m.kind === 'project' && !m.done && (m.area_id === id || goals.some((g) => g.id === m.goal_id)));
  const habits = useRows('habits').filter((h) => h.area_id === id && !h.archived);
  const tasks = useRows('tasks').filter((t) => t.area_id === id && !t.parent_id && !t.archived);
  const ideas = useRows('ideas').filter((i) => i.area_id === id);
  const learning = useRows('learning_items').filter((l) => l.area_id === id);
  const idx = useHabitIndex();
  if (!area) return <div className="page"><PageHead title="Not found" backTo="/more/areas" /></div>;
  const from = addDays(today, -27);
  const doneRecent = tasks.filter((t) => t.status === 'done' && t.completed_at && dayOf(t.completed_at, tz) >= from).length;
  const checkins = habits.reduce((n, h) => n + consistency(h, idx, from, today, today).done, 0);
  const open = tasks.filter((t) => t.status === 'open').sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9'));
  return (
    <div className="page">
      <PageHead backTo="/more/areas" title={`${area.icon ?? ''} ${area.name}`} sub={area.description ?? undefined} />
      <div className="card"><div className="small">Last 4 weeks: <strong>{doneRecent}</strong> tasks completed, <strong>{checkins}</strong> habit check-ins.</div></div>
      <Section title="Goals" count={goals.filter((g) => g.status !== 'archived').length || undefined}
        action={<button className="link-btn" onClick={() => navigate('/plan/goal/new')}>Add</button>}>
        <div className="list">{goals.length ? goals.map((g) => <GoalCard key={g.id} goal={g} />) : <Empty title="No goals in this area" />}</div>
      </Section>
      {projects.length > 0 && <Section title="Open projects"><div className="list">{projects.map((p) => (
        <Link key={p.id} to={p.goal_id ? `/plan/goal/${p.goal_id}` : '#'} className="row"><span className="row-main row-title">{p.title}</span></Link>
      ))}</div></Section>}
      <Section title="Habits" action={<button className="link-btn" onClick={() => openHabitEditor(null, { area_id: id })}>Add</button>}>
        <div className="list">{habits.length ? habits.map((h) => <HabitRow key={h.id} habit={h} idx={idx} day={today} />) : <Empty title="No habits in this area" />}</div>
      </Section>
      <Section title="Open tasks" count={open.length || undefined} action={<button className="link-btn" onClick={() => openTask(null, { area_id: id })}>Add</button>}>
        <div className="list">{open.length ? open.slice(0, 30).map((t) => <TaskRow key={t.id} task={t} />) : <Empty title="No open tasks" />}</div>
      </Section>
      {(ideas.length > 0 || learning.length > 0) && (
        <Section title="Notes and learning">
          <div className="list">
            {learning.map((l) => <Link key={l.id} to={`/growth/item/${l.id}`} className="row"><span className="row-main"><span className="row-title">{l.title}</span><span className="row-meta">{l.kind}</span></span></Link>)}
            {ideas.slice(0, 10).map((i) => <div key={i.id} className="row"><span className="row-main serif">{i.body.slice(0, 160)}</span></div>)}
          </div>
        </Section>
      )}
      <p className="tiny faint mt">Updated {relDay(today, today).toLowerCase()} from your own entries.</p>
    </div>
  );
}

// ---------- progress ----------

type Range = 'weeks4' | 'weeks12' | 'months12';

export function ProgressScreen() {
  const today = useToday();
  const { tz, week_starts_on } = useSettings();
  const tasks = useRows('tasks');
  const habits = useRows('habits');
  const logs = useRows('habit_logs');
  const sessions = useRows('learning_sessions');
  const learning = useRows('learning_items');
  const wins = useRows('wins');
  const goals = useRows('goals').filter((g) => g.status === 'active');
  const milestones = useRows('milestones');
  const areas = useRows('areas');
  const [range, setRange] = useState<Range>('weeks12');
  const buckets = useMemo(() => bucketsFor(range, today, week_starts_on), [range, today, week_starts_on]);
  const from = buckets[0].start;
  const unit = range === 'months12' ? 'month' : 'week';
  const detail = (b: { start: string; end: string }) => `${b.start} to ${b.end < today ? b.end : today}`;
  const withDetail = <T extends { key: string }>(arr: T[]) => arr.map((d, i) => ({ ...d, detail: detail(buckets[i]) }));
  const hc = habitConsistency(habits.filter((h) => !h.archived), logs, buckets, today);
  const learningArea = useMemo(() => new Map(learning.map((l) => [l.id, l.area_id])), [learning]);
  const byArea = activityByArea({ tasks, logs, habits, sessions, learningArea, from, to: today, tz });
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const areaRows = [...byArea.entries()].map(([k, v]) => ({ label: areaName.get(k) ?? 'No life area', value: v.tasks + v.habits + v.learning, detail: `${v.tasks} tasks · ${v.habits} habits · ${v.learning} learning` }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="page">
      <PageHead backTo="/more" title="Progress" sub="Built only from what you’ve recorded. No scores." />
      <Seg label="Date range" value={range} onChange={setRange} options={[{ value: 'weeks4', label: '4 weeks' }, { value: 'weeks12', label: '12 weeks' }, { value: 'months12', label: '12 months' }]} />
      <p className="tiny muted">From {from} to today ({today}). Tap a column to see its value.</p>
      <p className="small" style={{ color: 'var(--ink-2)' }}>These charts show effort and activity. Outcomes are tracked separately, on each goal. Neither one measures your worth.</p>

      <ColumnChart title="Habit consistency" unit="%" max={100}
        how={`Check-ins ÷ scheduled days per ${unit}, across all active habits. Rest days and paused days are left out; the minimum version counts.`}
        data={withDetail(hc.map((d) => ({ ...d, label: d.label })))} format={(v) => `${v}%`} />
      <ColumnChart title="Tasks completed" how={`Number of tasks marked done per ${unit}, by the day you completed them.`} data={withDetail(tasksCompleted(tasks, buckets, tz))} format={(v) => String(v)} />
      <ColumnChart title="Learning time" how={`Minutes from logged learning sessions per ${unit}.`} data={withDetail(learningMinutes(sessions, buckets))} format={(v) => `${v} min`} />
      <ColumnChart title="Wins recorded" color="harvest" how={`Goals, milestones and other wins you recorded per ${unit}.`} data={withDetail(winsPer(wins, buckets))} format={(v) => String(v)} />
      <div className="mt"><BarList title="Activity by life area" how="Completed tasks + habit check-ins + learning sessions in the selected range." rows={areaRows} /></div>

      <Section title="Goals in progress" note="Each goal’s own measure: its number, its milestones, or your assessment.">
        <div className="card">
          {goals.length ? goals.map((g) => {
            const p = goalProgress(g, milestones);
            return (
              <Link key={g.id} to={`/plan/goal/${g.id}`} style={{ display: 'block', color: 'inherit', textDecoration: 'none', padding: '6px 0' }}>
                <div className="stat-line small"><span>{g.title}</span><span className="num">{p.pct == null ? '—' : `${p.pct}%`}</span></div>
                <Progress pct={p.pct} /><div className="basis">{p.basis}</div>
              </Link>
            );
          }) : <p className="small muted" style={{ margin: 0 }}>No active goals.</p>}
        </div>
      </Section>
    </div>
  );
}

// ---------- wins ----------

const WIN_LABEL: Record<WinKind, string> = { goal: 'Goal', milestone: 'Milestone', habit: 'Habit', learning: 'Learning', personal: 'Personal' };

export function WinsScreen() {
  const store = useStore();
  const today = useToday();
  const wins = useRows('wins');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState(today);
  const search = q.trim().toLowerCase();
  const shown = wins.filter((w) => !search || `${w.title} ${w.note ?? ''}`.toLowerCase().includes(search)).sort((a, b) => b.day.localeCompare(a.day));
  const byYear = new Map<string, typeof shown>();
  for (const w of shown) byYear.set(w.day.slice(0, 4), [...(byYear.get(w.day.slice(0, 4)) ?? []), w]);
  return (
    <div className="page">
      <PageHead backTo="/more" title="Wins" sub="A record of what you’ve achieved"
        actions={<button className="btn small" onClick={() => setAdding(true)}><IconPlus size={18} />Win</button>} />
      <div className="toolbar"><div className="search"><IconSearch size={18} /><input className="input" type="search" placeholder="Search wins" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search wins" /></div></div>
      {!shown.length && <div className="list"><Empty title={wins.length ? 'No wins match' : 'No wins recorded yet'}>Completed goals and milestones land here automatically. Add anything else worth celebrating.</Empty></div>}
      {[...byYear.entries()].map(([y, list]) => (
        <Section key={y} title={y} count={list.length}>
          <div className="list wins-list">{list.map((w) => (
            <div key={w.id} className="row">
              <span className="win-mark"><IconTrophy size={20} /></span>
              <span className="row-main"><span className="row-title">{w.title}</span>
                <span className="row-meta"><span>{relDay(w.day, today)}</span><span>{WIN_LABEL[w.kind]}</span>{w.is_example && <span className="badge example">Example</span>}</span>
                {w.note && <span className="small muted" style={{ display: 'block' }}>{w.note}</span>}</span>
              <button className="icon-btn" aria-label={`Delete ${w.title}`} onClick={async () => {
                if (await confirm({ title: 'Remove this win?', confirmLabel: 'Remove', danger: true })) store.remove('wins', w.id);
              }}>×</button>
            </div>
          ))}</div>
        </Section>
      ))}
      <Sheet open={adding} onClose={() => setAdding(false)} title="Record a win">
        <div className="form">
          <Field label="What did you achieve?"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus /></Field>
          <Field label="When"><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value || today)} /></Field>
          <Field label="Note (optional)"><AutoText value={note} onChange={(e) => setNote(e.target.value)} minRows={2} /></Field>
        </div>
        <button className="btn block mt" disabled={!title.trim()} onClick={() => {
          store.create('wins', { title: title.trim(), note: note.trim() || null, day, kind: 'personal' });
          setTitle(''); setNote(''); setAdding(false);
          toast('Win recorded. Well done.', { kind: 'win' });
        }}>Save win</button>
      </Sheet>
    </div>
  );
}

// ---------- about ----------

export function AboutScreen() {
  return (
    <div className="page">
      <PageHead backTo="/more" title="About My Life" />
      <div className="prose">
        <p>My Life is a personal planner built around ideas from a Jim Rohn seminar transcript. It is an independent personal project and is <strong>not affiliated with, endorsed by, or connected to Jim Rohn or his estate</strong>. Everything below is paraphrased, not quoted.</p>
        <h3>Ideas from the seminar</h3>
        <p><strong>You change, then things change.</strong> The seminar’s theme is that the main key to a better future is the person you become. The useful question isn’t only “what am I getting?” but “what am I becoming?” → Every goal asks who you must become; the Growth tab holds your learning and skills.</p>
        <p><strong>Written goals, long and short range.</strong> Dreams for 3, 5, 10 years and beyond, plus short-range goals that build confidence. Three kinds: economic goals, things you want, and personal development. → Plan › Goals, with vision, horizons and categories kept separate from life areas.</p>
        <p><strong>Reasons come first.</strong> With strong enough reasons you can do remarkable things; the answers follow the reasons. → Each goal has a “why” and “who benefits”, shown on Today.</p>
        <p><strong>Ask clearly.</strong> Be specific — how much, by when. → Measurable targets and dates.</p>
        <p><strong>Small disciplines.</strong> Start with the little disciplines; they build the strength for big ones. → Habits, each with a minimum version for hard days.</p>
        <p><strong>Keep a journal; study.</strong> Don’t use your head as a filing cabinet. Read, find out how things work. → Journal, idea notebook, learning items, and “Turn this idea into action”.</p>
        <p><strong>Majors and minors.</strong> At the end of each week and month, check you’re not spending major time on minor things. → Weekly and monthly reviews.</p>
        <p><strong>The seasons.</strong> Life is like the seasons: learn to handle winter, take advantage of spring, protect your crops in summer, and reap in autumn without complaint or apology. → The optional Life season reflection.</p>
        <p><strong>Sowing and reaping; responsibility.</strong> It isn’t what happens that decides how life turns out, but what you do about it. Sometimes you lose anyway — hail can hit a good crop. → Evening review asks what got in the way and what you’ll change, without blame.</p>
        <p><strong>The law of use.</strong> What you don’t use, you lose. → Reviews flag goals with no recent activity.</p>
        <p><strong>Celebrate.</strong> When you reach something you worked for, celebrate it. → A planned celebration on each goal, and the Wins record.</p>
        <p><strong>The day that turns your life around.</strong> Disgust (“I’ve had it”), decision, desire, resolve — then action. → The Fresh start workflow, which ends in one small task for today.</p>
        <h3>Added by this app (not from the seminar)</h3>
        <p>Life areas, milestones and projects, tasks and subtasks, recurring tasks, time blocks, streaks and consistency percentages, charts, the money and relationships sections, calendar export, offline sync, backups and the morning/evening question sets are ordinary modern planning features added for usefulness.</p>
        <h3>How the app treats you</h3>
        <p>There is no life score. Charts show effort you recorded, kept apart from outcomes. Missed days are information, not failure; rest days and pauses never break streaks.</p>
        <h3>Privacy</h3>
        <p>Your data is stored in your own Supabase project and on this device. Database rules allow each account to read and write only its own records. Nothing is sent to an AI service, and nothing is shared or sent to anyone automatically.</p>
      </div>
    </div>
  );
}

