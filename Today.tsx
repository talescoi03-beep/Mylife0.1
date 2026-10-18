import { useMemo, useState } from 'react';
import { useRows, useSettings, useStore, useSyncStatus, useToday } from '../app/context';
import { dismissTask, rescheduleTask } from '../app/actions';
import { addDays, dayOf, diffDays, longDay } from '../lib/dates';
import { stableId } from '../lib/ids';
import { Link, navigate } from '../lib/router';
import { dueOn } from '../logic/habits';
import { computeReminders } from '../logic/reminders';
import type { Task } from '../data/schema';
import { Empty, Section, Sheet, toast } from '../ui/kit';
import {
  IconCalendar, IconChevron, IconJournal, IconMoon, IconPeople, IconRefresh, IconSunrise, IconMoney,
  SeasonAutumn, SeasonSpring, SeasonSummer, SeasonWinter,
} from '../ui/icons';
import { HabitRow, TaskRow, openTask, useHabitIndex } from './shared';
import { SyncBadge } from '../app/SyncBadge';

const SEASON_ICON = { winter: SeasonWinter, spring: SeasonSpring, summer: SeasonSummer, autumn: SeasonAutumn };

export function TodayScreen() {
  const store = useStore();
  const syncStatus = useSyncStatus();
  const settings = useSettings();
  const today = useToday();
  const tasks = useRows('tasks');
  const habits = useRows('habits');
  const goals = useRows('goals');
  const blocks = useRows('time_blocks');
  const bills = useRows('bills');
  const people = useRows('people');
  const dates = useRows('people_dates');
  const dayNotes = useRows('day_notes');
  const journal = useRows('journal_entries');
  const idx = useHabitIndex();
  const [showOverdue, setShowOverdue] = useState(true);
  const [picker, setPicker] = useState(false);

  const live = tasks.filter((t) => !t.archived && !t.parent_id);
  const top = live.filter((t) => t.top_on === today && t.status !== 'dismissed').sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).slice(0, 3);
  const topIds = new Set(top.map((t) => t.id));
  const timed = live.filter((t) => t.status === 'open' && t.due_date === today && t.due_time && !topIds.has(t.id));
  const todaysBlocks = blocks.filter((b) => b.day === today);
  const schedule = [
    ...todaysBlocks.map((b) => ({ key: b.id, time: b.start_time, block: b, task: null as Task | null })),
    ...timed.map((t) => ({ key: t.id, time: t.due_time!, block: null, task: t })),
  ].sort((a, b) => a.time.localeCompare(b.time));
  const dueToday = live.filter((t) => t.due_date === today && !t.due_time && !topIds.has(t.id) && (t.status === 'open' || (t.status === 'done' && !!t.completed_at && dayOf(t.completed_at, settings.tz) === today)));
  const overdue = live.filter((t) => t.status === 'open' && t.due_date && t.due_date < today && !topIds.has(t.id)).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  const habitsToday = habits.filter((h) => dueOn(h, idx, today, settings.week_starts_on)).sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));

  const noteId = stableId('day_note', store.userId, today);
  const note = dayNotes.find((n) => n.id === noteId);
  const [intention, setIntention] = useState<string | null>(null);
  const intentionValue = intention ?? note?.intention ?? '';
  const saveIntention = () => {
    if (intention === null || intention === (note?.intention ?? '')) return;
    store.upsert('day_notes', noteId, { day: today, intention: intention.trim() || null });
    setIntention(null);
  };

  // A different goal-with-a-reason each day, so the "why" stays visible.
  const withWhy = goals.filter((g) => g.status === 'active' && g.why);
  const whyGoal = withWhy.length ? withWhy.sort((a, b) => a.id.localeCompare(b.id))[Math.abs(diffDays(today, '2000-01-01')) % withWhy.length] : null;

  const reminders = useMemo(() => computeReminders({ bills, people, dates, today, tz: settings.tz }), [bills, people, dates, today, settings.tz]);
  const morningDone = journal.some((j) => j.day === today && j.kind === 'morning');
  const eveningDone = journal.some((j) => j.day === today && j.kind === 'evening');
  const SeasonIcon = settings.season ? SEASON_ICON[settings.season] : null;
  const onboardingPending = settings.onboarding?.skipped && !settings.onboarding?.done;

  return (
    <div className="page">
      <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="small muted">Today</span>
        <SyncBadge />
      </div>
      <header className="today-head">
        <h1 className="today-date">
          {longDay(today)}
          {SeasonIcon && <span className="season" title={`Season you chose: ${settings.season}`}><SeasonIcon size={24} /></span>}
        </h1>
        <p className="reminder-line">
          {settings.reminder_text
            ? settings.reminder_text
            : <button onClick={() => navigate('/more/settings#reminder')}>Add a line you want to read every morning…</button>}
        </p>
      </header>

      {onboardingPending && (
        <div className="banner mt">
          <div className="grow">Setup isn’t finished. Choose your life areas and add your first goal when you’re ready.
            <div><button className="btn small" onClick={() => navigate('/onboarding')}>Continue setup</button></div>
          </div>
        </div>
      )}
      {syncStatus.state === 'signin' && (
        <div className="banner warn mt"><div className="grow">{syncStatus.message}
          <div><button className="btn small" onClick={() => navigate('/more/settings#account')}>Sign in again</button></div></div></div>
      )}

      <div className="intention">
        <label htmlFor="intention">Today’s intention</label>
        <input id="intention" placeholder="What matters most today?" value={intentionValue}
          onChange={(e) => setIntention(e.target.value)} onBlur={saveIntention}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} enterKeyHint="done" />
      </div>

      <Section title="Top three" action={top.length < 3 ? <button className="link-btn" onClick={() => setPicker(true)}>Choose</button> : undefined}>
        <div className="list">
          {top.map((t) => <TaskRow key={t.id} task={t} showDate={false} />)}
          {Array.from({ length: 3 - top.length }, (_, i) => (
            <button key={i} className="slot-empty row" onClick={() => setPicker(true)}>
              <span className="n">{top.length + i + 1}</span>Choose a priority
            </button>
          ))}
        </div>
      </Section>

      {reminders.length > 0 && (
        <Section title="Reminders" count={reminders.length}>
          <div className="list">
            {reminders.map((r) => (
              <Link key={r.key} to={r.href} className="row">
                <span className="row-end" style={{ color: 'var(--accent-text)' }}>
                  {r.kind === 'bill' ? <IconMoney size={20} /> : r.kind === 'contact' ? <IconPeople size={20} /> : <IconCalendar size={20} />}
                </span>
                <span className="row-main"><span className="row-title">{r.title}</span><span className="row-meta">{r.detail}</span></span>
                <IconChevron size={18} className="faint" />
              </Link>
            ))}
          </div>
        </Section>
      )}

      {schedule.length > 0 && (
        <Section title="Schedule">
          <div className="list">
            {schedule.map((s) => s.task ? <TaskRow key={s.key} task={s.task} showDate={false} /> : (
              <Link key={s.key} to="/plan?tab=week" className="row">
                <span className="time-col">{s.block!.start_time}–{s.block!.end_time}</span>
                <span className="row-main"><span className="row-title">{s.block!.title}</span>
                  <span className="row-meta">{s.block!.kind === 'appointment' ? 'Appointment' : 'Work session'}</span></span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section title="Habits" count={habitsToday.length || undefined}
        action={<Link className="link-btn" to="/plan?tab=habits">All habits</Link>}>
        <div className="list">
          {habitsToday.length ? habitsToday.map((h) => <HabitRow key={h.id} habit={h} idx={idx} day={today} />) : (
            <Empty title="No habits due today">Small disciplines done every day add up. Add one in Plan › Habits.</Empty>
          )}
        </div>
      </Section>

      <Section title="Due today" count={dueToday.filter((t) => t.status === 'open').length || undefined}
        action={<button className="link-btn" onClick={() => openTask(null, { due_date: today })}>Add</button>}>
        <div className="list">
          {dueToday.length ? dueToday.map((t) => <TaskRow key={t.id} task={t} showDate={false} />) : (
            <Empty title="Nothing else due today">Use the + button to capture anything on your mind.</Empty>
          )}
        </div>
      </Section>

      {overdue.length > 0 && (
        <Section title="Overdue" count={overdue.length}
          note="Deadlines don’t move on their own. Decide for each: do it, give it a new date, or let it go."
          action={<button className="link-btn" onClick={() => setShowOverdue((s) => !s)}>{showOverdue ? 'Hide' : 'Show'}</button>}>
          {showOverdue && (
            <div className="list">
              {overdue.slice(0, 20).map((t) => (
                <div key={t.id}>
                  <TaskRow task={t} />
                  <div className="chips" style={{ padding: '0 14px 12px 56px', gap: 6 }}>
                    <button className="chip" onClick={() => rescheduleTask(store, t, today)}>Today</button>
                    <button className="chip" onClick={() => rescheduleTask(store, t, addDays(today, 1))}>Tomorrow</button>
                    <button className="chip" onClick={() => openTask(t.id)}>Pick a date</button>
                    <button className="chip" onClick={() => dismissTask(store, t)}>Let it go</button>
                  </div>
                </div>
              ))}
              {overdue.length > 20 && <div className="empty">And {overdue.length - 20} more in Plan › Tasks.</div>}
            </div>
          )}
        </Section>
      )}

      {whyGoal && (
        <Link to={`/plan/goal/${whyGoal.id}`} className="why-card" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
          <div className="label">Why you’re doing this</div>
          <div className="goal">{whyGoal.title}</div>
          <p className="why">{whyGoal.why}</p>
        </Link>
      )}

      <Section title="Reflect">
        <div className="review-links">
          <Link className="review-link" to={morningDone ? '/journal?kind=morning' : '/journal/new?kind=morning'}><IconSunrise />{morningDone ? 'Morning done' : 'Morning'}</Link>
          <Link className="review-link" to={eveningDone ? '/journal?kind=evening' : '/journal/new?kind=evening'}><IconMoon />{eveningDone ? 'Evening done' : 'Evening review'}</Link>
          <Link className="review-link" to="/review/weekly"><IconCalendar />Weekly review</Link>
          <Link className="review-link" to="/fresh-start"><IconRefresh />Fresh start</Link>
        </div>
        <Link className="review-link mt-s" to="/journal/new?kind=free" style={{ marginTop: 10 }}><IconJournal />Write in your journal</Link>
      </Section>

      {picker && <TopPicker onClose={() => setPicker(false)} current={top.length} />}
    </div>
  );
}

function TopPicker({ onClose, current }: { onClose: () => void; current: number }) {
  const store = useStore();
  const today = useToday();
  const tasks = useRows('tasks').filter((t) => t.status === 'open' && !t.archived && !t.parent_id && t.top_on !== today);
  const [title, setTitle] = useState('');
  const candidates = tasks.sort((a, b) => {
    const rank = (t: Task) => (t.due_date && t.due_date <= today ? 0 : !t.due_date ? 1 : 2);
    return rank(a) - rank(b) || b.priority - a.priority || (a.due_date ?? '').localeCompare(b.due_date ?? '');
  }).slice(0, 30);
  const pick = (t: Task) => {
    store.update('tasks', t.id, { top_on: today, due_date: t.due_date && t.due_date <= today ? t.due_date : today });
    if (current + 1 >= 3) onClose();
    else toast('Added to top three');
  };
  return (
    <Sheet open title="Choose today’s priorities" onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>Pick what would make the biggest difference — not the easiest. {3 - current} slot{3 - current === 1 ? '' : 's'} left.</p>
      <form className="inline mb" onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        store.create('tasks', { title: title.trim(), due_date: today, top_on: today, priority: 2 });
        setTitle('');
        if (current + 1 >= 3) onClose();
      }}>
        <input className="input" placeholder="New priority" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
        <button className="btn" style={{ flex: '0 0 auto' }} disabled={!title.trim()}>Add</button>
      </form>
      {candidates.length > 0 && (
        <div className="list">
          {candidates.map((t) => (
            <button key={t.id} className="row" onClick={() => pick(t)}>
              <span className="row-main"><span className="row-title">{t.title}</span>
                <span className="row-meta">{t.due_date ? (t.due_date < today ? 'Overdue' : t.due_date === today ? 'Due today' : `Due ${t.due_date}`) : 'Inbox'}</span></span>
              <span className="row-end">Add</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
