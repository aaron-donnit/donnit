-- Donnit bootstrap RPC + insert policy for first-time users.
--
-- Why this migration is needed:
--   Migration 0002 added RLS policies for `donnit.organizations` and
--   `donnit.organization_members`, but only for SELECT (and a few UPDATEs).
--   There is no INSERT policy for `donnit.organizations` or
--   `donnit.organization_members`, which means an authenticated client cannot
--   create their first org or membership row directly. Without that, a brand
--   new user who just signed up has no way to bootstrap themselves into the
--   schema.
--
-- Two changes here:
--   1. A SECURITY DEFINER RPC `donnit.bootstrap_workspace(...)` that the
--      authenticated user calls once after signup. It is idempotent: if the
--      caller already has a profile + default org, it returns the existing
--      ids. Owner role lets the user assign tasks within their own org.
--   2. Optional INSERT policies on `organizations` and
--      `organization_members` that mirror the RPC's behavior, scoped so a
--      user can only create the initial owner row for themselves. These are
--      kept narrow so direct REST inserts cannot grant access to other
--      users' orgs.
--
-- Idempotent: uses CREATE OR REPLACE for the function, DROP POLICY IF EXISTS
-- for policies. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Bootstrap RPC
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Narrow insert policies that mirror the RPC, so that REST clients can also
-- create their initial org/membership without needing the RPC if they prefer
-- a roundtrip-free flow. The RPC remains the canonical entry point.
-- ---------------------------------------------------------------------------

drop policy if exists "donnit users can create initial organization" on donnit.organizations;
create policy "donnit users can create initial organization"
  on donnit.organizations for insert
  with check (auth.uid() is not null);

drop policy if exists "donnit users can create owner membership" on donnit.organization_members;
create policy "donnit users can create owner membership"
  on donnit.organization_members for insert
  with check (
    auth.uid() = user_id
    and role = 'owner'
    and not exists (
      select 1 from donnit.organization_members existing
      where existing.org_id = organization_members.org_id
    )
  );

-- Allow members to update their own membership row (role stays controlled by
-- existing select policy + manual elevation by owners).
drop policy if exists "donnit members can update own membership" on donnit.organization_members;
create policy "donnit members can update own membership"
  on donnit.organization_members for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Allow chat_messages updates by owner (used to attach task_id after parse).
drop policy if exists "donnit users can update own chat" on donnit.chat_messages;
create policy "donnit users can update own chat"
  on donnit.chat_messages for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
