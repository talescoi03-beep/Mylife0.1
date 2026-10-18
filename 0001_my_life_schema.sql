-- My Life: schema, row-level security and triggers.
-- Run this once in the Supabase SQL editor (or with `supabase db push`).
--
-- Design notes
-- * Every private table carries user_id (defaults to the signed-in user) and is
--   protected by row-level security: a user can only read and write rows whose
--   user_id equals their own auth.uid().
-- * Rows are never hard-deleted by the app; deleted_at marks them so the
--   deletion can sync to other devices. Account deletion removes everything
--   through ON DELETE CASCADE on auth.users.
-- * ids are generated on the device (UUIDs) so records can be created offline.
-- * rev + last_op support the offline sync queue: last_op stores the id of the
--   operation that last wrote the row, so a retried operation is recognised
--   instead of being applied twice.
-- * There are deliberately no foreign keys between user tables. Offline changes
--   can arrive in any order, and a foreign key would also let one user point at
--   another user's row id. Links are plain uuid columns resolved in the app.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.settings (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  timezone text,
  theme text not null default 'system',
  default_currency text not null default 'USD',
  currencies text[] not null default array['USD','IQD'],
  fx jsonb not null default '{}'::jsonb,
  reminder_text text,
  season text,
  season_note text,
  week_starts_on integer not null default 1 check (week_starts_on between 0 and 6),
  onboarding jsonb not null default '{}'::jsonb,
  constraint settings_one_per_user check (id = user_id)
);

create table if not exists public.areas (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  name text not null check (char_length(name) between 1 and 80),
  icon text,
  description text,
  sort integer not null default 0,
  hidden boolean not null default false,
  archived boolean not null default false
);

create table if not exists public.visions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  title text not null,
  body text,
  horizon text not null default '10y',
  area_id uuid
);

create table if not exists public.goals (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  title text not null check (char_length(title) between 1 and 200),
  area_id uuid,
  vision_id uuid,
  category text not null default 'personal' check (category in ('economic','things','personal')),
  description text,
  why text,
  who_benefits text,
  horizon text not null default '1y' check (horizon in ('10y','5y','3y','1y','quarter','month','week','flexible')),
  target_date date,
  progress_mode text not null default 'milestones' check (progress_mode in ('numeric','milestones','manual')),
  start_value numeric,
  target_value numeric,
  current_value numeric,
  unit text,
  manual_progress integer check (manual_progress between 0 and 100),
  become text,
  obstacles jsonb not null default '[]'::jsonb,
  next_action text,
  celebration text,
  status text not null default 'active' check (status in ('active','paused','completed','archived')),
  completed_at timestamptz,
  sort integer not null default 0
);

create table if not exists public.goal_events (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  goal_id uuid not null,
  at timestamptz not null default now(),
  kind text not null,
  summary text not null,
  data jsonb
);

create table if not exists public.milestones (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  goal_id uuid,
  area_id uuid,
  kind text not null default 'milestone' check (kind in ('milestone','project')),
  title text not null,
  notes text,
  due_date date,
  done boolean not null default false,
  done_at timestamptz,
  sort integer not null default 0
);

create table if not exists public.tasks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  title text not null check (char_length(title) between 1 and 500),
  notes text,
  parent_id uuid,
  area_id uuid,
  goal_id uuid,
  milestone_id uuid,
  person_id uuid,
  learning_id uuid,
  idea_id uuid,
  due_date date,
  due_time text check (due_time is null or due_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  priority integer not null default 0 check (priority between 0 and 3),
  tags text[] not null default '{}',
  estimate_min integer check (estimate_min is null or estimate_min >= 0),
  recurrence jsonb,
  series_id uuid,
  status text not null default 'open' check (status in ('open','done','dismissed')),
  completed_at timestamptz,
  archived boolean not null default false,
  top_on date,
  sort integer not null default 0
);

create table if not exists public.time_blocks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  day date not null,
  start_time text not null check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time text not null check (end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  title text not null,
  kind text not null default 'work' check (kind in ('work','appointment')),
  task_id uuid,
  goal_id uuid,
  area_id uuid,
  notes text
);

create table if not exists public.habits (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  title text not null,
  area_id uuid,
  goal_id uuid,
  learning_id uuid,
  idea_id uuid,
  kind text not null default 'check' check (kind in ('check','measure')),
  unit text,
  daily_target numeric,
  schedule text not null default 'daily' check (schedule in ('daily','weekdays','weekly')),
  weekdays integer[] not null default '{}',
  weekly_target integer check (weekly_target is null or weekly_target between 1 and 7),
  minimum_version text,
  why text,
  start_date date not null,
  pauses jsonb not null default '[]'::jsonb,
  archived boolean not null default false,
  sort integer not null default 0
);

