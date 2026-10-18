import { useState } from 'react';
import { useRows, useSettings, useStore, useToday } from '../app/context';
import { addDays, dayOf, relDay } from '../lib/dates';
import { Link, back, navigate, useLocation } from '../lib/router';
import type { Idea, LearningItem, LearningKind } from '../data/schema';
import { AutoText, Empty, Field, NumberInput, PageHead, Progress, Section, Seg, SeminarNote, Sheet, confirm, toast } from '../ui/kit';
import { IconBulb, IconChevron, IconEdit, IconPlus, IconSearch, IconStar } from '../ui/icons';
import { AreaSelect, GoalSelect, openHabitEditor, openTask } from './shared';

const KIND_LABEL: Record<LearningKind, string> = { book: 'Book', course: 'Course', seminar: 'Seminar', skill: 'Skill', other: 'Other' };

export function GrowthScreen() {
  const { query } = useLocation();
  const tab = (query.get('tab') as 'learning' | 'ideas') || 'learning';
  const [editing, setEditing] = useState(false);
  const [ideaEdit, setIdeaEdit] = useState<Idea | 'new' | null>(null);
  return (
    <div className="page">
      <PageHead title="Growth" sub="Who you are becoming"
        actions={tab === 'learning'
          ? <button className="btn small" onClick={() => setEditing(true)}><IconPlus size={18} />Add</button>
          : <button className="btn small" onClick={() => setIdeaEdit('new')}><IconPlus size={18} />Idea</button>} />
      <Seg label="Growth section" value={tab} onChange={(v) => navigate(`/growth?tab=${v}`, { replace: true })}
        options={[{ value: 'learning', label: 'Learning' }, { value: 'ideas', label: 'Idea notebook' }]} />
      <div className="mt">{tab === 'learning' ? <LearningList onAdd={() => setEditing(true)} /> : <IdeaList onEdit={setIdeaEdit} />}</div>
      {editing && <LearningEditor item={null} onClose={() => setEditing(false)} />}
      {ideaEdit && <IdeaSheet idea={ideaEdit === 'new' ? null : ideaEdit} onClose={() => setIdeaEdit(null)} />}
    </div>
  );
}

function pct(i: LearningItem): number | null {
  if (i.status === 'done') return 100;
  if (i.progress_total && i.progress_current != null) return Math.min(100, Math.round((i.progress_current / i.progress_total) * 100));
  return null;
}

function LearningList({ onAdd }: { onAdd: () => void }) {
  const items = useRows('learning_items');
  const sessions = useRows('learning_sessions');
  const today = useToday();
  const [q, setQ] = useState('');
  const search = q.trim().toLowerCase();
  const match = (i: LearningItem) => !search || `${i.title} ${i.creator ?? ''} ${i.key_ideas ?? ''} ${i.notes ?? ''} ${i.application ?? ''}`.toLowerCase().includes(search);
  const groups: { title: string; items: LearningItem[] }[] = [
    { title: 'In progress', items: items.filter((i) => i.status === 'active' && match(i)) },
    { title: 'Up next', items: items.filter((i) => i.status === 'planned' && match(i)) },
    { title: 'Paused', items: items.filter((i) => i.status === 'paused' && match(i)) },
    { title: 'Finished', items: items.filter((i) => i.status === 'done' && match(i)).sort((a, b) => (b.finished_on ?? '').localeCompare(a.finished_on ?? '')) },
  ];
  const weekMinutes = sessions.filter((s) => s.day > addDays(today, -7)).reduce((n, s) => n + (s.minutes ?? 0), 0);
  return (
    <>
      <SeminarNote>Work harder on yourself than on your job. Read, study how things work, and keep what you learn in a journal instead of trusting memory.</SeminarNote>
      {items.length > 0 && (
        <div className="toolbar">
          <div className="search"><IconSearch size={18} /><input className="input" type="search" placeholder="Search books, courses, notes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search learning" /></div>
        </div>
      )}
      {items.length > 0 && <p className="small muted">{weekMinutes} minutes of learning logged in the last 7 days.</p>}
      {!items.length && <div className="list"><Empty title="Nothing here yet">Add a book, course, seminar or skill you’re working on.
        <div className="mt-s"><button className="btn small" onClick={onAdd}>Add learning</button></div></Empty></div>}
      {groups.map((g) => g.items.length > 0 && (
        <Section key={g.title} title={g.title} count={g.items.length}>
          <div className="list">{g.items.map((i) => {
            const p = pct(i);
            return (
              <Link key={i.id} to={`/growth/item/${i.id}`} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="inline" style={{ gap: 8 }}>
                  <span className="row-title grow" style={{ fontWeight: 600 }}>{i.title}</span><IconChevron size={18} className="faint" />
                </div>
                <div className="row-meta" style={{ marginTop: -4 }}><span>{KIND_LABEL[i.kind]}</span>{i.creator && <span>{i.creator}</span>}
                  {i.progress_total ? <span>{i.progress_current ?? 0} / {i.progress_total} {i.progress_unit ?? ''}</span> : null}
                  {i.is_example && <span className="badge example">Example</span>}</div>
                {p != null && i.status !== 'done' && <Progress pct={p} />}
              </Link>
            );
          })}</div>
        </Section>
      ))}
    </>
  );
}

