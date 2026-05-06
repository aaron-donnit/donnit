-- Donnit: document imports and next task primitives.
--
-- Document uploads reuse the approval inbox and should preserve source
-- provenance when approved into tasks. The subtasks and credential vault
-- tables are intentionally small foundations for the next implementation
-- slice; sensitive credential values should be encrypted before production
-- use and never exposed to the client as plaintext.

alter table donnit.tasks
  drop constraint if exists tasks_source_check;

alter table donnit.tasks
  add constraint tasks_source_check
  check (source in ('chat', 'manual', 'email', 'slack', 'sms', 'document', 'automation', 'annual'));

create table if not exists donnit.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references donnit.tasks(id) on delete cascade,
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  title text not null,
  status text not null default 'open' check (status in ('open', 'completed')),
  position integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists donnit_task_subtasks_task_position_idx
  on donnit.task_subtasks (task_id, position, created_at);

create table if not exists donnit.position_tool_credentials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  owner_user_id uuid references donnit.profiles(id) on delete set null,
  position_label text not null,
  tool_name text not null,
  login_url text,
  account_identifier text,
  billing_notes text,
  encrypted_secret text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists donnit_position_tool_credentials_org_position_idx
  on donnit.position_tool_credentials (org_id, position_label, tool_name);

alter table donnit.task_subtasks enable row level security;
alter table donnit.position_tool_credentials enable row level security;

drop policy if exists "donnit members can view task subtasks" on donnit.task_subtasks;
create policy "donnit members can view task subtasks"
  on donnit.task_subtasks for select
  using (donnit.is_org_member(task_subtasks.org_id));

drop policy if exists "donnit managers can manage task subtasks" on donnit.task_subtasks;
create policy "donnit managers can manage task subtasks"
  on donnit.task_subtasks for all
  using (donnit.is_org_manager(task_subtasks.org_id))
  with check (donnit.is_org_manager(task_subtasks.org_id));

drop policy if exists "donnit managers can manage position credentials" on donnit.position_tool_credentials;
create policy "donnit managers can manage position credentials"
  on donnit.position_tool_credentials for all
  using (donnit.is_org_manager(position_tool_credentials.org_id))
  with check (donnit.is_org_manager(position_tool_credentials.org_id));

grant select, insert, update, delete on donnit.task_subtasks to authenticated, service_role;
grant select, insert, update, delete on donnit.position_tool_credentials to authenticated, service_role;
