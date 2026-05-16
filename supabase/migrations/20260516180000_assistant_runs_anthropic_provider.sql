-- Phase 1 D6 — Anthropic provider unlock
-- Adds 'anthropic' to the assistant_runs.provider check constraint so Claude
-- can be a callable provider alongside OpenAI and Hermes.
-- Does NOT change the default provider. Application code still routes through
-- OpenAI; this migration just opens the door.

alter table donnit.assistant_runs
  drop constraint if exists assistant_runs_provider_check;

alter table donnit.assistant_runs
  add constraint assistant_runs_provider_check
  check (provider in ('openai', 'hermes', 'anthropic'));
