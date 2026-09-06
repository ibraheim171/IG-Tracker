-- ============================================================================
-- admin_historical_csv_import.sql — one-shot, admin-only historical backfill
--
-- This deliberately does not call the normal draft or workflow RPCs. It creates
-- already-published historical records, while leaving every future-content path
-- and direct-write restriction unchanged.
-- ============================================================================

create schema if not exists extensions;
revoke create on schema extensions from public, anon, authenticated;
create extension if not exists pgcrypto with schema extensions;

do $extension_guard$
declare
  extension_schema text;
begin
  select namespace.nspname
    into extension_schema
    from pg_catalog.pg_extension extension
    join pg_catalog.pg_namespace namespace on namespace.oid = extension.extnamespace
   where extension.extname = 'pgcrypto';

  if extension_schema is distinct from 'extensions' then
    raise exception 'PGCRYPTO_SCHEMA_MISMATCH: expected extensions, found %', coalesce(extension_schema, 'missing');
  end if;
  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null
     or pg_catalog.to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'PGCRYPTO_FUNCTIONS_MISSING: digest(bytea,text) and gen_random_bytes(integer) are required';
  end if;
end
$extension_guard$;

create or replace function public.parse_instagram_permalink(p_permalink text)
returns jsonb
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
declare
  permalink_match text[];
  media_kind text;
  shortcode text;
begin
  permalink_match := pg_catalog.regexp_match(
    pg_catalog.btrim(p_permalink),
    '^https?://(?:www\.)?instagram\.com/(p|reel|tv)/([A-Za-z0-9_-]+)/?(?:[?#][^[:space:]]*)?$',
    'i'
  );
  if permalink_match is null then
    return null;
  end if;

  media_kind := pg_catalog.lower(permalink_match[1]);
  shortcode := permalink_match[2];
  return pg_catalog.jsonb_build_object(
    'media_kind', media_kind,
    'shortcode', shortcode,
    'permalink', 'https://www.instagram.com/' || media_kind || '/' || shortcode || '/'
  );
end
$$;

revoke execute on function public.parse_instagram_permalink(text) from public, anon, authenticated;

create table public.historical_import_control (
  singleton            boolean primary key default true check (singleton),
  preview_token_hash   bytea,
  preview_actor_id     uuid,
  preview_payload_hash bytea,
  preview_expires_at   timestamptz,
  preview_used_at      timestamptz,
  applied_at           timestamptz,
  applied_batch_id     uuid unique,
  applied_by           uuid,
  source_sha256        text
);

alter table public.historical_import_control enable row level security;
revoke all on table public.historical_import_control from public, anon, authenticated;
insert into public.historical_import_control (singleton) values (true);

do $identity_guard$
declare
  duplicate_shortcode text;
begin
  if pg_catalog.to_regclass('public.ux_items_shortcode') is null then
    raise exception 'SHORTCODE_UNIQUE_INDEX_MISSING: public.ux_items_shortcode is required';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_index index_record
      join pg_catalog.pg_class index_class on index_class.oid = index_record.indexrelid
      join pg_catalog.pg_class table_class on table_class.oid = index_record.indrelid
      join pg_catalog.pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
      join pg_catalog.pg_attribute attribute
        on attribute.attrelid = table_class.oid
       and attribute.attnum = any(index_record.indkey)
     where table_namespace.nspname = 'public'
       and table_class.relname = 'items'
       and index_class.relname = 'ux_items_shortcode'
       and attribute.attname = 'ig_shortcode'
       and index_record.indisunique
       and index_record.indisvalid
       and index_record.indnkeyatts = 1
       and pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid) ~* 'ig_shortcode IS NOT NULL'
  ) then
    raise exception 'SHORTCODE_UNIQUE_INDEX_INVALID: expected a valid partial unique index on public.items(ig_shortcode)';
  end if;

  select candidate.shortcode
    into duplicate_shortcode
    from (
      select coalesce(
               item.ig_shortcode,
               public.parse_instagram_permalink(item.ig_permalink) ->> 'shortcode'
             ) as shortcode
        from public.items item
       where item.ig_permalink is not null
    ) candidate
   where candidate.shortcode is not null
   group by candidate.shortcode
  having count(*) > 1
   limit 1;

  if duplicate_shortcode is not null then
    raise exception 'EXISTING_INSTAGRAM_DUPLICATE: shortcode % already identifies multiple items', duplicate_shortcode;
  end if;
