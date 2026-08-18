-- ============================================================================
-- 0002_functions.sql — every rule in the system, in one file.
--
-- Read this file and you know what the platform forbids. Nothing that changes
-- an item's status may live anywhere else: the UI calls these functions and
-- nothing but these functions.
-- ============================================================================

-- Publishing timezone. One constant, one place. Verify before first deploy.
create or replace function app_tz() returns text
  language sql immutable as $$ select 'Asia/Hebron'::text $$;

-- How many approvals close the content gate. The two sheet approvals were merged
-- into one gate; raise this to 2 if a second signature is ever required again.
create or replace function content_gate_signatures() returns integer
  language sql immutable as $$ select 1 $$;

-- ============================== IDENTITY HELPERS ==============================
-- SECURITY DEFINER so RLS policies can call them without recursing on profiles.

create or replace function has_role(p_role role_name)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and active and p_role = any(roles)
  );
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('admin');
$$;

create or replace function is_participant(p_item uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from item_participants
                 where item_id = p_item and user_id = auth.uid())
      or exists (select 1 from items
                 where id = p_item and created_by = auth.uid());
$$;

create or replace function me()
returns profiles language sql stable security definer set search_path = public as $$
  select * from profiles where id = auth.uid();
$$;

-- ============================== GUARDS ==============================

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_items_touch   before update on items
  for each row execute function touch_updated_at();
create trigger trg_reports_touch before update on reports
  for each row execute function touch_updated_at();

-- Archived months are excluded from EVERYTHING, including writes. This is the
-- one rule an admin cannot override: an archive that can be edited is not an
-- archive, and last time it was edited the year-over-year comparison broke.
create or replace function guard_archived() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.is_archived then
      raise exception 'ARCHIVED_IMMUTABLE: المادة في شهر مؤرشف ولا يمكن حذفها';
    end if;
    return old;
  end if;
  if old.is_archived and new.is_archived then
    raise exception 'ARCHIVED_IMMUTABLE: المادة في شهر مؤرشف ولا يمكن تعديلها';
  end if;
  return new;
end $$;

create trigger trg_items_archived before update or delete on items
  for each row execute function guard_archived();

-- status / ref / published_at / is_archived move only through the RPC functions
-- below, which raise a transaction-local flag before writing. Any other path —
-- a stray UPDATE from the client, a well-meant patch in a screen — is rejected.
create or replace function guard_item_columns() returns trigger
language plpgsql as $$
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
  if new.published_at is distinct from old.published_at then
    raise exception 'USE_RPC: وقت النشر يُكتب من mark_published';
  end if;
  if new.is_archived is distinct from old.is_archived then
    raise exception 'IMMUTABLE_COLUMN: is_archived';
  end if;
  return new;
end $$;

create trigger trg_items_columns before update on items
  for each row execute function guard_item_columns();

-- ============================== TRANSITION MAP ==============================

create or replace function allowed_edge(p_from item_status, p_to item_status)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('idea',             'writing'),
    ('writing',          'content_approved'),
    ('content_approved', 'in_production'),
    ('in_production',    'design_approved'),
    ('design_approved',  'ready'),
    ('ready',            'published'),
    ('idea',             'cancelled'),
    ('writing',          'cancelled'),
    ('content_approved', 'cancelled'),
    ('in_production',    'cancelled'),
    ('design_approved',  'cancelled'),
    ('ready',            'cancelled'),
    ('cancelled',        'idea')
  );
$$;

-- ============================== RULE CHECK ==============================
-- Returns the list of broken rules, in Arabic, for a proposed move.
-- Empty array = the move is clean.

create or replace function item_violations(p_item uuid, p_to item_status)
returns text[] language plpgsql stable security definer set search_path = public as $$
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
    v := v || format('انتقال غير مسموح: %s ← %s', it.status, p_to);
  end if;

  if p_to = 'content_approved' then
    if coalesce(btrim(it.caption), '') = '' then
      v := v || 'لا إرسال للاعتماد بلا كابشن';
    end if;
    if it.track_id is null then
      v := v || 'المسار مطلوب من القائمة المغلقة';
    end if;
    if not (has_role('reviewer') or is_admin()) then
      v := v || 'الاعتماد يحتاج دور مراجع';
    end if;
  end if;

  if p_to = 'in_production' then
    select count(*) into n_producers
      from item_participants where item_id = p_item and part = 'producer';
    if n_producers = 0 then
      v := v || 'لا إنتاج بلا مسؤول إنتاج معيّن';
    end if;
  end if;

  if p_to = 'design_approved' then
    if coalesce(btrim(it.production_file_url), '') = '' then
      v := v || 'لا اعتماد تصميم بلا رابط ملف الإنتاج';
    end if;
    if not (has_role('reviewer') or is_admin()) then
      v := v || 'اعتماد التصميم يحتاج دور مراجع';
    end if;
  end if;

  -- Gate 3 is a system gate: no human signs it, the data does.
  if p_to = 'ready' then
    if coalesce(btrim(it.caption), '') = '' then
      v := v || 'لا جاهز بلا كابشن';
    end if;
    if coalesce(btrim(it.production_file_url), '') = '' then
      v := v || 'لا جاهز بلا رابط ملف الإنتاج';
    end if;
    if it.slot_id is null then
      v := v || 'لا جاهز بلا فتحة نشر — التاريخ من الفتحات فقط';
    end if;
  end if;

  if p_to = 'published' then
    v := v || 'النشر يمر عبر mark_published() لا عبر advance_item()';
  end if;

  return v;
end $$;

-- ============================== ADVANCE ==============================