export function LearningDetail({ id }: { id: string }) {
  const store = useStore();
  const today = useToday();
  const item = useRows('learning_items').find((i) => i.id === id);
  const sessions = useRows('learning_sessions').filter((s) => s.learning_id === id).sort((a, b) => b.day.localeCompare(a.day));
  const ideas = useRows('ideas').filter((i) => i.learning_id === id);
  const tasks = useRows('tasks').filter((t) => t.learning_id === id && !t.archived);
  const habits = useRows('habits').filter((h) => h.learning_id === id && !h.archived);
  const [editing, setEditing] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [newIdea, setNewIdea] = useState('');
  if (!item) return <div className="page"><PageHead title="Not found" backTo="/growth" /></div>;
  const p = pct(item);
  return (
    <div className="page">
      <PageHead backTo="/growth" title={item.title} sub={`${KIND_LABEL[item.kind]}${item.creator ? ` · ${item.creator}` : ''}`}
        actions={<button className="icon-btn" aria-label="Edit" onClick={() => setEditing(true)}><IconEdit /></button>} />
      <div className="card">
        <div className="stat-line"><span>Progress</span><strong className="num">{item.progress_total ? `${item.progress_current ?? 0} / ${item.progress_total} ${item.progress_unit ?? ''}` : item.status === 'done' ? 'Finished' : '—'}</strong></div>
        {p != null && <div className="mt-s"><Progress pct={p} /></div>}
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn small" onClick={() => setLogOpen(true)}>Log a session</button>
          {item.status !== 'done'
            ? <button className="btn small secondary" onClick={() => {
              store.update('learning_items', item.id, { status: 'done', finished_on: today, progress_current: item.progress_total ?? item.progress_current });
              store.create('wins', { day: today, title: `Finished: ${item.title}`, kind: 'learning', area_id: item.area_id });
              toast('Finished — added to your wins.', { kind: 'win' });
            }}>Mark finished</button>
            : <button className="btn small secondary" onClick={() => store.update('learning_items', item.id, { status: 'active', finished_on: null })}>Reopen</button>}
        </div>
      </div>

      <dl className="kv card mt">
        <div><dt>Key ideas</dt><dd>{item.key_ideas || <span className="muted">Not written yet</span>}</dd></div>
        <div><dt>How I’ll apply it</dt><dd>{item.application || <span className="muted">Not written yet</span>}</dd></div>
        {item.notes && <div><dt>Notes</dt><dd>{item.notes}</dd></div>}
      </dl>

      <button className="btn block mt" onClick={() => setActionOpen(true)}><IconBulb size={18} />Turn this idea into action</button>

      <Section title="Ideas from this" count={ideas.length || undefined}>
        <div className="list">
          {ideas.map((i) => <div key={i.id} className="row"><div className="row-main row-title serif">{i.body}</div></div>)}
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (!newIdea.trim()) return; store.create('ideas', { body: newIdea.trim(), learning_id: item.id, area_id: item.area_id }); setNewIdea(''); toast('Saved to your idea notebook'); }}>
            <input className="input" style={{ border: 0, padding: 0, minHeight: 36 }} placeholder="Capture an idea" value={newIdea} onChange={(e) => setNewIdea(e.target.value)} />
          </form>
        </div>
      </Section>

      {(tasks.length > 0 || habits.length > 0) && (
        <Section title="Actions created">
          <div className="list">
            {tasks.map((t) => <button key={t.id} className="row" onClick={() => openTask(t.id)}><span className="row-main"><span className="row-title">{t.title}</span><span className="row-meta">Task · {t.status}</span></span></button>)}
            {habits.map((h) => <Link key={h.id} to={`/plan/habit/${h.id}`} className="row"><span className="row-main"><span className="row-title">{h.title}</span><span className="row-meta">Habit</span></span></Link>)}
          </div>
        </Section>
      )}

      {sessions.length > 0 && (
        <Section title="Sessions" count={sessions.length}>
          <div className="list">{sessions.slice(0, 30).map((s) => (
            <div key={s.id} className="row"><div className="row-main"><div className="row-title small">{relDay(s.day, today)}{s.minutes ? ` · ${s.minutes} min` : ''}{s.amount ? ` · +${s.amount} ${item.progress_unit ?? ''}` : ''}</div>
              {s.note && <div className="row-meta">{s.note}</div>}</div>
              <button className="link-btn danger-text" onClick={() => store.remove('learning_sessions', s.id)}>Remove</button></div>
          ))}</div>
        </Section>
      )}

      <div className="btn-row">
        <button className="btn ghost danger-text" onClick={async () => {
          if (await confirm({ title: 'Delete this item?', body: 'Its sessions are deleted. Ideas, tasks and habits created from it are kept.', confirmLabel: 'Delete', danger: true })) {
            sessions.forEach((s) => store.remove('learning_sessions', s.id));
            store.remove('learning_items', item.id);
            back('/growth');
          }
        }}>Delete</button>
      </div>
      {editing && <LearningEditor item={item} onClose={() => setEditing(false)} />}
      {logOpen && <SessionSheet item={item} onClose={() => setLogOpen(false)} />}
      {actionOpen && <ActionSheet onClose={() => setActionOpen(false)} source={{ learning_id: item.id, area_id: item.area_id, text: item.application ?? '' }} />}
    </div>
  );
}

