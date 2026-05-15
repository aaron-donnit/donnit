-- Donnit learning ledger and policy promotion gate.
--
-- Contract stays in code. Learned behavior is stored as workspace-scoped
-- events and promoted into versioned policy only after review/thresholds.

create table if not exists donnit.learning_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  actor_id uuid references donnit.profiles(id) on delete set null,
  source text not null,
  event_type text not null,
  scope_type text not null default 'workspace',
  scope_id uuid,
  position_profile_id uuid references donnit.position_profiles(id) on delete set null,
  task_id uuid references donnit.tasks(id) on delete set null,
  source_ref_type text,
  source_ref_id uuid,
  raw_text text not null default '',
  normalized_text text not null default '',
  interpretation jsonb not null default '{}'::jsonb,
  signal jsonb not null default '{}'::jsonb,
  confidence_score numeric,
  signal_strength numeric,
  created_at timestamptz not null default now(),
  constraint learning_events_source_check
    check (source in ('chat', 'manual', 'email', 'slack', 'sms', 'document', 'automation', 'assistant', 'system')),
  constraint learning_events_scope_type_check
    check (scope_type in ('workspace', 'user', 'position_profile', 'task_profile', 'task', 'member')),
  constraint learning_events_confidence_check
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  constraint learning_events_signal_strength_check
    check (signal_strength is null or (signal_strength >= 0 and signal_strength <= 1))
);

create index if not exists donnit_learning_events_org_created_idx
  on donnit.learning_events (org_id, created_at desc);

create index if not exists donnit_learning_events_scope_idx
  on donnit.learning_events (org_id, scope_type, scope_id, created_at desc);

create index if not exists donnit_learning_events_task_idx
  on donnit.learning_events (org_id, task_id, created_at desc)
  where task_id is not null;

create index if not exists donnit_learning_events_profile_idx
  on donnit.learning_events (org_id, position_profile_id, created_at desc)
  where position_profile_id is not null;

create table if not exists donnit.learning_candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  scope_type text not null default 'workspace',
  scope_id uuid,
  candidate_type text not null,
  proposed_policy jsonb not null default '{}'::jsonb,
  evidence_event_ids uuid[] not null default '{}'::uuid[],
  signal_count integer not null default 1,
  confidence_score numeric not null default 0.5,
  status text not null default 'pending_review',
  rationale text not null default '',
  created_by uuid references donnit.profiles(id) on delete set null,
  reviewed_by uuid references donnit.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  promoted_at timestamptz,
  constraint learning_candidates_scope_type_check
    check (scope_type in ('workspace', 'user', 'position_profile', 'task_profile', 'task', 'member')),
  constraint learning_candidates_type_check
    check (candidate_type in ('alias', 'task_profile_step', 'recurrence_rule', 'due_rule', 'owner_rule', 'position_memory', 'preference')),
  constraint learning_candidates_status_check
    check (status in ('pending_review', 'approved', 'rejected', 'promoted', 'archived')),
  constraint learning_candidates_confidence_check
    check (confidence_score >= 0 and confidence_score <= 1),
  constraint learning_candidates_signal_count_check
    check (signal_count >= 0)
);

create index if not exists donnit_learning_candidates_review_idx
  on donnit.learning_candidates (org_id, status, updated_at desc);

create index if not exists donnit_learning_candidates_scope_idx
  on donnit.learning_candidates (org_id, scope_type, scope_id, candidate_type, updated_at desc);

create table if not exists donnit.policy_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  scope_type text not null default 'workspace',
  scope_id uuid,
  policy_type text not null,
  version integer not null default 1,
  policy jsonb not null default '{}'::jsonb,
  source_candidate_id uuid references donnit.learning_candidates(id) on delete set null,
  active boolean not null default true,
  created_by uuid references donnit.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint policy_versions_scope_type_check
    check (scope_type in ('workspace', 'user', 'position_profile', 'task_profile', 'task', 'member')),
  constraint policy_versions_version_check
    check (version > 0)
);

create unique index if not exists donnit_policy_versions_active_unique_idx
  on donnit.policy_versions (org_id, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), policy_type)
  where active = true;

create index if not exists donnit_policy_versions_scope_idx
  on donnit.policy_versions (org_id, scope_type, scope_id, policy_type, version desc);

alter table donnit.learning_events enable row level security;
alter table donnit.learning_candidates enable row level security;
alter table donnit.policy_versions enable row level security;

grant select, insert on donnit.learning_events to authenticated, service_role;
grant select, insert, update on donnit.learning_candidates to authenticated, service_role;
grant select, insert, update on donnit.policy_versions to authenticated, service_role;

drop policy if exists "donnit members can view learning events" on donnit.learning_events;
create policy "donnit members can view learning events"
  on donnit.learning_events for select
  using (donnit.is_org_member(learning_events.org_id));

drop policy if exists "donnit members can create learning events" on donnit.learning_events;
create policy "donnit members can create learning events"
  on donnit.learning_events for insert
  with check (donnit.is_org_member(learning_events.org_id) and (actor_id is null or actor_id = auth.uid()));

drop policy if exists "donnit members can view learning candidates" on donnit.learning_candidates;
create policy "donnit members can view learning candidates"
  on donnit.learning_candidates for select
  using (donnit.is_org_member(learning_candidates.org_id));

drop policy if exists "donnit admins can manage learning candidates" on donnit.learning_candidates;
create policy "donnit admins can manage learning candidates"
  on donnit.learning_candidates for all
  using (donnit.is_org_admin(learning_candidates.org_id))
  with check (donnit.is_org_admin(learning_candidates.org_id));

drop policy if exists "donnit members can view policy versions" on donnit.policy_versions;
create policy "donnit members can view policy versions"
  on donnit.policy_versions for select
  using (donnit.is_org_member(policy_versions.org_id));

drop policy if exists "donnit admins can manage policy versions" on donnit.policy_versions;
create policy "donnit admins can manage policy versions"
  on donnit.policy_versions for all
  using (donnit.is_org_admin(policy_versions.org_id))
  with check (donnit.is_org_admin(policy_versions.org_id));

notify pgrst, 'reload schema';
