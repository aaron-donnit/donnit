-- Fix infinite recursion in RLS policies on donnit.organization_members.
--
-- Background:
--   Migrations 0002 and 0003 defined RLS policies on `donnit.organizations`,
--   `donnit.organization_members`, `donnit.tasks`, `donnit.task_events`, and
--   `donnit.email_suggestions` whose USING / WITH CHECK clauses contained a
--   subquery against `donnit.organization_members`. Because
--   `organization_members` itself has a SELECT policy that subqueries the same
--   table to determine whether the caller is a member of the row's org, every
--   read of `organization_members` triggers another evaluation of that same
--   policy on the inner subquery, and Postgres returns:
--
--       42P17  infinite recursion detected in policy for relation
--              "organization_members"
--
--   This now surfaces directly to the client because the `donnit` schema is
--   exposed via PostgREST (Supabase Project settings → API → Exposed schemas).
--
-- Fix:
--   Replace the recursive `exists (select 1 from donnit.organization_members
--   ...)` checks with calls to SECURITY DEFINER helper functions that run with
--   the function owner's privileges and therefore bypass RLS on
--   `organization_members`. Helpers pin `search_path` to `donnit, pg_temp` to
--   avoid search_path hijacking and read `auth.uid()` from the caller's
--   session (this is preserved across SECURITY DEFINER on Supabase because
--   GUCs are local to the request).
--
-- Non-destructive:
--   - DOES NOT drop or alter any table or column.
--   - DOES NOT touch the `public` schema.
--   - Uses `CREATE OR REPLACE FUNCTION` and `DROP POLICY IF EXISTS` /
--     `CREATE POLICY` so the migration is idempotent.
--   - Preserves the original intended behavior of every policy: members can
--     read org-scoped rows, owners/managers/can_assign users can assign and
--     update, users can still create their initial owner membership when no
--     other member exists.

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER helpers
-- ---------------------------------------------------------------------------

create or replace function donnit.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = donnit, pg_temp
as $$
  select exists (
    select 1
      from donnit.organization_members m
     where m.org_id = p_org_id
       and m.user_id = auth.uid()
  );
$$;

create or replace function donnit.can_assign_in_org(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = donnit, pg_temp
as $$
  select exists (
    select 1
      from donnit.organization_members m
     where m.org_id = p_org_id
       and m.user_id = auth.uid()
       and (m.can_assign = true or m.role in ('owner', 'manager'))
  );
$$;

create or replace function donnit.is_org_manager(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = donnit, pg_temp
as $$
  select exists (
    select 1
      from donnit.organization_members m
     where m.org_id = p_org_id
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager')
  );
$$;

create or replace function donnit.org_has_members(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = donnit, pg_temp
as $$
  select exists (
    select 1
      from donnit.organization_members m
     where m.org_id = p_org_id
  );
$$;

revoke all on function donnit.is_org_member(uuid) from public;
revoke all on function donnit.can_assign_in_org(uuid) from public;
revoke all on function donnit.is_org_manager(uuid) from public;
revoke all on function donnit.org_has_members(uuid) from public;

grant execute on function donnit.is_org_member(uuid) to authenticated;
grant execute on function donnit.can_assign_in_org(uuid) to authenticated;
grant execute on function donnit.is_org_manager(uuid) to authenticated;
grant execute on function donnit.org_has_members(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

drop policy if exists "donnit members can view organizations" on donnit.organizations;
create policy "donnit members can view organizations"
  on donnit.organizations for select
  using (donnit.is_org_member(organizations.id));

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------

-- A user can see every membership row in any org they belong to (peers + self).
-- Implemented via the SECURITY DEFINER helper, so the inner check no longer
-- re-enters this policy.
drop policy if exists "donnit members can view org membership" on donnit.organization_members;
create policy "donnit members can view org membership"
  on donnit.organization_members for select
  using (donnit.is_org_member(organization_members.org_id));

-- Initial owner membership insert: the user can create the first owner row
-- for an org that currently has no members. The helper bypasses RLS, so this
-- no longer self-recurses through the SELECT policy.
drop policy if exists "donnit users can create owner membership" on donnit.organization_members;
create policy "donnit users can create owner membership"
  on donnit.organization_members for insert
  with check (
    auth.uid() = user_id
    and role = 'owner'
    and not donnit.org_has_members(organization_members.org_id)
  );

-- Self-update remains unchanged in spirit but restated here so the migration
-- is self-contained / idempotent.
drop policy if exists "donnit members can update own membership" on donnit.organization_members;
create policy "donnit members can update own membership"
  on donnit.organization_members for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

drop policy if exists "donnit members can view org tasks" on donnit.tasks;
create policy "donnit members can view org tasks"
  on donnit.tasks for select
  using (donnit.is_org_member(tasks.org_id));

drop policy if exists "donnit assigners can create tasks" on donnit.tasks;
create policy "donnit assigners can create tasks"
  on donnit.tasks for insert
  with check (
    donnit.is_org_member(tasks.org_id)
    and (
      donnit.can_assign_in_org(tasks.org_id)
      or tasks.assigned_to = auth.uid()
    )
  );

drop policy if exists "donnit assignees and assigners can update tasks" on donnit.tasks;
create policy "donnit assignees and assigners can update tasks"
  on donnit.tasks for update
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or donnit.is_org_manager(tasks.org_id)
  );

-- ---------------------------------------------------------------------------
-- task_events
-- ---------------------------------------------------------------------------

drop policy if exists "donnit members can view task events" on donnit.task_events;
create policy "donnit members can view task events"
  on donnit.task_events for select
  using (donnit.is_org_member(task_events.org_id));

drop policy if exists "donnit members can create task events" on donnit.task_events;
create policy "donnit members can create task events"
  on donnit.task_events for insert
  with check (donnit.is_org_member(task_events.org_id));

-- ---------------------------------------------------------------------------
-- email_suggestions
-- ---------------------------------------------------------------------------

drop policy if exists "donnit members can view email suggestions" on donnit.email_suggestions;
create policy "donnit members can view email suggestions"
  on donnit.email_suggestions for select
  using (donnit.is_org_member(email_suggestions.org_id));

drop policy if exists "donnit assigners can update email suggestions" on donnit.email_suggestions;
create policy "donnit assigners can update email suggestions"
  on donnit.email_suggestions for update
  using (donnit.can_assign_in_org(email_suggestions.org_id));

drop policy if exists "donnit assigners can insert email suggestions" on donnit.email_suggestions;
create policy "donnit assigners can insert email suggestions"
  on donnit.email_suggestions for insert
  with check (donnit.can_assign_in_org(email_suggestions.org_id));
