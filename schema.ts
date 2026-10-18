// Row types. Field names match the Supabase columns exactly
// (supabase/migrations/0001_my_life_schema.sql) so rows can be sent as-is.
import type { ISODate } from '../lib/dates';

export interface Base {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  rev: number;
  last_op: string | null;
  is_example: boolean;
}

export type Theme = 'system' | 'light' | 'dark';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

export interface Settings extends Base {
  timezone: string | null;
  theme: Theme;
  default_currency: string;
  currencies: string[];
  /** Explicit conversion rates entered by the user, e.g. { "USD>IQD": 1310 } */
  fx: Record<string, number>;
  reminder_text: string | null;
  season: Season | null;
  season_note: string | null;
  week_starts_on: number;
  onboarding: { step?: number; done?: boolean; skipped?: boolean };
}

export interface Area extends Base {
  name: string;
  icon: string | null;
  description: string | null;
  sort: number;
  hidden: boolean;
  archived: boolean;
}

export type Horizon = '10y' | '5y' | '3y' | '1y' | 'quarter' | 'month' | 'week' | 'flexible';

export interface Vision extends Base {
  title: string;
  body: string | null;
  horizon: Horizon;
  area_id: string | null;
}

export type GoalCategory = 'economic' | 'things' | 'personal';
export type ProgressMode = 'numeric' | 'milestones' | 'manual';
export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived';
export interface Obstacle { obstacle: string; response: string }

export interface Goal extends Base {
  title: string;
  area_id: string | null;
  vision_id: string | null;
  category: GoalCategory;
  description: string | null;
  why: string | null;
  who_benefits: string | null;
  horizon: Horizon;
  target_date: ISODate | null;
  progress_mode: ProgressMode;
  start_value: number | null;
  target_value: number | null;
  current_value: number | null;
  unit: string | null;
  manual_progress: number | null;
  become: string | null;
  obstacles: Obstacle[];
  next_action: string | null;
  celebration: string | null;
  status: GoalStatus;
  completed_at: string | null;
  sort: number;
}

export interface GoalEvent extends Base {
  goal_id: string;
  at: string;
  kind: string;
  summary: string;
  data: Record<string, unknown> | null;
}

export interface Milestone extends Base {
  goal_id: string | null;
  area_id: string | null;
  kind: 'milestone' | 'project';
  title: string;
  notes: string | null;
  due_date: ISODate | null;
  done: boolean;
  done_at: string | null;
  sort: number;
}

export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export interface Recurrence { freq: Freq; interval: number; weekdays?: number[]; anchor_day?: number }

export interface Task extends Base {
  title: string;
  notes: string | null;
  parent_id: string | null;
  area_id: string | null;
  goal_id: string | null;
  milestone_id: string | null;
  person_id: string | null;
  learning_id: string | null;
  idea_id: string | null;
  due_date: ISODate | null;
  due_time: string | null;
  priority: number;
  tags: string[];
  estimate_min: number | null;
  recurrence: Recurrence | null;
  series_id: string | null;
  status: 'open' | 'done' | 'dismissed';
  completed_at: string | null;
  archived: boolean;
  top_on: ISODate | null;
  sort: number;
}

export interface TimeBlock extends Base {
  day: ISODate;
  start_time: string;
  end_time: string;
  title: string;
  kind: 'work' | 'appointment';
  task_id: string | null;
  goal_id: string | null;
  area_id: string | null;
  notes: string | null;
}

export interface Pause { from: ISODate; to: ISODate | null }

export interface Habit extends Base {
  title: string;
  area_id: string | null;
  goal_id: string | null;
  learning_id: string | null;
  idea_id: string | null;
  kind: 'check' | 'measure';
  unit: string | null;
  daily_target: number | null;
  schedule: 'daily' | 'weekdays' | 'weekly';
  weekdays: number[];
  weekly_target: number | null;
  minimum_version: string | null;
  why: string | null;
  start_date: ISODate;
  pauses: Pause[];
  archived: boolean;
  sort: number;
}

export type HabitStatus = 'done' | 'minimum' | 'rest' | 'missed';
export interface HabitLog extends Base {
  habit_id: string;
  day: ISODate;
  status: HabitStatus;
  value: number | null;
  note: string | null;
}

