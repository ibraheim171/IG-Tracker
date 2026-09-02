-- ============================================================================
-- role_field_permissions.sql — field-level item permissions by role
--
-- Adds the publisher role and the writer delivery URL, then moves item field
-- edits and partner assignment behind explicit SECURITY DEFINER RPCs. Direct
-- browser updates to items are no longer a writable surface.
-- ============================================================================

alter type public.role_name add value if not exists 'publisher';

alter table public.items
  add column if not exists writer_delivery_url text;

create or replace function public.has_role_text(p_role text)
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
       and p_role = any(roles::text[])
  );
$$;

create or replace function public.is_item_participant_part(
  p_item uuid,
  p_part public.participant_part
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
       select 1
         from public.profiles profile
         join public.item_participants participant
           on participant.user_id = profile.id
        where profile.id = auth.uid()
          and profile.active
          and not profile.must_change_password
          and p_part::text = any(profile.roles::text[])
          and participant.item_id = p_item
          and participant.part = p_part
     );
$$;

create or replace function public.can_publish_items()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or public.has_role_text('publisher');
$$;

create or replace function public.guard_item_columns() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.rpc', true) = 'on' then
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'USE_RPC: تغيير الحالة يمر عبر advance_item / reject_item / mark_published';
  end if;
  if new.ref is distinct from old.ref then
    raise exception 'IMMUTABLE_COLUMN: ref';
  end if;
  if new.slot_id is distinct from old.slot_id then
    raise exception 'USE_RPC: موعد النشر يمر عبر assign_slot';
  end if;
  if new.published_at is distinct from old.published_at then
    raise exception 'USE_RPC: وقت النشر يُكتب من mark_published';
  end if;
  if new.ig_permalink is distinct from old.ig_permalink then
    raise exception 'USE_RPC: رابط إنستغرام يُكتب من mark_published';
  end if;
  if new.is_archived is distinct from old.is_archived then
    raise exception 'IMMUTABLE_COLUMN: is_archived';
  end if;
  return new;
end
$$;

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
  it   public.items;
  v    text[] := '{}';
  n_producers integer;
begin
  select * into it from public.items where id = p_item;
  if it.id is null then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  if not public.allowed_edge(it.status, p_to) then
    v := array_append(v, format('انتقال غير مسموح: %s ← %s', it.status, p_to));
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

create or replace function public.ensure_can_advance_item(
  p_item uuid,
  p_from public.item_status,
  p_to public.item_status
) returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return;
  end if;

  if p_from = 'idea' and p_to = 'writing' and public.is_item_participant_part(p_item, 'writer') then
    return;
  end if;

  if p_from = 'writing' and p_to = 'content_approved' and public.is_item_participant_part(p_item, 'reviewer') then
    return;
  end if;

  if p_from = 'content_approved' and p_to = 'in_production' and public.is_item_participant_part(p_item, 'producer') then
    return;
  end if;

  if p_from = 'in_production' and p_to = 'design_approved' and public.is_item_participant_part(p_item, 'reviewer') then
    return;
  end if;

  if p_from = 'design_approved' and p_to = 'ready' and public.can_publish_items() then
    return;
  end if;

  raise exception 'ROLE_REQUIRED: هذا الانتقال لا يملكه دورك على هذه المادة';
end
$$;

create or replace function public.save_item_fields(
  p_item uuid,
  p_fields jsonb
) returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.items;
  requested text[];
  allowed text[] := '{}';
  forbidden text[];
