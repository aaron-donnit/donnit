-- Donnit: allow any workspace member to create reusable task templates.
--
-- Templates are a personal/team productivity primitive, not an admin-only
-- control. This migration updates environments that already applied the first
-- task template migration with manager-only policies. It also creates the
-- tables if an operator runs only this latest migration in the SQL editor.

create table if not exists donnit.task_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  trigger_phrases text[] not null default '{}'::text[],
  default_urgency text not null default 'normal',
  default_estimated_minutes integer not null default 30,
  default_recurrence text not null default 'none',
  created_by uuid references donnit.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_templates_default_urgency_check
    check (default_urgency in ('low', 'normal', 'high', 'critical')),
  constraint task_templates_default_recurrence_check
    check (default_recurrence in ('none', 'daily', 'weekly', 'monthly', 'quarterly', 'annual')),
  constraint task_templates_default_estimated_minutes_check
    check (default_estimated_minutes between 5 and 1440)
);

create table if not exists donnit.task_template_subtasks (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references donnit.task_templates(id) on delete cascade,
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  title text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists donnit_task_templates_org_name_idx
  on donnit.task_templates (org_id, lower(name));

create index if not exists donnit_task_template_subtasks_template_position_idx
  on donnit.task_template_subtasks (template_id, position, created_at);

alter table donnit.task_templates enable row level security;
alter table donnit.task_template_subtasks enable row level security;

grant select, insert, update, delete on donnit.task_templates to authenticated, service_role;
grant select, insert, update, delete on donnit.task_template_subtasks to authenticated, service_role;

drop policy if exists "donnit members can view task templates" on donnit.task_templates;
create policy "donnit members can view task templates"
  on donnit.task_templates for select
  using (donnit.is_org_member(task_templates.org_id));

drop policy if exists "donnit members can view task template subtasks" on donnit.task_template_subtasks;
create policy "donnit members can view task template subtasks"
  on donnit.task_template_subtasks for select
  using (donnit.is_org_member(task_template_subtasks.org_id));

drop policy if exists "donnit managers can manage task templates" on donnit.task_templates;
drop policy if exists "donnit members can manage task templates" on donnit.task_templates;
create policy "donnit members can manage task templates"
  on donnit.task_templates for all
  using (donnit.is_org_member(task_templates.org_id))
  with check (donnit.is_org_member(task_templates.org_id));

drop policy if exists "donnit managers can manage task template subtasks" on donnit.task_template_subtasks;
drop policy if exists "donnit members can manage task template subtasks" on donnit.task_template_subtasks;
create policy "donnit members can manage task template subtasks"
  on donnit.task_template_subtasks for all
  using (donnit.is_org_member(task_template_subtasks.org_id))
  with check (donnit.is_org_member(task_template_subtasks.org_id));

notify pgrst, 'reload schema';
