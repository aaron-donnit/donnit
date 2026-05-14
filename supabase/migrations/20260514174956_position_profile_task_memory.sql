-- Donnit Task Memory: repeatable, position-scoped task sequences.
--
-- Task Memory is the durable bridge between recurring work and workforce
-- continuity. A Position Profile can hold a recurring business task such as
-- "Monthly CEO financial report" plus the sequenced steps, timing, systems,
-- instructions, and learning signals needed for a new profile holder to
-- complete the work with the same end result.

create table if not exists donnit.position_profile_task_memories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  position_profile_id uuid not null references donnit.position_profiles(id) on delete cascade,
  source_task_id uuid references donnit.tasks(id) on delete set null,
  title text not null,
  objective text not null default '',
  cadence text not null default 'none',
  due_rule text not null default '',
  start_offset_days integer not null default 0,
  default_urgency text not null default 'normal',
  default_estimated_minutes integer not null default 30,
  status text not null default 'active',
  version integer not null default 1,
  confidence_score numeric not null default 0.65,
  learned_from jsonb not null default '{}'::jsonb,
  created_by uuid references donnit.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_learned_at timestamptz not null default now(),
  constraint position_profile_task_memories_cadence_check
    check (cadence in ('none', 'daily', 'weekly', 'monthly', 'quarterly', 'annual')),
  constraint position_profile_task_memories_urgency_check
    check (default_urgency in ('low', 'normal', 'high', 'critical')),
  constraint position_profile_task_memories_status_check
    check (status in ('suggested', 'active', 'archived')),
  constraint position_profile_task_memories_start_offset_days_check
    check (start_offset_days between 0 and 365),
  constraint position_profile_task_memories_estimated_minutes_check
    check (default_estimated_minutes between 5 and 1440),
  constraint position_profile_task_memories_confidence_score_check
    check (confidence_score >= 0 and confidence_score <= 1)
);

create table if not exists donnit.position_profile_task_memory_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  task_memory_id uuid not null references donnit.position_profile_task_memories(id) on delete cascade,
  position_profile_id uuid not null references donnit.position_profiles(id) on delete cascade,
  source_task_id uuid references donnit.tasks(id) on delete set null,
  title text not null,
  instructions text not null default '',
  tool_name text not null default '',
  tool_url text not null default '',
  expected_output text not null default '',
  relative_due_offset_days integer not null default 0,
  estimated_minutes integer not null default 30,
  dependency_step_ids uuid[] not null default '{}'::uuid[],
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint position_profile_task_memory_steps_offset_check
    check (relative_due_offset_days between -365 and 365),
  constraint position_profile_task_memory_steps_estimated_minutes_check
    check (estimated_minutes between 5 and 1440)
);

create table if not exists donnit.position_profile_task_memory_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  task_memory_id uuid not null references donnit.position_profile_task_memories(id) on delete cascade,
  position_profile_id uuid not null references donnit.position_profiles(id) on delete cascade,
  owner_id uuid references donnit.profiles(id) on delete set null,
  due_date date,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint position_profile_task_memory_runs_status_check
    check (status in ('active', 'completed', 'cancelled'))
);

create table if not exists donnit.position_profile_task_memory_step_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  task_memory_run_id uuid not null references donnit.position_profile_task_memory_runs(id) on delete cascade,
  task_memory_step_id uuid not null references donnit.position_profile_task_memory_steps(id) on delete cascade,
  generated_task_id uuid references donnit.tasks(id) on delete set null,
  status text not null default 'waiting',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint position_profile_task_memory_step_runs_status_check
    check (status in ('waiting', 'active', 'completed', 'skipped'))
);

create unique index if not exists donnit_task_memories_profile_title_active_idx
  on donnit.position_profile_task_memories (org_id, position_profile_id, lower(title))
  where status <> 'archived';

create index if not exists donnit_task_memories_profile_status_idx
  on donnit.position_profile_task_memories (org_id, position_profile_id, status, updated_at desc);

create index if not exists donnit_task_memories_source_task_idx
  on donnit.position_profile_task_memories (org_id, source_task_id);

create index if not exists donnit_task_memory_steps_memory_position_idx
  on donnit.position_profile_task_memory_steps (org_id, task_memory_id, position, created_at);

create index if not exists donnit_task_memory_runs_profile_idx
  on donnit.position_profile_task_memory_runs (org_id, position_profile_id, status, due_date);

alter table donnit.position_profile_task_memories enable row level security;
alter table donnit.position_profile_task_memory_steps enable row level security;
alter table donnit.position_profile_task_memory_runs enable row level security;
alter table donnit.position_profile_task_memory_step_runs enable row level security;

grant select, insert, update, delete on donnit.position_profile_task_memories to authenticated, service_role;
grant select, insert, update, delete on donnit.position_profile_task_memory_steps to authenticated, service_role;
grant select, insert, update, delete on donnit.position_profile_task_memory_runs to authenticated, service_role;
grant select, insert, update, delete on donnit.position_profile_task_memory_step_runs to authenticated, service_role;

drop policy if exists "donnit admins can view task memories" on donnit.position_profile_task_memories;
create policy "donnit admins can view task memories"
  on donnit.position_profile_task_memories for select
  using (donnit.is_org_admin(position_profile_task_memories.org_id));

drop policy if exists "donnit admins can manage task memories" on donnit.position_profile_task_memories;
create policy "donnit admins can manage task memories"
  on donnit.position_profile_task_memories for all
  using (donnit.is_org_admin(position_profile_task_memories.org_id))
  with check (donnit.is_org_admin(position_profile_task_memories.org_id));

drop policy if exists "donnit admins can view task memory steps" on donnit.position_profile_task_memory_steps;
create policy "donnit admins can view task memory steps"
  on donnit.position_profile_task_memory_steps for select
  using (donnit.is_org_admin(position_profile_task_memory_steps.org_id));

drop policy if exists "donnit admins can manage task memory steps" on donnit.position_profile_task_memory_steps;
create policy "donnit admins can manage task memory steps"
  on donnit.position_profile_task_memory_steps for all
  using (donnit.is_org_admin(position_profile_task_memory_steps.org_id))
  with check (donnit.is_org_admin(position_profile_task_memory_steps.org_id));

drop policy if exists "donnit admins can view task memory runs" on donnit.position_profile_task_memory_runs;
create policy "donnit admins can view task memory runs"
  on donnit.position_profile_task_memory_runs for select
  using (donnit.is_org_admin(position_profile_task_memory_runs.org_id));

drop policy if exists "donnit admins can manage task memory runs" on donnit.position_profile_task_memory_runs;
create policy "donnit admins can manage task memory runs"
  on donnit.position_profile_task_memory_runs for all
  using (donnit.is_org_admin(position_profile_task_memory_runs.org_id))
  with check (donnit.is_org_admin(position_profile_task_memory_runs.org_id));

drop policy if exists "donnit admins can view task memory step runs" on donnit.position_profile_task_memory_step_runs;
create policy "donnit admins can view task memory step runs"
  on donnit.position_profile_task_memory_step_runs for select
  using (donnit.is_org_admin(position_profile_task_memory_step_runs.org_id));

drop policy if exists "donnit admins can manage task memory step runs" on donnit.position_profile_task_memory_step_runs;
create policy "donnit admins can manage task memory step runs"
  on donnit.position_profile_task_memory_step_runs for all
  using (donnit.is_org_admin(position_profile_task_memory_step_runs.org_id))
  with check (donnit.is_org_admin(position_profile_task_memory_step_runs.org_id));

notify pgrst, 'reload schema';
