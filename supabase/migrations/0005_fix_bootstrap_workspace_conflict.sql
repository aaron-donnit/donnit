-- Fix ambiguous column reference in donnit.bootstrap_workspace.
--
-- Background:
--   Migration 0003 defined `donnit.bootstrap_workspace(...)` returning a
--   TABLE with output columns `(user_id uuid, org_id uuid, is_new boolean)`.
--   Inside the body the function executes:
--
--       insert into donnit.organization_members (org_id, user_id, role, can_assign)
--       values (v_org_id, v_uid, 'owner', true)
--       on conflict (org_id, user_id) do nothing;
--
--   At runtime PL/pgSQL raises:
--
--       42702 column reference "org_id" is ambiguous
--       DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--       CONTEXT: PL/pgSQL function bootstrap_workspace(text,text,text) line 52.
--
--   The output columns from the function's RETURNS TABLE clause are visible
--   as PL/pgSQL variables inside the body, so `org_id` and `user_id` in the
--   ON CONFLICT target list match both the table columns and the function
--   output variables. The user-visible symptom is `POST /api/auth/bootstrap`
--   returning 500 and `POST /rest/v1/rpc/bootstrap_workspace` returning 400
--   with this 42702 error, leaving brand-new authenticated users unable to
--   create their workspace.
--
-- Fix:
--   Recreate `donnit.bootstrap_workspace(...)` with the same external
--   signature and the same RETURNS TABLE column names (so PostgREST clients
--   keep reading `row.user_id` / `row.org_id` / `row.is_new`), but add a
--   `#variable_conflict use_column` directive at the top of the body. This
--   instructs PL/pgSQL to resolve ambiguous identifiers to the referenced
--   column rather than to the output-table variable, which is the correct
--   reading of every ambiguous reference in this function: the only places
--   where the function uses the OUT-variable values are the trailing
--   `return query select v_uid, v_org_id, v_is_new;` (and an early return
--   that selects from `v_existing_profile`), neither of which references the
--   bare names `org_id` / `user_id` / `is_new`. Local DECLARE-d variables
--   (v_uid, v_org_id, ...) are unaffected by the directive.
--
-- Non-destructive / idempotent:
--   - Uses `CREATE OR REPLACE FUNCTION` with the same `(text, text, text)`
--     argument signature, so existing `GRANT EXECUTE ... TO authenticated`
--     is preserved by Postgres. The explicit GRANT below is defensive.
--   - DOES NOT drop or alter any table, column, policy, or other function.
--   - DOES NOT touch the `public` schema.
--   - The function still runs as `SECURITY DEFINER` with
--     `search_path = donnit, public`, matching the original.
--   - The returned column names and types are unchanged, so application
--     code (`server/donnit-store.ts`, `client/src/components/AuthGate.tsx`)
--     does not need updating.
--   - Safe to re-run.

create or replace function donnit.bootstrap_workspace(
  p_full_name text default '',
  p_email text default '',
  p_org_name text default ''
) returns table (
  user_id uuid,
  org_id uuid,
  is_new boolean
)
language plpgsql
security definer
set search_path = donnit, public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_email text := coalesce(nullif(p_email, ''), (auth.jwt() ->> 'email'));
  v_name text := coalesce(nullif(p_full_name, ''), v_email, 'New user');
  v_existing_profile donnit.profiles%rowtype;
  v_org_id uuid;
  v_org_name text := coalesce(nullif(p_org_name, ''), v_name || '''s workspace');
  v_org_slug text;
  v_is_new boolean := false;
begin
  if v_uid is null then
    raise exception 'bootstrap_workspace requires an authenticated session';
  end if;

  select * into v_existing_profile from donnit.profiles where id = v_uid;

  if found and v_existing_profile.default_org_id is not null then
    return query select v_existing_profile.id, v_existing_profile.default_org_id, false;
    return;
  end if;

  -- Build a unique slug from the org name + short uid suffix.
  v_org_slug := regexp_replace(lower(v_org_name), '[^a-z0-9]+', '-', 'g');
  v_org_slug := trim(both '-' from v_org_slug);
  if v_org_slug = '' then
    v_org_slug := 'workspace';
  end if;
  v_org_slug := v_org_slug || '-' || substr(replace(v_uid::text, '-', ''), 1, 8);

  insert into donnit.organizations (name, slug)
  values (v_org_name, v_org_slug)
  returning id into v_org_id;

  if not found then
    -- Should not happen, but guard against it.
    raise exception 'failed to create organization for user %', v_uid;
  end if;

  if v_existing_profile.id is null then
    insert into donnit.profiles (id, full_name, email, default_org_id, persona)
    values (v_uid, v_name, coalesce(v_email, ''), v_org_id, 'operator');
    v_is_new := true;
  else
    update donnit.profiles
       set default_org_id = v_org_id,
           full_name = case when full_name = '' then v_name else full_name end,
           email = case when email = '' then coalesce(v_email, '') else email end
     where id = v_uid;
  end if;

  insert into donnit.organization_members (org_id, user_id, role, can_assign)
  values (v_org_id, v_uid, 'owner', true)
  on conflict (org_id, user_id) do nothing;

  insert into donnit.reminder_preferences (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  return query select v_uid, v_org_id, v_is_new;
end;
$$;

grant execute on function donnit.bootstrap_workspace(text, text, text) to authenticated;
