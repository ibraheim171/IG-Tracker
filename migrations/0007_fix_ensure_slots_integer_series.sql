-- ============================================================================
-- 0007_fix_ensure_slots_integer_series.sql
--
-- Avoid timestamp/date generate_series overloads because they can inherit the
-- caller session timezone. Calendar math is done as date + integer offsets.
-- ============================================================================

create or replace function ensure_slots(p_weeks integer default 8)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with bounds as (
    select (now() at time zone app_tz())::date as start_date
  ),
  gen as (
    select ((local_day + time '21:00') at time zone app_tz()) as slot_at
      from bounds
      cross join generate_series(0, p_weeks * 7) as offset_days(day_offset)
      cross join lateral (
        select bounds.start_date + offset_days.day_offset as local_day
      ) as days
     where extract(isodow from local_day) in (1, 2, 6)
  )
  insert into publishing_slots (slot_at)
  select slot_at from gen
  on conflict (slot_at) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
