-- Donnit: persist first-run onboarding checklist state.

alter table donnit.user_workspace_state
  drop constraint if exists user_workspace_state_state_key_check;

alter table donnit.user_workspace_state
  add constraint user_workspace_state_state_key_check
  check (state_key in ('reviewed_notifications', 'agenda_state', 'onboarding_state'));
