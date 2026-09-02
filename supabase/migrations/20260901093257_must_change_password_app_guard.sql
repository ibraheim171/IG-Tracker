-- ============================================================================
-- must_change_password_app_guard.sql — block app access until password rotation
--
-- Adds database-side defense for users who still have a temporary password.
-- It does not change workflow statuses, item rules, account data, or real rows.
-- ============================================================================

create or replace function public.can_use_app()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles
     where id = auth.uid()
       and active
       and not must_change_password
  );
$$;

create or replace function public.assert_can_use_app()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  profile_record record;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED: سجّل الدخول أولاً';
  end if;

  select active, must_change_password
    into profile_record
    from public.profiles
   where id = auth.uid();

  if not found or not profile_record.active then
    raise exception 'ACCOUNT_INACTIVE: الحساب غير نشط';
  end if;

  if profile_record.must_change_password then
    raise exception 'PASSWORD_CHANGE_REQUIRED: يجب تغيير كلمة المرور قبل متابعة استخدام المنصة';
  end if;
end
$$;

create or replace function public.has_role(p_role role_name)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles
     where id = auth.uid()
       and active
       and not must_change_password
       and p_role = any(roles)
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin');
$$;

create or replace function public.is_participant(p_item uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_use_app()
     and (
       exists (
         select 1
           from public.item_participants
          where item_id = p_item
            and user_id = auth.uid()
       )
       or exists (
         select 1
           from public.items
          where id = p_item
            and created_by = auth.uid()
       )
     );
$$;

drop policy if exists password_ready_user_guard on public.tracks;
create policy password_ready_user_guard on public.tracks
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.idea_types;
create policy password_ready_user_guard on public.idea_types
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.partners;
create policy password_ready_user_guard on public.partners
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.items;
create policy password_ready_user_guard on public.items
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.item_participants;
create policy password_ready_user_guard on public.item_participants
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.item_partners;
create policy password_ready_user_guard on public.item_partners
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.approvals;
create policy password_ready_user_guard on public.approvals
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.transitions;
create policy password_ready_user_guard on public.transitions
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.publishing_slots;
create policy password_ready_user_guard on public.publishing_slots
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.reports;
create policy password_ready_user_guard on public.reports
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.ai_drafts;
create policy password_ready_user_guard on public.ai_drafts
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.ig_posts;
create policy password_ready_user_guard on public.ig_posts
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.ig_post_daily;
create policy password_ready_user_guard on public.ig_post_daily
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.ig_account_daily;
create policy password_ready_user_guard on public.ig_account_daily
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.ig_demographics;
create policy password_ready_user_guard on public.ig_demographics
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.ig_link_candidates;
create policy password_ready_user_guard on public.ig_link_candidates
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

drop policy if exists password_ready_user_guard on public.admin_account_audit;
create policy password_ready_user_guard on public.admin_account_audit
  as restrictive for all to authenticated
  using (public.can_use_app())
  with check (public.can_use_app());

create or replace function public.advance_item(
  p_item            uuid,
  p_to              public.item_status,
  p_note            text default null,
  p_override_reason text default null
) returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  it   public.items;
  v    text[];
  ovr  boolean := false;
  prev public.item_status;
begin
  perform public.assert_can_use_app();

  select * into it from public.items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then
    raise exception 'ARCHIVED_IMMUTABLE: المادة في شهر مؤرشف';
  end if;
  prev := it.status;
  perform set_config('app.rpc', 'on', true);

  v := public.item_violations(p_item, p_to);

  if array_length(v, 1) > 0 then
    if public.is_admin() and coalesce(btrim(p_override_reason), '') <> '' then
      ovr := true;
    else
      raise exception 'RULE_VIOLATION: %', array_to_string(v, ' · ');
    end if;
  end if;

  update public.items set status = p_to where id = p_item returning * into it;

  if p_to in ('content_approved', 'design_approved') then
    insert into public.approvals (item_id, gate, result, actor_id, note)
    values (p_item,
            case when p_to = 'content_approved' then 'content'::public.approval_gate
                 else 'design'::public.approval_gate end,
            'approve', auth.uid(), p_note);
  end if;

  insert into public.transitions (item_id, from_status, to_status, actor_id,
                                  is_override, override_reason, violations, note)
  values (p_item, prev, p_to, auth.uid(),
          ovr, nullif(btrim(coalesce(p_override_reason, '')), ''),
          nullif(v, '{}'), p_note);

  return it;
end $$;

create or replace function public.reject_item(
  p_item uuid,
  p_gate public.approval_gate,
  p_note text
) returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  it   public.items;
  back public.item_status;
begin
  perform public.assert_can_use_app();

  if coalesce(btrim(p_note), '') = '' then
    raise exception 'NOTE_REQUIRED: الإعادة تحتاج ملاحظة مكتوبة';
  end if;
  if not (public.has_role('reviewer') or public.is_admin()) then
    raise exception 'ROLE_REQUIRED: الإعادة تحتاج دور مراجع';
  end if;

  select * into it from public.items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then raise exception 'ARCHIVED_IMMUTABLE'; end if;

  perform set_config('app.rpc', 'on', true);

  back := case p_gate when 'content' then 'writing'::public.item_status
                      else 'in_production'::public.item_status end;

  insert into public.approvals (item_id, gate, result, actor_id, note)
  values (p_item, p_gate, 'reject', auth.uid(), p_note);

  insert into public.transitions (item_id, from_status, to_status, actor_id, note)
  values (p_item, it.status, back, auth.uid(), p_note);

  update public.items set status = back where id = p_item returning * into it;
  return it;
end $$;

create or replace function public.mark_published(
  p_item            uuid,
  p_permalink       text,
  p_at              timestamptz default now(),
  p_override_reason text default null
) returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  it  public.items;
  v   text[] := '{}';
  ovr boolean := false;
begin
  perform public.assert_can_use_app();

  if not public.is_admin() then
    raise exception 'ROLE_REQUIRED: تعليم النشر يحتاج دور أدمن';
  end if;

  select * into it from public.items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then raise exception 'ARCHIVED_IMMUTABLE'; end if;

  if it.status <> 'ready' then
    v := array_append(v, format('المادة ليست جاهزة للنشر (%s)', it.status));
  end if;
  if coalesce(btrim(p_permalink), '') = '' then
    v := array_append(v, 'رابط المنشور مطلوب عند تعليم النشر');
  elsif p_permalink !~ '^https?://(www\.)?instagram\.com/(p|reel|tv)/[^/?#]+' then
    v := array_append(v, 'الرابط ليس رابط منشور إنستغرام صالحاً');
  elsif exists (select 1 from public.items where ig_permalink = p_permalink and id <> p_item) then
    v := array_append(v, 'هذا الرابط مربوط بمادة أخرى');
  end if;

  if array_length(v, 1) > 0 then
    if public.is_admin() and coalesce(btrim(p_override_reason), '') <> '' then
      ovr := true;
    else
      raise exception 'RULE_VIOLATION: %', array_to_string(v, ' · ');
    end if;
  end if;

  perform set_config('app.rpc', 'on', true);

  insert into public.transitions (item_id, from_status, to_status, actor_id,
                                  is_override, override_reason, violations)
  values (p_item, it.status, 'published', auth.uid(),
          ovr, nullif(btrim(coalesce(p_override_reason, '')), ''), nullif(v, '{}'));

  update public.items
     set status       = 'published',
         published_at = p_at,
         ig_permalink = nullif(btrim(p_permalink), '')
   where id = p_item
   returning * into it;

  update public.publishing_slots set state = 'published' where id = it.slot_id;
  return it;
end $$;

create or replace function public.assign_slot(p_item uuid, p_slot uuid)
returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.items;
begin
  perform public.assert_can_use_app();

  if not (public.is_participant(p_item) or public.is_admin()) then
    raise exception 'FORBIDDEN: لست مشاركاً في هذه المادة';
  end if;
  update public.items set slot_id = p_slot where id = p_item returning * into it;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  update public.publishing_slots set state = 'assigned'
   where id = p_slot and state = 'open';
  return it;
end $$;

create or replace function public.admin_change_item_stage(
  p_item       uuid,
  p_to         public.item_status,
  p_reason     text,
  p_clear_slot boolean default false
) returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  it                       public.items;
  previous_status          public.item_status;
  old_slot_id              uuid;
  old_slot_at              timestamptz;
  old_slot_state           public.slot_state;
  new_slot_state           public.slot_state;
  has_remaining_items      boolean := false;
  has_published_remaining  boolean := false;
  violations               text[] := '{}';
  trimmed_reason           text;
  slot_note                text;
begin
  perform public.assert_can_use_app();

  if not public.is_admin() then
    raise exception 'ROLE_REQUIRED: تغيير المرحلة يحتاج دور أدمن';
  end if;

  trimmed_reason := btrim(coalesce(p_reason, ''));
  if char_length(trimmed_reason) < 5 then
    raise exception 'REASON_REQUIRED: سبب تغيير المرحلة يجب أن يكون مكتوباً وواضحاً';
  end if;
  if char_length(trimmed_reason) > 500 then
    raise exception 'REASON_TOO_LONG: سبب تغيير المرحلة طويل جداً';
  end if;

  if p_to is null then
    raise exception 'TARGET_REQUIRED: اختر المرحلة الجديدة';
  end if;

  if p_to = 'published' then
    raise exception 'PUBLISHED_TARGET_FORBIDDEN: النشر يمر عبر mark_published() فقط';
  end if;

  select * into it from public.items where id = p_item for update;
  if it.id is null then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  if it.is_archived then
    raise exception 'ARCHIVED_IMMUTABLE: المادة في شهر مؤرشف';
  end if;

  if it.status = 'published' then
    raise exception 'PUBLISHED_IMMUTABLE: المادة المنشورة سجل تاريخي ولا تُعاد في هذه المهمة';
  end if;

  if it.status = p_to then
    raise exception 'SAME_STATUS: المرحلة الجديدة مطابقة للمرحلة الحالية';
  end if;

  previous_status := it.status;
  old_slot_id := it.slot_id;

  if old_slot_id is not null then
    select slot_at, state into old_slot_at, old_slot_state
      from public.publishing_slots
     where id = old_slot_id
     for update;

    if old_slot_at is null then
      raise exception 'SLOT_NOT_FOUND: موعد النشر المرتبط غير موجود';
    end if;
  end if;

  slot_note := case
    when old_slot_id is null then 'قرار موعد النشر: لا يوجد موعد مرتبط'
    when p_clear_slot then 'قرار موعد النشر: إلغاء موعد النشر وإعادته للمواعيد المتاحة'
    else 'قرار موعد النشر: الاحتفاظ بموعد النشر'
  end;

  perform set_config('app.rpc', 'on', true);

  if p_clear_slot and old_slot_id is not null then
    update public.items
       set slot_id = null
     where id = p_item
     returning * into it;
  end if;

  violations := public.item_violations(p_item, p_to);

  update public.items
     set status = p_to
   where id = p_item
   returning * into it;

  insert into public.transitions (item_id, from_status, to_status, actor_id,
                                  is_override, override_reason, violations, note)
  values (p_item, previous_status, p_to, auth.uid(),
          true, trimmed_reason, nullif(violations, '{}'), slot_note);

  if p_clear_slot and old_slot_id is not null then
    select exists (
             select 1
               from public.items
              where slot_id = old_slot_id
           ),
           exists (
             select 1
               from public.items
              where slot_id = old_slot_id
                and status = 'published'
           )
      into has_remaining_items, has_published_remaining;

    new_slot_state := case
      when old_slot_state = 'published' or has_published_remaining then 'published'::public.slot_state
      when has_remaining_items then 'assigned'::public.slot_state
      when old_slot_state = 'skipped' or old_slot_at <= now() then 'skipped'::public.slot_state
      else 'open'::public.slot_state
    end;

    update public.publishing_slots
       set state = new_slot_state
     where id = old_slot_id;

    if not found then
      raise exception 'SLOT_UPDATE_FAILED: تعذر تحديث موعد النشر';
    end if;
  end if;

  return it;
end $$;

revoke execute on function public.can_use_app() from public, anon;
grant execute on function public.can_use_app() to authenticated;

revoke execute on function public.assert_can_use_app() from public, anon;
grant execute on function public.assert_can_use_app() to authenticated;

revoke execute on function public.advance_item(uuid, public.item_status, text, text) from public;
revoke execute on function public.reject_item(uuid, public.approval_gate, text) from public;
revoke execute on function public.mark_published(uuid, text, timestamptz, text) from public;
revoke execute on function public.assign_slot(uuid, uuid) from public;
revoke execute on function public.admin_change_item_stage(uuid, public.item_status, text, boolean) from public;

grant execute on function public.advance_item(uuid, public.item_status, text, text) to authenticated;
grant execute on function public.reject_item(uuid, public.approval_gate, text) to authenticated;
grant execute on function public.mark_published(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.assign_slot(uuid, uuid) to authenticated;
grant execute on function public.admin_change_item_stage(uuid, public.item_status, text, boolean) to authenticated;
