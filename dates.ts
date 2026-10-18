// Date helpers. Calendar days are plain ISO strings ("2026-10-18") interpreted
// in the user's chosen time zone. All arithmetic on days is done at UTC noon so
// daylight-saving changes can never shift a day.

export type ISODate = string; // YYYY-MM-DD

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(instant: number | Date, tz: string) {
  const parts = fmt(tz).formatToParts(typeof instant === 'number' ? new Date(instant) : instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`,
  };
}

/** The calendar day of an instant in the given time zone. */
export function dayOf(instant: number | Date | string, tz: string): ISODate {
  const t = typeof instant === 'string' ? Date.parse(instant) : instant;
  return zonedParts(t, tz).date;
}

export function today(tz: string, now: number = Date.now()): ISODate {
  return zonedParts(now, tz).date;
}

export function nowHM(tz: string, now: number = Date.now()): string {
  return zonedParts(now, tz).time;
}

function toUTCNoon(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day, 12));
}
function fromUTC(dt: Date): ISODate {
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  const dt = toUTCNoon(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
}

export function addMonths(d: ISODate, n: number, anchorDay?: number): ISODate {
  const [y, m, day] = d.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const wanted = anchorDay ?? day;
  const last = daysInMonth(target.getUTCFullYear(), target.getUTCMonth() + 1);
  target.setUTCDate(Math.min(wanted, last));
  return fromUTC(target);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(d: ISODate): number {
  return toUTCNoon(d).getUTCDay();
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTCNoon(a).getTime() - toUTCNoon(b).getTime()) / 86400000);
}

export function startOfWeek(d: ISODate, weekStartsOn: number): ISODate {
  const wd = weekday(d);
  return addDays(d, -((wd - weekStartsOn + 7) % 7));
}

export function startOfMonth(d: ISODate): ISODate {
  return d.slice(0, 8) + '01';
}

export function endOfMonth(d: ISODate): ISODate {
  const [y, m] = d.split('-').map(Number);
  return `${d.slice(0, 8)}${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

export function rangeDays(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isISODate(s: unknown): s is ISODate {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUTCNoon(s).getTime());
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const weekdayShort = (i: number) => WEEKDAY_SHORT[i];
export const weekdayName = (i: number) => WEEKDAY[i];
export const monthName = (m1: number) => MONTH[m1 - 1];

/** "Sunday, 18 October" */
export function longDay(d: ISODate): string {
  const [, m, day] = d.split('-').map(Number);
  return `${WEEKDAY[weekday(d)]}, ${day} ${MONTH[m - 1]}`;
}

/** Friendly relative label: Today, Tomorrow, Yesterday, Mon 20 Oct, 3 Jan 2027 */
export function relDay(d: ISODate, todayISO: ISODate): string {
  const n = diffDays(d, todayISO);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  const [y, m, day] = d.split('-').map(Number);
  const sameYear = y === Number(todayISO.slice(0, 4));
  if (n > 1 && n < 7) return `${WEEKDAY_SHORT[weekday(d)]} ${day} ${MONTH[m - 1].slice(0, 3)}`;
  return sameYear ? `${day} ${MONTH[m - 1].slice(0, 3)}` : `${day} ${MONTH[m - 1].slice(0, 3)} ${y}`;
}

export function monthLabel(d: ISODate): string {
  const [y, m] = d.split('-').map(Number);
  return `${MONTH[m - 1]} ${y}`;
}

export function formatTime(hm: string | null | undefined): string {
  if (!hm) return '';
  return hm;
}

/** Days until the next occurrence of a yearly date (month-day of `d`). */
export function nextYearly(d: ISODate, todayISO: ISODate): ISODate {
  const year = Number(todayISO.slice(0, 4));
  const md = d.slice(5);
  const fix = (y: number) => {
    const [mm, dd] = md.split('-').map(Number);
    const day = Math.min(dd, daysInMonth(y, mm));
    return `${y}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  const thisYear = fix(year);
  return thisYear >= todayISO ? thisYear : fix(year + 1);
}
