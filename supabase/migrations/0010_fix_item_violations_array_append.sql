-- ============================================================================
-- 0010_fix_item_violations_array_append.sql — avoid text[] concatenation ambiguity
--
-- This migration only redefines item_violations() so rule collection uses
-- explicit array_append() calls. It does not change workflow, RLS, permissions,
-- tables, data, or RPC callers.
-- ============================================================================

create or replace function public.item_violations(p_item uuid, p_to public.item_status)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  it   items;
  v    text[] := '{}';
  n_producers integer;
begin
  select * into it from items where id = p_item;
  if it.id is null then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  if not allowed_edge(it.status, p_to) then
    v := array_append(v, format('انتقال غير مسموح: %s ← %s', it.status, p_to));
  end if;

  if p_to = 'content_approved' then
    if coalesce(btrim(it.caption), '') = '' then
      v := array_append(v, 'لا إرسال للاعتماد بلا كابشن');
    end if;
    if it.track_id is null then
      v := array_append(v, 'المسار مطلوب من القائمة المغلقة');
    end if;
    if not (has_role('reviewer') or is_admin()) then
      v := array_append(v, 'الاعتماد يحتاج دور مراجع');
    end if;
  end if;

  if p_to = 'in_production' then
    select count(*) into n_producers
      from item_participants where item_id = p_item and part = 'producer';
    if n_producers = 0 then
      v := array_append(v, 'لا إنتاج بلا مسؤول إنتاج معيّن');
    end if;
  end if;

  if p_to = 'design_approved' then
    if coalesce(btrim(it.production_file_url), '') = '' then
      v := array_append(v, 'لا اعتماد تصميم بلا رابط ملف الإنتاج');
    end if;
    if not (has_role('reviewer') or is_admin()) then
      v := array_append(v, 'اعتماد التصميم يحتاج دور مراجع');
    end if;
  end if;

  -- Gate 3 is a system gate: no human signs it, the data does.
  if p_to = 'ready' then
    if coalesce(btrim(it.caption), '') = '' then
      v := array_append(v, 'لا جاهز بلا كابشن');
    end if;
    if coalesce(btrim(it.production_file_url), '') = '' then
      v := array_append(v, 'لا جاهز بلا رابط ملف الإنتاج');
    end if;
    if it.slot_id is null then
      v := array_append(v, 'لا جاهز بلا موعد نشر — التاريخ من المواعيد فقط');
    end if;
  end if;

  if p_to = 'published' then
    v := array_append(v, 'النشر يمر عبر mark_published() لا عبر advance_item()');
  end if;

  return v;
end $$;
