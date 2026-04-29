-- Donnit production foundation for Supabase Auth + multi-user organizations.
-- Apply only after confirming the target Supabase project.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  default_org_id uuid references public.organizations(id) on delete set null,
  persona text not null default 'operator',
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'manager', 'member', 'viewer')),
  manager_id uuid references public.profiles(id) on delete set null,
  can_assign boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'open' check (status in ('open', 'pending_acceptance', 'accepted', 'denied', 'completed')),
  urgency text not null default 'normal' check (urgency in ('low', 'normal', 'high', 'critical')),
  due_date date,
  estimated_minutes integer not null default 30 check (estimated_minutes > 0),
  assigned_to uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id) on delete cascade,
  source text not null default 'chat' check (source in ('chat', 'manual', 'email', 'automation', 'annual')),
  recurrence text not null default 'none' check (recurrence in ('none', 'annual')),
  reminder_days_before integer not null default 0 check (reminder_days_before >= 0),
  accepted_at timestamptz,
  denied_at timestamptz,
  completed_at timestamptz,
  completion_notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.email_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  gmail_message_id text,
  from_email text not null,
  subject text not null,
  preview text not null,
  suggested_title text not null,
  suggested_due_date date,
  urgency text not null default 'normal' check (urgency in ('low', 'normal', 'high', 'critical')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'dismissed')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.reminder_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  channel_order text[] not null default array['in_app', 'email', 'push', 'sms'],
  digest_hour_local integer not null default 8 check (digest_hour_local between 0 and 23),
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_org_sort_idx on public.tasks (org_id, status, due_date, urgency, created_at);
create index if not exists task_events_org_created_idx on public.task_events (org_id, created_at desc);
create index if not exists email_suggestions_org_status_idx on public.email_suggestions (org_id, status, created_at desc);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.chat_messages enable row level security;
alter table public.email_suggestions enable row level security;
alter table public.reminder_preferences enable row level security;

create policy "members can view organizations"
  on public.organizations for select
  using (exists (
    select 1 from public.organization_members m
    where m.org_id = organizations.id and m.user_id = auth.uid()
  ));

create policy "users can view own profile"
  on public.profiles for select
  using (id = auth.uid());

create policy "users can update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "members can view org membership"
  on public.organization_members for select
  using (exists (
    select 1 from public.organization_members m
    where m.org_id = organization_members.org_id and m.user_id = auth.uid()
  ));

create policy "members can view org tasks"
  on public.tasks for select
  using (exists (
    select 1 from public.organization_members m
    where m.org_id = tasks.org_id and m.user_id = auth.uid()
  ));

create policy "assigners can create tasks"
  on public.tasks for insert
  with check (exists (
    select 1 from public.organization_members m
    where m.org_id = tasks.org_id
      and m.user_id = auth.uid()
      and (m.can_assign = true or tasks.assigned_to = auth.uid())
  ));

create policy "assignees and assigners can update tasks"
  on public.tasks for update
  using (assigned_to = auth.uid() or assigned_by = auth.uid() or exists (
    select 1 from public.organization_members m
    where m.org_id = tasks.org_id and m.user_id = auth.uid() and m.role in ('owner', 'manager')
  ));

create policy "members can view task events"
  on public.task_events for select
  using (exists (
    select 1 from public.organization_members m
    where m.org_id = task_events.org_id and m.user_id = auth.uid()
  ));

create policy "members can create task events"
  on public.task_events for insert
  with check (exists (
    select 1 from public.organization_members m
    where m.org_id = task_events.org_id and m.user_id = auth.uid()
  ));

create policy "users can view own chat"
  on public.chat_messages for select
  using (user_id = auth.uid());

create policy "users can create own chat"
  on public.chat_messages for insert
  with check (user_id = auth.uid());

create policy "members can view email suggestions"
  on public.email_suggestions for select
  using (exists (
    select 1 from public.organization_members m
    where m.org_id = email_suggestions.org_id and m.user_id = auth.uid()
  ));

create policy "assigners can update email suggestions"
  on public.email_suggestions for update
  using (exists (
    select 1 from public.organization_members m
    where m.org_id = email_suggestions.org_id
      and m.user_id = auth.uid()
      and (m.can_assign = true or m.role in ('owner', 'manager'))
  ));

create policy "users can manage own reminder preferences"
  on public.reminder_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
