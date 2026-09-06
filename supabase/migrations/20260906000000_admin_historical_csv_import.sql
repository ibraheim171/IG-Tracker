-- ============================================================================
-- admin_historical_csv_import.sql — one-shot, admin-only historical backfill
--
-- This deliberately does not call the normal draft or workflow RPCs. It creates
-- already-published historical records, while leaving every future-content path
-- and direct-write restriction unchanged.
-- ============================================================================

create or replace function public.admin_import_historical_items(
  p_rows             jsonb,
  p_source_filename  text,
  p_source_sha256    text,
  p_reason            text,
  p_dry_run           boolean default true,
  p_preview_token     text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id             uuid := auth.uid();
  batch_id             uuid;
  source_filename      text := btrim(coalesce(p_source_filename, ''));
  source_sha256        text := lower(btrim(coalesce(p_source_sha256, '')));
  reason               text := btrim(coalesce(p_reason, ''));
  dry_run              boolean := coalesce(p_dry_run, true);
  expected_token       text;
  row_value            jsonb;
  row_number           integer;
  title_value          text;
  permalink_value      text;
  canonical_permalink text;
  permalink_match      text[];
  shortcode_value      text;
  media_kind           text;
  published_text       text;
  published_value      timestamptz;
  track_name           text;
  track_value          smallint;
  idea_type_name       text;
  idea_type_value      smallint;
  caption_value        text;
  notes_value          text;
  partner_value        jsonb;
  partner_name         text;
  partner_id           smallint;
  partner_matches      integer;
  partner_ids          smallint[];
  row_errors           text[];
  forbidden_keys       text[];
  seen_lines           integer[] := '{}';
  seen_shortcodes      text[] := '{}';
  preview_rows         jsonb := '[]'::jsonb;
  normalized_rows      jsonb := '[]'::jsonb;
  total_rows           integer := 0;
  valid_rows           integer := 0;
  invalid_rows         integer := 0;
  intended_new_slots   integer := 0;
  created_slots        integer := 0;
  reused_slots         integer := 0;
  inserted_items       integer := 0;
  inserted_transitions integer := 0;
  normalized_row       jsonb;
  slot_value           uuid;
  item_value           public.items;
  inserted_refs        jsonb := '[]'::jsonb;
begin
  perform public.assert_can_use_app();

  if not public.is_admin() then
    raise exception 'ROLE_REQUIRED: الاستيراد التاريخي يحتاج دور أدمن';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_PAYLOAD: الصفوف يجب أن تكون قائمة';
  end if;

  total_rows := jsonb_array_length(p_rows);
  if total_rows < 1 or total_rows > 200 then
    raise exception 'ROW_LIMIT: يجب أن يحتوي الملف على 1 إلى 200 صف';
  end if;

  if octet_length(p_rows::text) > 2097152 then
    raise exception 'PAYLOAD_TOO_LARGE: حجم بيانات الاستيراد يتجاوز 2 MiB';
  end if;

  if source_filename = '' or char_length(source_filename) > 255 then
    raise exception 'INVALID_SOURCE_FILENAME: اسم ملف المصدر غير صحيح';
  end if;

  if source_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_SOURCE_SHA256: بصمة ملف المصدر غير صحيحة';
  end if;

  if not dry_run and (char_length(reason) < 5 or char_length(reason) > 500) then
    raise exception 'REASON_REQUIRED: سبب الاستيراد يجب أن يكون بين 5 و500 محرف';
  end if;

  expected_token := encode(
    digest(convert_to(source_sha256 || E'\n' || p_rows::text, 'UTF8'), 'sha256'),
    'hex'
  );

  if not dry_run then
    if coalesce(btrim(p_preview_token), '') <> expected_token then
      raise exception 'PREVIEW_REQUIRED: يجب اعتماد معاينة مطابقة قبل الاستيراد';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('ig-tracker:historical-import:v1', 0));
  end if;

  for row_value in select value from jsonb_array_elements(p_rows)
  loop
    row_errors := '{}';
    row_number := null;
    title_value := null;
    permalink_value := null;
    canonical_permalink := null;
    shortcode_value := null;
    media_kind := null;
    published_text := null;
    published_value := null;
    track_name := null;
    track_value := null;
    idea_type_name := null;
    idea_type_value := null;
    caption_value := null;
    notes_value := null;
    partner_ids := '{}';

    if jsonb_typeof(row_value) <> 'object' then
      row_errors := array_append(row_errors, 'الصف ليس سجلاً صالحاً');
    else
      select coalesce(array_agg(key order by key), '{}')
        into forbidden_keys
        from jsonb_object_keys(row_value) as keys(key)
       where not (key = any(array[
         'csv_line', 'title', 'permalink', 'published_at',
         'track', 'idea_type', 'partners', 'caption', 'notes'
       ]));
      if array_length(forbidden_keys, 1) is not null then
        row_errors := array_append(row_errors, 'حقول غير مسموحة: ' || array_to_string(forbidden_keys, ', '));
      end if;

      if jsonb_typeof(row_value -> 'csv_line') is distinct from 'number'
         or (row_value ->> 'csv_line') !~ '^[0-9]+$'
         or (row_value ->> 'csv_line')::numeric > 2147483647 then
        row_errors := array_append(row_errors, 'رقم سطر CSV غير صحيح');
      else
        row_number := (row_value ->> 'csv_line')::integer;
        if row_number < 2 then
          row_errors := array_append(row_errors, 'رقم سطر CSV يجب أن يبدأ من 2');
        elsif row_number = any(seen_lines) then
          row_errors := array_append(row_errors, 'رقم سطر CSV مكرر داخل الملف');
        else
          seen_lines := array_append(seen_lines, row_number);
        end if;
      end if;

      if jsonb_typeof(row_value -> 'title') is distinct from 'string' then
        row_errors := array_append(row_errors, 'العنوان مطلوب');
      else
        title_value := btrim(row_value ->> 'title');
        if title_value = '' or char_length(title_value) > 300 then
          row_errors := array_append(row_errors, 'العنوان يجب أن يكون بين 1 و300 محرف');
        end if;
      end if;

      if jsonb_typeof(row_value -> 'permalink') is distinct from 'string' then
        row_errors := array_append(row_errors, 'رابط إنستغرام مطلوب');
      else
        permalink_value := btrim(row_value ->> 'permalink');
        permalink_match := regexp_match(
          permalink_value,
          '^https://(?:www\.)?instagram\.com/(p|reel|tv)/([A-Za-z0-9_-]+)/?(?:[?#][^[:space:]]*)?$',
          'i'
        );
        if permalink_match is null then
          row_errors := array_append(row_errors, 'يجب أن يكون الرابط HTTPS من نوع p أو reel أو tv');
        else
          media_kind := lower(permalink_match[1]);
          shortcode_value := permalink_match[2];
          canonical_permalink := 'https://www.instagram.com/' || media_kind || '/' || shortcode_value || '/';
          if shortcode_value = any(seen_shortcodes) then
            row_errors := array_append(row_errors, 'رابط إنستغرام مكرر داخل الملف');
          else
            seen_shortcodes := array_append(seen_shortcodes, shortcode_value);
          end if;
          if exists (
            select 1 from public.items
             where ig_shortcode = shortcode_value
                or ig_permalink = canonical_permalink
          ) then
            row_errors := array_append(row_errors, 'رابط إنستغرام موجود في المنصة');
          end if;
        end if;
      end if;

      if jsonb_typeof(row_value -> 'published_at') is distinct from 'string' then
        row_errors := array_append(row_errors, 'وقت النشر مطلوب');
      else
        published_text := btrim(row_value ->> 'published_at');
        if published_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$' then
          row_errors := array_append(row_errors, 'وقت النشر يجب أن يكون ISO-8601 كاملاً مع فرق التوقيت');
        else
          begin
            published_value := published_text::timestamptz;
          exception when others then
            row_errors := array_append(row_errors, 'وقت النشر غير صالح');
          end;
          if published_value >= timestamptz '2026-09-06T09:30:57+03:00' then
            row_errors := array_append(row_errors, 'وقت النشر خارج الحد التاريخي المعتمد');
          end if;
        end if;
      end if;

      if row_value ? 'track' and jsonb_typeof(row_value -> 'track') not in ('string', 'null') then
        row_errors := array_append(row_errors, 'المسار يجب أن يكون نصاً أو فارغاً');
      else
        track_name := nullif(btrim(coalesce(row_value ->> 'track', '')), '');
        if track_name is not null then
          select id into track_value from public.tracks where name = track_name;
          if track_value is null then
            row_errors := array_append(row_errors, 'المسار غير موجود بالاسم المطابق');
          end if;
        end if;
      end if;

      if row_value ? 'idea_type' and jsonb_typeof(row_value -> 'idea_type') not in ('string', 'null') then
        row_errors := array_append(row_errors, 'نوع الفكرة يجب أن يكون نصاً أو فارغاً');
      else
        idea_type_name := nullif(btrim(coalesce(row_value ->> 'idea_type', '')), '');
        if idea_type_name is not null then
          select id into idea_type_value
            from public.idea_types
           where name = idea_type_name and active;
          if idea_type_value is null then
            row_errors := array_append(row_errors, 'نوع الفكرة غير موجود بالاسم المطابق أو غير نشط');
          end if;
        end if;
      end if;

      if row_value ? 'caption' and jsonb_typeof(row_value -> 'caption') not in ('string', 'null') then
        row_errors := array_append(row_errors, 'الكابشن يجب أن يكون نصاً أو فارغاً');
      else
        caption_value := nullif(btrim(coalesce(row_value ->> 'caption', '')), '');
        if char_length(coalesce(caption_value, '')) > 2200 then
          row_errors := array_append(row_errors, 'الكابشن يتجاوز 2200 محرف');
        end if;
      end if;

      if row_value ? 'notes' and jsonb_typeof(row_value -> 'notes') not in ('string', 'null') then
        row_errors := array_append(row_errors, 'الملاحظات يجب أن تكون نصاً أو فارغة');
      else
        notes_value := nullif(btrim(coalesce(row_value ->> 'notes', '')), '');
        if char_length(coalesce(notes_value, '')) > 2000 then
          row_errors := array_append(row_errors, 'الملاحظات تتجاوز 2000 محرف');
        end if;
      end if;

      if row_value ? 'partners' and jsonb_typeof(row_value -> 'partners') not in ('array', 'null') then
        row_errors := array_append(row_errors, 'الشركاء يجب أن يكونوا قائمة');
      elsif jsonb_typeof(row_value -> 'partners') = 'array' then
        if jsonb_array_length(row_value -> 'partners') > 20 then
          row_errors := array_append(row_errors, 'عدد الشركاء يتجاوز 20');
        else
          for partner_value in select value from jsonb_array_elements(row_value -> 'partners')
          loop
            if jsonb_typeof(partner_value) <> 'string' or btrim(partner_value #>> '{}') = '' then
              row_errors := array_append(row_errors, 'اسم شريك غير صالح');
              continue;
            end if;
            partner_name := btrim(partner_value #>> '{}');
            select count(*), min(id)
              into partner_matches, partner_id
              from public.partners
             where active
               and (name = partner_name or partner_name = any(aliases));
            if partner_matches = 0 then
              row_errors := array_append(row_errors, 'الشريك غير موجود بالاسم أو الاسم البديل المطابق: ' || partner_name);
            elsif partner_matches > 1 then
              row_errors := array_append(row_errors, 'اسم الشريك ملتبس: ' || partner_name);
            elsif partner_id = any(partner_ids) then
              row_errors := array_append(row_errors, 'الشريك مكرر في الصف: ' || partner_name);
            else
              partner_ids := array_append(partner_ids, partner_id);
            end if;
          end loop;
        end if;
      end if;
    end if;

    if array_length(row_errors, 1) is null then
      valid_rows := valid_rows + 1;
      normalized_row := jsonb_build_object(
        'csv_line', row_number,
        'title', title_value,
        'permalink', canonical_permalink,
        'shortcode', shortcode_value,
        'published_at', published_value,
        'track_id', track_value,
        'track', track_name,
        'idea_type_id', idea_type_value,
        'idea_type', idea_type_name,
        'partner_ids', to_jsonb(partner_ids),
        'partners', coalesce(row_value -> 'partners', '[]'::jsonb),
        'caption', caption_value,
        'notes', notes_value
      );
      normalized_rows := normalized_rows || jsonb_build_array(normalized_row);
    else
      invalid_rows := invalid_rows + 1;
    end if;

    preview_rows := preview_rows || jsonb_build_array(jsonb_build_object(
      'csv_line', row_number,
      'valid', array_length(row_errors, 1) is null,
      'errors', to_jsonb(row_errors),
      'resolved', jsonb_build_object(
        'title', title_value,
        'permalink', canonical_permalink,
        'published_at', published_value,
        'track', track_name,
        'idea_type', idea_type_name,
        'partners', coalesce(row_value -> 'partners', '[]'::jsonb)
      )
    ));
  end loop;

  select count(*)::integer
    into intended_new_slots
    from (
      select distinct (value ->> 'published_at')::timestamptz as slot_at
        from jsonb_array_elements(normalized_rows)
    ) proposed
   where not exists (
     select 1 from public.publishing_slots existing where existing.slot_at = proposed.slot_at
   );

  if dry_run then
    return jsonb_build_object(
      'ok', invalid_rows = 0,
      'dry_run', true,
      'preview_token', expected_token,
      'source_filename', source_filename,
      'source_sha256', source_sha256,
      'total_rows', total_rows,
      'valid_rows', valid_rows,
      'invalid_rows', invalid_rows,
      'intended_items', valid_rows,
      'intended_new_slots', intended_new_slots,
      'rows', preview_rows
    );
  end if;

  if invalid_rows > 0 then
    raise exception 'VALIDATION_FAILED: لا يمكن تطبيق ملف يحتوي على صفوف غير صالحة';
  end if;

  batch_id := gen_random_uuid();

  for normalized_row in select value from jsonb_array_elements(normalized_rows)
  loop
    insert into public.publishing_slots (slot_at, state, note)
    values (
      (normalized_row ->> 'published_at')::timestamptz,
      'published',
      'موعد تاريخي من استيراد CSV'
    )
    on conflict (slot_at) do nothing
    returning id into slot_value;

    if slot_value is null then
      reused_slots := reused_slots + 1;
      select id into slot_value
        from public.publishing_slots
       where slot_at = (normalized_row ->> 'published_at')::timestamptz
       for update;
    else
      created_slots := created_slots + 1;
    end if;

    insert into public.items (
      title,
      track_id,
      idea_type_id,
      caption,
      notes,
      status,
      slot_id,
      ig_permalink,
      published_at,
      is_archived,
      created_by
    )
    values (
      normalized_row ->> 'title',
      nullif(normalized_row ->> 'track_id', '')::smallint,
      nullif(normalized_row ->> 'idea_type_id', '')::smallint,
      nullif(normalized_row ->> 'caption', ''),
      nullif(normalized_row ->> 'notes', ''),
      'published',
      slot_value,
      normalized_row ->> 'permalink',
      (normalized_row ->> 'published_at')::timestamptz,
      false,
      actor_id
    )
    returning * into item_value;

    inserted_items := inserted_items + 1;

    insert into public.item_partners (item_id, partner_id, added_by)
    select item_value.id, value::smallint, actor_id
      from jsonb_array_elements_text(normalized_row -> 'partner_ids');

    insert into public.transitions (
      item_id,
      from_status,
      to_status,
      actor_id,
      is_override,
      override_reason,
      note
    )
    values (
      item_value.id,
      null,
      'published',
      actor_id,
      true,
      reason,
      jsonb_build_object(
        'kind', 'historical_csv_import',
        'batch_id', batch_id,
        'source_sha256', source_sha256,
        'csv_line', (normalized_row ->> 'csv_line')::integer
      )::text
    );

    inserted_transitions := inserted_transitions + 1;
    perform public.refresh_slot_state(slot_value);
    inserted_refs := inserted_refs || jsonb_build_array(jsonb_build_object(
      'id', item_value.id,
      'ref', item_value.ref,
      'csv_line', (normalized_row ->> 'csv_line')::integer
    ));
    slot_value := null;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'batch_id', batch_id,
    'source_filename', source_filename,
    'source_sha256', source_sha256,
    'inserted_items', inserted_items,
    'created_slots', created_slots,
    'reused_slots', reused_slots,
    'inserted_transitions', inserted_transitions,
    'items', inserted_refs
  );
end
$$;

revoke execute on function public.admin_import_historical_items(jsonb, text, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.admin_import_historical_items(jsonb, text, text, text, boolean, text)
  to authenticated;
