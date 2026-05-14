-- Donnit workspace memory aliases and task-resolution learning events.
--
-- This is the durable foundation for the chat/memory feedback loop:
-- scoped aliases, contested phrase tracking, correction signals, and
-- resolution observability.

create table if not exists donnit.workspace_memory_aliases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  surface_form text not null,
  normalized_form text not null,
  target_type text not null,
  target_id uuid not null,
  scope_type text not null default 'workspace',
  scope_id uuid,
  scope_key text not null default 'workspace',
  confidence_score numeric not null default 0.65,
  status text not null default 'active',
  source text not null default 'learned',
  usage_count integer not null default 1,
  contradicted_count integer not null default 0,
  last_used_at timestamptz not null default now(),
  contested_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references donnit.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint workspace_memory_aliases_target_type_check
    check (target_type in ('member', 'position_profile', 'team', 'artifact', 'project', 'template', 'tool')),
  constraint workspace_memory_aliases_scope_type_check
    check (scope_type in ('user', 'team', 'position_profile', 'workspace')),
  constraint workspace_memory_aliases_status_check
    check (status in ('active', 'contested', 'archived', 'rejected')),
  constraint workspace_memory_aliases_confidence_check
    check (confidence_score >= 0 and confidence_score <= 1),
  constraint workspace_memory_aliases_usage_check
    check (usage_count >= 0 and contradicted_count >= 0)
);

create unique index if not exists donnit_workspace_memory_aliases_unique_idx
  on donnit.workspace_memory_aliases (org_id, normalized_form, target_type, target_id, scope_type, scope_key);

create index if not exists donnit_workspace_memory_aliases_lookup_idx
  on donnit.workspace_memory_aliases (org_id, normalized_form, scope_type, status, confidence_score desc);

create index if not exists donnit_workspace_memory_aliases_target_idx
  on donnit.workspace_memory_aliases (org_id, target_type, target_id, status, confidence_score desc);

create table if not exists donnit.task_resolution_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  actor_id uuid references donnit.profiles(id) on delete set null,
  source text not null default 'chat',
  original_text text not null default '',
  parsed_slots jsonb not null default '{}'::jsonb,
  candidate_snapshot jsonb not null default '{}'::jsonb,
  resolution_output jsonb not null default '{}'::jsonb,
  decision text not null,
  confidence_score numeric,
  created_task_id uuid references donnit.tasks(id) on delete set null,
  correction jsonb not null default '{}'::jsonb,
  signal_type text,
  signal_strength numeric,
  latency_ms integer not null default 0,
  model text,
  cost_usd numeric(12, 8) not null default 0,
  created_at timestamptz not null default now(),
  constraint task_resolution_events_source_check
    check (source in ('chat', 'manual', 'email', 'slack', 'sms', 'document', 'automation')),
  constraint task_resolution_events_decision_check
    check (decision in ('created', 'asked', 'confirmed', 'corrected', 'rejected', 'ignored')),
  constraint task_resolution_events_signal_type_check
    check (
      signal_type is null or
      signal_type in ('explicit_correction', 'clarification_picked', 'clarification_unpicked', 'silent_edit', 'implicit_acceptance', 'undo', 'task_completed')
    ),
  constraint task_resolution_events_confidence_check
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  constraint task_resolution_events_signal_strength_check
    check (signal_strength is null or (signal_strength >= 0 and signal_strength <= 1)),
  constraint task_resolution_events_latency_check
    check (latency_ms >= 0)
);

create index if not exists donnit_task_resolution_events_org_created_idx
  on donnit.task_resolution_events (org_id, created_at desc);

create index if not exists donnit_task_resolution_events_actor_created_idx
  on donnit.task_resolution_events (org_id, actor_id, created_at desc);

create index if not exists donnit_task_resolution_events_task_idx
  on donnit.task_resolution_events (org_id, created_task_id, created_at desc)
  where created_task_id is not null;

alter table donnit.workspace_memory_aliases enable row level security;
alter table donnit.task_resolution_events enable row level security;

grant select, insert, update on donnit.workspace_memory_aliases to authenticated, service_role;
grant select, insert, update on donnit.task_resolution_events to authenticated, service_role;

drop policy if exists "donnit members can view workspace memory aliases" on donnit.workspace_memory_aliases;
create policy "donnit members can view workspace memory aliases"
  on donnit.workspace_memory_aliases for select
  using (donnit.is_org_member(workspace_memory_aliases.org_id));

drop policy if exists "donnit members can create workspace memory aliases" on donnit.workspace_memory_aliases;
create policy "donnit members can create workspace memory aliases"
  on donnit.workspace_memory_aliases for insert
  with check (donnit.is_org_member(workspace_memory_aliases.org_id) and created_by = auth.uid());

drop policy if exists "donnit members can update workspace memory aliases" on donnit.workspace_memory_aliases;
create policy "donnit members can update workspace memory aliases"
  on donnit.workspace_memory_aliases for update
  using (donnit.is_org_member(workspace_memory_aliases.org_id))
  with check (donnit.is_org_member(workspace_memory_aliases.org_id));

drop policy if exists "donnit members can view task resolution events" on donnit.task_resolution_events;
create policy "donnit members can view task resolution events"
  on donnit.task_resolution_events for select
  using (donnit.is_org_member(task_resolution_events.org_id));

drop policy if exists "donnit members can create task resolution events" on donnit.task_resolution_events;
create policy "donnit members can create task resolution events"
  on donnit.task_resolution_events for insert
  with check (donnit.is_org_member(task_resolution_events.org_id) and actor_id = auth.uid());

drop policy if exists "donnit members can update task resolution events" on donnit.task_resolution_events;
create policy "donnit members can update task resolution events"
  on donnit.task_resolution_events for update
  using (donnit.is_org_member(task_resolution_events.org_id))
  with check (donnit.is_org_member(task_resolution_events.org_id));

notify pgrst, 'reload schema';
