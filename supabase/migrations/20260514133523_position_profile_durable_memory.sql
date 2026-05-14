-- Donnit durable Position Profile memory.
--
-- Position Profiles already store a flexible institutional_memory JSON field.
-- This migration turns position_profile_knowledge into the durable, source-
-- backed "role vault" that can be searched by Donnit AI and preserved across
-- employee transitions.

alter table donnit.position_profile_knowledge
  drop constraint if exists position_profile_knowledge_kind_check;

alter table donnit.position_profile_knowledge
  add constraint position_profile_knowledge_kind_check
  check (
    kind in (
      'how_to',
      'recurring_responsibility',
      'stakeholder',
      'tool',
      'risk',
      'critical_date',
      'decision_rule',
      'relationship',
      'process',
      'preference',
      'handoff_note'
    )
  );

alter table donnit.position_profile_knowledge
  add column if not exists memory_key text not null default gen_random_uuid()::text,
  add column if not exists markdown_body text not null default '',
  add column if not exists source_kind text not null default 'task',
  add column if not exists source_event_id uuid references donnit.task_events(id) on delete set null,
  add column if not exists source_ref text not null default '',
  add column if not exists evidence jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'active',
  add column if not exists importance integer not null default 50,
  add column if not exists confidence_score numeric not null default 0.6,
  add column if not exists created_by uuid references donnit.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz;

alter table donnit.position_profile_knowledge
  drop constraint if exists position_profile_knowledge_source_kind_check,
  add constraint position_profile_knowledge_source_kind_check
  check (source_kind in ('task', 'task_event', 'email', 'slack', 'sms', 'document', 'manual', 'assistant', 'profile_transfer'));

alter table donnit.position_profile_knowledge
  drop constraint if exists position_profile_knowledge_status_check,
  add constraint position_profile_knowledge_status_check
  check (status in ('active', 'superseded', 'archived', 'rejected'));

alter table donnit.position_profile_knowledge
  drop constraint if exists position_profile_knowledge_importance_check,
  add constraint position_profile_knowledge_importance_check
  check (importance >= 0 and importance <= 100);

alter table donnit.position_profile_knowledge
  drop constraint if exists position_profile_knowledge_confidence_score_check,
  add constraint position_profile_knowledge_confidence_score_check
  check (confidence_score >= 0 and confidence_score <= 1);

create unique index if not exists donnit_position_profile_knowledge_memory_key_idx
  on donnit.position_profile_knowledge (org_id, position_profile_id, memory_key);

create index if not exists donnit_position_profile_knowledge_active_idx
  on donnit.position_profile_knowledge (org_id, position_profile_id, status, kind, importance desc, last_seen_at desc)
  where archived_at is null;

create index if not exists donnit_position_profile_knowledge_source_task_idx
  on donnit.position_profile_knowledge (org_id, source_task_id, kind, last_seen_at desc)
  where source_task_id is not null;

create index if not exists donnit_position_profile_knowledge_search_idx
  on donnit.position_profile_knowledge
  using gin (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(body, '') || ' ' || coalesce(markdown_body, '')
    )
  );

grant select, insert, update, delete on donnit.position_profile_knowledge to authenticated, service_role;

notify pgrst, 'reload schema';
