import { useState } from 'react';
import { useRows, useSettings, useStore, useToday } from '../app/context';
import { addDays, addMonths, diffDays, endOfMonth, monthLabel, nextYearly, relDay, startOfMonth } from '../lib/dates';
import { Link, back } from '../lib/router';
import type { Bill, MoneyEntry, Person, SavingsGoal } from '../data/schema';
import { AutoText, Empty, Field, NumberInput, PageHead, Progress, Section, Seg, Sheet, Toggle, confirm, toast } from '../ui/kit';
import { IconBack, IconChevron, IconPlus } from '../ui/icons';
import { TaskRow, openTask } from './shared';

export function money(n: number, cur: string) {
  const digits = cur === 'IQD' ? 0 : 2;
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits })} ${cur}`;
}

// ---------- money ----------

export function MoneyScreen() {
  const store = useStore();
  const today = useToday();
  const settings = useSettings();
  const entries = useRows('money_entries');
  const savings = useRows('savings_goals').filter((s) => !s.archived);
  const bills = useRows('bills').sort((a, b) => a.next_due.localeCompare(b.next_due));
  const [month, setMonth] = useState(startOfMonth(today));
  const [entryEdit, setEntryEdit] = useState<MoneyEntry | 'income' | 'expense' | null>(null);
  const [savingEdit, setSavingEdit] = useState<SavingsGoal | 'new' | null>(null);
  const [billEdit, setBillEdit] = useState<Bill | 'new' | null>(null);
  const end = endOfMonth(month);
  const monthEntries = entries.filter((e) => e.day >= month && e.day <= end).sort((a, b) => b.day.localeCompare(a.day));
  const currencies = [...new Set(monthEntries.map((e) => e.currency))].sort();
  const totals = currencies.map((c) => {
    const inc = monthEntries.filter((e) => e.currency === c && e.kind === 'income').reduce((n, e) => n + Number(e.amount), 0);
    const exp = monthEntries.filter((e) => e.currency === c && e.kind === 'expense').reduce((n, e) => n + Number(e.amount), 0);
    return { c, inc, exp };
  });
  // Converted total only when the user supplied a rate for every other currency.
  const target = settings.default_currency;
  const rateTo = (c: string) => (c === target ? 1 : settings.fx?.[`${c}>${target}`] ?? (settings.fx?.[`${target}>${c}`] ? 1 / settings.fx[`${target}>${c}`] : null));
  const canConvert = totals.length > 1 && totals.every((t) => rateTo(t.c) != null);
  const converted = canConvert ? totals.reduce((acc, t) => ({ inc: acc.inc + t.inc * rateTo(t.c)!, exp: acc.exp + t.exp * rateTo(t.c)! }), { inc: 0, exp: 0 }) : null;
  const byCategory = new Map<string, number>();
  monthEntries.filter((e) => e.kind === 'expense' && e.currency === (currencies.includes(target) ? target : currencies[0])).forEach((e) => byCategory.set(e.category || 'Uncategorised', (byCategory.get(e.category || 'Uncategorised') ?? 0) + Number(e.amount)));

  const payBill = (b: Bill) => {
    store.create('money_entries', { day: today, kind: 'expense', amount: b.amount, currency: b.currency, category: 'Bills', note: b.title, bill_id: b.id });
    const next = b.frequency === 'weekly' ? addDays(b.next_due, 7) : b.frequency === 'yearly' ? addMonths(b.next_due, 12) : addMonths(b.next_due, 1, Number(b.next_due.slice(8)));
    store.update('bills', b.id, { next_due: next });
    toast(`Paid. Next due ${next}.`);
  };

  return (
    <div className="page">
      <PageHead backTo="/more" title="Money" sub="Simple manual tracking. No bank connections." />
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(startOfMonth(addDays(month, -1)))}><IconBack /></button>
        <strong>{monthLabel(month)}</strong>
        <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(startOfMonth(addDays(end, 1)))}><IconChevron /></button>
      </div>
      <div className="card mt-s">
        {totals.length ? totals.map((t) => (
          <div key={t.c} style={{ padding: '4px 0' }}>
            <div className="stat-line"><span>Income</span><span className="num">{money(t.inc, t.c)}</span></div>
            <div className="stat-line"><span>Expenses</span><span className="num">{money(t.exp, t.c)}</span></div>
            <div className="stat-line"><strong>Net</strong><strong className="num">{money(t.inc - t.exp, t.c)}</strong></div>
            {totals.length > 1 && <div className="divider" style={{ margin: '8px 0' }} />}
          </div>
        )) : <p className="small muted" style={{ margin: 0 }}>No entries this month.</p>}
        {totals.length > 1 && (converted
          ? <p className="small" style={{ marginBottom: 0 }}>Combined in {target}, using your own rates: net {money(converted.inc - converted.exp, target)}</p>
          : <p className="tiny muted" style={{ marginBottom: 0 }}>Currencies are totalled separately. Add a conversion rate in Settings to see a combined total.</p>)}
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => setEntryEdit('expense')}>Add expense</button>
        <button className="btn secondary" onClick={() => setEntryEdit('income')}>Add income</button>
      </div>

      {byCategory.size > 1 && (
        <Section title="Spending by category">
          <div className="card">{[...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => (
            <div key={c} className="stat-line small" style={{ padding: '3px 0' }}><span>{c}</span><span className="num">{money(v, currencies.includes(target) ? target : currencies[0])}</span></div>
          ))}</div>
        </Section>
      )}

      <Section title="Entries" count={monthEntries.length || undefined}>
        <div className="list">
          {monthEntries.length ? monthEntries.map((e) => (
            <button key={e.id} className="row" onClick={() => setEntryEdit(e)}>
              <span className="row-main"><span className="row-title">{e.note || e.category || (e.kind === 'income' ? 'Income' : 'Expense')}</span>
                <span className="row-meta"><span>{relDay(e.day, today)}</span>{e.category && e.note && <span>{e.category}</span>}</span></span>
              <span className="num" style={{ color: e.kind === 'income' ? 'var(--accent-text)' : 'var(--ink)' }}>{e.kind === 'income' ? '+' : '−'}{money(Number(e.amount), e.currency)}</span>
            </button>
          )) : <Empty title="No entries this month" />}
        </div>
      </Section>

      <Section title="Bills" action={<button className="link-btn" onClick={() => setBillEdit('new')}>Add</button>}>
        <div className="list">
          {bills.length ? bills.map((b) => {
            const n = diffDays(b.next_due, today);
            return (
              <div key={b.id} className="row">
                <button className="row-main" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => setBillEdit(b)}>
                  <span className="row-title">{b.title}</span>
                  <span className="row-meta"><span className={n < 0 && b.active ? 'late' : ''}>{b.active ? (n < 0 ? `Overdue since ${b.next_due}` : `Due ${relDay(b.next_due, today)}`) : 'Inactive'}</span><span>{money(b.amount, b.currency)} · {b.frequency}</span></span>
                </button>
                {b.active && <button className="btn small secondary" onClick={() => payBill(b)}>Paid</button>}
              </div>
            );
          }) : <Empty title="No recurring bills">Add rent, phone, internet… They appear in Today’s reminders three days before they’re due.</Empty>}
        </div>
      </Section>

      <Section title="Savings goals" action={<button className="link-btn" onClick={() => setSavingEdit('new')}>Add</button>}>
        <div className="list">
          {savings.length ? savings.map((s) => (
            <button key={s.id} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }} onClick={() => setSavingEdit(s)}>
              <div className="stat-line"><span className="row-title">{s.title}</span><span className="num small">{money(Number(s.saved), s.currency)} / {money(Number(s.target), s.currency)}</span></div>
              <Progress pct={Math.min(100, Math.round((Number(s.saved) / Number(s.target)) * 100))} />
              {s.target_date && <span className="tiny muted">Target date {s.target_date}</span>}
            </button>
          )) : <Empty title="No savings goals" />}
        </div>
      </Section>

      {entryEdit && <EntrySheet entry={typeof entryEdit === 'string' ? null : entryEdit} kind={typeof entryEdit === 'string' ? entryEdit : entryEdit.kind} onClose={() => setEntryEdit(null)} />}
      {savingEdit && <SavingSheet goal={savingEdit === 'new' ? null : savingEdit} onClose={() => setSavingEdit(null)} />}
      {billEdit && <BillSheet bill={billEdit === 'new' ? null : billEdit} onClose={() => setBillEdit(null)} />}
    </div>
  );
}

function CurrencySelect({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const { currencies } = useSettings();
  const list = [...new Set([...(currencies ?? []), value])];
  return (
    <Field label="Currency">
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>{list.map((c) => <option key={c}>{c}</option>)}</select>
    </Field>
  );
}

function EntrySheet({ entry, kind: k, onClose }: { entry: MoneyEntry | null; kind: 'income' | 'expense'; onClose: () => void }) {
  const store = useStore();
  const today = useToday();
  const { default_currency } = useSettings();
  const categories = [...new Set(useRows('money_entries').map((e) => e.category).filter(Boolean))] as string[];
  const [kind, setKind] = useState(entry?.kind ?? k);
  const [amount, setAmount] = useState<number | null>(entry ? Number(entry.amount) : null);
  const [currency, setCurrency] = useState(entry?.currency ?? default_currency);
  const [category, setCategory] = useState(entry?.category ?? '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [day, setDay] = useState(entry?.day ?? today);
  const save = () => {
    if (amount == null || amount < 0) { toast('Enter an amount'); return; }
    const values = { kind, amount, currency, category: category.trim() || null, note: note.trim() || null, day };
    if (entry) store.update('money_entries', entry.id, values); else store.create('money_entries', values);
    onClose();
  };
  return (
    <Sheet open title={entry ? 'Entry' : kind === 'income' ? 'Add income' : 'Add expense'} onClose={onClose}>
      <div className="form">
        <Seg label="Type" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} />
        <div className="inline">
          <Field label="Amount"><NumberInput value={amount} onChange={setAmount} aria-label="Amount" /></Field>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
        <Field label="Category"><input className="input" list="money-cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Food, transport, salary…" />
          <datalist id="money-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Field label="Date"><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value || today)} /></Field>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={save}>Save</button>
        {entry && <button className="btn ghost danger-text" onClick={() => { store.remove('money_entries', entry.id); toast('Deleted', { action: { label: 'Undo', run: () => store.restore('money_entries', entry.id) } }); onClose(); }}>Delete</button>}
      </div>
    </Sheet>
  );
}

function SavingSheet({ goal, onClose }: { goal: SavingsGoal | null; onClose: () => void }) {
  const store = useStore();
  const { default_currency } = useSettings();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [target, setTarget] = useState<number | null>(goal ? Number(goal.target) : null);
  const [saved, setSaved] = useState<number | null>(goal ? Number(goal.saved) : 0);
  const [currency, setCurrency] = useState(goal?.currency ?? default_currency);
  const [date, setDate] = useState(goal?.target_date ?? '');
  const [add, setAdd] = useState<number | null>(null);
  const save = () => {
    if (!title.trim() || !target || target <= 0) { toast('Add a name and a target above zero'); return; }
    const values = { title: title.trim(), target, saved: (saved ?? 0) + (add ?? 0), currency, target_date: date || null };
    if (goal) store.update('savings_goals', goal.id, values); else store.create('savings_goals', values);
    onClose();
  };
  return (
    <Sheet open title={goal ? 'Savings goal' : 'New savings goal'} onClose={onClose}>
      <div className="form">
        <Field label="Saving for"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="inline">
          <Field label="Target"><NumberInput value={target} onChange={setTarget} /></Field>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
        <Field label="Saved so far"><NumberInput value={saved} onChange={setSaved} /></Field>
        {goal && <Field label="Add to it now" hint="Added to “saved so far” when you save."><NumberInput value={add} onChange={setAdd} /></Field>}
        <Field label="Target date (optional)"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={save}>Save</button>
        {goal && <button className="btn ghost" onClick={() => { store.update('savings_goals', goal.id, { archived: true }); onClose(); }}>Archive</button>}
      </div>
    </Sheet>
  );
}

function BillSheet({ bill, onClose }: { bill: Bill | null; onClose: () => void }) {
  const store = useStore();
  const today = useToday();
  const { default_currency } = useSettings();
  const [d, setD] = useState<Partial<Bill>>(bill ?? { title: '', amount: 0, currency: default_currency, frequency: 'monthly', next_due: today, active: true });
  const set = (p: Partial<Bill>) => setD((x) => ({ ...x, ...p }));
  const save = () => {
    if (!d.title?.trim()) { toast('Name the bill'); return; }
    const values = { title: d.title.trim(), amount: d.amount ?? 0, currency: d.currency ?? default_currency, frequency: d.frequency ?? 'monthly', next_due: d.next_due || today, active: d.active ?? true, notes: d.notes ?? null };
    if (bill) store.update('bills', bill.id, values); else store.create('bills', values);
    onClose();
  };
  return (
    <Sheet open title={bill ? 'Bill' : 'New bill'} onClose={onClose}>
      <div className="form">
        <Field label="Bill"><input className="input" value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></Field>
        <div className="inline">
          <Field label="Amount"><NumberInput value={d.amount ?? null} onChange={(n) => set({ amount: n ?? 0 })} /></Field>
          <CurrencySelect value={d.currency ?? default_currency} onChange={(c) => set({ currency: c })} />
        </div>
        <Field label="Repeats">
          <select className="select" value={d.frequency} onChange={(e) => set({ frequency: e.target.value as Bill['frequency'] })}>
            <option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
          </select>
        </Field>
        <Field label="Next due"><input className="input" type="date" value={d.next_due ?? today} onChange={(e) => set({ next_due: e.target.value || today })} /></Field>
        <Toggle label="Active" checked={d.active ?? true} onChange={(v) => set({ active: v })} />
      </div>
      <div className="btn-row">
        <button className="btn" onClick={save}>Save</button>
        {bill && <button className="btn ghost danger-text" onClick={async () => { if (await confirm({ title: 'Delete this bill?', confirmLabel: 'Delete', danger: true })) { store.remove('bills', bill.id); onClose(); } }}>Delete</button>}
      </div>
    </Sheet>
  );
}

// ---------- relationships ----------

export function PeopleScreen() {
  const today = useToday();
  const people = useRows('people').filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name));
  const dates = useRows('people_dates');
  const [adding, setAdding] = useState(false);
  const upcoming = dates.map((d) => ({ d, next: d.yearly ? nextYearly(d.date, today) : d.date }))
    .filter((x) => x.next >= today && diffDays(x.next, today) <= 60).sort((a, b) => a.next.localeCompare(b.next));
  const due = (p: Person) => p.contact_every_days && diffDays(today, p.last_contact ?? p.created_at.slice(0, 10)) >= p.contact_every_days;
  return (
    <div className="page">
      <PageHead backTo="/more" title="Relationships" sub="The people who matter, and the time you want to give them"
        actions={<button className="btn small" onClick={() => setAdding(true)}><IconPlus size={18} />Person</button>} />
      {upcoming.length > 0 && (
        <Section title="Coming up">
          <div className="list">{upcoming.map(({ d, next }) => {
            const p = people.find((x) => x.id === d.person_id);
            if (!p) return null;
            return <Link key={d.id} to={`/more/people/${p.id}`} className="row"><span className="row-main"><span className="row-title">{p.name}: {d.label}</span><span className="row-meta">{relDay(next, today)}</span></span></Link>;
          })}</div>
        </Section>
      )}
      <Section title="People" count={people.length || undefined}>
        <div className="list">
          {people.length ? people.map((p) => (
            <Link key={p.id} to={`/more/people/${p.id}`} className="row">
              <span className="row-main"><span className="row-title">{p.name}</span>
                <span className="row-meta">{p.relation && <span>{p.relation}</span>}
                  {p.last_contact && <span>Last contact {relDay(p.last_contact, today).toLowerCase()}</span>}
                  {due(p) && <span className="tag">Time to reach out</span>}
                  {p.is_example && <span className="badge example">Example</span>}</span></span>
              <IconChevron size={18} className="faint" />
            </Link>
          )) : <Empty title="No one added yet">Add family and friends to remember important dates and keep in touch. Nothing is sent to anyone — reminders are only for you.</Empty>}
        </div>
      </Section>
      {adding && <PersonSheet person={null} onClose={() => setAdding(false)} />}
    </div>
  );
}

function PersonSheet({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState(person?.name ?? '');
  const [relation, setRelation] = useState(person?.relation ?? '');
  const [notes, setNotes] = useState(person?.notes ?? '');
  const [every, setEvery] = useState<number | null>(person?.contact_every_days ?? null);
  const save = () => {
    if (!name.trim()) return;
    const values = { name: name.trim(), relation: relation.trim() || null, notes: notes.trim() || null, contact_every_days: every ? Math.round(every) : null };
    if (person) store.update('people', person.id, values); else store.create('people', values);
    onClose();
  };
  return (
    <Sheet open title={person ? 'Edit' : 'Add a person'} onClose={onClose}>
      <div className="form">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} data-autofocus /></Field>
        <Field label="Relationship"><input className="input" value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Brother, friend, mentor…" /></Field>
        <Field label="Remind me to reach out every … days" hint="Optional. Shows on Today when it’s time."><NumberInput value={every} onChange={setEvery} /></Field>
        <Field label="Notes"><AutoText value={notes} onChange={(e) => setNotes(e.target.value)} minRows={2} placeholder="Things to remember, gift ideas…" /></Field>
      </div>
      <button className="btn block mt" onClick={save} disabled={!name.trim()}>Save</button>
    </Sheet>
  );
}

export function PersonDetail({ id }: { id: string }) {
  const store = useStore();
  const today = useToday();
  const person = useRows('people').find((p) => p.id === id);
  const dates = useRows('people_dates').filter((d) => d.person_id === id);
  const logs = useRows('contact_logs').filter((l) => l.person_id === id).sort((a, b) => b.day.localeCompare(a.day));
  const tasks = useRows('tasks').filter((t) => t.person_id === id && !t.archived && !t.parent_id);
  const goals = useRows('goals');
  const [edit, setEdit] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [dateLabel, setDateLabel] = useState('');
  const [dateValue, setDateValue] = useState('');
  const [logNote, setLogNote] = useState('');
  const [logDay, setLogDay] = useState(today);
  if (!person) return <div className="page"><PageHead title="Not found" backTo="/more/people" /></div>;
  const linkedGoals = goals.filter((g) => tasks.some((t) => t.goal_id === g.id));
  return (
    <div className="page">
      <PageHead backTo="/more/people" title={person.name} sub={person.relation ?? undefined}
        actions={<button className="btn small secondary" onClick={() => setEdit(true)}>Edit</button>} />
      {person.notes && <div className="card"><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{person.notes}</p></div>}
      <div className="card mt">
        <div className="stat-line"><span>Last contact</span><span>{person.last_contact ? relDay(person.last_contact, today) : 'Not logged yet'}</span></div>
        {person.contact_every_days && <div className="stat-line mt-s"><span>You planned</span><span>every {person.contact_every_days} days</span></div>}
        <button className="btn small mt" onClick={() => setLogOpen(true)}>Log time together or a call</button>
      </div>

      <Section title="Important dates">
        <div className="list">
          {dates.map((d) => (
            <div key={d.id} className="row"><span className="row-main"><span className="row-title">{d.label}</span>
              <span className="row-meta">{d.date}{d.yearly ? ` · next ${relDay(nextYearly(d.date, today), today).toLowerCase()}` : ''}</span></span>
              <button className="link-btn danger-text" onClick={() => store.remove('people_dates', d.id)}>Remove</button></div>
          ))}
          <form className="row" onSubmit={(e) => {
            e.preventDefault();
            if (!dateLabel.trim() || !dateValue) { toast('Add a label and a date'); return; }
            store.create('people_dates', { person_id: id, label: dateLabel.trim(), date: dateValue, yearly: true });
            setDateLabel(''); setDateValue('');
          }} style={{ flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: '1 1 140px' }} placeholder="Birthday, anniversary…" value={dateLabel} onChange={(e) => setDateLabel(e.target.value)} aria-label="Date label" />
            <input className="input" style={{ flex: '1 1 140px' }} type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} aria-label="Date" />
            <button className="btn small">Add</button>
          </form>
        </div>
        <p className="tiny muted">Repeats every year. Shows on Today a week ahead, and can be exported to Calendar.</p>
      </Section>

      <Section title="Plans and tasks" action={<button className="link-btn" onClick={() => openTask(null, { person_id: id, title: `Spend time with ${person.name}` })}>Add</button>}>
        <div className="list">{tasks.length ? tasks.map((t) => <TaskRow key={t.id} task={t} />) : <Empty title="Nothing planned">Plan a call, a visit or time together.</Empty>}</div>
        {linkedGoals.length > 0 && <p className="small muted">Related goals: {linkedGoals.map((g) => g.title).join(', ')}</p>}
      </Section>

      {logs.length > 0 && (
        <Section title="Time together">
          <div className="list">{logs.slice(0, 20).map((l) => (
            <div key={l.id} className="row"><span className="row-main"><span className="row-title small">{relDay(l.day, today)}</span>{l.note && <span className="row-meta">{l.note}</span>}</span></div>
          ))}</div>
        </Section>
      )}

      <div className="btn-row">
        <button className="btn ghost" onClick={() => { store.update('people', id, { archived: true }); back('/more/people'); }}>Archive</button>
        <button className="btn ghost danger-text" onClick={async () => {
          if (await confirm({ title: `Delete ${person.name}?`, body: 'Their dates and contact log are deleted. Tasks are kept.', confirmLabel: 'Delete', danger: true })) {
            dates.forEach((d) => store.remove('people_dates', d.id));
            logs.forEach((l) => store.remove('contact_logs', l.id));
            tasks.forEach((t) => store.update('tasks', t.id, { person_id: null }));
            store.remove('people', id);
            back('/more/people');
          }
        }}>Delete</button>
      </div>
      {edit && <PersonSheet person={person} onClose={() => setEdit(false)} />}
      <Sheet open={logOpen} onClose={() => setLogOpen(false)} title={`Time with ${person.name}`}>
        <div className="form">
          <Field label="When"><input className="input" type="date" value={logDay} onChange={(e) => setLogDay(e.target.value || today)} /></Field>
          <Field label="Note (optional)"><AutoText value={logNote} onChange={(e) => setLogNote(e.target.value)} minRows={2} /></Field>
        </div>
        <button className="btn block mt" onClick={() => {
          store.create('contact_logs', { person_id: id, day: logDay, note: logNote.trim() || null });
          if (!person.last_contact || logDay > person.last_contact) store.update('people', id, { last_contact: logDay });
          setLogNote(''); setLogOpen(false);
          toast('Logged');
        }}>Save</button>
      </Sheet>
    </div>
  );
}
