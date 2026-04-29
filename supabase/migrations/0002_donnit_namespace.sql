-- Donnit production foundation, isolated in the `donnit` schema.
--
-- Background:
--   The Supabase project shared with Donnit already contains `public.profiles`
--   and `public.chat_messages` from a Rosterstack app. Migration
--   `0001_donnit_foundation.sql` used `CREATE TABLE IF NOT EXISTS public.*`,
--   which silently skipped those colliding tables. To avoid touching or
--   altering the existing `public` tables, all Donnit-owned objects are
--   recreated here inside a dedicated `donnit` schema.
--
-- Apply order:
--   1. (already applied) 0001_donnit_foundation.sql -- DO NOT extend or
--      alter destructively. Some tables in `public` are now shared with
--      Rosterstack; treat them as read-only for Donnit.
--   2. (this file) 0002_donnit_namespace.sql -- creates `donnit` schema and
--      Donnit-owned tables, indexes, and RLS. Idempotent where practical.
--
-- This migration is non-destructive:
--   - Does NOT drop or alter any existing `public.*` table.
--   - Uses `CREATE ... IF NOT EXISTS` for schema, tables, indexes.
--   - Uses `DROP POLICY IF EXISTS` before each `CREATE POLICY` so re-running
--     refreshes policies without orphaning old ones.

create extension if not exists pgcrypto;

create schema if not exists donnit;

-- Allow authenticated users to use the schema (RLS still gates row access).
grant usage on schema donnit to anon, authenticated, service_role;
alter default privileges in schema donnit
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema donnit
  grant usage, select on sequences to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists donnit.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists donnit.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  default_org_id uuid references donnit.organizations(id) on delete set null,
  persona text not null default 'operator',
  created_at timestamptz not null default now()
);