export interface DayNote extends Base {
  day: ISODate;
  intention: string | null;
}

export interface WeekPriority { text: string; goal_id?: string | null; done?: boolean }
export interface WeekPlan extends Base {
  week_start: ISODate;
  priorities: WeekPriority[];
  focus: string | null;
}

export type JournalKind = 'free' | 'morning' | 'evening' | 'weekly' | 'monthly' | 'season' | 'fresh_start';
export interface JournalEntry extends Base {
  day: ISODate;
  kind: JournalKind;
  title: string | null;
  body: string | null;
  answers: Record<string, string>;
  season: Season | null;
  tags: string[];
  conflict_of: string | null;
}

export type LearningKind = 'book' | 'course' | 'seminar' | 'skill' | 'other';
export interface LearningItem extends Base {
  kind: LearningKind;
  title: string;
  creator: string | null;
  area_id: string | null;
  goal_id: string | null;
  status: 'planned' | 'active' | 'paused' | 'done';
  progress_unit: string | null;
  progress_current: number | null;
  progress_total: number | null;
  key_ideas: string | null;
  notes: string | null;
  application: string | null;
  started_on: ISODate | null;
  finished_on: ISODate | null;
  sort: number;
}

export interface LearningSession extends Base {
  learning_id: string;
  day: ISODate;
  minutes: number | null;
  amount: number | null;
  note: string | null;
}

export interface Idea extends Base {
  title: string | null;
  body: string;
  learning_id: string | null;
  area_id: string | null;
  journal_id: string | null;
  tags: string[];
  pinned: boolean;
  conflict_of: string | null;
}

export type WinKind = 'goal' | 'milestone' | 'habit' | 'learning' | 'personal';
export interface Win extends Base {
  day: ISODate;
  title: string;
  note: string | null;
  kind: WinKind;
  area_id: string | null;
  goal_id: string | null;
  milestone_id: string | null;
}

export interface MoneyEntry extends Base {
  day: ISODate;
  kind: 'income' | 'expense';
  amount: number;
  currency: string;
  category: string | null;
  note: string | null;
  bill_id: string | null;
}

export interface SavingsGoal extends Base {
  title: string;
  target: number;
  saved: number;
  currency: string;
  target_date: ISODate | null;
  goal_id: string | null;
  archived: boolean;
}

export interface Bill extends Base {
  title: string;
  amount: number;
  currency: string;
  frequency: 'weekly' | 'monthly' | 'yearly';
  next_due: ISODate;
  active: boolean;
  notes: string | null;
}

export interface Person extends Base {
  name: string;
  relation: string | null;
  notes: string | null;
  contact_every_days: number | null;
  last_contact: ISODate | null;
  archived: boolean;
}

export interface PersonDate extends Base {
  person_id: string;
  label: string;
  date: ISODate;
  yearly: boolean;
}

export interface ContactLog extends Base {
  person_id: string;
  day: ISODate;
  note: string | null;
}

export interface Tables {
  settings: Settings;
  areas: Area;
  visions: Vision;
  goals: Goal;
  goal_events: GoalEvent;
  milestones: Milestone;
  tasks: Task;
  time_blocks: TimeBlock;
  habits: Habit;
  habit_logs: HabitLog;
  day_notes: DayNote;
  week_plans: WeekPlan;
  journal_entries: JournalEntry;
  learning_items: LearningItem;
  learning_sessions: LearningSession;
  ideas: Idea;
  wins: Win;
  money_entries: MoneyEntry;
  savings_goals: SavingsGoal;
  bills: Bill;
  people: Person;
  people_dates: PersonDate;
  contact_logs: ContactLog;
}

export type TableName = keyof Tables;
export type Row<T extends TableName> = Tables[T];

export const TABLES: TableName[] = [
  'settings', 'areas', 'visions', 'goals', 'goal_events', 'milestones', 'tasks',
  'time_blocks', 'habits', 'habit_logs', 'day_notes', 'week_plans',
  'journal_entries', 'learning_items', 'learning_sessions', 'ideas', 'wins',
  'money_entries', 'savings_goals', 'bills', 'people', 'people_dates', 'contact_logs',
];

