import { useState } from 'react';
import { useRows, useSettings, useStore, useToday } from '../app/context';
import { setHabitDay } from '../app/actions';
import { addDays, relDay, startOfWeek, weekdayShort, type ISODate } from '../lib/dates';
import { back } from '../lib/router';
import { consistency, currentStreak, dayState, isPaused, scheduleLabel } from '../logic/habits';
import type { Habit } from '../data/schema';
import { AutoText, Field, PageHead, Section, Sheet, confirm, toast } from '../ui/kit';
import { IconEdit } from '../ui/icons';
import { openHabitEditor, useHabitIndex } from './shared';

export function HabitDetail({ id }: { id: string }) {
  const store = useStore();
  const today = useToday();
  const { week_starts_on } = useSettings();
  const habit = useRows('habits').find((h) => h.id === id);
  const logs = useRows('habit_logs').filter((l) => l.habit_id === id);
  const goals = useRows('goals');
  const idx = useHabitIndex();
  const [editDay, setEditDay] = useState<ISODate | null>(null);
  if (!habit) return <div className="page"><PageHead title="Habit not found" backTo="/plan?tab=habits" /></div>;

  const streak = currentStreak(habit, idx, today, week_starts_on);
  const c4 = consistency(habit, idx, addDays(today, -27), today, today);
  const c12 = consistency(habit, idx, addDays(today, -83), today, today);
  const paused = isPaused(habit, today);
  const start = startOfWeek(addDays(today, -7 * 11), week_starts_on);
  const weeks = Array.from({ length: 12 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
  const notes = logs.filter((l) => l.note).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 20);
  const goal = goals.find((g) => g.id === habit.goal_id);

  const pause = () => {
    store.update('habits', habit.id, { pauses: [...habit.pauses, { from: today, to: null }] });
    toast('Paused. Paused days never count against you.');
  };
  const resume = () => {
    store.update('habits', habit.id, { pauses: habit.pauses.map((p) => (p.to === null || p.to >= today ? { ...p, to: addDays(today, -1) } : p)).filter((p) => !p.to || p.to >= p.from) });
    toast('Welcome back. Start with the minimum if you need to.');
  };

  return (
    <div className="page">
      <PageHead backTo="/plan?tab=habits" title={habit.title} sub={`${scheduleLabel(habit)}${habit.kind === 'measure' && habit.daily_target ? ` · ${habit.daily_target} ${habit.unit ?? ''} a day` : ''}`}
        actions={<button className="icon-btn" aria-label="Edit habit" onClick={() => openHabitEditor(habit.id)}><IconEdit /></button>} />
      {paused && <div className="banner"><div>Paused since {habit.pauses.find((p) => !p.to || p.to >= today)?.from}. <button className="link-btn" onClick={resume}>Resume</button></div></div>}

      <div className="card">
        <div className="stat-line"><span>Current streak</span><strong className="num">{streak.count} {streak.unit}{streak.count === 1 ? '' : 's'}</strong></div>
        <div className="stat-line mt-s"><span>Last 4 weeks</span><strong className="num">{c4.pct == null ? '—' : `${c4.pct}%`}</strong></div>
        <div className="stat-line mt-s"><span>Last 12 weeks</span><strong className="num">{c12.pct == null ? '—' : `${c12.pct}%`}</strong></div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Consistency = completed ÷ scheduled days. Rest days, paused days, days before the start date and today (until done) are left out.
          The minimum version counts. A streak isn’t the goal — showing up again after a miss is.
        </p>
      </div>

      {(habit.why || habit.minimum_version || goal) && (
        <dl className="kv card mt">
          {habit.why && <div><dt>Why</dt><dd>{habit.why}</dd></div>}
          {habit.minimum_version && <div><dt>Minimum version for hard days</dt><dd>{habit.minimum_version}</dd></div>}
          {goal && <div><dt>Supports</dt><dd>{goal.title}</dd></div>}
        </dl>
      )}

      <Section title="Last 12 weeks" note="Tap any day to change it.">
        <div className="card">
          <div className="heat" style={{ marginBottom: 4 }}>
            {weeks[0].map((d) => <span key={d} className="tiny faint" style={{ textAlign: 'center' }}>{weekdayShort(new Date(d + 'T12:00:00Z').getUTCDay())[0]}</span>)}
          </div>
          {weeks.map((w) => (
            <div key={w[0]} className="heat" style={{ marginBottom: 4 }}>
              {w.map((d) => {
                const s = dayState(habit, idx, d, today);
                const cls = { done: 'd', minimum: 'm', rest: 'r', paused: 'p', missed: 'x', open: 'n', unscheduled: 'n', 'before-start': 'n' }[s];
                return d > today ? <i key={d} className="n" /> : (
                  <button key={d} className={`${cls}`} style={{ aspectRatio: '1', borderRadius: 4, border: s === 'rest' || s === 'paused' ? '1px dashed var(--line-strong)' : 0, padding: 0, background: cls === 'd' ? 'var(--accent)' : cls === 'm' ? 'color-mix(in srgb, var(--accent) 45%, var(--line))' : cls === 'x' ? 'var(--danger-soft)' : cls === 'n' ? 'var(--line)' : 'transparent', outline: d === today ? '2px solid var(--ink-2)' : undefined }}
                    aria-label={`${d}: ${s}`} onClick={() => setEditDay(d)} />
                );
              })}
            </div>
          ))}
        </div>
      </Section>

      {notes.length > 0 && (
        <Section title="Notes">
          <div className="list">{notes.map((l) => (
            <div key={l.id} className="row"><div className="row-main"><div className="row-title small">{l.note}</div>
              <div className="row-meta"><span>{relDay(l.day, today)}</span><span>{l.status}</span></div></div></div>
          ))}</div>
        </Section>
      )}

      <div className="btn-row">
        {paused ? <button className="btn" onClick={resume}>Resume habit</button> : <button className="btn secondary" onClick={pause}>Pause</button>}
        <button className="btn ghost" onClick={() => { store.update('habits', habit.id, { archived: !habit.archived }); toast(habit.archived ? 'Restored' : 'Archived'); }}>{habit.archived ? 'Unarchive' : 'Archive'}</button>
        <button className="btn ghost danger-text" onClick={async () => {
          if (await confirm({ title: 'Delete this habit and its history?', body: 'Archiving keeps the history. Deleting removes every check-in.', confirmLabel: 'Delete', danger: true })) {
            logs.forEach((l) => store.remove('habit_logs', l.id));
            store.remove('habits', habit.id);
            back('/plan?tab=habits');
          }
        }}>Delete</button>
      </div>
      {editDay && <DayEditSheet habit={habit} day={editDay} onClose={() => setEditDay(null)} />}
    </div>
  );
}

function DayEditSheet({ habit, day, onClose }: { habit: Habit; day: ISODate; onClose: () => void }) {
  const store = useStore();
  const today = useToday();
  const log = useRows('habit_logs').find((l) => l.habit_id === habit.id && l.day === day);
  const [value, setValue] = useState(log?.value ?? null);
  const [note, setNote] = useState(log?.note ?? '');
  const set = (status: 'done' | 'minimum' | 'rest' | 'missed' | null) => {
    setHabitDay(store, habit, day, status, { value, note: note.trim() || null });
    onClose();
  };
  return (
    <Sheet open title={relDay(day, today)} onClose={onClose}>
      <div className="form">
        {habit.kind === 'measure' && (
          <Field label={`Amount${habit.unit ? ` (${habit.unit})` : ''}`}>
            <input className="input" inputMode="decimal" value={value ?? ''} onChange={(e) => setValue(e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
        )}
        <Field label="Note"><AutoText value={note} onChange={(e) => setNote(e.target.value)} minRows={2} /></Field>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => set('done')}>Done</button>
        <button className="btn secondary" onClick={() => set('minimum')}>Minimum</button>
        <button className="btn secondary" onClick={() => set('rest')}>Rest day</button>
      </div>
      <div className="btn-row">
        <button className="btn secondary" onClick={() => set('missed')}>Missed</button>
        <button className="btn ghost" onClick={() => set(null)}>Clear</button>
      </div>
    </Sheet>
  );
}
