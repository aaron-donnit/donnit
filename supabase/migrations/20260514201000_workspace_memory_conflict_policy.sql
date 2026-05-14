-- Donnit: memory conflict policy primitives.
--
-- The resolver can already enforce tenant and scope rules from existing
-- columns. This migration adds expiry support for temporary facts and a
-- lightweight conflict log for future admin review surfaces.

alter table donnit.workspace_memory_aliases
  add column if not exists expires_at timestamptz;

create index if not exists donnit_workspace_memory_aliases_expiry_idx
  on donnit.workspace_memory_aliases (org_id, expires_at)
  where expires_at is not null;

create table if not exists donnit.workspace_memory_conflicts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  field text not null default '',
  normalized_form text not null default '',
  scope_chain text[] not null default '{}'::text[],
  winning_scope text,
  winner_source text,
  losing_source text,
  resolution_reason text not null default '',
  confidence_score numeric,
  status text not null default 'resolved',
  winning_alias_id uuid references donnit.workspace_memory_aliases(id) on delete set null,
  losing_alias_id uuid references donnit.workspace_memory_aliases(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references donnit.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint workspace_memory_conflicts_status_check
    check (status in ('resolved', 'needs_clarification', 'rejected', 'archived')),
  constraint workspace_memory_conflicts_confidence_check
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1))
);

create index if not exists donnit_workspace_memory_conflicts_org_created_idx
  on donnit.workspace_memory_conflicts (org_id, created_at desc);

create index if not exists donnit_workspace_memory_conflicts_status_idx
  on donnit.workspace_memory_conflicts (org_id, status, created_at desc);

alter table donnit.workspace_memory_conflicts enable row level security;

grant select, insert, update on donnit.workspace_memory_conflicts to authenticated, service_role;

drop policy if exists "donnit members can view workspace memory conflicts" on donnit.workspace_memory_conflicts;
create policy "donnit members can view workspace memory conflicts"
  on donnit.workspace_memory_conflicts for select
  using (donnit.is_org_member(workspace_memory_conflicts.org_id));

drop policy if exists "donnit members can create workspace memory conflicts" on donnit.workspace_memory_conflicts;
create policy "donnit members can create workspace memory conflicts"
  on donnit.workspace_memory_conflicts for insert
  with check (donnit.is_org_member(workspace_memory_conflicts.org_id) and created_by = auth.uid());

drop policy if exists "donnit members can update workspace memory conflicts" on donnit.workspace_memory_conflicts;
create policy "donnit members can update workspace memory conflicts"
  on donnit.workspace_memory_conflicts for update
  using (donnit.is_org_member(workspace_memory_conflicts.org_id))
  with check (donnit.is_org_member(workspace_memory_conflicts.org_id));

notify pgrst, 'reload schema';