/** “Turn this idea into action”: creates a linked task or habit. */
export function ActionSheet({ source, onClose }: { source: { learning_id?: string | null; idea_id?: string | null; area_id?: string | null; text: string }; onClose: () => void }) {
  const today = useToday();
  const [kind, setKind] = useState<'task' | 'habit'>('task');
  const [title, setTitle] = useState(source.text.split('\n')[0].slice(0, 140));
  const go = () => {
    if (!title.trim()) return;
    onClose();
    const link = { learning_id: source.learning_id ?? null, idea_id: source.idea_id ?? null, area_id: source.area_id ?? null };
    if (kind === 'task') openTask(null, { title: title.trim(), due_date: today, ...link });
    else openHabitEditor(null, { title: title.trim(), ...link });
  };
  return (
    <Sheet open title="Turn into action" onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>An idea only changes things once you act on it. Make it a one-time task or a repeating habit.</p>
      <Seg label="Action type" value={kind} onChange={setKind} options={[{ value: 'task', label: 'One-time task' }, { value: 'habit', label: 'Repeating habit' }]} />
      <Field label="Action"><input className="input mt-s" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Start with a verb" data-autofocus /></Field>
      <button className="btn block mt" onClick={go} disabled={!title.trim()}>Continue</button>
    </Sheet>
  );
}

