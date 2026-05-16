-- Phase 3 D1 — Writeable Brain version history.
-- Adds a version column to position_profile_knowledge and a sibling history
-- table that snapshots every write. Optimistic locking lives in the API
-- layer (server/donnit-store.ts:patchPositionProfileKnowledge); this just
-- persists the version counter and the full prior-state snapshots so admins
-- can audit and a future phase can implement rollback.

alter table donnit.position_profile_knowledge
  add column if not exists version integer not null default 1;

alter table donnit.position_profile_knowledge
  drop constraint if exists position_profile_knowledge_version_check;
alter table donnit.position_profile_knowledge
  add constraint position_profile_knowledge_version_check check (version > 0);

create table if not exists donnit.position_profile_knowledge_versions (
  id                  uuid primary key default gen_random_uuid(),
  knowledge_id        uuid not null references donnit.position_profile_knowledge(id) on delete cascade,
  org_id              uuid not null references donnit.organizations(id) on delete cascade,
  position_profile_id uuid not null references donnit.position_profiles(id) on delete cascade,
  version             integer not null,
  snapshot            jsonb not null,        -- full row state at this version
  written_by          uuid references auth.users(id),
  written_by_agent    boolean not null default false,
  agent_run_id        uuid,
  reason              text,                  -- e.g. 'edited', 'archived', 'auto-captured'
  created_at          timestamptz not null default now(),
  constraint position_profile_knowledge_versions_unique
    unique (knowledge_id, version)
);

create index if not exists donnit_ppk_versions_by_doc_idx
  on donnit.position_profile_knowledge_versions (knowledge_id, version desc);

create index if not exists donnit_ppk_versions_by_org_idx
  on donnit.position_profile_knowledge_versions (org_id, created_at desc);

alter table donnit.position_profile_knowledge_versions enable row level security;

drop policy if exists "donnit admins can view ppk versions"
  on donnit.position_profile_knowledge_versions;
create policy "donnit admins can view ppk versions"
  on donnit.position_profile_knowledge_versions for select
  using (donnit.is_org_admin(position_profile_knowledge_versions.org_id));

-- Writes happen from the API layer via service_role; no client policies.
grant select on donnit.position_profile_knowledge_versions to authenticated;
grant select, insert on donnit.position_profile_knowledge_versions to service_role;
