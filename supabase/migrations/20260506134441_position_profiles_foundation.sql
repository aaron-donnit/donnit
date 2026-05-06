-- Donnit Workforce Continuity: job-based position profiles.
--
-- The application currently derives Position Profiles from task history so
-- managers get value immediately. These tables preserve explicit admin
-- decisions, assignment history, institutional knowledge, and access-control
-- posture as the continuity product deepens.

create table if not exists donnit.position_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  title text not null,
  status text not null default 'active' check (status in ('active', 'vacant', 'covered')),
  current_owner_id uuid references donnit.profiles(id) on delete set null,
  direct_manager_id uuid references donnit.profiles(id) on delete set null,
  temporary_owner_id uuid references donnit.profiles(id) on delete set null,
  delegate_user_id uuid references donnit.profiles(id) on delete set null,
  delegate_until date,
  auto_update_rules jsonb not null default jsonb_build_object(
    'captureRecurringTasks', true,
    'preserveCompletionNotes', true,
    'preserveExternalSources', true,
    'managerRiskVisibleOnly', true,
    'neverDeleteKnowledgeAutomatically', true
  ),
  institutional_memory jsonb not null default '{}'::jsonb,
  risk_score integer not null default 0 check (risk_score >= 0 and risk_score <= 100),
  risk_summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, title)
);

create table if not exists donnit.position_profile_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  position_profile_id uuid references donnit.position_profiles(id) on delete cascade,
  from_user_id uuid references donnit.profiles(id) on delete set null,
  to_user_id uuid references donnit.profiles(id) on delete set null,
  actor_id uuid references donnit.profiles(id) on delete set null,
  mode text not null check (mode in ('transfer', 'temporary_cover', 'delegate')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists donnit.position_profile_knowledge (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  position_profile_id uuid references donnit.position_profiles(id) on delete cascade,
  source_task_id uuid references donnit.tasks(id) on delete set null,
  kind text not null check (kind in ('how_to', 'recurring_responsibility', 'stakeholder', 'tool', 'risk', 'critical_date')),
  title text not null,
  body text not null default '',
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists donnit_position_profiles_org_owner_idx
  on donnit.position_profiles (org_id, current_owner_id);
create index if not exists donnit_position_profile_assignments_profile_idx
  on donnit.position_profile_assignments (position_profile_id, created_at desc);
create index if not exists donnit_position_profile_knowledge_profile_kind_idx
  on donnit.position_profile_knowledge (position_profile_id, kind, last_seen_at desc);

alter table donnit.position_profiles enable row level security;
alter table donnit.position_profile_assignments enable row level security;
alter table donnit.position_profile_knowledge enable row level security;

drop policy if exists "donnit members can view position profiles" on donnit.position_profiles;
create policy "donnit members can view position profiles"
  on donnit.position_profiles for select
  using (donnit.is_org_member(position_profiles.org_id));

drop policy if exists "donnit managers can manage position profiles" on donnit.position_profiles;
create policy "donnit managers can manage position profiles"
  on donnit.position_profiles for all
  using (donnit.is_org_manager(position_profiles.org_id))
  with check (donnit.is_org_manager(position_profiles.org_id));

drop policy if exists "donnit managers can view position assignments" on donnit.position_profile_assignments;
create policy "donnit managers can view position assignments"
  on donnit.position_profile_assignments for select
  using (donnit.is_org_manager(position_profile_assignments.org_id));

drop policy if exists "donnit managers can manage position assignments" on donnit.position_profile_assignments;
create policy "donnit managers can manage position assignments"
  on donnit.position_profile_assignments for all
  using (donnit.is_org_manager(position_profile_assignments.org_id))
  with check (donnit.is_org_manager(position_profile_assignments.org_id));

drop policy if exists "donnit members can view position knowledge" on donnit.position_profile_knowledge;
create policy "donnit members can view position knowledge"
  on donnit.position_profile_knowledge for select
  using (donnit.is_org_member(position_profile_knowledge.org_id));

drop policy if exists "donnit managers can manage position knowledge" on donnit.position_profile_knowledge;
create policy "donnit managers can manage position knowledge"
  on donnit.position_profile_knowledge for all
  using (donnit.is_org_manager(position_profile_knowledge.org_id))
  with check (donnit.is_org_manager(position_profile_knowledge.org_id));

grant select, insert, update, delete on donnit.position_profiles to authenticated, service_role;
grant select, insert, update, delete on donnit.position_profile_assignments to authenticated, service_role;
grant select, insert, update, delete on donnit.position_profile_knowledge to authenticated, service_role;
