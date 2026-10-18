// Calendar export (.ics). Calendar apps keep alerts even when My Life is
// closed, which a web app on iPhone cannot do by itself.
import { addDays, nextYearly, zonedParts, type ISODate } from '../lib/dates';
import type { Bill, Person, PersonDate, Task, TimeBlock } from '../data/schema';

/** The UTC instant for a wall-clock time in a time zone. */
export function zonedToUtc(day: ISODate, hm: string, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Adjust twice for the zone offset (handles DST edges).
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(t, tz);
    const [py, pm, pd] = p.date.split('-').map(Number);
    const [ph, pmin] = p.time.split(':').map(Number);
    const shown = Date.UTC(py, pm - 1, pd, ph, pmin);
    t += guess - shown;
  }
  return new Date(t);
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateOnly = (d: ISODate) => d.replace(/-/g, '');

/** Folds lines longer than 75 octets as the iCalendar format requires. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 74) { out.push(cur); cur = ' ' + ch; }
    else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

interface Ev { uid: string; summary: string; description?: string; allDay?: ISODate; start?: Date; end?: Date; rrule?: string; alarmMinutesBefore?: number }

export function buildIcs(opts: {
  tasks: Task[]; blocks: TimeBlock[]; bills: Bill[]; people: Person[]; dates: PersonDate[]; tz: string; today: ISODate;
  include: { tasks: boolean; blocks: boolean; bills: boolean; dates: boolean };
}): { ics: string; count: number } {
  const { tz, today, include } = opts;
  const events: Ev[] = [];
  if (include.tasks) {
    for (const t of opts.tasks) {
      if (t.status !== 'open' || t.archived || !t.due_date || t.due_date < addDays(today, -1)) continue;
      if (t.due_time) {
        const start = zonedToUtc(t.due_date, t.due_time, tz);
        events.push({ uid: `task-${t.id}`, summary: t.title, description: t.notes ?? undefined, start, end: new Date(start.getTime() + (t.estimate_min || 30) * 60000), alarmMinutesBefore: 15 });
      } else {
        events.push({ uid: `task-${t.id}`, summary: `Due: ${t.title}`, description: t.notes ?? undefined, allDay: t.due_date });
      }
    }
  }
  if (include.blocks) {
    for (const b of opts.blocks) {
      if (b.day < addDays(today, -1)) continue;
      events.push({
        uid: `block-${b.id}`, summary: b.title, description: b.notes ?? undefined,
        start: zonedToUtc(b.day, b.start_time, tz), end: zonedToUtc(b.day, b.end_time > b.start_time ? b.end_time : b.start_time, tz), alarmMinutesBefore: 10,
      });
    }
  }
  if (include.bills) {
    for (const b of opts.bills) {
      if (!b.active) continue;
      const rrule = b.frequency === 'weekly' ? 'FREQ=WEEKLY' : b.frequency === 'yearly' ? 'FREQ=YEARLY' : 'FREQ=MONTHLY';
      events.push({ uid: `bill-${b.id}`, summary: `Bill: ${b.title} (${b.amount} ${b.currency})`, allDay: b.next_due, rrule, alarmMinutesBefore: -9 * 60 });
    }
  }
  if (include.dates) {
    const byId = new Map(opts.people.map((p) => [p.id, p]));
    for (const d of opts.dates) {
      const p = byId.get(d.person_id);
      if (!p || p.archived) continue;
      events.push({
        uid: `date-${d.id}`, summary: `${p.name}: ${d.label}`,
        allDay: d.yearly ? nextYearly(d.date, today) : d.date, rrule: d.yearly ? 'FREQ=YEARLY' : undefined, alarmMinutesBefore: -9 * 60,
      });
    }
  }
  const now = utcStamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//My Life//Personal planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:My Life'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@my-life`, `DTSTAMP:${now}`, `SUMMARY:${esc(e.summary)}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.allDay)}`, `DTEND;VALUE=DATE:${dateOnly(addDays(e.allDay, 1))}`);
    } else {
      lines.push(`DTSTART:${utcStamp(e.start!)}`, `DTEND:${utcStamp(e.end!)}`);
    }
    if (e.rrule) lines.push(`RRULE:${e.rrule}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.alarmMinutesBefore != null) {
      // Negative values on all-day events mean "this many minutes after midnight" (e.g. 9:00).
      const trig = e.alarmMinutesBefore >= 0 ? `-PT${e.alarmMinutesBefore}M` : `PT${-e.alarmMinutesBefore}M`;
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.summary)}`, `TRIGGER:${trig}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return { ics: lines.map(fold).join('\r\n') + '\r\n', count: events.length };
}

/** Hands a file to the user: the iPhone share sheet when available, otherwise a download. */
export async function shareOrDownload(name: string, content: string | Blob, type: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const file = new File([blob], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
