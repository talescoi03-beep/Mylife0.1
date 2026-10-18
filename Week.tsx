import { useState } from 'react';
import { useRows, useSettings, useStore, useToday } from '../app/context';
import { addDays, longDay, startOfWeek, weekdayShort, type ISODate } from '../lib/dates';
import { stableId } from '../lib/ids';
import { Link } from '../lib/router';
import { buildIcs, shareOrDownload } from '../logic/ics';
import type { TimeBlock } from '../data/schema';
import { Empty, Field, Section, Sheet, Toggle, confirm, toast } from '../ui/kit';
import { IconBack, IconCalendar, IconChevron, IconPlus } from '../ui/icons';
import { AreaSelect, GoalSelect, TaskRow } from './shared';

export function WeekView() {
  const today = useToday();
  const { week_starts_on } = useSettings();
  const store = useStore();
  const tasks = useRows('tasks');
  const blocks = useRows('time_blocks');
  const plans = useRows('week_plans');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today, week_starts_on));
  const [day, setDay] = useState<ISODate>(today);
  const [blockEdit, setBlockEdit] = useState<TimeBlock | 'new' | null>(null);
  const [exporting, setExporting] = useState(false);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const due = tasks.filter((t) => t.due_date === day && !t.archived && !t.parent_id && t.status !== 'dismissed')
    .sort((a, b) => (a.due_time ?? '99').localeCompare(b.due_time ?? '99'));
  const dayBlocks = blocks.filter((b) => b.day === day).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const moveWeek = (n: number) => {
    const ws = addDays(weekStart, 7 * n);
    setWeekStart(ws);
    setDay(n === 0 ? today : ws);
  };
  return (
    <>
      <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <button className="icon-btn" aria-label="Previous week" onClick={() => moveWeek(-1)}><IconBack /></button>
        <button className="link-btn" onClick={() => { setWeekStart(startOfWeek(today, week_starts_on)); setDay(today); }}>This week</button>
        <button className="icon-btn" aria-label="Next week" onClick={() => moveWeek(1)}><IconChevron /></button>
      </div>
      <WeekPriorities plan={plans.find((p) => p.id === stableId('week_plan', store.userId, weekStart))} />
      <div className="week-grid" role="group" aria-label="Days of the week">
        {days.map((d) => {
          const nTasks = tasks.filter((t) => t.due_date === d && t.status === 'open' && !t.archived && !t.parent_id).length;
          const nBlocks = blocks.filter((b) => b.day === d).length;
          return (
            <button key={d} className={`week-day ${d === today ? 'today' : ''}`} aria-pressed={d === day} onClick={() => setDay(d)}
              aria-label={`${longDay(d)}: ${nTasks} due, ${nBlocks} scheduled`}>
              <span className="wd">{weekdayShort(new Date(d + 'T12:00:00Z').getUTCDay())}</span>
              <span className="dn">{Number(d.slice(8))}</span>
              <span className="dots">{Array.from({ length: Math.min(nTasks, 3) }, (_, i) => <i key={i} />)}{nBlocks > 0 && <i className="b" />}</span>
            </button>
          );
        })}
      </div>
      <h2 className="serif" style={{ fontSize: 22, margin: '18px 4px 0' }}>{longDay(day)}</h2>

      <Section title="Deadlines" count={due.length || undefined} note="Tasks due this day.">
        <div className="list">{due.length ? due.map((t) => <TaskRow key={t.id} task={t} showDate={false} />) : <Empty title="Nothing due" />}</div>
      </Section>

      <Section title="Time blocks" note="When you plan to work on something, or appointments. Separate from deadlines."
        action={<button className="link-btn" onClick={() => setBlockEdit('new')}><IconPlus size={16} /> Add</button>}>
        <div className="list">
          {dayBlocks.length ? dayBlocks.map((b) => (
            <button key={b.id} className="row" onClick={() => setBlockEdit(b)}>
              <span className="time-col">{b.start_time}–{b.end_time}</span>
              <span className="row-main"><span className="row-title">{b.title}</span>
                <span className="row-meta">{b.kind === 'appointment' ? 'Appointment' : 'Work session'}</span></span>
            </button>
          )) : <Empty title="No time blocked" />}
        </div>
      </Section>

      <button className="btn secondary block mt" onClick={() => setExporting(true)}><IconCalendar size={18} />Export to Calendar</button>
      {blockEdit && <BlockSheet block={blockEdit === 'new' ? null : blockEdit} day={day} onClose={() => setBlockEdit(null)} />}
      {exporting && <ExportSheet onClose={() => setExporting(false)} />}
    </>
  );
}

