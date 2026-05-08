-- Position Profile task continuity and privacy.
--
-- Binds tasks to job-based Position Profiles, expands recurrence cadence
-- beyond annual, and adds privacy controls so personal/confidential work is
-- excluded from role handoff history.

alter table donnit.tasks
  add column if not exists position_profile_id uuid references donnit.position_profiles(id) on delete set null;

alter table donnit.tasks
  add column if not exists visibility text not null default 'work';

alter table donnit.tasks
  add column if not exists visible_from date;

alter table donnit.tasks
  drop constraint if exists tasks_visibility_check;

alter table donnit.tasks
  add constraint tasks_visibility_check
  check (visibility in ('work', 'personal', 'confidential'));

alter table donnit.tasks
  drop constraint if exists tasks_recurrence_check;

alter table donnit.tasks
  add constraint tasks_recurrence_check
  check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'quarterly', 'annual'));

create index if not exists donnit_tasks_position_profile_idx
  on donnit.tasks (org_id, position_profile_id, visibility);

create index if not exists donnit_tasks_visible_from_idx
  on donnit.tasks (org_id, assigned_to, visible_from);

drop policy if exists "donnit members can view org tasks" on donnit.tasks;
create policy "donnit members can view org tasks"
  on donnit.tasks for select
  using (
    donnit.is_org_member(tasks.org_id)
    and (
      coalesce(tasks.visibility, 'work') = 'work'
      or tasks.assigned_to = auth.uid()
      or tasks.assigned_by = auth.uid()
      or tasks.delegated_to = auth.uid()
      or auth.uid() = any(coalesce(tasks.collaborator_ids, '{}'::uuid[]))
      or donnit.is_org_manager(tasks.org_id)
    )
  );

notify pgrst, 'reload schema';