function SessionSheet({ item, onClose }: { item: LearningItem; onClose: () => void }) {
  const store = useStore();
  const today = useToday();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const save = () => {
    store.create('learning_sessions', { learning_id: item.id, day: today, minutes: minutes == null ? null : Math.round(minutes), amount, note: note.trim() || null });
    if (amount) store.update('learning_items', item.id, { progress_current: (item.progress_current ?? 0) + amount, status: item.status === 'planned' ? 'active' : item.status, started_on: item.started_on ?? today });
    toast('Session logged');
    onClose();
  };
  return (
    <Sheet open title="Log a session" onClose={onClose}>
      <div className="form">
        <div className="inline">
          <Field label="Minutes"><NumberInput value={minutes} onChange={setMinutes} /></Field>
          <Field label={`Progress made${item.progress_unit ? ` (${item.progress_unit})` : ''}`}><NumberInput value={amount} onChange={setAmount} placeholder="e.g. 12" /></Field>
        </div>
        <Field label="What stood out?"><AutoText value={note} onChange={(e) => setNote(e.target.value)} minRows={2} /></Field>
      </div>
      <button className="btn block mt" onClick={save} disabled={!minutes && !amount && !note.trim()}>Save session</button>
    </Sheet>
  );
}

function LearningEditor({ item, onClose }: { item: LearningItem | null; onClose: () => void }) {
  const store = useStore();
  const today = useToday();
  const [d, setD] = useState<Partial<LearningItem>>(item ? { ...item } : { kind: 'book', status: 'active', title: '' });
  const set = (p: Partial<LearningItem>) => setD((x) => ({ ...x, ...p }));
  const save = () => {
    if (!d.title?.trim()) { toast('Add a title'); return; }
    const values = {
      kind: d.kind ?? 'book', title: d.title.trim(), creator: d.creator || null, status: d.status ?? 'active',
      progress_unit: d.progress_unit || null, progress_current: d.progress_current ?? null, progress_total: d.progress_total ?? null,
      key_ideas: d.key_ideas || null, application: d.application || null, notes: d.notes || null,
      area_id: d.area_id ?? null, goal_id: d.goal_id ?? null, started_on: d.started_on ?? (d.status === 'active' ? today : null),
    };
    if (item) store.update('learning_items', item.id, values);
    else { const n = store.create('learning_items', values); navigate(`/growth/item/${n.id}`); }
    onClose();
  };
  return (
    <Sheet open title={item ? 'Edit' : 'Add learning'} onClose={onClose}>
      <div className="form">
        <Seg label="Kind" value={d.kind ?? 'book'} onChange={(v) => set({ kind: v as LearningKind, progress_unit: d.progress_unit ?? (v === 'book' ? 'pages' : v === 'course' ? 'lessons' : null) })}
          options={(Object.keys(KIND_LABEL) as LearningKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        <Field label="What are you learning?"><input className="input" value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} data-autofocus /></Field>
        <Field label="Author, teacher or source"><input className="input" value={d.creator ?? ''} onChange={(e) => set({ creator: e.target.value })} /></Field>
        <Field label="Status">
          <select className="select" value={d.status} onChange={(e) => set({ status: e.target.value as LearningItem['status'] })}>
            <option value="planned">Up next</option><option value="active">In progress</option><option value="paused">Paused</option><option value="done">Finished</option>
          </select>
        </Field>
        <div className="inline">
          <Field label="Done so far"><NumberInput value={d.progress_current ?? null} onChange={(n) => set({ progress_current: n })} /></Field>
          <Field label="Total"><NumberInput value={d.progress_total ?? null} onChange={(n) => set({ progress_total: n })} /></Field>
          <Field label="Unit"><input className="input" value={d.progress_unit ?? ''} onChange={(e) => set({ progress_unit: e.target.value })} placeholder="pages" /></Field>
        </div>
        <Field label="Key ideas"><AutoText value={d.key_ideas ?? ''} onChange={(e) => set({ key_ideas: e.target.value })} minRows={3} /></Field>
        <Field label="How will you apply it?"><AutoText value={d.application ?? ''} onChange={(e) => set({ application: e.target.value })} minRows={2} /></Field>
        <Field label="Personal notes"><AutoText value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} minRows={2} /></Field>
        <AreaSelect value={d.area_id ?? null} onChange={(v) => set({ area_id: v })} />
        <GoalSelect value={d.goal_id ?? null} onChange={(v) => set({ goal_id: v })} label="Supports goal" />
      </div>
      <button className="btn block mt" onClick={save}>Save</button>
    </Sheet>
  );
}

// ---------- ideas ----------