function WeekPriorities({ plan }: { plan: import('../data/schema').WeekPlan | undefined }) {
  const store = useStore();
  if (!plan?.priorities?.length) {
    return <p className="small muted" style={{ margin: '0 4px 12px' }}>No priorities set for this week. <Link to="/review/weekly">Set them in a weekly review</Link>.</p>;
  }
  return (
    <div className="list" style={{ marginBottom: 14 }} aria-label="This week’s priorities">
      {plan.priorities.map((p, i) => (
        <label key={i} className="row has-check">
          <input type="checkbox" checked={!!p.done} style={{ width: 22, height: 22, accentColor: 'var(--accent)' }}
            onChange={(e) => store.update('week_plans', plan.id, { priorities: plan.priorities.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} />
          <span className={`row-main row-title ${p.done ? 'muted' : ''}`}>{p.text}</span>
        </label>
      ))}
    </div>
  );
}

function BlockSheet({ block, day, onClose }: { block: TimeBlock | null; day: ISODate; onClose: () => void }) {
  const store = useStore();
  const [d, setD] = useState<Partial<TimeBlock>>(block ?? { day, start_time: '09:00', end_time: '10:00', kind: 'work', title: '' });
  const set = (p: Partial<TimeBlock>) => setD((x) => ({ ...x, ...p }));
  const save = () => {
    if (!d.title?.trim()) { toast('Add a title'); return; }
    if ((d.end_time ?? '') <= (d.start_time ?? '')) { toast('End time must be after start time'); return; }
    const values = { title: d.title.trim(), day: d.day!, start_time: d.start_time!, end_time: d.end_time!, kind: d.kind ?? 'work', area_id: d.area_id ?? null, goal_id: d.goal_id ?? null, notes: d.notes ?? null };
    if (block) store.update('time_blocks', block.id, values); else store.create('time_blocks', values);
    onClose();
  };
  return (
    <Sheet open title={block ? 'Time block' : 'New time block'} onClose={onClose}>
      <div className="form">
        <Field label="What"><input className="input" value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Deep work on the game" /></Field>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={d.kind !== 'appointment'} onClick={() => set({ kind: 'work' })}>Work session</button>
          <button type="button" className="chip" aria-pressed={d.kind === 'appointment'} onClick={() => set({ kind: 'appointment' })}>Appointment</button>
        </div>
        <Field label="Day"><input className="input" type="date" value={d.day} onChange={(e) => set({ day: e.target.value || day })} /></Field>
        <div className="inline">
          <Field label="Start"><input className="input" type="time" value={d.start_time} onChange={(e) => set({ start_time: e.target.value })} /></Field>
          <Field label="End"><input className="input" type="time" value={d.end_time} onChange={(e) => set({ end_time: e.target.value })} /></Field>
        </div>
        <AreaSelect value={d.area_id ?? null} onChange={(v) => set({ area_id: v })} />
        <GoalSelect value={d.goal_id ?? null} onChange={(v) => set({ goal_id: v })} />
      </div>
      <div className="btn-row">
        <button className="btn" onClick={save}>Save</button>
        {block && <button className="btn ghost danger-text" onClick={async () => {
          if (await confirm({ title: 'Delete this time block?', confirmLabel: 'Delete', danger: true })) { store.remove('time_blocks', block.id); onClose(); }
        }}>Delete</button>}
      </div>
    </Sheet>
  );
}

export function ExportSheet({ onClose }: { onClose: () => void }) {
  const today = useToday();
  const { tz } = useSettings();
  const tasks = useRows('tasks');
  const blocks = useRows('time_blocks');
  const bills = useRows('bills');
  const people = useRows('people');
  const dates = useRows('people_dates');
  const [inc, setInc] = useState({ tasks: true, blocks: true, bills: true, dates: true });
  const go = async () => {
    const { ics, count } = buildIcs({ tasks, blocks, bills, people, dates, tz, today, include: inc });
    if (!count) { toast('Nothing to export yet'); return; }
    const r = await shareOrDownload(`my-life-${today}.ics`, ics, 'text/calendar');
    if (r !== 'cancelled') toast(`${count} events exported`);
    onClose();
  };
  return (
    <Sheet open title="Export to Calendar" onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Creates a calendar file with alerts. Open it on your iPhone and choose “Add All” to put these in Calendar —
        its alerts work even when My Life is closed. Exporting again adds copies, so delete old ones first if you re-export.
      </p>
      <Toggle label="Tasks with due dates" checked={inc.tasks} onChange={(v) => setInc({ ...inc, tasks: v })} />
      <Toggle label="Time blocks" checked={inc.blocks} onChange={(v) => setInc({ ...inc, blocks: v })} />
      <Toggle label="Recurring bills" checked={inc.bills} onChange={(v) => setInc({ ...inc, bills: v })} />
      <Toggle label="Birthdays and important dates" checked={inc.dates} onChange={(v) => setInc({ ...inc, dates: v })} />
      <button className="btn block mt" onClick={go}><IconCalendar size={18} />Export</button>
    </Sheet>
  );
}
