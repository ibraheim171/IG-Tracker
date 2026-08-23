-- ============================================================================
-- 0006_fix_ensure_slots_timezone.sql
--
-- Keep slot generation tied to the publishing calendar, not the caller session
-- timezone. Slots remain Mon / Tue / Sat at 21:00 in Asia/Hebron.
-- ============================================================================

create or replace function ensure_slots(p_weeks integer default 8)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with bounds as (
    select
      (now() at time zone app_tz())::date as start_date,
      ((now() at time zone app_tz())::date + (p_weeks * 7)) as end_date
  ),
  gen as (
    select ((local_day + time '21:00') at time zone app_tz()) as slot_at
      from bounds
      cross join generate_series(bounds.start_date, bounds.end_date, interval '1 day') as day(local_day)
     where extract(isodow from local_day::date) in (1, 2, 6)
  )
  insert into publishing_slots (slot_at)
  select slot_at from gen
  on conflict (slot_at) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
