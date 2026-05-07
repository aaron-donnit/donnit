-- Donnit: durable per-user workspace state.
--
-- This intentionally stores small UI/workflow decisions that matter across
-- sessions but do not belong on the task row itself: reviewed notifications,
-- agenda approval state, and similar per-user state as the product grows.

create table if not exists donnit.user_workspace_state (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  user_id uuid not null references donnit.profiles(id) on delete cascade,
  state_key text not null check (state_key in ('reviewed_notifications', 'agenda_state')),
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, state_key)
);

create index if not exists donnit_user_workspace_state_user_idx
  on donnit.user_workspace_state (org_id, user_id, state_key);

alter table donnit.user_workspace_state enable row level security;

drop policy if exists "donnit users can view their workspace state" on donnit.user_workspace_state;
create policy "donnit users can view their workspace state"
  on donnit.user_workspace_state for select
  using (
    user_id = auth.uid()
    and donnit.is_org_member(user_workspace_state.org_id)
  );

drop policy if exists "donnit users can manage their workspace state" on donnit.user_workspace_state;
create policy "donnit users can manage their workspace state"
  on donnit.user_workspace_state for all
  using (
    user_id = auth.uid()
    and donnit.is_org_member(user_workspace_state.org_id)
  )
  with check (
    user_id = auth.uid()
    and donnit.is_org_member(user_workspace_state.org_id)
  );

drop policy if exists "donnit task participants can manage task subtasks" on donnit.task_subtasks;
create policy "donnit task participants can manage task subtasks"
  on donnit.task_subtasks for all
  using (
    exists (
      select 1
      from donnit.tasks
      where tasks.id = task_subtasks.task_id
        and tasks.org_id = task_subtasks.org_id
        and (
          tasks.assigned_to = auth.uid()
          or tasks.assigned_by = auth.uid()
          or tasks.delegated_to = auth.uid()
          or auth.uid() = any(tasks.collaborator_ids)
          or donnit.is_org_manager(tasks.org_id)
        )
    )
  )
  with check (
    exists (
      select 1
      from donnit.tasks
      where tasks.id = task_subtasks.task_id
        and tasks.org_id = task_subtasks.org_id
        and (
          tasks.assigned_to = auth.uid()
          or tasks.assigned_by = auth.uid()
          or tasks.delegated_to = auth.uid()
          or auth.uid() = any(tasks.collaborator_ids)
          or donnit.is_org_manager(tasks.org_id)
        )
    )
  );

grant select, insert, update, delete on donnit.user_workspace_state to authenticated, service_role;