create table if not exists donnit.organization_members (
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  user_id uuid not null references donnit.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'manager', 'member', 'viewer')),
  manager_id uuid references donnit.profiles(id) on delete set null,
  can_assign boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists donnit.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'open' check (status in ('open', 'pending_acceptance', 'accepted', 'denied', 'completed')),
  urgency text not null default 'normal' check (urgency in ('low', 'normal', 'high', 'critical')),
  due_date date,
  estimated_minutes integer not null default 30 check (estimated_minutes > 0),
  assigned_to uuid not null references donnit.profiles(id) on delete cascade,
  assigned_by uuid not null references donnit.profiles(id) on delete cascade,
  source text not null default 'chat' check (source in ('chat', 'manual', 'email', 'automation', 'annual')),
  recurrence text not null default 'none' check (recurrence in ('none', 'annual')),
  reminder_days_before integer not null default 0 check (reminder_days_before >= 0),
  accepted_at timestamptz,
  denied_at timestamptz,
  completed_at timestamptz,
  completion_notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists donnit.task_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  task_id uuid not null references donnit.tasks(id) on delete cascade,
  actor_id uuid not null references donnit.profiles(id) on delete cascade,
  type text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists donnit.chat_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  user_id uuid not null references donnit.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  task_id uuid references donnit.tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists donnit.email_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  gmail_message_id text,
  from_email text not null,
  subject text not null,
  preview text not null,
  suggested_title text not null,
  suggested_due_date date,
  urgency text not null default 'normal' check (urgency in ('low', 'normal', 'high', 'critical')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'dismissed')),
  assigned_to uuid references donnit.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists donnit.reminder_preferences (
  user_id uuid primary key references donnit.profiles(id) on delete cascade,
  channel_order text[] not null default array['in_app', 'email', 'push', 'sms'],
  digest_hour_local integer not null default 8 check (digest_hour_local between 0 and 23),
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists donnit_tasks_org_sort_idx
  on donnit.tasks (org_id, status, due_date, urgency, created_at);
create index if not exists donnit_task_events_org_created_idx
  on donnit.task_events (org_id, created_at desc);
create index if not exists donnit_email_suggestions_org_status_idx
  on donnit.email_suggestions (org_id, status, created_at desc);
create index if not exists donnit_chat_messages_user_created_idx
  on donnit.chat_messages (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table donnit.organizations enable row level security;
alter table donnit.profiles enable row level security;
alter table donnit.organization_members enable row level security;
alter table donnit.tasks enable row level security;
alter table donnit.task_events enable row level security;
alter table donnit.chat_messages enable row level security;
alter table donnit.email_suggestions enable row level security;
alter table donnit.reminder_preferences enable row level security;

-- organizations
drop policy if exists "donnit members can view organizations" on donnit.organizations;
create policy "donnit members can view organizations"
  on donnit.organizations for select
  using (exists (
    select 1 from donnit.organization_members m
    where m.org_id = organizations.id and m.user_id = auth.uid()
  ));

-- profiles
drop policy if exists "donnit users can view own profile" on donnit.profiles;
create policy "donnit users can view own profile"
  on donnit.profiles for select
  using (id = auth.uid());

drop policy if exists "donnit users can insert own profile" on donnit.profiles;
create policy "donnit users can insert own profile"
  on donnit.profiles for insert
  with check (id = auth.uid());

drop policy if exists "donnit users can update own profile" on donnit.profiles;
create policy "donnit users can update own profile"
  on donnit.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- organization_members
drop policy if exists "donnit members can view org membership" on donnit.organization_members;
create policy "donnit members can view org membership"
  on donnit.organization_members for select
  using (exists (
    select 1 from donnit.organization_members m
    where m.org_id = organization_members.org_id and m.user_id = auth.uid()
  ));

-- tasks
drop policy if exists "donnit members can view org tasks" on donnit.tasks;
create policy "donnit members can view org tasks"
  on donnit.tasks for select
  using (exists (
    select 1 from donnit.organization_members m
    where m.org_id = tasks.org_id and m.user_id = auth.uid()
  ));

drop policy if exists "donnit assigners can create tasks" on donnit.tasks;
create policy "donnit assigners can create tasks"
  on donnit.tasks for insert
  with check (exists (
    select 1 from donnit.organization_members m
    where m.org_id = tasks.org_id
      and m.user_id = auth.uid()
      and (m.can_assign = true or tasks.assigned_to = auth.uid())
  ));

drop policy if exists "donnit assignees and assigners can update tasks" on donnit.tasks;
create policy "donnit assignees and assigners can update tasks"
  on donnit.tasks for update
  using (assigned_to = auth.uid() or assigned_by = auth.uid() or exists (
    select 1 from donnit.organization_members m
    where m.org_id = tasks.org_id and m.user_id = auth.uid() and m.role in ('owner', 'manager')
  ));

-- task_events
drop policy if exists "donnit members can view task events" on donnit.task_events;
create policy "donnit members can view task events"
  on donnit.task_events for select
  using (exists (
    select 1 from donnit.organization_members m
    where m.org_id = task_events.org_id and m.user_id = auth.uid()
  ));

drop policy if exists "donnit members can create task events" on donnit.task_events;
create policy "donnit members can create task events"
  on donnit.task_events for insert
  with check (exists (
    select 1 from donnit.organization_members m
    where m.org_id = task_events.org_id and m.user_id = auth.uid()
  ));

-- chat_messages
drop policy if exists "donnit users can view own chat" on donnit.chat_messages;
create policy "donnit users can view own chat"
  on donnit.chat_messages for select
  using (user_id = auth.uid());

drop policy if exists "donnit users can create own chat" on donnit.chat_messages;
create policy "donnit users can create own chat"
  on donnit.chat_messages for insert
  with check (user_id = auth.uid());

-- email_suggestions
drop policy if exists "donnit members can view email suggestions" on donnit.email_suggestions;
create policy "donnit members can view email suggestions"
  on donnit.email_suggestions for select
  using (exists (
    select 1 from donnit.organization_members m
    where m.org_id = email_suggestions.org_id and m.user_id = auth.uid()
  ));

drop policy if exists "donnit assigners can update email suggestions" on donnit.email_suggestions;
create policy "donnit assigners can update email suggestions"
  on donnit.email_suggestions for update
  using (exists (
    select 1 from donnit.organization_members m
    where m.org_id = email_suggestions.org_id
      and m.user_id = auth.uid()
      and (m.can_assign = true or m.role in ('owner', 'manager'))
  ));

drop policy if exists "donnit assigners can insert email suggestions" on donnit.email_suggestions;
create policy "donnit assigners can insert email suggestions"
  on donnit.email_suggestions for insert
  with check (exists (
    select 1 from donnit.organization_members m
    where m.org_id = email_suggestions.org_id
      and m.user_id = auth.uid()
      and (m.can_assign = true or m.role in ('owner', 'manager'))
  ));

-- reminder_preferences
drop policy if exists "donnit users can manage own reminder preferences" on donnit.reminder_preferences;
create policy "donnit users can manage own reminder preferences"
  on donnit.reminder_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