begin
  perform public.assert_can_use_app();

  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'INVALID_PAYLOAD: أرسل حقولاً صحيحة للحفظ';
  end if;

  select coalesce(array_agg(key order by key), '{}')
    into requested
    from jsonb_object_keys(p_fields) as keys(key);

  if array_length(requested, 1) is null then
    raise exception 'INVALID_PAYLOAD: لا توجد حقول للحفظ';
  end if;

  select * into it from public.items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then raise exception 'ARCHIVED_IMMUTABLE: المادة في شهر مؤرشف'; end if;

  if public.is_admin() then
    allowed := array['title', 'track_id', 'idea_type_id', 'caption', 'notes', 'writer_delivery_url', 'production_file_url', 'priority'];
  else
    if public.is_item_participant_part(p_item, 'writer') then
      allowed := allowed || array['title', 'track_id', 'idea_type_id', 'caption', 'notes', 'writer_delivery_url'];
    end if;
    if public.is_item_participant_part(p_item, 'producer') then
      allowed := allowed || array['production_file_url'];
    end if;
  end if;

  select coalesce(array_agg(field order by field), '{}')
    into forbidden
    from unnest(requested) as field
   where not (field = any(allowed));

  if array_length(forbidden, 1) is not null then
    raise exception 'FIELD_FORBIDDEN: %', array_to_string(forbidden, ', ');
  end if;

  if p_fields ? 'title' and coalesce(btrim(p_fields ->> 'title'), '') = '' then
    raise exception 'INVALID_PAYLOAD: العنوان مطلوب';
  end if;

  update public.items
     set title = case when p_fields ? 'title' then btrim(p_fields ->> 'title') else title end,
         track_id = case when p_fields ? 'track_id' then nullif(p_fields ->> 'track_id', '')::smallint else track_id end,
         idea_type_id = case when p_fields ? 'idea_type_id' then nullif(p_fields ->> 'idea_type_id', '')::smallint else idea_type_id end,
         caption = case when p_fields ? 'caption' then nullif(btrim(coalesce(p_fields ->> 'caption', '')), '') else caption end,
         notes = case when p_fields ? 'notes' then nullif(btrim(coalesce(p_fields ->> 'notes', '')), '') else notes end,
         writer_delivery_url = case when p_fields ? 'writer_delivery_url' then nullif(btrim(coalesce(p_fields ->> 'writer_delivery_url', '')), '') else writer_delivery_url end,
         production_file_url = case when p_fields ? 'production_file_url' then nullif(btrim(coalesce(p_fields ->> 'production_file_url', '')), '') else production_file_url end,
         priority = case when p_fields ? 'priority' then nullif(p_fields ->> 'priority', '')::smallint else priority end
   where id = p_item
   returning * into it;

  return it;
end
$$;

