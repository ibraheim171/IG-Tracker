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
  requested text[];
  forbidden text[];
  allowed_draft_fields text[] := array[
    'title',
    'track_id',
    'idea_type_id',
    'caption',
    'notes',
    'writer_delivery_url',
    'production_file_url',
    'partner_ids',
    'new_partner_name',
    'slot_id'
  ];
  field text;
begin
  perform public.assert_can_use_app();

  if not public.is_admin() then
    raise exception 'ROLE_REQUIRED: إنشاء مادة بهذه التفاصيل يحتاج أدمن';
  end if;

  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'INVALID_PAYLOAD: أرسل حقولاً صحيحة للإنشاء';
  end if;

  select coalesce(array_agg(key order by key), '{}')
    into requested
    from jsonb_object_keys(p_fields) as keys(key);

  select coalesce(array_agg(candidate order by candidate), '{}')
    into forbidden
    from unnest(requested) as candidates(candidate)
   where not (candidate = any(allowed_draft_fields));

  if array_length(forbidden, 1) is not null then
    raise exception 'INVALID_PAYLOAD: حقل غير مسموح عند إنشاء المسودة';
  end if;

  if jsonb_typeof(p_fields -> 'title') is distinct from 'string'
     or coalesce(btrim(p_fields ->> 'title'), '') = '' then
    raise exception 'INVALID_PAYLOAD: العنوان مطلوب';
  end if;

  foreach field in array array['track_id', 'idea_type_id'] loop
    if p_fields ? field and jsonb_typeof(p_fields -> field) not in ('number', 'null') then
      raise exception 'INVALID_PAYLOAD: الحقول المرجعية يجب أن تكون أرقاماً صحيحة';
    end if;
    if p_fields ? field and jsonb_typeof(p_fields -> field) = 'number'
       and ((p_fields ->> field) !~ '^[0-9]+$' or (p_fields ->> field)::numeric > 32767) then
      raise exception 'INVALID_PAYLOAD: الحقول المرجعية يجب أن تكون أرقاماً صحيحة';
    end if;
  end loop;

  foreach field in array array['caption', 'notes', 'writer_delivery_url', 'production_file_url', 'new_partner_name'] loop
    if p_fields ? field and jsonb_typeof(p_fields -> field) not in ('string', 'null') then
      raise exception 'INVALID_PAYLOAD: الحقول النصية يجب أن تكون نصوصاً';
    end if;
  end loop;

  if p_fields ? 'writer_delivery_url'
     and jsonb_typeof(p_fields -> 'writer_delivery_url') = 'string'
     and coalesce(btrim(p_fields ->> 'writer_delivery_url'), '') <> ''
     and not public.is_safe_https_url(p_fields ->> 'writer_delivery_url') then
    raise exception 'INVALID_LINK: رابط تسليم الكاتب يجب أن يكون HTTPS صالحاً';
  end if;

  if p_fields ? 'production_file_url'
     and jsonb_typeof(p_fields -> 'production_file_url') = 'string'
     and coalesce(btrim(p_fields ->> 'production_file_url'), '') <> ''
     and not public.is_safe_https_url(p_fields ->> 'production_file_url') then
    raise exception 'INVALID_LINK: رابط ملف الإنتاج يجب أن يكون HTTPS صالحاً';
  end if;

  if p_fields ? 'slot_id' and jsonb_typeof(p_fields -> 'slot_id') not in ('string', 'null') then
    raise exception 'INVALID_SLOT: موعد النشر غير صحيح';
  end if;

  if p_fields ? 'slot_id'
     and jsonb_typeof(p_fields -> 'slot_id') = 'string'
     and nullif(btrim(p_fields ->> 'slot_id'), '') is not null
     and (p_fields ->> 'slot_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'INVALID_SLOT: موعد النشر غير صحيح';
  end if;

  if p_fields ? 'partner_ids' and jsonb_typeof(p_fields -> 'partner_ids') <> 'array' then
    raise exception 'INVALID_PAYLOAD: الشركاء يجب أن يكونوا قائمة';
  end if;

  if p_fields ? 'partner_ids' and exists (
    select 1
      from jsonb_array_elements(p_fields -> 'partner_ids') as elements(value)
     where jsonb_typeof(value) <> 'number'
  ) then
    raise exception 'INVALID_PAYLOAD: الشركاء يجب أن يكونوا أرقاماً صحيحة';
  end if;

  if p_fields ? 'partner_ids' and exists (
    select 1
      from jsonb_array_elements_text(p_fields -> 'partner_ids') as elements(value)
     where value !~ '^[0-9]+$' or value::numeric > 32767
  ) then
    raise exception 'INVALID_PAYLOAD: الشركاء يجب أن يكونوا أرقاماً صحيحة';
  end if;

  creation_fields := jsonb_build_object('title', btrim(p_fields ->> 'title'));

  if p_fields ? 'track_id' and jsonb_typeof(p_fields -> 'track_id') = 'number' then
    creation_fields := creation_fields || jsonb_build_object('track_id', (p_fields ->> 'track_id')::smallint);
  end if;

  if p_fields ? 'idea_type_id' and jsonb_typeof(p_fields -> 'idea_type_id') = 'number' then
    creation_fields := creation_fields || jsonb_build_object('idea_type_id', (p_fields ->> 'idea_type_id')::smallint);
  end if;

  foreach field in array array['caption', 'notes', 'writer_delivery_url'] loop
    if p_fields ? field and jsonb_typeof(p_fields -> field) = 'string' then
      creation_fields := creation_fields || jsonb_build_object(field, nullif(btrim(p_fields ->> field), ''));
    end if;
  end loop;

  it := public.create_item(creation_fields);

  if nullif(btrim(coalesce(p_fields ->> 'production_file_url', '')), '') is not null then
    it := public.save_item_fields(
      it.id,
      jsonb_build_object('production_file_url', p_fields ->> 'production_file_url')
    );
  end if;

  if p_fields ? 'slot_id'
     and jsonb_typeof(p_fields -> 'slot_id') = 'string'
     and nullif(btrim(p_fields ->> 'slot_id'), '') is not null then
    slot_id := (p_fields ->> 'slot_id')::uuid;
    it := public.assign_slot(it.id, slot_id);
  end if;

  if p_fields ? 'partner_ids' then
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
