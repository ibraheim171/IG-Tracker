-- ============================================================================
-- 0009_security_hardening.sql — tighten Data API and RPC privileges
--
-- This migration does not change data, workflow states, gate rules, archived-item
-- protection, override behavior, or the publishing slot cadence.
-- ============================================================================

-- Migration scratch tables are kept as historical migration trace, but they are
-- not part of the application Data API surface.
do $$
begin
  if to_regclass('public._mig_partners') is not null then
    alter table public._mig_partners enable row level security;
    revoke all privileges on table public._mig_partners from public, anon, authenticated;
  end if;

  if to_regclass('public._mig_people') is not null then
    alter table public._mig_people enable row level security;
    revoke all privileges on table public._mig_people from public, anon, authenticated;
  end if;

  if to_regclass('public._mig_people_map') is not null then
    alter table public._mig_people_map enable row level security;
    revoke all privileges on table public._mig_people_map from public, anon, authenticated;
  end if;
end $$;

-- The publishing action is limited at the database layer to profile admins until
-- a separate publisher role exists.
create or replace function public.mark_published(
  p_item            uuid,
  p_permalink       text,
  p_at              timestamptz default now(),
  p_override_reason text default null
) returns public.items
language plpgsql security definer set search_path = public as $$
declare
  it  items;
  v   text[] := '{}';
  ovr boolean := false;
begin
  if not is_admin() then
    raise exception 'ROLE_REQUIRED: تعليم النشر يحتاج دور أدمن';
  end if;

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

-- Slot generation remains callable by server-side service-role automation and by
-- authenticated profile admins only. End users without the admin role fail here,
-- not in the UI.
create or replace function public.ensure_slots(p_weeks integer default 8)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_admin() then
    raise exception 'ROLE_REQUIRED: توليد مواعيد النشر يحتاج دور أدمن';
  end if;

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

-- Remove anonymous execute access from SECURITY DEFINER functions. Revoke from
-- authenticated first, then grant back only what the UI and RLS policies need.
revoke execute on function public.advance_item(uuid, public.item_status, text, text) from public, anon, authenticated;
revoke execute on function public.assign_slot(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ensure_slots(integer) from public, anon, authenticated;
revoke execute on function public.has_role(public.role_name) from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon, authenticated;
revoke execute on function public.is_participant(uuid) from public, anon, authenticated;
revoke execute on function public.item_violations(uuid, public.item_status) from public, anon, authenticated;
revoke execute on function public.mark_published(uuid, text, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.me() from public, anon, authenticated;
revoke execute on function public.reject_item(uuid, public.approval_gate, text) from public, anon, authenticated;

grant execute on function public.advance_item(uuid, public.item_status, text, text) to authenticated;
grant execute on function public.assign_slot(uuid, uuid) to authenticated;
grant execute on function public.ensure_slots(integer) to authenticated;
grant execute on function public.has_role(public.role_name) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_participant(uuid) to authenticated;
grant execute on function public.mark_published(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.me() to authenticated;
grant execute on function public.reject_item(uuid, public.approval_gate, text) to authenticated;

-- Remove mutable search_path warnings without rewriting these functions.
alter function public.allowed_edge(public.item_status, public.item_status) set search_path = public;
alter function public.app_tz() set search_path = public;
alter function public.content_gate_signatures() set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.guard_archived() set search_path = public;
alter function public.guard_item_columns() set search_path = public;
