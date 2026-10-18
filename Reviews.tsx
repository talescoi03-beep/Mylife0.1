import { useMemo, useState } from 'react';
import { updateSettings, useRows, useSettings, useStore, useToday } from '../app/context';
import { logGoalEvent } from '../app/actions';
import { addDays, dayOf, endOfMonth, longDay, monthLabel, relDay, startOfMonth, startOfWeek, type ISODate } from '../lib/dates';
import { stableId } from '../lib/ids';
import { Link, back, navigate, useLocation } from '../lib/router';
import { goalProgress } from '../logic/goals';
import { isCompletion } from '../logic/habits';
import { SEASONS } from '../logic/templates';
import type { Season, WeekPriority } from '../data/schema';
import { AutoText, Empty, PageHead, Progress, Section, Seg, SeminarNote, Toggle, toast } from '../ui/kit';
import { IconPlus, IconX, SeasonAutumn, SeasonSpring, SeasonSummer, SeasonWinter } from '../ui/icons';
import { GoalSelect, useAreaName } from './shared';

/** Activity in a date range, computed from real entries only. */
function useActivity(from: ISODate, to: ISODate) {
  const { tz } = useSettings();
  const tasks = useRows('tasks');
  const logs = useRows('habit_logs');
  const habits = useRows('habits');
  const sessions = useRows('learning_sessions');
  const wins = useRows('wins');
  const events = useRows('goal_events');
  const milestones = useRows('milestones');
  return useMemo(() => {
    const inRange = (d: ISODate) => d >= from && d <= to;
    const doneTasks = tasks.filter((t) => t.status === 'done' && t.completed_at && inRange(dayOf(t.completed_at, tz)));
    const habitById = new Map(habits.map((h) => [h.id, h]));
    const checkins = logs.filter((l) => inRange(l.day) && habitById.has(l.habit_id) && isCompletion(l, habitById.get(l.habit_id)!));
    const learn = sessions.filter((s) => inRange(s.day));
    const winList = wins.filter((w) => inRange(w.day)).sort((a, b) => b.day.localeCompare(a.day));
    const goalTouched = new Set<string>();
    doneTasks.forEach((t) => t.goal_id && goalTouched.add(t.goal_id));
    checkins.forEach((l) => { const g = habitById.get(l.habit_id)?.goal_id; if (g) goalTouched.add(g); });
    events.filter((e) => inRange(dayOf(e.at, tz)) && e.kind !== 'created').forEach((e) => goalTouched.add(e.goal_id));
    milestones.filter((m) => m.done_at && inRange(dayOf(m.done_at, tz))).forEach((m) => m.goal_id && goalTouched.add(m.goal_id));
    const byArea = new Map<string, number>();
    const bump = (a: string | null | undefined) => byArea.set(a ?? '', (byArea.get(a ?? '') ?? 0) + 1);
    doneTasks.forEach((t) => bump(t.area_id));
    checkins.forEach((l) => bump(habitById.get(l.habit_id)?.area_id));
    return { doneTasks, checkins, learnMinutes: learn.reduce((n, s) => n + (s.minutes ?? 0), 0), winList, goalTouched, byArea };
  }, [from, to, tz, tasks, logs, habits, sessions, wins, events, milestones]);
}

function ActivitySummary({ act }: { act: ReturnType<typeof useActivity> }) {
  return (
    <div className="card">
      <div className="stat-line"><span>Tasks completed</span><strong className="num">{act.doneTasks.length}</strong></div>
      <div className="stat-line mt-s"><span>Habit check-ins</span><strong className="num">{act.checkins.length}</strong></div>
      <div className="stat-line mt-s"><span>Learning time</span><strong className="num">{act.learnMinutes} min</strong></div>
      <div className="stat-line mt-s"><span>Wins recorded</span><strong className="num">{act.winList.length}</strong></div>
      <p className="tiny muted" style={{ marginBottom: 0 }}>Counts what you did, not how good the week was. Effort and outcomes are different things.</p>
    </div>
  );
}

// ---------- weekly ----------

