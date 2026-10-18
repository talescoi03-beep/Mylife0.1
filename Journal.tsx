import { useEffect, useRef, useState } from 'react';
import { useRows, useSettings, useStore, useToday } from '../app/context';
import { dayOf, longDay, monthLabel, relDay } from '../lib/dates';
import { stableId } from '../lib/ids';
import { Link, back, navigate, useLocation } from '../lib/router';
import { KIND_LABEL, SEASONS, entryText, promptsFor } from '../logic/templates';
import type { JournalEntry, JournalKind } from '../data/schema';
import { AutoText, Empty, PageHead, Section, SeminarNote, confirm, toast } from '../ui/kit';
import { IconCalendar, IconChart, IconMoon, IconRefresh, IconSearch, IconSunrise, SeasonSpring } from '../ui/icons';

export function JournalScreen() {
  const entries = useRows('journal_entries');
  const today = useToday();
  const { query } = useLocation();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string>(query.get('kind') ?? 'all');
  const search = q.trim().toLowerCase();
  const shown = entries
    .filter((e) => kind === 'all' || e.kind === kind || (kind === 'reviews' && ['weekly', 'monthly', 'season', 'fresh_start'].includes(e.kind)))
    .filter((e) => !search || `${e.title ?? ''} ${entryText(e)} ${e.tags.join(' ')}`.toLowerCase().includes(search))
    .sort((a, b) => b.day.localeCompare(a.day) || b.created_at.localeCompare(a.created_at));
  const byMonth = new Map<string, JournalEntry[]>();
  for (const e of shown) byMonth.set(e.day.slice(0, 7), [...(byMonth.get(e.day.slice(0, 7)) ?? []), e]);

  return (
    <div className="page">
      <PageHead title="Journal" sub="Reflections, lessons and reviews" />
      <div className="review-links">
        <Link className="review-link" to="/journal/new?kind=free"><IconCalendar />New entry</Link>
        <Link className="review-link" to="/journal/new?kind=morning"><IconSunrise />Morning</Link>
        <Link className="review-link" to="/journal/new?kind=evening"><IconMoon />Evening</Link>
        <Link className="review-link" to="/review/weekly"><IconChart />Weekly review</Link>
        <Link className="review-link" to="/review/monthly"><IconCalendar />Monthly review</Link>
        <Link className="review-link" to="/review/season"><SeasonSpring />Life season</Link>
      </div>
      <Link className="review-link mt-s" to="/fresh-start" style={{ marginTop: 10 }}><IconRefresh />Fresh start</Link>

      <div className="toolbar mt">
        <div className="search"><IconSearch size={18} /><input className="input" type="search" placeholder="Search your journal" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search journal" /></div>
      </div>
      <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter entries">
        <option value="all">All entries</option>
        <option value="free">Journal</option><option value="morning">Morning</option><option value="evening">Evening</option>
        <option value="reviews">Reviews, seasons and fresh starts</option>
      </select>

      {!shown.length && <div className="list mt"><Empty title={entries.length ? 'No entries match' : 'No entries yet'}>Writing things down helps you notice what’s working and what needs to change.</Empty></div>}
      {[...byMonth.entries()].map(([m, list]) => (
        <Section key={m} title={monthLabel(m + '-01')} count={list.length}>
          <div className="list">{list.map((e) => (
            <Link key={e.id} to={reviewHref(e)} className="row" style={{ alignItems: 'flex-start' }}>
              <span className="row-main">
                <span className="row-meta" style={{ marginTop: 0, marginBottom: 2 }}><span>{relDay(e.day, today)}</span><span>{KIND_LABEL[e.kind]}{e.season ? ` · ${SEASONS[e.season].name}` : ''}</span>
                  {e.conflict_of && <span className="badge">Edited on two devices — both kept</span>}</span>
                <span className="serif" style={{ fontSize: 17, display: 'block' }}>{e.title || firstLine(entryText(e)) || <span className="faint">Empty entry</span>}</span>
              </span>
            </Link>
          ))}</div>
        </Section>
      ))}
    </div>
  );
}

function firstLine(s: string) {
  const l = s.split('\n').find((x) => x.trim()) ?? '';
  return l.length > 140 ? l.slice(0, 140) + '…' : l;
}

function reviewHref(e: JournalEntry) {
  if (e.kind === 'weekly' && e.answers.week_start) return `/review/weekly?week=${e.answers.week_start}`;
  if (e.kind === 'monthly' && e.answers.month) return `/review/monthly?month=${e.answers.month}`;
  return `/journal/${e.id}`;
}

