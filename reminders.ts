// In-app reminders, computed whenever the app is open. (Web apps on iPhone
// cannot run in the background, so nothing is scheduled while it is closed —
// export to Calendar for alerts that fire when the app is closed.)
import { addDays, dayOf, diffDays, nextYearly, type ISODate } from '../lib/dates';
import type { Bill, Person, PersonDate } from '../data/schema';

export interface Reminder { key: string; kind: 'bill' | 'contact' | 'date'; title: string; detail: string; due: ISODate; href: string }

export function computeReminders(opts: { bills: Bill[]; people: Person[]; dates: PersonDate[]; today: ISODate; tz: string }): Reminder[] {
  const { today, tz } = opts;
  const out: Reminder[] = [];
  for (const b of opts.bills) {
    if (!b.active || b.next_due > addDays(today, 3)) continue;
    const n = diffDays(b.next_due, today);
    out.push({
      key: `bill:${b.id}`, kind: 'bill', title: b.title, due: b.next_due, href: '/more/money',
      detail: n < 0 ? `Bill was due ${-n} day${n === -1 ? '' : 's'} ago` : n === 0 ? 'Bill due today' : `Bill due in ${n} day${n === 1 ? '' : 's'}`,
    });
  }
  const peopleById = new Map(opts.people.map((p) => [p.id, p]));
  for (const p of opts.people) {
    if (p.archived || !p.contact_every_days) continue;
    const last = p.last_contact ?? dayOf(p.created_at, tz);
    const due = addDays(last, p.contact_every_days);
    if (due > today) continue;
    out.push({
      key: `contact:${p.id}`, kind: 'contact', title: `Reach out to ${p.name}`, due, href: `/more/people/${p.id}`,
      detail: p.last_contact ? `Last contact ${diffDays(today, p.last_contact)} days ago` : `You planned every ${p.contact_every_days} days`,
    });
  }
  for (const d of opts.dates) {
    const p = peopleById.get(d.person_id);
    if (!p || p.archived) continue;
    const next = d.yearly ? nextYearly(d.date, today) : d.date;
    const n = diffDays(next, today);
    if (n < 0 || n > 7) continue;
    out.push({
      key: `date:${d.id}`, kind: 'date', title: `${p.name}: ${d.label}`, due: next, href: `/more/people/${p.id}`,
      detail: n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`,
    });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}