export function WeeklyReview() {
  const store = useStore();
  const today = useToday();
  const { week_starts_on } = useSettings();
  const { query } = useLocation();
  const thisWeek = startOfWeek(today, week_starts_on);
  const [weekStart, setWeekStart] = useState<ISODate>(query.get('week') ?? thisWeek);
  const weekEnd = addDays(weekStart, 6);
  const nextWeek = addDays(weekStart, 7);
  const act = useActivity(weekStart, weekEnd);
  const goals = useRows('goals').filter((g) => g.status === 'active');
  const plans = useRows('week_plans');
  const areaName = useAreaName();
  const entries = useRows('journal_entries');
  const existing = entries.find((e) => e.kind === 'weekly' && e.answers.week_start === weekStart);
  const planId = stableId('week_plan', store.userId, weekStart);
  const nextPlanId = stableId('week_plan', store.userId, nextWeek);
  const plan = plans.find((p) => p.id === planId);
  const nextPlan = plans.find((p) => p.id === nextPlanId);
  const [answers, setAnswers] = useState<Record<string, string>>(existing?.answers ?? {});
  const [next, setNext] = useState<WeekPriority[]>(nextPlan?.priorities?.length ? nextPlan.priorities : [{ text: '' }, { text: '' }, { text: '' }]);
  const neglected = goals.filter((g) => !act.goalTouched.has(g.id));
  const setA = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  const areas = [...act.byArea.entries()].sort((a, b) => b[1] - a[1]);

  const save = () => {
    const values = { day: weekEnd < today ? weekEnd : today, kind: 'weekly' as const, title: `Week of ${weekStart}`, answers: { ...answers, week_start: weekStart } };
    if (existing) store.update('journal_entries', existing.id, values); else store.create('journal_entries', values);
    const pr = next.filter((p) => p.text.trim()).map((p) => ({ ...p, text: p.text.trim() }));
    store.upsert('week_plans', nextPlanId, { week_start: nextWeek, priorities: pr });
    toast('Weekly review saved');
    back('/journal');
  };

  return (
    <div className="page">
      <PageHead backTo="/journal" title="Weekly review" sub={`${longDay(weekStart)} – ${longDay(weekEnd)}`} />
      <Seg label="Which week" value={weekStart === thisWeek ? 'this' : weekStart === addDays(thisWeek, -7) ? 'last' : 'other'}
        onChange={(v) => setWeekStart(v === 'last' ? addDays(thisWeek, -7) : thisWeek)}
        options={[{ value: 'this', label: 'This week' }, { value: 'last', label: 'Last week' }, ...(weekStart !== thisWeek && weekStart !== addDays(thisWeek, -7) ? [{ value: 'other' as const, label: 'Selected' }] : [])]} />
      <SeminarNote>At the end of every week, check that you aren’t spending major time on minor things.</SeminarNote>
      <ActivitySummary act={act} />

      <Section title="What you planned" note={plan?.priorities?.length ? 'Tick what actually happened.' : undefined}>
        <div className="list">
          {plan?.priorities?.length ? plan.priorities.map((p, i) => (
            <label key={i} className="row has-check">
              <input type="checkbox" checked={!!p.done} style={{ width: 22, height: 22, accentColor: 'var(--accent)' }}
                onChange={(e) => store.update('week_plans', plan.id, { priorities: plan.priorities.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} />
              <span className="row-main"><span className="row-title">{p.text}</span></span>
            </label>
          )) : <Empty title="No priorities were set for this week">This review sets next week’s.</Empty>}
        </div>
      </Section>

      <Section title="Where your effort went" note="Completed tasks and habit check-ins by life area.">
        <div className="list">
          {areas.length ? areas.map(([a, n]) => (
            <div key={a} className="row"><span className="row-main">{areaName(a || null) ?? 'No life area'}</span><span className="num muted">{n}</span></div>
          )) : <Empty title="No completed activity recorded this week" />}
        </div>
      </Section>

      <Section title="Goals with no activity this week" count={neglected.length || undefined}
        note="No completed tasks, habit check-ins, milestones or progress updates.">
        <div className="list">
          {neglected.length ? neglected.map((g) => (
            <Link key={g.id} to={`/plan/goal/${g.id}`} className="row"><span className="row-main"><span className="row-title">{g.title}</span>
              {g.next_action && <span className="row-meta">Next: {g.next_action}</span>}</span></Link>
          )) : <Empty title={goals.length ? 'Every active goal moved this week' : 'No active goals'} />}
        </div>
      </Section>

      {act.doneTasks.length > 0 && (
        <details className="mt">
          <summary className="link-btn" style={{ cursor: 'pointer' }}>See the {act.doneTasks.length} completed tasks</summary>
          <div className="list mt-s">{act.doneTasks.map((t) => <div key={t.id} className="row"><span className="row-main row-title small">{t.title}</span></div>)}</div>
        </details>
      )}

      <Section title="Reflect">
        <div className="qa"><p className="q">Did you spend major time on minor things? Where?</p><AutoText value={answers.minor ?? ''} onChange={(e) => setA('minor', e.target.value)} minRows={2} aria-label="Major time on minor things" /></div>
        <div className="qa"><p className="q">One thing to continue</p><AutoText value={answers.continue ?? ''} onChange={(e) => setA('continue', e.target.value)} minRows={1} aria-label="Continue" /></div>
        <div className="qa"><p className="q">One thing to stop</p><AutoText value={answers.stop ?? ''} onChange={(e) => setA('stop', e.target.value)} minRows={1} aria-label="Stop" /></div>
        <div className="qa"><p className="q">One thing to change</p><AutoText value={answers.change ?? ''} onChange={(e) => setA('change', e.target.value)} minRows={1} aria-label="Change" /></div>
      </Section>

      <Section title="Next week’s priorities" note={`For the week starting ${longDay(nextWeek)}. They appear in next week’s review.`}>
        {next.map((p, i) => (
          <div key={i} className="card" style={{ padding: 12 }}>
            <div className="inline" style={{ gap: 6 }}>
              <input className="input" value={p.text} placeholder={`Priority ${i + 1}`} onChange={(e) => setNext(next.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} aria-label={`Priority ${i + 1}`} />
              <button className="icon-btn" style={{ flex: '0 0 auto' }} aria-label="Remove" onClick={() => setNext(next.filter((_, j) => j !== i))}><IconX size={18} /></button>
            </div>
            {goals.length > 0 && <div className="mt-s"><GoalSelect value={p.goal_id ?? null} onChange={(v) => setNext(next.map((x, j) => (j === i ? { ...x, goal_id: v } : x)))} label="For goal (optional)" /></div>}
          </div>
        ))}
        {next.length < 5 && <button className="btn small secondary mt-s" onClick={() => setNext([...next, { text: '' }])}><IconPlus size={16} />Add priority</button>}
      </Section>
      <button className="btn block mt" onClick={save}>Save review</button>
    </div>
  );
}

// ---------- monthly ----------

export function MonthlyReview() {
  const store = useStore();
  const today = useToday();
  const { query } = useLocation();
  const thisMonth = startOfMonth(today);
  const [month, setMonth] = useState<ISODate>(query.get('month') ?? thisMonth);
  const end = endOfMonth(month);
  const act = useActivity(month, end);
  const areas = useRows('areas').filter((a) => !a.archived && !a.hidden).sort((a, b) => a.sort - b.sort);
  const goals = useRows('goals').filter((g) => g.status === 'active');
  const milestones = useRows('milestones');
  const entries = useRows('journal_entries');
  const existing = entries.find((e) => e.kind === 'monthly' && e.answers.month === month);
  const [answers, setAnswers] = useState<Record<string, string>>(existing?.answers ?? {});
  const [winTitle, setWinTitle] = useState('');
  const setA = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  const prevMonth = startOfMonth(addDays(thisMonth, -1));

  const save = () => {
    const values = { day: end < today ? end : today, kind: 'monthly' as const, title: monthLabel(month), answers: { ...answers, month } };
    if (existing) store.update('journal_entries', existing.id, values); else store.create('journal_entries', values);
    toast('Monthly review saved');
    back('/journal');
  };
  return (
    <div className="page">
      <PageHead backTo="/journal" title="Monthly review" sub={monthLabel(month)} />
      <Seg label="Which month" value={month === thisMonth ? 'this' : 'last'} onChange={(v) => setMonth(v === 'this' ? thisMonth : prevMonth)}
        options={[{ value: 'this', label: 'This month' }, { value: 'last', label: 'Last month' }]} />
      <div className="mt"><ActivitySummary act={act} /></div>

      <Section title="Life areas" note="Activity this month, and the goals in each area. Tap a goal to update its progress.">
        {areas.map((a) => {
          const ag = goals.filter((g) => g.area_id === a.id);
          const n = act.byArea.get(a.id) ?? 0;
          return (
            <div key={a.id} className="card" style={{ padding: 14 }}>
              <div className="stat-line"><strong>{a.icon} {a.name}</strong><span className="muted small">{n} done</span></div>
              {ag.map((g) => {
                const p = goalProgress(g, milestones);
                return (
                  <Link key={g.id} to={`/plan/goal/${g.id}`} style={{ display: 'block', marginTop: 10, color: 'inherit', textDecoration: 'none' }}>
                    <div className="small">{g.title}</div><Progress pct={p.pct} /><div className="basis">{p.basis}</div>
                  </Link>
                );
              })}
              {!ag.length && <p className="tiny muted" style={{ margin: '6px 0 0' }}>No active goals here{n === 0 ? ' and no activity this month' : ''}.</p>}
            </div>
          );
        })}
      </Section>

      <Section title="Wins this month" count={act.winList.length || undefined}>
        <div className="list wins-list">
          {act.winList.map((w) => <div key={w.id} className="row"><span className="row-main"><span className="row-title">{w.title}</span><span className="row-meta">{relDay(w.day, today)}</span></span></div>)}
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (!winTitle.trim()) return; store.create('wins', { day: today, title: winTitle.trim(), kind: 'personal' }); setWinTitle(''); toast('Win recorded', { kind: 'win' }); }}>
            <input className="input" style={{ border: 0, padding: 0, minHeight: 36 }} placeholder="Record a win" value={winTitle} onChange={(e) => setWinTitle(e.target.value)} />
          </form>
        </div>
      </Section>

      <Section title="Reflect">
        <div className="qa"><p className="q">What were the important lessons?</p><AutoText value={answers.lessons ?? ''} onChange={(e) => setA('lessons', e.target.value)} minRows={2} aria-label="Lessons" /></div>
        <div className="qa"><p className="q">Did major time go to minor things?</p><AutoText value={answers.minor ?? ''} onChange={(e) => setA('minor', e.target.value)} minRows={2} aria-label="Minor things" /></div>
        <div className="qa"><p className="q">What priorities or commitments will you adjust?</p><AutoText value={answers.adjust ?? ''} onChange={(e) => setA('adjust', e.target.value)} minRows={2} aria-label="Adjust" /></div>
      </Section>
      <SeminarNote>Whatever you reap is what you have sown. When the results disappoint, look honestly at what was planted — and plant differently.</SeminarNote>
      <button className="btn block" onClick={save}>Save review</button>
    </div>
  );
}

// ---------- life season ----------

const SEASON_ICONS = { winter: SeasonWinter, spring: SeasonSpring, summer: SeasonSummer, autumn: SeasonAutumn };

export function SeasonReflection() {
  const store = useStore();
  const today = useToday();
  const settings = useSettings();
  const [season, setSeason] = useState<Season | null>(settings.season);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [makeCurrent, setMakeCurrent] = useState(true);
  const save = () => {
    if (!season) return;
    store.create('journal_entries', { day: today, kind: 'season', season, title: `${SEASONS[season].name} reflection`, answers });
    if (makeCurrent) updateSettings(store, { season });
    toast('Reflection saved');
    back('/journal');
  };
  return (
    <div className="page">
      <PageHead backTo="/journal" title="Life season" sub="An optional way to look at where you are" />
      <SeminarNote>Life and business are like the seasons. You can’t change the seasons, but you can change yourself: handle the winters, use the springs, protect what grows in summer, and reap in autumn without complaint.</SeminarNote>
      <p className="small muted">Choose the season that fits. The app never guesses it from your mood, and it isn’t a diagnosis — just a lens for reflection.</p>
      <div className="list">
        {(Object.keys(SEASONS) as Season[]).map((s) => {
          const Icon = SEASON_ICONS[s];
          return (
            <button key={s} className="row" aria-pressed={season === s} onClick={() => { setSeason(s); setAnswers({}); }}
              style={season === s ? { background: 'var(--accent-soft)' } : undefined}>
              <span style={{ color: 'var(--accent-text)' }}><Icon size={26} /></span>
              <span className="row-main"><span className="row-title" style={{ fontWeight: 600 }}>{SEASONS[s].name}</span>
                <span className="row-meta">{SEASONS[s].meaning}</span></span>
            </button>
          );
        })}
      </div>
      {season && (
        <>
          <Section title={`Reflecting on ${SEASONS[season].name.toLowerCase()}`}>
            {SEASONS[season].prompts.map((p) => (
              <div key={p.key} className="qa"><p className="q">{p.q}</p>
                <AutoText value={answers[p.key] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [p.key]: e.target.value }))} minRows={2} aria-label={p.q} /></div>
            ))}
            {season === 'winter' && <SeminarNote>Don’t wish it were easier; wish you were better. Don’t wish for fewer problems; wish for more skills.</SeminarNote>}
          </Section>
          <Toggle label="Show this season on my Today screen" checked={makeCurrent} onChange={setMakeCurrent} />
          <button className="btn block mt" onClick={save}>Save reflection</button>
        </>
      )}
      {settings.season && (
        <button className="link-btn mt" onClick={() => { updateSettings(store, { season: null }); toast('Season cleared from Today'); }}>Clear current season ({SEASONS[settings.season].name})</button>
      )}
    </div>
  );
}

