-- Allow an admin to capture a minimal idea before assigning a writer, while
-- keeping assignment and every workflow gate inside the existing RPC layer.

alter function public.admin_create_item(jsonb)
  rename to admin_create_item_with_writer;

revoke execute on function public.admin_create_item_with_writer(jsonb)
  from public, anon, authenticated;

create function public.admin_create_item(
  p_fields jsonb
) returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.items;
  creation_fields jsonb;
  partner_ids smallint[] := '{}';
  slot_id uuid;
begin
  perform public.assert_can_use_app();

  if not public.is_admin() then
    raise exception 'ROLE_REQUIRED: إنشاء مادة بهذه التفاصيل يحتاج أدمن';
  end if;

  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'INVALID_PAYLOAD: أرسل حقولاً صحيحة للإنشاء';
  end if;

  if nullif(btrim(coalesce(p_fields ->> 'writer_id', '')), '') is not null then
    return public.admin_create_item_with_writer(p_fields);
  end if;

  if nullif(btrim(coalesce(p_fields ->> 'producer_id', '')), '') is not null
     or nullif(btrim(coalesce(p_fields ->> 'reviewer_id', '')), '') is not null then
    raise exception 'WRITER_REQUIRED: عيّن مسؤول الإعداد قبل تعيين بقية الفريق';
  end if;

  creation_fields := p_fields - array[
    'writer_id',
    'producer_id',
    'reviewer_id',
    'production_file_url',
    'partner_ids',
    'new_partner_name',
    'slot_id'
  ]::text[];

  it := public.create_item(creation_fields);

  if nullif(btrim(coalesce(p_fields ->> 'production_file_url', '')), '') is not null then
    it := public.save_item_fields(
      it.id,
      jsonb_build_object('production_file_url', p_fields ->> 'production_file_url')
    );
  end if;

  if nullif(btrim(coalesce(p_fields ->> 'slot_id', '')), '') is not null then
    if (p_fields ->> 'slot_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'INVALID_SLOT: موعد النشر غير صحيح';
    end if;
    slot_id := (p_fields ->> 'slot_id')::uuid;
    it := public.assign_slot(it.id, slot_id);
  end if;

  if p_fields ? 'partner_ids' then
    if jsonb_typeof(p_fields -> 'partner_ids') <> 'array' then
      raise exception 'INVALID_PAYLOAD: الشركاء يجب أن يكونوا قائمة';
    end if;
    if exists (
      select 1
        from jsonb_array_elements_text(p_fields -> 'partner_ids') as values(value)
       where value !~ '^[0-9]+$'
    ) then
      raise exception 'INVALID_PAYLOAD: الشركاء يجب أن يكونوا أرقاماً صحيحة';
    end if;
    select coalesce(array_agg(distinct value::smallint order by value::smallint), '{}')
      into partner_ids
      from jsonb_array_elements_text(p_fields -> 'partner_ids') as values(value);
  end if;

  if coalesce(array_length(partner_ids, 1), 0) > 0
     or nullif(btrim(coalesce(p_fields ->> 'new_partner_name', '')), '') is not null then
    perform public.save_item_partners(
      it.id,
      partner_ids,
      nullif(btrim(coalesce(p_fields ->> 'new_partner_name', '')), '')
    );
  end if;

  select target.* into it
    from public.items target
   where target.id = it.id;
  return it;
end
$$;

revoke execute on function public.admin_create_item(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_create_item(jsonb)
  to authenticated;

create or replace function public.item_violations(
  p_item uuid,
  p_to public.item_status
) returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  it public.items;
  v text[] := '{}';
  n_writers integer;
  n_producers integer;
begin
  select * into it from public.items where id = p_item;
  if it.id is null then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  if not public.allowed_edge(it.status, p_to) then
    v := array_append(v, format('انتقال غير مسموح: %s ← %s', it.status, p_to));
  end if;

  if p_to = 'writing' then
    select count(*) into n_writers
      from public.item_participants participant
      join public.profiles profile on profile.id = participant.user_id
     where participant.item_id = p_item
       and participant.part = 'writer'
       and profile.active
       and not profile.must_change_password
       and 'writer' = any(profile.roles::text[]);
    if n_writers = 0 then
      v := array_append(v, 'عيّن مسؤول الإعداد قبل إرسال المادة للكتابة');
    end if;
  end if;

  if p_to = 'content_approved' then
    if coalesce(btrim(it.caption), '') = '' then
      v := array_append(v, 'لا إرسال للاعتماد بلا كابشن');
    end if;
    if it.track_id is null then
      v := array_append(v, 'المسار مطلوب من القائمة المغلقة');
    end if;
    if not (public.is_item_participant_part(p_item, 'reviewer') or public.is_admin()) then
      v := array_append(v, 'الاعتماد يحتاج مراجعاً معيّناً على المادة');
    end if;
  end if;

  if p_to = 'in_production' then
    select count(*) into n_producers
      from public.item_participants participant
      join public.profiles profile on profile.id = participant.user_id
     where participant.item_id = p_item
       and participant.part = 'producer'
       and profile.active
       and not profile.must_change_password
       and 'producer' = any(profile.roles::text[]);
    if n_producers = 0 then
      v := array_append(v, 'لا إنتاج بلا مسؤول إنتاج معيّن');
    end if;
  end if;

  if p_to = 'design_approved' then
    if coalesce(btrim(it.production_file_url), '') = '' then
      v := array_append(v, 'لا اعتماد تصميم بلا رابط ملف الإنتاج');
    end if;
    if not (public.is_item_participant_part(p_item, 'reviewer') or public.is_admin()) then
      v := array_append(v, 'اعتماد التصميم يحتاج مراجعاً معيّناً على المادة');
    end if;
  end if;

  if p_to = 'ready' then
    if coalesce(btrim(it.caption), '') = '' then
      v := array_append(v, 'لا جاهز بلا كابشن');
    end if;
    if coalesce(btrim(it.production_file_url), '') = '' then
      v := array_append(v, 'لا جاهز بلا رابط ملف الإنتاج');
    end if;
    if it.slot_id is null then
      v := array_append(v, 'لا جاهز بلا فتحة نشر — التاريخ من الفتحات فقط');
    end if;
  end if;

  if p_to = 'published' then
    v := array_append(v, 'النشر يمر عبر mark_published() لا عبر advance_item()');
  end if;

  return v;
end
$$;

revoke execute on function public.item_violations(uuid, public.item_status)
  from public, anon, authenticated;
