-- ============================================================================
-- 0003_rls.sql — Row Level Security
--
-- Shape of the policy set: a team of twenty with nothing to hide from each other,
-- so everyone READS everything. Writing is narrow, and status never moves through
-- a plain UPDATE — only through the functions in 0002.
-- ============================================================================

alter table profiles           enable row level security;
alter table tracks             enable row level security;
alter table idea_types         enable row level security;
alter table partners           enable row level security;
alter table items              enable row level security;
alter table item_participants  enable row level security;
alter table item_partners      enable row level security;
alter table approvals          enable row level security;
alter table transitions        enable row level security;
alter table publishing_slots   enable row level security;
alter table reports            enable row level security;
alter table ai_drafts          enable row level security;
alter table ig_posts           enable row level security;
alter table ig_post_daily      enable row level security;
alter table ig_account_daily   enable row level security;
alter table ig_demographics    enable row level security;
alter table ig_link_candidates enable row level security;

-- ============================== READ ==============================

create policy read_all on profiles           for select to authenticated using (true);
create policy read_all on tracks             for select to authenticated using (true);
create policy read_all on idea_types         for select to authenticated using (true);
create policy read_all on partners           for select to authenticated using (true);
create policy read_all on items              for select to authenticated using (true);
create policy read_all on item_participants  for select to authenticated using (true);
create policy read_all on item_partners      for select to authenticated using (true);
create policy read_all on approvals          for select to authenticated using (true);
create policy read_all on transitions        for select to authenticated using (true);
create policy read_all on publishing_slots   for select to authenticated using (true);
create policy read_all on reports            for select to authenticated using (true);
create policy read_all on ai_drafts          for select to authenticated using (true);
create policy read_all on ig_posts           for select to authenticated using (true);
create policy read_all on ig_post_daily      for select to authenticated using (true);
create policy read_all on ig_account_daily   for select to authenticated using (true);
create policy read_all on ig_demographics    for select to authenticated using (true);
create policy read_all on ig_link_candidates for select to authenticated using (true);

-- ============================== PROFILES ==============================
-- A person edits their own display name. Roles are admin-only, always.

create policy self_update on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and roles = (select roles from profiles p where p.id = auth.uid()));

create policy admin_all on profiles for all to authenticated
  using (is_admin()) with check (is_admin());

-- ============================== ITEMS ==============================

create policy insert_item on items for insert to authenticated
  with check ((has_role('writer') or is_admin()) and created_by = auth.uid());

-- Content edits by participants. status, is_archived, ref and published_at are
-- blocked by guard_item_columns() rather than by a WITH CHECK subquery: a policy
-- that selects from its own table recurses under RLS.
create policy update_item on items for update to authenticated
  using (not is_archived and (is_participant(id) or is_admin()))
  with check (not is_archived);

create policy admin_delete_item on items for delete to authenticated using (is_admin());

-- ============================== ITEM CHILDREN ==============================

create policy write_participants on item_participants for all to authenticated
  using (is_participant(item_id) or is_admin())
  with check (is_participant(item_id) or is_admin());

create policy write_partners on item_partners for all to authenticated
  using (is_participant(item_id) or is_admin())
  with check (is_participant(item_id) or is_admin());

-- approvals and transitions are append-only, written by SECURITY DEFINER
-- functions. No direct insert path is granted, deliberately.
create policy admin_fix_links on ig_link_candidates for update to authenticated
  using (has_role('reviewer') or is_admin())
  with check (has_role('reviewer') or is_admin());

-- ============================== LISTS ==============================

create policy add_partner on partners for insert to authenticated
  with check (has_role('writer') or has_role('reviewer') or is_admin());
create policy edit_partner on partners for update to authenticated
  using (is_admin()) with check (is_admin());

create policy admin_tracks on tracks for all to authenticated
  using (is_admin()) with check (is_admin());
create policy admin_types on idea_types for all to authenticated
  using (is_admin()) with check (is_admin());
create policy admin_slots on publishing_slots for all to authenticated
  using (is_admin()) with check (is_admin());

-- ============================== REPORTS & AI ==============================

create policy write_report on reports for all to authenticated
  using (author_id = auth.uid() or is_admin())
  with check (author_id = auth.uid() or is_admin());

create policy write_ai on ai_drafts for insert to authenticated
  with check (created_by = auth.uid());
create policy approve_ai on ai_drafts for update to authenticated
  using (has_role('reviewer') or is_admin())
  with check (has_role('reviewer') or is_admin());

-- ============================== INSTAGRAM TABLES ==============================
-- Written only by the Apps Script collector, which authenticates with the
-- service_role key and bypasses RLS. No client-side write path exists.

-- ============================== EXECUTE GRANTS ==============================

revoke execute on function advance_item(uuid, item_status, text, text)  from public;
revoke execute on function reject_item(uuid, approval_gate, text)       from public;
revoke execute on function mark_published(uuid, text, timestamptz, text) from public;
revoke execute on function assign_slot(uuid, uuid)                      from public;
revoke execute on function ensure_slots(integer)                        from public;

grant execute on function advance_item(uuid, item_status, text, text)   to authenticated;
grant execute on function reject_item(uuid, approval_gate, text)        to authenticated;
grant execute on function mark_published(uuid, text, timestamptz, text) to authenticated;
grant execute on function assign_slot(uuid, uuid)                       to authenticated;
grant execute on function ensure_slots(integer)                         to service_role;