/**
 * Tables whose text is precious: a write is only applied if nobody changed the
 * row since this device last saw it. Otherwise both versions are kept.
 * Everything else uses "last write wins".
 */
export const PRESERVE_ON_CONFLICT: TableName[] = ['journal_entries', 'ideas'];

/** Default values for every column of each table (besides the base columns). */
export const DEFAULTS: { [T in TableName]: Omit<Row<T>, keyof Base> } = {
  settings: {
    timezone: null, theme: 'system', default_currency: 'USD', currencies: ['USD', 'IQD'], fx: {},
    reminder_text: null, season: null, season_note: null, week_starts_on: 1, onboarding: {},
  },
  areas: { name: '', icon: null, description: null, sort: 0, hidden: false, archived: false },
  visions: { title: '', body: null, horizon: '10y', area_id: null },
  goals: {
    title: '', area_id: null, vision_id: null, category: 'personal', description: null, why: null,
    who_benefits: null, horizon: '1y', target_date: null, progress_mode: 'milestones', start_value: null,
    target_value: null, current_value: null, unit: null, manual_progress: null, become: null, obstacles: [],
    next_action: null, celebration: null, status: 'active', completed_at: null, sort: 0,
  },
  goal_events: { goal_id: '', at: '', kind: '', summary: '', data: null },
  milestones: {
    goal_id: null, area_id: null, kind: 'milestone', title: '', notes: null, due_date: null, done: false,
    done_at: null, sort: 0,
  },
  tasks: {
    title: '', notes: null, parent_id: null, area_id: null, goal_id: null, milestone_id: null, person_id: null,
    learning_id: null, idea_id: null, due_date: null, due_time: null, priority: 0, tags: [], estimate_min: null,
    recurrence: null, series_id: null, status: 'open', completed_at: null, archived: false, top_on: null, sort: 0,
  },
  time_blocks: {
    day: '', start_time: '09:00', end_time: '10:00', title: '', kind: 'work', task_id: null, goal_id: null,
    area_id: null, notes: null,
  },
  habits: {
    title: '', area_id: null, goal_id: null, learning_id: null, idea_id: null, kind: 'check', unit: null,
    daily_target: null, schedule: 'daily', weekdays: [], weekly_target: null, minimum_version: null, why: null,
    start_date: '', pauses: [], archived: false, sort: 0,
  },
  habit_logs: { habit_id: '', day: '', status: 'done', value: null, note: null },
  day_notes: { day: '', intention: null },
  week_plans: { week_start: '', priorities: [], focus: null },
  journal_entries: {
    day: '', kind: 'free', title: null, body: null, answers: {}, season: null, tags: [], conflict_of: null,
  },
  learning_items: {
    kind: 'book', title: '', creator: null, area_id: null, goal_id: null, status: 'active', progress_unit: null,
    progress_current: null, progress_total: null, key_ideas: null, notes: null, application: null,
    started_on: null, finished_on: null, sort: 0,
  },
  learning_sessions: { learning_id: '', day: '', minutes: null, amount: null, note: null },
  ideas: { title: null, body: '', learning_id: null, area_id: null, journal_id: null, tags: [], pinned: false, conflict_of: null },
  wins: { day: '', title: '', note: null, kind: 'personal', area_id: null, goal_id: null, milestone_id: null },
  money_entries: { day: '', kind: 'expense', amount: 0, currency: 'USD', category: null, note: null, bill_id: null },
  savings_goals: { title: '', target: 1, saved: 0, currency: 'USD', target_date: null, goal_id: null, archived: false },
  bills: { title: '', amount: 0, currency: 'USD', frequency: 'monthly', next_due: '', active: true, notes: null },
  people: { name: '', relation: null, notes: null, contact_every_days: null, last_contact: null, archived: false },
  people_dates: { person_id: '', label: '', date: '', yearly: true },
  contact_logs: { person_id: '', day: '', note: null },
};

export const BASE_KEYS: (keyof Base)[] = ['id', 'user_id', 'created_at', 'updated_at', 'deleted_at', 'rev', 'last_op', 'is_example'];

/** Every column name for a table, in a stable order. */
export function columnsOf(t: TableName): string[] {
  return [...BASE_KEYS, ...Object.keys(DEFAULTS[t])];
}
