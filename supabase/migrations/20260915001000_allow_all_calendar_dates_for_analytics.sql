-- April and May are excluded only as archived legacy work-tracker tabs.
-- Calendar dates remain valid for Instagram analytics in every year.

alter table public.ig_account_range_snapshots
  drop constraint if exists ig_account_range_snapshots_check1;

create or replace function public.ingest_account_range_snapshots(
  p_rows jsonb,
  p_source_timestamp timestamptz,
  p_sync_run_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  received integer := 0;
  inserted integer := 0;
  identical integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) > 500 then
    raise exception 'INVALID_ACCOUNT_RANGE_PAYLOAD';
  end if;
  create temporary table pg_temp.account_range_incoming on commit drop as
  select x.snapshot_date, x.range_start, x.range_end,
    coalesce(nullif(btrim(x.source), ''), 'instagram_aggregate') as source,
    x.followers, x.reach, x.views, x.interactions, x.reach_followers,
    x.reach_non_followers, x.follows, x.unfollows,
    public.normalize_analytics_metric_names(x.missing_metrics) as missing_metrics,
    p_source_timestamp as source_timestamp, p_sync_run_id as sync_run_id
  from jsonb_to_recordset(p_rows) as x(
    snapshot_date date, range_start date, range_end date, source text,
    followers integer, reach integer, views integer, interactions integer,
    reach_followers integer, reach_non_followers integer, follows integer,
    unfollows integer, missing_metrics text[]
  );
  if exists (select 1 from pg_temp.account_range_incoming where snapshot_date is null or range_start is null or range_end is null or range_start > range_end or source not in ('instagram_aggregate', 'manual_verified') or (followers is null and reach is null and views is null and interactions is null and reach_followers is null and reach_non_followers is null and follows is null and unfollows is null) or coalesce(followers, 0) < 0 or coalesce(reach, 0) < 0 or coalesce(views, 0) < 0 or coalesce(interactions, 0) < 0 or coalesce(reach_followers, 0) < 0 or coalesce(reach_non_followers, 0) < 0 or coalesce(follows, 0) < 0 or coalesce(unfollows, 0) < 0) then
    raise exception 'INVALID_ACCOUNT_RANGE_ROW';
  end if;
  lock table public.ig_account_range_snapshots in share row exclusive mode;
  if exists (select 1 from pg_temp.account_range_incoming t join public.ig_account_range_snapshots e using (snapshot_date, range_start, range_end, source) where row(e.followers, e.reach, e.views, e.interactions, e.reach_followers, e.reach_non_followers, e.follows, e.unfollows, public.normalize_analytics_metric_names(e.missing_metrics)) is distinct from row(t.followers, t.reach, t.views, t.interactions, t.reach_followers, t.reach_non_followers, t.follows, t.unfollows, t.missing_metrics)) then
    raise exception 'DIVERGENT_ACCOUNT_RANGE_SNAPSHOT';
  end if;
  select count(*) into received from pg_temp.account_range_incoming;
  select count(*) into inserted from pg_temp.account_range_incoming t where not exists (select 1 from public.ig_account_range_snapshots e where e.snapshot_date = t.snapshot_date and e.range_start = t.range_start and e.range_end = t.range_end and e.source = t.source);
  identical := received - inserted;
  insert into public.ig_account_range_snapshots (snapshot_date, range_start, range_end, source, followers, reach, views, interactions, reach_followers, reach_non_followers, follows, unfollows, missing_metrics, source_timestamp, sync_run_id)
  select t.snapshot_date, t.range_start, t.range_end, t.source, t.followers, t.reach, t.views, t.interactions, t.reach_followers, t.reach_non_followers, t.follows, t.unfollows, t.missing_metrics, t.source_timestamp, t.sync_run_id
  from pg_temp.account_range_incoming t
  where not exists (select 1 from public.ig_account_range_snapshots e where e.snapshot_date = t.snapshot_date and e.range_start = t.range_start and e.range_end = t.range_end and e.source = t.source);
  return jsonb_build_object('received_count', received, 'inserted_count', inserted, 'already_present_identical_count', identical);
end;
$function$;

revoke all on function public.ingest_account_range_snapshots(jsonb, timestamptz, uuid) from public;
grant execute on function public.ingest_account_range_snapshots(jsonb, timestamptz, uuid) to service_role;
drop function if exists public.analytics_range_crosses_excluded_months(date, date);