create or replace function public.create_item(
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
begin
  perform public.assert_can_use_app();

  if not (public.has_role_text('writer') or public.is_admin()) then
    raise exception 'ROLE_REQUIRED: إنشاء مادة يحتاج كاتباً أو أدمن';
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
   where not (field = any(array['title', 'track_id', 'idea_type_id', 'caption', 'notes', 'writer_delivery_url']));

  if array_length(forbidden, 1) is not null then
    raise exception 'FIELD_FORBIDDEN: %', array_to_string(forbidden, ', ');
  end if;

  if coalesce(btrim(p_fields ->> 'title'), '') = '' then
    raise exception 'INVALID_PAYLOAD: العنوان مطلوب';
  end if;

  perform set_config('app.rpc', 'on', true);

  insert into public.items (
    title,
    track_id,
    idea_type_id,
    caption,
    notes,
    writer_delivery_url,
    created_by
  )
  values (
    btrim(p_fields ->> 'title'),
    case when p_fields ? 'track_id' then nullif(p_fields ->> 'track_id', '')::smallint else null end,
    case when p_fields ? 'idea_type_id' then nullif(p_fields ->> 'idea_type_id', '')::smallint else null end,
    case when p_fields ? 'caption' then nullif(btrim(coalesce(p_fields ->> 'caption', '')), '') else null end,
    case when p_fields ? 'notes' then nullif(btrim(coalesce(p_fields ->> 'notes', '')), '') else null end,
    case when p_fields ? 'writer_delivery_url' then nullif(btrim(coalesce(p_fields ->> 'writer_delivery_url', '')), '') else null end,
    auth.uid()
  )
  returning * into it;

  if public.has_role_text('writer') then
    insert into public.item_participants (item_id, user_id, part, added_by)
    values (it.id, auth.uid(), 'writer', auth.uid())
    on conflict (item_id, user_id, part) do nothing;
  end if;

  if it.status <> 'idea' then
    raise exception 'INVALID_DEFAULT: المادة الجديدة يجب أن تبدأ من الفكرة';
  end if;

  return it;
end
$$;

create or replace function public.refresh_slot_state(p_slot uuid)
returns public.slot_state
language plpgsql
security definer
set search_path = public
as $$
declare
  slot_record public.publishing_slots;
  has_items boolean := false;
  has_published boolean := false;
  next_state public.slot_state;
begin
  if p_slot is null then
    return null;
  end if;

  select * into slot_record
    from public.publishing_slots
   where id = p_slot
   for update;

  if slot_record.id is null then
    raise exception 'SLOT_NOT_FOUND: موعد النشر غير موجود';
  end if;

  select exists (
           select 1 from public.items where slot_id = p_slot
         ),
         exists (
           select 1 from public.items where slot_id = p_slot and status = 'published'
         )
    into has_items, has_published;

  next_state := case
    when slot_record.state = 'published' or has_published then 'published'::public.slot_state
    when has_items then 'assigned'::public.slot_state
    when slot_record.state = 'skipped' or slot_record.slot_at <= now() then 'skipped'::public.slot_state
    else 'open'::public.slot_state
  end;

  update public.publishing_slots
     set state = next_state
   where id = p_slot;

  return next_state;
end
$$;

create or replace function public.save_item_partners(
  p_item uuid,
  p_partner_ids smallint[] default '{}',
  p_new_partner_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.items;
  trimmed_name text := nullif(btrim(coalesce(p_new_partner_name, '')), '');
  created_partner_id smallint;
  selected_ids smallint[];
  expected_count integer;
  actual_count integer;
begin
  perform public.assert_can_use_app();

  if not public.can_publish_items() then
    raise exception 'ROLE_REQUIRED: إدارة شركاء المادة تحتاج مسؤول النشر أو الأدمن';
  end if;

  select * into it from public.items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then raise exception 'ARCHIVED_IMMUTABLE: المادة في شهر مؤرشف'; end if;

  if trimmed_name is not null then
    insert into public.partners (name, aliases, created_by)
    values (trimmed_name, array[trimmed_name], auth.uid())
    on conflict (name) do update set name = excluded.name
    returning id into created_partner_id;
  end if;

  select coalesce(array_agg(distinct id order by id), '{}')
    into selected_ids
    from unnest(coalesce(p_partner_ids, '{}') || coalesce(array[created_partner_id], '{}')) as ids(id)
   where id is not null;

  select coalesce(array_length(selected_ids, 1), 0) into expected_count;

  select count(*) into actual_count
    from public.partners
   where id = any(selected_ids)
     and active;

  if actual_count <> expected_count then
    raise exception 'INVALID_PARTNER: اختر شريكاً موجوداً ونشطاً';
  end if;

  delete from public.item_partners where item_id = p_item;

  insert into public.item_partners (item_id, partner_id, added_by)
  select p_item, id, auth.uid()
    from unnest(selected_ids) as ids(id);

  return jsonb_build_object(
    'partner_ids', selected_ids,
    'created_partner_id', created_partner_id
  );
end
$$;

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

  perform public.ensure_can_advance_item(p_item, prev, p_to);
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
end
$$;

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

  select * into it from public.items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then raise exception 'ARCHIVED_IMMUTABLE'; end if;

  if not (public.is_item_participant_part(p_item, 'reviewer') or public.is_admin()) then
    raise exception 'ROLE_REQUIRED: الإعادة تحتاج مراجعاً معيّناً على المادة';
  end if;

  if p_gate = 'content' and it.status <> 'writing' then
    raise exception 'INVALID_REJECT_STAGE: رفض المحتوى مسموح فقط في مرحلة اعتماد المحتوى';
  end if;

  if p_gate = 'design' and it.status <> 'in_production' then
    raise exception 'INVALID_REJECT_STAGE: رفض التصميم مسموح فقط في مرحلة اعتماد التصميم';
  end if;

  perform set_config('app.rpc', 'on', true);

  back := case p_gate when 'content' then 'writing'::public.item_status
                      else 'in_production'::public.item_status end;

  insert into public.approvals (item_id, gate, result, actor_id, note)
  values (p_item, p_gate, 'reject', auth.uid(), p_note);

  insert into public.transitions (item_id, from_status, to_status, actor_id, note)
  values (p_item, it.status, back, auth.uid(), p_note);

  update public.items set status = back where id = p_item returning * into it;
  return it;
end
$$;

create or replace function public.assign_slot(p_item uuid, p_slot uuid)
returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.items;
  old_slot uuid;
begin
  perform public.assert_can_use_app();

  if not public.can_publish_items() then
    raise exception 'ROLE_REQUIRED: تعيين موعد النشر يحتاج مسؤول النشر أو الأدمن';
  end if;

  if p_slot is null then
    raise exception 'SLOT_REQUIRED: اختر موعد النشر';
  end if;

  perform public.refresh_slot_state(p_slot);

  select * into it from public.items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then raise exception 'ARCHIVED_IMMUTABLE: المادة في شهر مؤرشف'; end if;

  old_slot := it.slot_id;
  perform set_config('app.rpc', 'on', true);

  update public.items set slot_id = p_slot where id = p_item returning * into it;

  if old_slot is distinct from p_slot then
    perform public.refresh_slot_state(old_slot);
  end if;
  perform public.refresh_slot_state(p_slot);

  return it;
end
$$;

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

  if not public.can_publish_items() then
    raise exception 'ROLE_REQUIRED: تعليم النشر يحتاج مسؤول النشر أو الأدمن';
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

  perform public.refresh_slot_state(it.slot_id);
  return it;
end
$$;

drop policy if exists update_item on public.items;
drop policy if exists insert_item on public.items;
drop policy if exists no_direct_item_insert on public.items;
drop policy if exists no_direct_item_update on public.items;
drop policy if exists no_direct_item_delete on public.items;
create policy no_direct_item_insert on public.items for insert to authenticated
  with check (false);
create policy no_direct_item_update on public.items for update to authenticated
  using (false)
  with check (false);
create policy no_direct_item_delete on public.items for delete to authenticated
  using (false);

drop policy if exists write_participants on public.item_participants;
drop policy if exists no_direct_item_participant_insert on public.item_participants;
drop policy if exists no_direct_item_participant_update on public.item_participants;
drop policy if exists no_direct_item_participant_delete on public.item_participants;
create policy no_direct_item_participant_insert on public.item_participants for insert to authenticated
  with check (false);
create policy no_direct_item_participant_update on public.item_participants for update to authenticated
  using (false)
  with check (false);
create policy no_direct_item_participant_delete on public.item_participants for delete to authenticated
  using (false);

drop policy if exists write_partners on public.item_partners;
create policy write_partners on public.item_partners for all to authenticated
  using (
    public.can_publish_items()
    and exists (select 1 from public.items where id = item_id and not is_archived)
  )
  with check (
    public.can_publish_items()
    and exists (select 1 from public.items where id = item_id and not is_archived)
  );

drop policy if exists add_partner on public.partners;
create policy add_partner on public.partners for insert to authenticated
  with check (public.can_publish_items());

revoke insert, update, delete on table public.items from public, anon, authenticated;
revoke insert, update, delete on table public.item_participants from public, anon, authenticated;
revoke insert, update, delete on table public.partners from anon, authenticated;
revoke insert, update, delete on table public.item_partners from anon, authenticated;

revoke execute on function public.has_role_text(text) from public, anon;
revoke execute on function public.is_item_participant_part(uuid, public.participant_part) from public, anon;
revoke execute on function public.can_publish_items() from public, anon;
revoke execute on function public.ensure_can_advance_item(uuid, public.item_status, public.item_status) from public, anon, authenticated;
revoke execute on function public.create_item(jsonb) from public, anon, authenticated;
revoke execute on function public.save_item_fields(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.save_item_partners(uuid, smallint[], text) from public, anon, authenticated;
revoke execute on function public.refresh_slot_state(uuid) from public, anon, authenticated;
revoke execute on function public.advance_item(uuid, public.item_status, text, text) from public, anon, authenticated;
revoke execute on function public.reject_item(uuid, public.approval_gate, text) from public, anon, authenticated;
revoke execute on function public.assign_slot(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.mark_published(uuid, text, timestamptz, text) from public, anon, authenticated;

grant execute on function public.has_role_text(text) to authenticated;
grant execute on function public.is_item_participant_part(uuid, public.participant_part) to authenticated;
grant execute on function public.can_publish_items() to authenticated;
grant execute on function public.create_item(jsonb) to authenticated;
grant execute on function public.save_item_fields(uuid, jsonb) to authenticated;
grant execute on function public.save_item_partners(uuid, smallint[], text) to authenticated;
grant execute on function public.advance_item(uuid, public.item_status, text, text) to authenticated;
grant execute on function public.reject_item(uuid, public.approval_gate, text) to authenticated;
grant execute on function public.assign_slot(uuid, uuid) to authenticated;
grant execute on function public.mark_published(uuid, text, timestamptz, text) to authenticated;