/** Free writing and the morning / evening templates. Saves as you type. */
export function JournalEditor({ id }: { id: string | null }) {
  const store = useStore();
  const today = useToday();
  const { tz } = useSettings();
  const { query } = useLocation();
  const existing = useRows('journal_entries').find((e) => e.id === id);
  const [entryId, setEntryIdState] = useState<string | null>(id);
  const entryRef = useRef<string | null>(id);
  const deleted = useRef(false);
  const setEntryId = (v: string | null) => { entryRef.current = v; setEntryIdState(v); };
  const kind: JournalKind = existing?.kind ?? (query.get('kind') as JournalKind) ?? 'free';
  const [day] = useState(existing?.day ?? today);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [answers, setAnswers] = useState<Record<string, string>>(existing?.answers ?? {});
  const [extraTask, setExtraTask] = useState(false);
  const [extraIdea, setExtraIdea] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title, body, answers });
  latest.current = { title, body, answers };
  const prompts = promptsFor(kind);

  const persist = () => {
    timer.current = null;
    if (deleted.current) return;
    const v = latest.current;
    const current = entryRef.current;
    const empty = !v.title.trim() && !v.body.trim() && !Object.values(v.answers).some((x) => x?.trim());
    if (empty && !current) return;
    const values = { title: v.title.trim() || null, body: v.body || null, answers: v.answers, kind, day };
    const cur = current ? store.get('journal_entries', current) : undefined;
    if (cur) {
      const same = cur.title === values.title && cur.body === values.body && JSON.stringify(cur.answers) === JSON.stringify(values.answers);
      if (!same) store.update('journal_entries', cur.id, values);
    }
    else {
      const e = store.create('journal_entries', values);
      setEntryId(e.id);
      history.replaceState(history.state, '', `/journal/${e.id}`);
    }
  };
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persist, 700);
  };
  // Save anything still pending when leaving the screen.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); persist(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = () => {
    if (timer.current) clearTimeout(timer.current);
    persist();
    const entryIdNow = entryRef.current;
    if (kind === 'morning') {
      if (extraTask && answers.action?.trim()) {
        store.create('tasks', { title: answers.action.trim(), due_date: today, top_on: store.all('tasks').filter((t) => t.top_on === today && t.status === 'open').length < 3 ? today : null });
      }
      if (answers.most?.trim()) {
        const noteId = stableId('day_note', store.userId, day);
        if (!store.get('day_notes', noteId)?.intention) store.upsert('day_notes', noteId, { day, intention: answers.most.trim() });
      }
    }
    if (kind === 'evening' && extraIdea && answers.learned?.trim()) {
      store.create('ideas', { body: answers.learned.trim(), journal_id: entryIdNow, tags: ['lesson'] });
    }
    toast('Saved');
    back('/journal');
  };

  return (
    <div className="page">
      <PageHead backTo="/journal" title={KIND_LABEL[kind]} sub={longDay(day)} />
      {existing?.conflict_of && <div className="banner warn"><div>This is the version written on another device at the same time. The other version is kept too — merge them if you like, then delete one.</div></div>}
      {existing && existing.updated_at && <p className="tiny faint">Last saved {relDay(dayOf(existing.updated_at, tz), today).toLowerCase()}</p>}
      {kind === 'free' && (
        <div className="form">
          <input className="input serif" style={{ fontSize: 22, border: 0, background: 'transparent', padding: '4px 0' }} placeholder="Title (optional)" value={title} onChange={(e) => { setTitle(e.target.value); schedule(); }} />
          <AutoText serif value={body} onChange={(e) => { setBody(e.target.value); schedule(); }} minRows={10} placeholder="Write freely…" data-autofocus aria-label="Entry" />
        </div>
      )}
      {prompts.length > 0 && (
        <div>
          {prompts.map((p, i) => (
            <div className="qa" key={p.key}>
              <p className="q">{p.q}</p>
              <AutoText value={answers[p.key] ?? ''} onChange={(e) => { setAnswers((a) => ({ ...a, [p.key]: e.target.value })); schedule(); }} minRows={2} aria-label={p.q} autoFocus={i === 0 && !existing} />
              {p.hint && <span className="tiny faint">{p.hint}</span>}
            </div>
          ))}
          <div className="qa"><p className="q">Anything else?</p><AutoText value={body} onChange={(e) => { setBody(e.target.value); schedule(); }} minRows={2} aria-label="Anything else" /></div>
          {kind === 'morning' && answers.action?.trim() && !existing && (
            <label className="toggle mt"><span>Add “{answers.action.trim().slice(0, 40)}” as a task for today</span><input type="checkbox" className="switch" checked={extraTask} onChange={(e) => setExtraTask(e.target.checked)} /></label>
          )}
          {kind === 'evening' && answers.learned?.trim() && (
            <label className="toggle mt"><span>Save what I learned to the idea notebook</span><input type="checkbox" className="switch" checked={extraIdea} onChange={(e) => setExtraIdea(e.target.checked)} /></label>
          )}
          {kind === 'evening' && <SeminarNote>It’s not what happens that decides how life turns out — it’s what you do about it. Take responsibility for the day, then plan the next one.</SeminarNote>}
        </div>
      )}
      <div className="btn-row">
        <button className="btn" onClick={finish}>Done</button>
        {entryId && <button className="btn ghost danger-text" onClick={async () => {
          if (await confirm({ title: 'Delete this entry?', confirmLabel: 'Delete', danger: true })) {
            if (timer.current) clearTimeout(timer.current);
            timer.current = null;
            deleted.current = true;
            store.remove('journal_entries', entryId);
            toast('Entry deleted', { action: { label: 'Undo', run: () => store.restore('journal_entries', entryId) } });
            setEntryId(null);
            navigate('/journal', { replace: true });
          }
        }}>Delete</button>}
      </div>
      <p className="tiny faint">Saved automatically as you write.</p>
    </div>
  );
}
