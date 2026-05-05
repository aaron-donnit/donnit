-- Donnit: allow Slack/SMS as first-class task sources.
--
-- Apply after 0008. The application can queue Slack/SMS messages as
-- approval suggestions immediately, and approved suggestions should preserve
-- source provenance on the created task for reporting.

alter table donnit.tasks
  drop constraint if exists tasks_source_check;

alter table donnit.tasks
  add constraint tasks_source_check
  check (source in ('chat', 'manual', 'email', 'slack', 'sms', 'automation', 'annual'));

