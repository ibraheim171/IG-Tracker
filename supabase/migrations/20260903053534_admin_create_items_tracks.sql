-- ============================================================================
-- admin_create_items_tracks.sql — admin item creation and track creation
--
-- Adds trusted admin-only RPCs for UAT item creation and track creation without
-- reopening direct browser writes. Previous PR #9 migrations have been applied
-- to Staging, so this migration intentionally stands alone.
-- ============================================================================

create or replace function public.admin_create_track(
  p_name text,
  p_color_hex text default '#1E8F8B',
  p_sort_order smallint default null
) returns public.tracks
language plpgsql
security definer
set search_path = public
as $$
declare
  trimmed_name text := btrim(coalesce(p_name, ''));
  normalized_color text := upper(btrim(coalesce(p_color_hex, '#1E8F8B')));
  base_slug text;
  candidate_slug text;
  suffix integer := 1;
  next_id smallint;
  next_sort smallint;
  created_track public.tracks;
begin
  perform public.assert_can_use_app();

  if not public.is_admin() then
    raise exception 'ROLE_REQUIRED: إضافة مسار تحتاج أدمن';
  end if;

  if trimmed_name = '' then
    raise exception 'INVALID_PAYLOAD: اسم المسار مطلوب';
  end if;

  if normalized_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'INVALID_COLOR: لون المسار يجب أن يكون بصيغة #RRGGBB';
  end if;

  lock table public.tracks in exclusive mode;

  if exists (select 1 from public.tracks where lower(name) = lower(trimmed_name)) then
    raise exception 'DUPLICATE_TRACK: اسم المسار موجود مسبقاً';
  end if;

  base_slug := lower(regexp_replace(trimmed_name, '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := btrim(base_slug, '-');
  if base_slug = '' then
    base_slug := 'track';
  end if;

  candidate_slug := base_slug;
  while exists (select 1 from public.tracks where slug = candidate_slug) loop
    suffix := suffix + 1;
    candidate_slug := base_slug || '-' || suffix::text;
  end loop;

  select (coalesce(max(id), 0) + 1)::smallint into next_id from public.tracks;
  next_sort := coalesce(p_sort_order, (select (coalesce(max(sort_order), 0) + 10)::smallint from public.tracks));

  insert into public.tracks (id, name, slug, color_hex, sort_order)
  values (next_id, trimmed_name, candidate_slug, normalized_color, next_sort)
  returning * into created_track;

  return created_track;
end
$$;

create or replace function public.admin_create_item(
  p_fields jsonb
) returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.items;
  requested text[];
  forbidden text[];
  writer_id uuid;
  producer_id uuid;
  reviewer_id uuid;
  slot_id uuid;
  selected_partner_ids smallint[];
  created_partner_id smallint;
  trimmed_new_partner text := null;
  expected_partner_count integer;
  actual_partner_count integer;
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

  select coalesce(array_agg(field order by field), '{}')
    into forbidden
    from unnest(requested) as field
   where not (field = any(array[
     'title',
     'track_id',
     'idea_type_id',
     'caption',
     'notes',
     'writer_delivery_url',
     'production_file_url',
     'partner_ids',
     'new_partner_name',
     'writer_id',
     'producer_id',
     'reviewer_id',
     'slot_id'
   ]));

  if array_length(forbidden, 1) is not null then
    raise exception 'FIELD_FORBIDDEN: %', array_to_string(forbidden, ', ');
  end if;

  if coalesce(btrim(p_fields ->> 'title'), '') = '' then
    raise exception 'INVALID_PAYLOAD: العنوان مطلوب';
  end if;

  if coalesce(btrim(p_fields ->> 'writer_id'), '') = '' then
    raise exception 'WRITER_REQUIRED: اختر الكاتب المسؤول';
  end if;

  if (p_fields ->> 'writer_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'INVALID_PAYLOAD: الكاتب المختار غير صحيح';
  end if;

  if nullif(p_fields ->> 'producer_id', '') is not null
     and (p_fields ->> 'producer_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'INVALID_PAYLOAD: المنتج المختار غير صحيح';
  end if;

  if nullif(p_fields ->> 'reviewer_id', '') is not null
     and (p_fields ->> 'reviewer_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'INVALID_PAYLOAD: المراجع المختار غير صحيح';
  end if;

  if nullif(p_fields ->> 'slot_id', '') is not null
     and (p_fields ->> 'slot_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'INVALID_PAYLOAD: موعد النشر غير صحيح';
  end if;

  if nullif(p_fields ->> 'track_id', '') is not null
     and (p_fields ->> 'track_id') !~ '^[0-9]+$' then
    raise exception 'INVALID_PAYLOAD: المسار غير صحيح';
  end if;

  if nullif(p_fields ->> 'idea_type_id', '') is not null
     and (p_fields ->> 'idea_type_id') !~ '^[0-9]+$' then
    raise exception 'INVALID_PAYLOAD: نوع الفكرة غير صحيح';
  end if;

  if p_fields ? 'writer_delivery_url' and not public.is_safe_https_url(p_fields ->> 'writer_delivery_url') then
    raise exception 'INVALID_LINK: رابط تسليم الكاتب يجب أن يكون HTTPS صالحاً';
  end if;

  if p_fields ? 'production_file_url' and not public.is_safe_https_url(p_fields ->> 'production_file_url') then
    raise exception 'INVALID_LINK: رابط ملف الإنتاج يجب أن يكون HTTPS صالحاً';
  end if;

  writer_id := (p_fields ->> 'writer_id')::uuid;
  producer_id := nullif(p_fields ->> 'producer_id', '')::uuid;
  reviewer_id := nullif(p_fields ->> 'reviewer_id', '')::uuid;
  slot_id := nullif(p_fields ->> 'slot_id', '')::uuid;
  trimmed_new_partner := nullif(btrim(coalesce(p_fields ->> 'new_partner_name', '')), '');

  perform 1
    from public.profiles
   where id in (writer_id, producer_id, reviewer_id)
   order by id
   for update;

  if not exists (
    select 1 from public.profiles
     where id = writer_id
       and active
       and not must_change_password
       and 'writer' = any(roles::text[])
  ) then
    raise exception 'ASSIGNEE_ROLE_REQUIRED: الكاتب المختار لا يملك دور الكاتب أو حسابه غير نشط';
  end if;

  if producer_id is not null and not exists (
    select 1 from public.profiles
     where id = producer_id
       and active
       and not must_change_password
       and 'producer' = any(roles::text[])
  ) then
    raise exception 'ASSIGNEE_ROLE_REQUIRED: المنتج المختار لا يملك دور المنتج أو حسابه غير نشط';
  end if;

  if reviewer_id is not null and not exists (
    select 1 from public.profiles
     where id = reviewer_id
       and active
       and not must_change_password
       and 'reviewer' = any(roles::text[])
  ) then
    raise exception 'ASSIGNEE_ROLE_REQUIRED: المراجع المختار لا يملك دور المراجع أو حسابه غير نشط';
  end if;

  if p_fields ? 'track_id'
     and nullif(p_fields ->> 'track_id', '') is not null
     and not exists (select 1 from public.tracks where id = (p_fields ->> 'track_id')::smallint) then
    raise exception 'INVALID_TRACK: اختر مساراً موجوداً';
  end if;

  if p_fields ? 'idea_type_id'
     and nullif(p_fields ->> 'idea_type_id', '') is not null
     and not exists (select 1 from public.idea_types where id = (p_fields ->> 'idea_type_id')::smallint and active) then
    raise exception 'INVALID_IDEA_TYPE: اختر نوع فكرة موجوداً ونشطاً';
  end if;

  if slot_id is not null and not exists (
    select 1 from public.publishing_slots
     where id = slot_id
       and state in ('open', 'assigned')
  ) then
    raise exception 'INVALID_SLOT: اختر موعد نشر متاحاً';
  end if;

  if p_fields ? 'partner_ids' then
    if jsonb_typeof(p_fields -> 'partner_ids') <> 'array' then
      raise exception 'INVALID_PAYLOAD: الشركاء يجب أن يكونوا قائمة';
    end if;

    if exists (
      select 1
        from jsonb_array_elements_text(p_fields -> 'partner_ids') as values(value)
       where nullif(value, '') is not null
         and value !~ '^[0-9]+$'
    ) then
      raise exception 'INVALID_PAYLOAD: الشركاء يجب أن يكونوا أرقاماً صحيحة';
    end if;

    select coalesce(array_agg(distinct value::smallint order by value::smallint), '{}')
      into selected_partner_ids
      from jsonb_array_elements_text(p_fields -> 'partner_ids') as values(value)
     where nullif(value, '') is not null;
  else
    selected_partner_ids := '{}';
  end if;

  select coalesce(array_length(selected_partner_ids, 1), 0) into expected_partner_count;
  select count(*) into actual_partner_count
    from public.partners
   where id = any(selected_partner_ids)
     and active;

  if actual_partner_count <> expected_partner_count then
    raise exception 'INVALID_PARTNER: اختر شركاء موجودين ونشطين';
  end if;

  perform set_config('app.rpc', 'on', true);

  insert into public.items (
    title,
    track_id,
    idea_type_id,
    caption,
    notes,
    writer_delivery_url,
    production_file_url,
    slot_id,
    created_by
  )
  values (
    btrim(p_fields ->> 'title'),
    case when p_fields ? 'track_id' then nullif(p_fields ->> 'track_id', '')::smallint else null end,
    case when p_fields ? 'idea_type_id' then nullif(p_fields ->> 'idea_type_id', '')::smallint else null end,
    case when p_fields ? 'caption' then nullif(btrim(coalesce(p_fields ->> 'caption', '')), '') else null end,
    case when p_fields ? 'notes' then nullif(btrim(coalesce(p_fields ->> 'notes', '')), '') else null end,
    case when p_fields ? 'writer_delivery_url' then nullif(btrim(coalesce(p_fields ->> 'writer_delivery_url', '')), '') else null end,
    case when p_fields ? 'production_file_url' then nullif(btrim(coalesce(p_fields ->> 'production_file_url', '')), '') else null end,
    slot_id,
    auth.uid()
  )
  returning * into it;

  if it.status <> 'idea' then
    raise exception 'INVALID_DEFAULT: المادة الجديدة يجب أن تبدأ من الفكرة';
  end if;

  insert into public.item_participants (item_id, user_id, part, added_by)
  values (it.id, writer_id, 'writer', auth.uid());

  if producer_id is not null then
    insert into public.item_participants (item_id, user_id, part, added_by)
    values (it.id, producer_id, 'producer', auth.uid())
    on conflict (item_id, user_id, part) do nothing;
  end if;

  if reviewer_id is not null then
    insert into public.item_participants (item_id, user_id, part, added_by)
    values (it.id, reviewer_id, 'reviewer', auth.uid())
    on conflict (item_id, user_id, part) do nothing;
  end if;

  if trimmed_new_partner is not null then
    insert into public.partners (name, aliases, created_by)
    values (trimmed_new_partner, array[trimmed_new_partner], auth.uid())
    on conflict (name) do update set name = excluded.name
    returning id into created_partner_id;
  end if;

  if created_partner_id is not null then
    selected_partner_ids := selected_partner_ids || created_partner_id;
  end if;

  insert into public.item_partners (item_id, partner_id, added_by)
  select it.id, id, auth.uid()
    from unnest(coalesce(selected_partner_ids, '{}')) as ids(id)
   group by id
  on conflict (item_id, partner_id) do nothing;

  perform public.refresh_slot_state(slot_id);

  return it;
end
$$;

create or replace function public.admin_save_item_assignments(
  p_item uuid,
  p_writer uuid,
  p_producer uuid default null,
  p_reviewer uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.items;
begin
  perform public.assert_can_use_app();

  if not public.is_admin() then
    raise exception 'ROLE_REQUIRED: تعديل تعيينات المادة يحتاج أدمن';
  end if;

  if p_item is null or p_writer is null then
    raise exception 'INVALID_PAYLOAD: المادة والكاتب مطلوبان';
  end if;

  select * into it from public.items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then raise exception 'ARCHIVED_IMMUTABLE: المادة في شهر مؤرشف'; end if;

  perform 1
    from public.profiles
   where id in (p_writer, p_producer, p_reviewer)
   order by id
   for update;

  perform 1
    from public.item_participants
   where item_id = p_item
     and part in ('writer', 'producer', 'reviewer')
   for update;

  if not exists (
    select 1 from public.profiles
     where id = p_writer
       and active
       and not must_change_password
       and 'writer' = any(roles::text[])
  ) then
    raise exception 'ASSIGNEE_ROLE_REQUIRED: الكاتب المختار لا يملك دور الكاتب أو حسابه غير نشط';
  end if;

  if p_producer is not null and not exists (
    select 1 from public.profiles
     where id = p_producer
       and active
       and not must_change_password
       and 'producer' = any(roles::text[])
  ) then
    raise exception 'ASSIGNEE_ROLE_REQUIRED: المنتج المختار لا يملك دور المنتج أو حسابه غير نشط';
  end if;

  if p_reviewer is not null and not exists (
    select 1 from public.profiles
     where id = p_reviewer
       and active
       and not must_change_password
       and 'reviewer' = any(roles::text[])
  ) then
    raise exception 'ASSIGNEE_ROLE_REQUIRED: المراجع المختار لا يملك دور المراجع أو حسابه غير نشط';
  end if;

  delete from public.item_participants
   where item_id = p_item
     and part in ('writer', 'producer', 'reviewer');

  insert into public.item_participants (item_id, user_id, part, added_by)
  values (p_item, p_writer, 'writer', auth.uid());

  if p_producer is not null then
    insert into public.item_participants (item_id, user_id, part, added_by)
    values (p_item, p_producer, 'producer', auth.uid())
    on conflict (item_id, user_id, part) do nothing;
  end if;

  if p_reviewer is not null then
    insert into public.item_participants (item_id, user_id, part, added_by)
    values (p_item, p_reviewer, 'reviewer', auth.uid())
    on conflict (item_id, user_id, part) do nothing;
  end if;

  return (
    select jsonb_agg(jsonb_build_object('user_id', user_id, 'part', part) order by part, user_id)
      from public.item_participants
     where item_id = p_item
       and part in ('writer', 'producer', 'reviewer')
  );
end
$$;

drop policy if exists no_direct_track_insert on public.tracks;
drop policy if exists no_direct_track_update on public.tracks;
drop policy if exists no_direct_track_delete on public.tracks;
create policy no_direct_track_insert on public.tracks for insert to authenticated
  with check (false);
create policy no_direct_track_update on public.tracks for update to authenticated
  using (false)
  with check (false);
create policy no_direct_track_delete on public.tracks for delete to authenticated
  using (false);

revoke insert, update, delete, truncate on table public.tracks from public, anon, authenticated;

revoke execute on function public.admin_create_item(jsonb) from public, anon, authenticated;
revoke execute on function public.admin_save_item_assignments(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.admin_create_track(text, text, smallint) from public, anon, authenticated;

grant execute on function public.admin_create_item(jsonb) to authenticated;
grant execute on function public.admin_save_item_assignments(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.admin_create_track(text, text, smallint) to authenticated;