create or replace function advance_item(
  p_item            uuid,
  p_to              item_status,
  p_note            text default null,
  p_override_reason text default null
) returns items
language plpgsql security definer set search_path = public as $$
declare
  it   items;
  v    text[];
  ovr  boolean := false;
  prev item_status;
begin
  select * into it from items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then
    raise exception 'ARCHIVED_IMMUTABLE: المادة في شهر مؤرشف';
  end if;
  prev := it.status;   -- captured before the UPDATE overwrites the record
  perform set_config('app.rpc', 'on', true);   -- transaction-local, see guard_item_columns()

  v := item_violations(p_item, p_to);

  if array_length(v, 1) > 0 then
    if is_admin() and coalesce(btrim(p_override_reason), '') <> '' then
      ovr := true;                       -- allowed, and recorded below
    else
      raise exception 'RULE_VIOLATION: %', array_to_string(v, ' · ');
    end if;
  end if;

  update items set status = p_to where id = p_item returning * into it;

  if p_to in ('content_approved', 'design_approved') then
    insert into approvals (item_id, gate, result, actor_id, note)
    values (p_item,
            case when p_to = 'content_approved' then 'content'::approval_gate
                 else 'design'::approval_gate end,
            'approve', auth.uid(), p_note);
  end if;

  insert into transitions (item_id, from_status, to_status, actor_id,
                           is_override, override_reason, violations, note)
  values (p_item, prev, p_to, auth.uid(),
          ovr, nullif(btrim(coalesce(p_override_reason, '')), ''),
          nullif(v, '{}'), p_note);

  return it;
end $$;

-- ============================== REJECT ==============================
-- A rejection always carries a note and always names where the item went back to.

create or replace function reject_item(
  p_item uuid,
  p_gate approval_gate,
  p_note text
) returns items
language plpgsql security definer set search_path = public as $$
declare
  it   items;
  back item_status;
begin
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'NOTE_REQUIRED: الإعادة تحتاج ملاحظة مكتوبة';
  end if;
  if not (has_role('reviewer') or is_admin()) then
    raise exception 'ROLE_REQUIRED: الإعادة تحتاج دور مراجع';
  end if;

  select * into it from items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then raise exception 'ARCHIVED_IMMUTABLE'; end if;

  perform set_config('app.rpc', 'on', true);

  back := case p_gate when 'content' then 'writing'::item_status
                      else 'in_production'::item_status end;

  insert into approvals (item_id, gate, result, actor_id, note)
  values (p_item, p_gate, 'reject', auth.uid(), p_note);

  insert into transitions (item_id, from_status, to_status, actor_id, note)
  values (p_item, it.status, back, auth.uid(), p_note);

  update items set status = back where id = p_item returning * into it;
  return it;
end $$;

-- ============================== PUBLISH ==============================
-- The button on the "جاهز للنشر" screen. It stamps the real time and takes the
-- permalink in the same call, because the gap between publishing and pasting the
-- link is exactly where 110 posts went undocumented.

create or replace function mark_published(
  p_item            uuid,
  p_permalink       text,
  p_at              timestamptz default now(),
  p_override_reason text default null
) returns items
language plpgsql security definer set search_path = public as $$
declare
  it  items;
  v   text[] := '{}';
  ovr boolean := false;
begin
  select * into it from items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then raise exception 'ARCHIVED_IMMUTABLE'; end if;

  if it.status <> 'ready' then
    v := v || format('المادة ليست جاهزة للنشر (%s)', it.status);
  end if;
  if coalesce(btrim(p_permalink), '') = '' then
    v := v || 'رابط المنشور مطلوب عند تعليم النشر';
  elsif p_permalink !~ '^https?://(www\.)?instagram\.com/(p|reel|tv)/[^/?#]+' then
    v := v || 'الرابط ليس رابط منشور إنستغرام صالحاً';
  elsif exists (select 1 from items where ig_permalink = p_permalink and id <> p_item) then
    v := v || 'هذا الرابط مربوط بمادة أخرى';
  end if;

  if array_length(v, 1) > 0 then
    if is_admin() and coalesce(btrim(p_override_reason), '') <> '' then
      ovr := true;
    else
      raise exception 'RULE_VIOLATION: %', array_to_string(v, ' · ');
    end if;
  end if;

  perform set_config('app.rpc', 'on', true);

  insert into transitions (item_id, from_status, to_status, actor_id,
                           is_override, override_reason, violations)
  values (p_item, it.status, 'published', auth.uid(),
          ovr, nullif(btrim(coalesce(p_override_reason, '')), ''), nullif(v, '{}'));

  update items
     set status       = 'published',
         published_at = p_at,
         ig_permalink = nullif(btrim(p_permalink), '')
   where id = p_item
   returning * into it;

  update publishing_slots set state = 'published' where id = it.slot_id;
  return it;
end $$;

-- ============================== SLOTS ==============================
-- Mon / Tue / Sat at 21:00 local. Run weekly by cron; safe to re-run.

create or replace function ensure_slots(p_weeks integer default 8)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with gen as (
    select ((d::date + time '21:00') at time zone app_tz()) as slot_at
      from generate_series(current_date, current_date + (p_weeks * 7), interval '1 day') d
     where extract(isodow from d) in (1, 2, 6)   -- Mon, Tue, Sat
  )
  insert into publishing_slots (slot_at)
  select slot_at from gen
  on conflict (slot_at) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function assign_slot(p_item uuid, p_slot uuid)
returns items
language plpgsql security definer set search_path = public as $$
declare it items;
begin
  if not (is_participant(p_item) or is_admin()) then
    raise exception 'FORBIDDEN: لست مشاركاً في هذه المادة';
  end if;
  update items set slot_id = p_slot where id = p_item returning * into it;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  update publishing_slots set state = 'assigned'
   where id = p_slot and state = 'open';
  return it;
end $$;