// ---------- fresh start ----------

export function FreshStart() {
  const store = useStore();
  const today = useToday();
  const [step, setStep] = useState(0);
  const [a, setA] = useState({ change: '', why: '', decision: '', action: '' });
  const [goalId, setGoalId] = useState<string | null>(null);
  const [top, setTop] = useState(true);
  const steps = [
    { key: 'change', q: 'What do you want to change?', hint: 'Name it plainly. “I’ve had it with…” is a fine way to start.' },
    { key: 'why', q: 'Why does it matter?', hint: 'Strong reasons give you the energy to follow through.' },
    { key: 'decision', q: 'What is your decision?', hint: 'Start with “I will…”' },
    { key: 'action', q: 'What is one small action you can take today?', hint: 'Small enough that you’ll actually do it.' },
  ] as const;
  const cur = steps[step];
  const finish = () => {
    store.create('journal_entries', { day: today, kind: 'fresh_start', title: a.change.slice(0, 80) || 'Fresh start', answers: a });
    const topCount = store.all('tasks').filter((t) => t.top_on === today && t.status === 'open').length;
    store.create('tasks', { title: a.action.trim(), due_date: today, top_on: top && topCount < 3 ? today : null, goal_id: goalId, priority: 3 });
    if (goalId) logGoalEvent(store, goalId, 'fresh_start', `Fresh start: ${a.decision.trim()}`);
    toast('Decision recorded. Your first step is on Today.');
    navigate('/', { replace: true });
  };
  return (
    <div className="page">
      <PageHead backTo="/" title="Fresh start" sub={`Step ${step + 1} of ${steps.length}`} />
      {step === 0 && <SeminarNote>Any day can be the day that turns things around: you’ve had enough, you decide, you want it badly enough, you resolve not to give up — and then you act.</SeminarNote>}
      <div className="qa">
        <p className="q" style={{ fontSize: 24 }}>{cur.q}</p>
        <AutoText serif value={a[cur.key]} onChange={(e) => setA({ ...a, [cur.key]: e.target.value })} minRows={3} aria-label={cur.q} autoFocus />
        <span className="tiny muted">{cur.hint}</span>
      </div>
      {step === 3 && (
        <div className="form mt">
          <GoalSelect value={goalId} onChange={setGoalId} label="Connect to a goal (optional)" />
          <Toggle label="Make it one of today’s top three" checked={top} onChange={setTop} />
        </div>
      )}
      <div className="btn-row">
        {step > 0 && <button className="btn secondary" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 3
          ? <button className="btn" onClick={() => setStep(step + 1)} disabled={!a[cur.key].trim()}>Next</button>
          : <button className="btn" onClick={finish} disabled={!a.action.trim()}>Commit and add to Today</button>}
      </div>
      <p className="tiny muted mt">Missed days and false starts happen to everyone. Restarting is the skill.</p>
    </div>
  );
}
