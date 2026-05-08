-- Donnit admin user management.
--
-- Adds an explicit workspace admin role and active/inactive member state so
-- admins can stage users, change reporting lines, and remove access without
-- deleting the user's task/profile history.

alter table donnit.organization_members
  add column if not exists status text not null default 'active';

alter table donnit.organization_members
  drop constraint if exists organization_members_role_check;

alter table donnit.organization_members
  add constraint organization_members_role_check
  check (role in ('owner', 'admin', 'manager', 'member', 'viewer'));

alter table donnit.organization_members
  drop constraint if exists organization_members_status_check;

alter table donnit.organization_members
  add constraint organization_members_status_check
  check (status in ('active', 'inactive'));

create index if not exists donnit_organization_members_status_idx
  on donnit.organization_members (org_id, status);

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
       and coalesce(m.status, 'active') = 'active'
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
       and coalesce(m.status, 'active') = 'active'
       and (m.can_assign = true or m.role in ('owner', 'admin', 'manager'))
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
       and coalesce(m.status, 'active') = 'active'
       and m.role in ('owner', 'admin', 'manager')
  );
$$;

create or replace function donnit.is_org_admin(p_org_id uuid)
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
      and coalesce(m.status, 'active') = 'active'
      and m.role in ('owner', 'admin')
  );
$$;

revoke all on function donnit.is_org_member(uuid) from public;
revoke all on function donnit.can_assign_in_org(uuid) from public;
revoke all on function donnit.is_org_manager(uuid) from public;
revoke all on function donnit.is_org_admin(uuid) from public;

grant execute on function donnit.is_org_member(uuid) to authenticated;
grant execute on function donnit.can_assign_in_org(uuid) to authenticated;
grant execute on function donnit.is_org_manager(uuid) to authenticated;
grant execute on function donnit.is_org_admin(uuid) to authenticated;
