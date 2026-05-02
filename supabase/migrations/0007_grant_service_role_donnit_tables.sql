-- Donnit: explicit table privileges for service_role on the donnit schema.
--
-- Background:
--   Migration 0002 grants `usage` on schema donnit to anon/authenticated/
--   service_role, and grants table-level select/insert/update/delete on
--   future tables only to `authenticated` (via ALTER DEFAULT PRIVILEGES).
--   `service_role` was never granted table-level privileges, so server
--   paths that rely on the service-role key (the Gmail OAuth callback,
--   bypassing RLS, etc.) hit `42501 permission denied for table ...`
--   even though the key itself is valid (PostgREST `/rest/v1/` returns
--   200 and HEAD-selects on some tables already work via `bypassrls`).
--
--   The Gmail OAuth callback's upsert into donnit.gmail_accounts is the
--   user-facing symptom: the SPA toast read "Gmail save blocked by
--   Supabase RLS" because the server's classifier maps any `42501` /
--   "permission denied" / "rls" message to the rls_denied bucket.
--
--   This migration grants the missing privileges to service_role so the
--   server can read and write donnit.* tables when it cannot carry a
--   user JWT (Google's OAuth redirect is the canonical example).
--
-- Apply order:
--   - Runs after 0006. Idempotent: ALTER DEFAULT PRIVILEGES, GRANT, and
--     GRANT ON ALL ... are all safe to re-run.
--
-- Security:
--   - `service_role` already bypasses RLS by Supabase convention. This
--     migration only grants the table privileges Postgres requires
--     before RLS bypass can take effect on the new schema. The donnit
--     application code only ever uses the service-role key from the
--     server (never shipped to the browser) and only on paths that have
--     no user JWT (Gmail OAuth callback, health probes).

-- ---------------------------------------------------------------------------
-- 1. Grants on existing donnit tables / sequences / functions.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on all tables in schema donnit
  to service_role;

grant usage, select on all sequences in schema donnit
  to service_role;

grant execute on all functions in schema donnit
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Default privileges so future donnit tables / sequences / functions
--    automatically extend to service_role too.
-- ---------------------------------------------------------------------------

alter default privileges in schema donnit
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema donnit
  grant usage, select on sequences to service_role;

alter default privileges in schema donnit
  grant execute on functions to service_role;
