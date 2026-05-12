-- Donnit: structured task timing for date-aware tasks, agenda scheduling, and calendar export.

alter table donnit.tasks
  add column if not exists due_time time,
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists is_all_day boolean not null default false;

alter table donnit.tasks
  drop constraint if exists tasks_time_order_check;

alter table donnit.tasks
  add constraint tasks_time_order_check
  check (
    start_time is null
    or end_time is null
    or end_time > start_time
  );

create index if not exists donnit_tasks_org_schedule_idx
  on donnit.tasks (org_id, due_date, start_time, due_time, status);

notify pgrst, 'reload schema';
