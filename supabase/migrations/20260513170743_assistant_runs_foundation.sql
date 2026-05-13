-- Donnit Agentic Assistant: durable run records and step-level events.
--
-- This is the first production primitive for assigning work to Donnit's AI
-- assistant. The assistant can read task/role context and report back, while
-- writes to user-owned work remain permission-gated by the application layer.

create table if not exists donnit.assistant_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  user_id uuid not null references donnit.profiles(id) on delete cascade,
  task_id uuid not null references donnit.tasks(id) on delete cascade,
  position_profile_id uuid references donnit.position_profiles(id) on delete set null,
  provider text not null default 'openai',
  skill_id text not null,
  status text not null default 'queued',
  instruction text not null default '',
  output jsonb not null default '{}'::jsonb,
  approval_required boolean not null default false,
  approved_at timestamptz,
  completed_at timestamptz,
  error_message text,
  correlation_id text not null unique,
  estimated_cost_usd numeric(12, 8) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_runs_provider_check
    check (provider in ('openai', 'hermes')),
  constraint assistant_runs_status_check
    check (status in ('queued', 'running', 'needs_approval', 'completed', 'failed', 'cancelled'))
);

create table if not exists donnit.assistant_run_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  assistant_run_id uuid not null references donnit.assistant_runs(id) on delete cascade,
  task_id uuid references donnit.tasks(id) on delete cascade,
  user_id uuid references donnit.profiles(id) on delete set null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists donnit_assistant_runs_org_created_idx
  on donnit.assistant_runs (org_id, created_at desc);

create index if not exists donnit_assistant_runs_task_created_idx
  on donnit.assistant_runs (task_id, created_at desc);

create index if not exists donnit_assistant_runs_status_idx
  on donnit.assistant_runs (org_id, status, created_at desc);

create index if not exists donnit_assistant_run_events_run_idx
  on donnit.assistant_run_events (assistant_run_id, created_at asc);

alter table donnit.assistant_runs enable row level security;
alter table donnit.assistant_run_events enable row level security;

grant select, insert, update on donnit.assistant_runs to authenticated, service_role;
grant select, insert on donnit.assistant_run_events to authenticated, service_role;

drop policy if exists "donnit members can view assistant runs" on donnit.assistant_runs;
create policy "donnit members can view assistant runs"
  on donnit.assistant_runs for select
  using (donnit.is_org_member(assistant_runs.org_id));

drop policy if exists "donnit members can create assistant runs" on donnit.assistant_runs;
create policy "donnit members can create assistant runs"
  on donnit.assistant_runs for insert
  with check (donnit.is_org_member(assistant_runs.org_id) and user_id = auth.uid());

drop policy if exists "donnit members can update own assistant runs" on donnit.assistant_runs;
create policy "donnit members can update own assistant runs"
  on donnit.assistant_runs for update
  using (donnit.is_org_member(assistant_runs.org_id) and user_id = auth.uid())
  with check (donnit.is_org_member(assistant_runs.org_id) and user_id = auth.uid());

drop policy if exists "donnit members can view assistant run events" on donnit.assistant_run_events;
create policy "donnit members can view assistant run events"
  on donnit.assistant_run_events for select
  using (donnit.is_org_member(assistant_run_events.org_id));

drop policy if exists "donnit members can create assistant run events" on donnit.assistant_run_events;
create policy "donnit members can create assistant run events"
  on donnit.assistant_run_events for insert
  with check (donnit.is_org_member(assistant_run_events.org_id) and user_id = auth.uid());

notify pgrst, 'reload schema';
