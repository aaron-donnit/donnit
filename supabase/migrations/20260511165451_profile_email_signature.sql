-- Donnit: let each user save a personal outbound email signature.
--
-- The signature is intentionally stored on the profile, not in workspace
-- state, because it should follow the user across reply drafts and devices.

alter table donnit.profiles
  add column if not exists email_signature text not null default '';

notify pgrst, 'reload schema';