function IdeaList({ onEdit }: { onEdit: (i: Idea) => void }) {
  const ideas = useRows('ideas');
  const items = useRows('learning_items');
  const { tz } = useSettings();
  const today = useToday();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const tags = [...new Set(ideas.flatMap((i) => i.tags))].sort();
  const search = q.trim().toLowerCase();
  const shown = ideas
    .filter((i) => (!tag || i.tags.includes(tag)) && (!search || `${i.title ?? ''} ${i.body} ${i.tags.join(' ')}`.toLowerCase().includes(search)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at));
  return (
    <>
      <div className="toolbar"><div className="search"><IconSearch size={18} /><input className="input" type="search" placeholder="Search ideas" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search ideas" /></div></div>
      {tags.length > 0 && (
        <div className="chips mb">{['', ...tags].map((t) => <button key={t || 'all'} className="chip" aria-pressed={tag === t} onClick={() => setTag(t)}>{t ? `#${t}` : 'All'}</button>)}</div>
      )}
      <div className="list">
        {shown.length ? shown.map((i) => (
          <button key={i.id} className="row" onClick={() => onEdit(i)} style={{ alignItems: 'flex-start' }}>
            <span className="row-main">
              {i.title && <span className="row-title" style={{ fontWeight: 600, display: 'block' }}>{i.title}</span>}
              <span className="serif" style={{ fontSize: 17, display: 'block', whiteSpace: 'pre-wrap' }}>{i.body.length > 280 ? i.body.slice(0, 280) + '…' : i.body}</span>
              <span className="row-meta">
                <span>{relDay(dayOf(i.created_at, tz), today)}</span>
                {i.learning_id && <span>From: {items.find((x) => x.id === i.learning_id)?.title ?? 'learning'}</span>}
                {i.tags.map((t) => <span key={t} className="tag">#{t}</span>)}
                {i.conflict_of && <span className="badge">Edited on two devices — both versions kept</span>}
              </span>
            </span>
            {i.pinned && <IconStar size={18} className="win-mark" />}
          </button>
        )) : <Empty title={ideas.length ? 'No ideas match' : 'Your idea notebook is empty'}>Capture useful thoughts here so they don’t get lost inside daily journal entries.</Empty>}
      </div>
    </>
  );
}

export function IdeaSheet({ idea, onClose, defaults }: { idea: Idea | null; onClose: () => void; defaults?: Partial<Idea> }) {
  const store = useStore();
  const [title, setTitle] = useState(idea?.title ?? defaults?.title ?? '');
  const [body, setBody] = useState(idea?.body ?? defaults?.body ?? '');
  const [tags, setTags] = useState((idea?.tags ?? []).join(', '));
  const [pinned, setPinned] = useState(idea?.pinned ?? false);
  const [action, setAction] = useState(false);
  const save = () => {
    if (!body.trim()) return;
    const values = { title: title.trim() || null, body: body.trim(), tags: tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean), pinned, journal_id: idea?.journal_id ?? defaults?.journal_id ?? null };
    if (idea) store.update('ideas', idea.id, values); else store.create('ideas', values);
    toast('Idea saved');
    onClose();
  };
  if (action && idea) return <ActionSheet onClose={onClose} source={{ idea_id: idea.id, area_id: idea.area_id, learning_id: idea.learning_id, text: idea.title || idea.body }} />;
  return (
    <Sheet open title={idea ? 'Idea' : 'New idea'} onClose={onClose}>
      <div className="form">
        <Field label="Title (optional)"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Idea"><AutoText serif value={body} onChange={(e) => setBody(e.target.value)} minRows={4} data-autofocus /></Field>
        <Field label="Tags" hint="Comma separated"><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} autoCapitalize="none" /></Field>
        <label className="toggle"><span>Pin to top</span><input type="checkbox" className="switch" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /></label>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={save} disabled={!body.trim()}>Save</button>
        {idea && <button className="btn secondary" onClick={() => setAction(true)}><IconBulb size={18} />Turn into action</button>}
      </div>
      {idea && <div className="btn-row"><button className="btn ghost danger-text" onClick={() => {
        store.remove('ideas', idea.id);
        toast('Idea deleted', { action: { label: 'Undo', run: () => store.restore('ideas', idea.id) } });
        onClose();
      }}>Delete</button></div>}
    </Sheet>
  );
}
