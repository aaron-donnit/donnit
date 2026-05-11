-- Donnit: AI reply drafting and Gmail thread send metadata.
--
-- Email suggestions now carry enough context for the approval inbox to show
-- "draft a reply", remember the editable draft, and record whether the final
-- response was sent through Gmail or fell back to a local draft.

alter table donnit.email_suggestions
  add column if not exists gmail_thread_id text,
  add column if not exists reply_suggested boolean not null default false,
  add column if not exists reply_draft text,
  add column if not exists reply_status text not null default 'none',
  add column if not exists reply_sent_at timestamptz,
  add column if not exists reply_provider_message_id text;

alter table donnit.email_suggestions
  drop constraint if exists email_suggestions_reply_status_check;

alter table donnit.email_suggestions
  add constraint email_suggestions_reply_status_check
  check (reply_status in ('none', 'suggested', 'drafted', 'sent', 'copy', 'failed'));

create index if not exists donnit_email_suggestions_thread_idx
  on donnit.email_suggestions (org_id, gmail_thread_id)
  where gmail_thread_id is not null;

create index if not exists donnit_email_suggestions_reply_status_idx
  on donnit.email_suggestions (org_id, reply_status, created_at desc);

notify pgrst, 'reload schema';
