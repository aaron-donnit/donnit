-- Task relationships for Donnit MVP collaboration.
--
-- assigned_to remains the owner/responsible person's to-do item.
-- delegated_to is the person currently asked to complete the work while the
-- owner keeps the task visible.
-- collaborator_ids are additional org members working on the task together.

alter table donnit.tasks
  add column if not exists delegated_to uuid references donnit.profiles(id) on delete set null,
  add column if not exists collaborator_ids uuid[] not null default '{}';

create index if not exists donnit_tasks_delegated_to_idx
  on donnit.tasks (org_id, delegated_to)
  where delegated_to is not null;

create index if not exists donnit_tasks_collaborator_ids_idx
  on donnit.tasks using gin (collaborator_ids);

drop policy if exists "donnit assignees assigners delegates collaborators can update tasks" on donnit.tasks;
drop policy if exists "donnit assignees and assigners can update tasks" on donnit.tasks;

create policy "donnit assignees assigners delegates collaborators can update tasks"
  on donnit.tasks for update
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or delegated_to = auth.uid()
    or auth.uid() = any(collaborator_ids)
    or donnit.is_org_manager(tasks.org_id)
  );

grant select, insert, update, delete on donnit.tasks to service_role;