end
$identity_guard$;

create or replace function public.mark_published(
  p_item            uuid,
  p_permalink       text,
  p_at              timestamptz default pg_catalog.now(),
  p_override_reason text default null
) returns public.items
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  item_record public.items;
  violations text[] := '{}';
  is_override boolean := false;
  parsed_permalink jsonb;
  canonical_permalink text;
  shortcode text;
begin
  perform public.assert_can_use_app();

  if not public.can_publish_items() then
    raise exception 'ROLE_REQUIRED: تعليم النشر يحتاج مسؤول النشر أو الأدمن';
  end if;

  select * into item_record from public.items where id = p_item for update;
  if item_record.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if item_record.is_archived then raise exception 'ARCHIVED_IMMUTABLE'; end if;

  parsed_permalink := public.parse_instagram_permalink(p_permalink);
  if parsed_permalink is null then
    raise exception 'RULE_VIOLATION: الرابط ليس رابط منشور إنستغرام صالحاً';
  end if;
  canonical_permalink := parsed_permalink ->> 'permalink';
  shortcode := parsed_permalink ->> 'shortcode';

  if exists (
    select 1
      from public.items existing
     where existing.id <> p_item
       and (
         existing.ig_shortcode = shortcode
         or (
           existing.ig_shortcode is null
           and public.parse_instagram_permalink(existing.ig_permalink) ->> 'shortcode' = shortcode
         )
       )
  ) then
    raise exception 'RULE_VIOLATION: هذا الرابط مربوط بمادة أخرى';
  end if;

  if item_record.status <> 'ready' then
    violations := pg_catalog.array_append(violations, pg_catalog.format('المادة ليست جاهزة للنشر (%s)', item_record.status));
  end if;

  if pg_catalog.array_length(violations, 1) > 0 then
    if public.is_admin() and coalesce(pg_catalog.btrim(p_override_reason), '') <> '' then
      is_override := true;
    else
      raise exception 'RULE_VIOLATION: %', pg_catalog.array_to_string(violations, ' · ');
    end if;
  end if;

  perform pg_catalog.set_config('app.rpc', 'on', true);

  insert into public.transitions (item_id, from_status, to_status, actor_id,
                                  is_override, override_reason, violations)
  values (p_item, item_record.status, 'published', auth.uid(),
          is_override, nullif(pg_catalog.btrim(coalesce(p_override_reason, '')), ''), nullif(violations, '{}'));

  update public.items
     set status = 'published',
         published_at = p_at,
         ig_permalink = canonical_permalink
   where id = p_item
   returning * into item_record;

  perform public.refresh_slot_state(item_record.slot_id);
  return item_record;
end
$$;