create table if not exists public.habit_logs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  habit_id uuid not null,
  day date not null,
  status text not null check (status in ('done','minimum','rest','missed')),
  value numeric,
  note text,
  constraint habit_logs_one_per_day unique (user_id, habit_id, day)
);

create table if not exists public.day_notes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  day date not null,
  intention text,
  constraint day_notes_one_per_day unique (user_id, day)
);

create table if not exists public.week_plans (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  week_start date not null,
  priorities jsonb not null default '[]'::jsonb,
  focus text,
  constraint week_plans_one_per_week unique (user_id, week_start)
);

create table if not exists public.journal_entries (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  day date not null,
  kind text not null default 'free' check (kind in ('free','morning','evening','weekly','monthly','season','fresh_start')),
  title text,
  body text,
  answers jsonb not null default '{}'::jsonb,
  season text check (season is null or season in ('winter','spring','summer','autumn')),
  tags text[] not null default '{}',
  conflict_of uuid
);

create table if not exists public.learning_items (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  kind text not null default 'book' check (kind in ('book','course','seminar','skill','other')),
  title text not null,
  creator text,
  area_id uuid,
  goal_id uuid,
  status text not null default 'active' check (status in ('planned','active','paused','done')),
  progress_unit text,
  progress_current numeric,
  progress_total numeric,
  key_ideas text,
  notes text,
  application text,
  started_on date,
  finished_on date,
  sort integer not null default 0
);

create table if not exists public.learning_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  learning_id uuid not null,
  day date not null,
  minutes integer check (minutes is null or minutes >= 0),
  amount numeric,
  note text
);

create table if not exists public.ideas (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  title text,
  body text not null,
  learning_id uuid,
  area_id uuid,
  journal_id uuid,
  tags text[] not null default '{}',
  pinned boolean not null default false,
  conflict_of uuid
);

create table if not exists public.wins (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  day date not null,
  title text not null,
  note text,
  kind text not null default 'personal' check (kind in ('goal','milestone','habit','learning','personal')),
  area_id uuid,
  goal_id uuid,
  milestone_id uuid
);

create table if not exists public.money_entries (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  day date not null,
  kind text not null check (kind in ('income','expense')),
  amount numeric not null check (amount >= 0),
  currency text not null,
  category text,
  note text,
  bill_id uuid
);

create table if not exists public.savings_goals (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  title text not null,
  target numeric not null check (target > 0),
  saved numeric not null default 0,
  currency text not null,
  target_date date,
  goal_id uuid,
  archived boolean not null default false
);

create table if not exists public.bills (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  title text not null,
  amount numeric not null check (amount >= 0),
  currency text not null,
  frequency text not null default 'monthly' check (frequency in ('weekly','monthly','yearly')),
  next_due date not null,
  active boolean not null default true,
  notes text
);

create table if not exists public.people (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  name text not null,
  relation text,
  notes text,
  contact_every_days integer check (contact_every_days is null or contact_every_days > 0),
  last_contact date,
  archived boolean not null default false
);

create table if not exists public.people_dates (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  person_id uuid not null,
  label text not null,
  date date not null,
  yearly boolean not null default true
);

create table if not exists public.contact_logs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev integer not null default 1,
  last_op text,
  is_example boolean not null default false,
  person_id uuid not null,
  day date not null,
  note text
);

-- ---------------------------------------------------------------------------
-- Shared trigger: server-owned timestamps
-- ---------------------------------------------------------------------------

create or replace function public.my_life_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The server clock decides updated_at so device clock drift cannot hide a
  -- change from other devices' incremental pulls.
  new.updated_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, clock_timestamp());
  else
    new.created_at := old.created_at;
    -- Ownership never changes after creation.
    new.user_id := old.user_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security, grants, indexes and triggers for every private table
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  private_tables text[] := array[
    'settings','areas','visions','goals','goal_events','milestones','tasks',
    'time_blocks','habits','habit_logs','day_notes','week_plans',
    'journal_entries','learning_items','learning_sessions','ideas','wins',
    'money_entries','savings_goals','bills','people','people_dates','contact_logs'
  ];
begin
  foreach t in array private_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
      t || '_delete_own', t);

    execute format('create index if not exists %I on public.%I (user_id, updated_at)', t || '_user_updated_idx', t);

    execute format('drop trigger if exists my_life_touch on public.%I', t);
    execute format(
      'create trigger my_life_touch before insert or update on public.%I for each row execute function public.my_life_touch()', t);
  end loop;
end;
$$;

-- Helpful lookup indexes for common links.
create index if not exists tasks_user_due_idx on public.tasks (user_id, due_date) where deleted_at is null;
create index if not exists habit_logs_user_habit_idx on public.habit_logs (user_id, habit_id, day);
create index if not exists journal_user_day_idx on public.journal_entries (user_id, day);
