-- Let active workspace members see profile names/emails for other active
-- members in the same Donnit workspace. Without this, the app can read
-- organization_members but RLS hides the matching profiles, so teammates
-- render as the fallback label "Member".

drop policy if exists "donnit members can view workspace profiles" on donnit.profiles;

create policy "donnit members can view workspace profiles"
  on donnit.profiles for select
  using (
    id = auth.uid()
    or donnit.is_org_member(default_org_id)
  );

notify pgrst, 'reload schema';
