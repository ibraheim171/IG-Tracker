-- ============================================================================
-- 0012_admin_change_item_stage.sql — admin-only atomic stage and slot control
--
-- This migration adds one admin RPC. It does not change workflow statuses,
-- mark_published(), item_violations(), RLS policies, tables, columns, or data.
-- ============================================================================

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
  it              public.items;
  previous_status public.item_status;
  old_slot_id     uuid;
  violations      text[] := '{}';
  trimmed_reason  text;
  remaining_items integer;
  slot_note       text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED: سجّل الدخول أولاً';
  end if;

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
    perform 1 from public.publishing_slots where id = old_slot_id for update;
    if not found then
      raise exception 'SLOT_NOT_FOUND: موعد النشر المرتبط غير موجود';
    end if;
  end if;

  violations := public.item_violations(p_item, p_to);

  slot_note := case
    when old_slot_id is null then 'قرار موعد النشر: لا يوجد موعد مرتبط'
    when p_clear_slot then 'قرار موعد النشر: إلغاء موعد النشر وإعادته للمواعيد المتاحة'
    else 'قرار موعد النشر: الاحتفاظ بموعد النشر'
  end;

  perform set_config('app.rpc', 'on', true);

  insert into public.transitions (item_id, from_status, to_status, actor_id,
                                  is_override, override_reason, violations, note)
  values (p_item, previous_status, p_to, auth.uid(),
          true, trimmed_reason, nullif(violations, '{}'), slot_note);

  update public.items
     set status = p_to,
         slot_id = case when p_clear_slot and old_slot_id is not null then null else slot_id end
   where id = p_item
   returning * into it;

  if p_clear_slot and old_slot_id is not null then
    select count(*) into remaining_items
      from public.items
     where slot_id = old_slot_id;

    update public.publishing_slots
       set state = case when remaining_items = 0 then 'open'::public.slot_state else 'assigned'::public.slot_state end
     where id = old_slot_id;

    if not found then
      raise exception 'SLOT_UPDATE_FAILED: تعذر تحديث موعد النشر';
    end if;
  end if;

  return it;
end $$;

revoke execute on function public.admin_change_item_stage(uuid, public.item_status, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_change_item_stage(uuid, public.item_status, text, boolean) to authenticated;