revoke execute on function public.mark_published(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.mark_published(uuid, text, timestamptz, text) to authenticated;

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
set search_path = pg_catalog
as $$
declare
  actor_id             uuid := auth.uid();
  batch_id             uuid;
  source_filename      text := btrim(coalesce(p_source_filename, ''));
  source_sha256_value  text := lower(btrim(coalesce(p_source_sha256, '')));
  reason               text := btrim(coalesce(p_reason, ''));
  dry_run              boolean := coalesce(p_dry_run, true);
  payload_hash         bytea;
  supplied_token_hash  bytea;
  raw_preview_token    text;
  preview_expiry       timestamptz;
  control_record       public.historical_import_control%rowtype;
  row_value            jsonb;
  row_number           integer;
  title_value          text;
  permalink_value      text;
  canonical_permalink text;
  parsed_permalink     jsonb;
  shortcode_value      text;
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

  if source_sha256_value !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_SOURCE_SHA256: بصمة ملف المصدر غير صحيحة';
  end if;

  if not dry_run and (char_length(reason) < 5 or char_length(reason) > 500) then
    raise exception 'REASON_REQUIRED: سبب الاستيراد يجب أن يكون بين 5 و500 محرف';
  end if;

  payload_hash := extensions.digest(
    pg_catalog.convert_to(source_filename || E'\n' || source_sha256_value || E'\n' || p_rows::text, 'UTF8'),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ig-tracker:historical-import:v2', 0)
  );
  select * into control_record
    from public.historical_import_control
   where singleton
   for update;
  if control_record.singleton is null then
    raise exception 'IMPORT_CONTROL_MISSING: historical import control row is missing';
  end if;
  if control_record.applied_at is not null then
    raise exception 'IMPORT_CLOSED: تم تطبيق دفعة الاستيراد التاريخي مسبقاً وأُغلقت الأداة';
  end if;

  if not dry_run then
    if coalesce(pg_catalog.btrim(p_preview_token), '') !~ '^[0-9a-f]{64}$' then
      raise exception 'PREVIEW_REQUIRED: يجب إجراء معاينة صالحة قبل الاستيراد';
    end if;
    supplied_token_hash := extensions.digest(
      pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(p_preview_token)), 'UTF8'),
      'sha256'
    );
    if control_record.preview_token_hash is distinct from supplied_token_hash then
      raise exception 'PREVIEW_REQUIRED: رمز المعاينة غير صالح';
    end if;
    if control_record.preview_actor_id is distinct from actor_id then
      raise exception 'PREVIEW_ACTOR_MISMATCH: رمز المعاينة مرتبط بأدمن آخر';
    end if;
    if control_record.preview_payload_hash is distinct from payload_hash then
      raise exception 'PREVIEW_INPUT_MISMATCH: محتوى الاستيراد لا يطابق المعاينة';
    end if;
    if control_record.preview_used_at is not null then
      raise exception 'PREVIEW_ALREADY_USED: رمز المعاينة استُخدم مسبقاً';
    end if;
    if control_record.preview_expires_at is null
       or control_record.preview_expires_at <= pg_catalog.clock_timestamp() then
      raise exception 'PREVIEW_EXPIRED: انتهت صلاحية المعاينة';
    end if;
  end if;

  for row_value in select value from jsonb_array_elements(p_rows)
  loop
    row_errors := '{}';
    row_number := null;
    title_value := null;
    permalink_value := null;
    canonical_permalink := null;
    parsed_permalink := null;
    shortcode_value := null;
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
        parsed_permalink := public.parse_instagram_permalink(permalink_value);
        if parsed_permalink is null then
          row_errors := array_append(row_errors, 'يجب أن يكون الرابط من instagram.com ومن نوع p أو reel أو tv دون مسار إضافي');
        else
          shortcode_value := parsed_permalink ->> 'shortcode';
          canonical_permalink := parsed_permalink ->> 'permalink';
          if shortcode_value = any(seen_shortcodes) then
            row_errors := array_append(row_errors, 'رابط إنستغرام مكرر داخل الملف');
          else
            seen_shortcodes := array_append(seen_shortcodes, shortcode_value);
          end if;
          if exists (
            select 1 from public.items existing
             where existing.ig_shortcode = shortcode_value
                or (
                  existing.ig_shortcode is null
                  and public.parse_instagram_permalink(existing.ig_permalink) ->> 'shortcode' = shortcode_value
                )
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
    raw_preview_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
    preview_expiry := pg_catalog.clock_timestamp() + interval '15 minutes';
    update public.historical_import_control
       set preview_token_hash = extensions.digest(
             pg_catalog.convert_to(raw_preview_token, 'UTF8'),
             'sha256'
           ),
           preview_actor_id = actor_id,
           preview_payload_hash = payload_hash,
           preview_expires_at = preview_expiry,
           preview_used_at = null
     where singleton;

    return jsonb_build_object(
      'ok', invalid_rows = 0,
      'dry_run', true,
      'preview_token', raw_preview_token,
      'preview_expires_at', preview_expiry,
      'source_filename', source_filename,
      'source_sha256', source_sha256_value,
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

  update public.historical_import_control
     set preview_used_at = pg_catalog.clock_timestamp()
   where singleton;

  batch_id := pg_catalog.gen_random_uuid();

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
        'source_sha256', source_sha256_value,
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

  update public.historical_import_control
     set applied_at = pg_catalog.clock_timestamp(),
         applied_batch_id = batch_id,
         applied_by = actor_id,
         source_sha256 = source_sha256_value
   where singleton;

  return jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'batch_id', batch_id,
    'source_filename', source_filename,
    'source_sha256', source_sha256_value,
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
