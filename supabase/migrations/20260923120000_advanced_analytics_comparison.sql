create or replace function public.admin_advanced_analytics_comparison(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  if not public.is_active_user() or not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object' or octet_length(p_request::text) > 32768
    or jsonb_typeof(p_request -> 'metrics') <> 'array' or jsonb_array_length(p_request -> 'metrics') not between 1 and 7
    or jsonb_typeof(p_request -> 'cohorts') <> 'array' or jsonb_array_length(p_request -> 'cohorts') <> 2
    or coalesce(p_request ->> 'checkpoint', '') !~ '^(1|7|30)$' or coalesce(p_request ->> 'evaluated_at', '') = '' then
    raise exception 'INVALID_ADVANCED_COMPARISON';
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_request -> 'metrics') metric where metric not in ('reach','save_rate','share_rate','follow_rate','visit_rate','signal','item_count'))
    or (p_request #>> '{cohorts,0,key}') <> 'A' or (p_request #>> '{cohorts,1,key}') <> 'B' then
    raise exception 'INVALID_ADVANCED_COMPARISON';
  end if;

  with cohort_defs as (
    select c ->> 'key' as cohort_key, nullif(btrim(c ->> 'label'), '') as cohort_label,
      (c #>> '{range,start}')::date as range_start, (c #>> '{range,end}')::date as range_end,
      coalesce((select array_agg(value::smallint) from jsonb_array_elements_text(c -> 'track_ids') value), array[]::smallint[]) as track_ids,
      coalesce((select array_agg(value::smallint) from jsonb_array_elements_text(c -> 'partner_ids') value), array[]::smallint[]) as partner_ids,
      coalesce((select array_agg(value::smallint) from jsonb_array_elements_text(c -> 'idea_type_ids') value), array[]::smallint[]) as idea_type_ids,
      coalesce((select array_agg(value) from jsonb_array_elements_text(c -> 'media_types') value), array[]::text[]) as media_types,
      coalesce(c -> 'participants', '[]'::jsonb) as participants
    from jsonb_array_elements(p_request -> 'cohorts') c
  ), validated as (
    select * from cohort_defs
    where cohort_label is not null and length(cohort_label) <= 80 and range_start <= range_end and range_end - range_start <= 365
      and cardinality(track_ids) <= 20 and cardinality(partner_ids) <= 20 and cardinality(idea_type_ids) <= 20 and cardinality(media_types) <= 20
      and jsonb_typeof(participants) = 'array' and jsonb_array_length(participants) <= 20
      and not exists (select 1 from unnest(media_types) media_type where media_type not in ('IMAGE','CAROUSEL_ALBUM','VIDEO','REELS'))
      and not exists (
        select 1 from jsonb_array_elements(participants) participant
        where coalesce(participant ->> 'person_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          or participant ->> 'role' is not null and participant ->> 'role' not in ('writer','reviewer','producer')
      )
  ), metric_names as (
    select value as metric from jsonb_array_elements_text(p_request -> 'metrics')
  ), item_rows as (
    select c.cohort_key, c.cohort_label, i.id as item_id, i.ref, i.title, i.published_at as workflow_published_at,
      (i.published_at at time zone public.app_tz())::date as workflow_publish_date,
      link.media_id, post.published_at as instagram_published_at,
      case when post.product_type = 'REELS' then 'REELS' else post.media_type end as normalized_media_type,
      selected.snapshot_date, selected.age_days, selected.likes, selected.comments, selected.reach, selected.saved, selected.shares,
      selected.profile_visits, selected.follows, selected.missing_metrics, selected.source_timestamp, selected.sync_run_id,
      post.published_at is not null and (p_request ->> 'evaluated_at')::timestamptz >= post.published_at + make_interval(days => (p_request ->> 'checkpoint')::integer) as is_mature
    from validated c
    join public.items i on true
    left join public.ig_item_links link on link.item_id = i.id
    left join public.ig_posts post on post.media_id = link.media_id
    left join lateral (
      select daily.* from public.ig_post_daily daily
      where daily.media_id = link.media_id and daily.age_days = (p_request ->> 'checkpoint')::integer
      order by daily.snapshot_date, daily.source_timestamp, daily.sync_run_id::text limit 1
    ) selected on true
    where i.status = 'published' and not i.is_archived and i.published_at is not null
      and (i.published_at at time zone public.app_tz())::date between c.range_start and c.range_end
      and not ((i.published_at at time zone public.app_tz())::date >= date '2026-04-01' and (i.published_at at time zone public.app_tz())::date < date '2026-06-01')
      and (cardinality(c.track_ids) = 0 or i.track_id = any(c.track_ids))
      and (cardinality(c.idea_type_ids) = 0 or i.idea_type_id = any(c.idea_type_ids))
      and (cardinality(c.partner_ids) = 0 or exists (select 1 from public.item_partners item_partner where item_partner.item_id = i.id and item_partner.partner_id = any(c.partner_ids)))
      and (cardinality(c.media_types) = 0 or case when post.product_type = 'REELS' then 'REELS' else post.media_type end = any(c.media_types))
      and (jsonb_array_length(c.participants) = 0 or exists (
        select 1 from jsonb_array_elements(c.participants) selector
        join public.item_participants participant on participant.item_id = i.id and participant.user_id = (selector ->> 'person_id')::uuid
          and (selector ->> 'role' is null or participant.part::text = selector ->> 'role')
      ))
  ), metric_rows as (
    select item.*, metric.metric,
      case
        when metric.metric = 'item_count' then 1::double precision
        when item.media_id is null or item.instagram_published_at is null or not item.is_mature or item.snapshot_date is null then null
        when metric.metric = 'reach' then item.reach::double precision
        when metric.metric = 'save_rate' and item.reach > 0 and item.saved is not null then item.saved::double precision / item.reach * 100
        when metric.metric = 'share_rate' and item.reach > 0 and item.shares is not null then item.shares::double precision / item.reach * 100
        when metric.metric = 'follow_rate' and item.reach > 0 and item.follows is not null then item.follows::double precision / item.reach * 100
        when metric.metric = 'visit_rate' and item.reach > 0 and item.profile_visits is not null then item.profile_visits::double precision / item.reach * 100
        when metric.metric = 'signal' and item.reach > 0 and item.shares is not null and item.saved is not null and item.follows is not null
          and item.profile_visits is not null and item.comments is not null and item.likes is not null
          then (item.shares * 6 + item.saved * 4 + item.follows * 3 + item.profile_visits * 2 + item.comments * 1.5 + item.likes * 0.5)::double precision / item.reach * 1000
        else null end as metric_value,
      case
        when metric.metric = 'item_count' then null when item.media_id is null then 'unlinked'
        when item.instagram_published_at is null then 'unknown_publication_time' when not item.is_mature then 'not_mature'
        when item.snapshot_date is null then 'no_checkpoint'
        when metric.metric in ('save_rate','share_rate','follow_rate','visit_rate','signal') and item.reach = 0 then 'reach_zero'
        when metric.metric = 'reach' and item.reach is null then 'missing_component'
        when metric.metric = 'save_rate' and (item.reach is null or item.saved is null) then 'missing_component'
        when metric.metric = 'share_rate' and (item.reach is null or item.shares is null) then 'missing_component'
        when metric.metric = 'follow_rate' and (item.reach is null or item.follows is null) then 'missing_component'
        when metric.metric = 'visit_rate' and (item.reach is null or item.profile_visits is null) then 'missing_component'
        when metric.metric = 'signal' and (item.reach is null or item.shares is null or item.saved is null or item.follows is null or item.profile_visits is null or item.comments is null or item.likes is null) then 'missing_component'
        else null end as missing_reason
    from item_rows item cross join metric_names metric
  ), cohort_summary as (
    select cohort.cohort_key as key, cohort.cohort_label as label, count(distinct item.item_id)::integer as eligible_n,
      count(distinct item.item_id) filter (where item.media_id is not null)::integer as linked_n,
      count(distinct item.item_id) filter (where item.is_mature)::integer as mature_n,
      count(distinct item.item_id) filter (where item.is_mature and item.snapshot_date is not null)::integer as checkpoint_n
    from validated cohort left join item_rows item on item.cohort_key = cohort.cohort_key group by cohort.cohort_key, cohort.cohort_label
  ), metric_summary as (
    select cohort.cohort_key, metric_name.metric, count(distinct row.item_id)::integer as eligible_n, count(row.metric_value)::integer as measured_n,
      case when metric_name.metric = 'item_count' then count(distinct row.item_id)::double precision else percentile_cont(0.5) within group (order by row.metric_value)::double precision end as median_value,
      jsonb_build_object('unlinked',count(row.item_id) filter (where row.missing_reason='unlinked'),'unknown_publication_time',count(row.item_id) filter (where row.missing_reason='unknown_publication_time'),
        'not_mature',count(row.item_id) filter (where row.missing_reason='not_mature'),'no_checkpoint',count(row.item_id) filter (where row.missing_reason='no_checkpoint'),
        'unverified_checkpoint',0,'missing_component',count(row.item_id) filter (where row.missing_reason='missing_component'),'reach_zero',count(row.item_id) filter (where row.missing_reason='reach_zero')) as missing
    from validated cohort cross join metric_names metric_name left join metric_rows row on row.cohort_key=cohort.cohort_key and row.metric=metric_name.metric
    group by cohort.cohort_key, metric_name.metric
  ), metric_pairs as (
    select metric.metric, a.median_value as cohort_a, b.median_value as cohort_b,
      case when a.median_value is null or b.median_value is null then null else b.median_value-a.median_value end as difference,
      case when a.median_value is null or a.median_value=0 or b.median_value is null then null else (b.median_value-a.median_value)/abs(a.median_value)*100 end as relative_change,
      coalesce(a.measured_n,0) as a_measured_n, coalesce(b.measured_n,0) as b_measured_n, coalesce(a.eligible_n,0) as a_eligible_n, coalesce(b.eligible_n,0) as b_eligible_n,
      coalesce(a.missing,jsonb_build_object('unlinked',0,'unknown_publication_time',0,'not_mature',0,'no_checkpoint',0,'unverified_checkpoint',0,'missing_component',0,'reach_zero',0)) as a_missing,
      coalesce(b.missing,jsonb_build_object('unlinked',0,'unknown_publication_time',0,'not_mature',0,'no_checkpoint',0,'unverified_checkpoint',0,'missing_component',0,'reach_zero',0)) as b_missing
    from metric_names metric left join metric_summary a on a.metric=metric.metric and a.cohort_key='A' left join metric_summary b on b.metric=metric.metric and b.cohort_key='B'
  ), timeline as (
    select to_char(date_trunc('month',workflow_publish_date),'YYYY-MM') as month, cohort_key as cohort, metric,
      case when metric='item_count' then count(distinct item_id)::double precision else percentile_cont(0.5) within group (order by metric_value)::double precision end as value,
      count(distinct item_id)::integer as eligible_n, count(metric_value)::integer as measured_n
    from metric_rows group by date_trunc('month',workflow_publish_date),cohort_key,metric
  ), evidence as (
    select item.cohort_key as cohort,item.item_id,item.ref,item.title,item.media_id,item.normalized_media_type as media_type,item.workflow_published_at,item.instagram_published_at,
      item.snapshot_date,item.source_timestamp as snapshot_source_timestamp,item.age_days as recorded_age_days,
      coalesce((select jsonb_object_agg(metric,metric_value) from metric_rows rm where rm.cohort_key=item.cohort_key and rm.item_id=item.item_id),'{}'::jsonb) as metric_values,
      coalesce((select jsonb_object_agg(metric,missing_reason) from metric_rows rm where rm.cohort_key=item.cohort_key and rm.item_id=item.item_id),'{}'::jsonb) as exclusion_reasons,
      jsonb_build_object('reach',item.reach,'saved',item.saved,'shares',item.shares,'follows',item.follows,'profile_visits',item.profile_visits,'comments',item.comments,'likes',item.likes) as components
    from item_rows item
  ), base_result as (
    select jsonb_build_object('request',p_request,'formula_version','analytics-formulas-v2','checkpoint_policy_version','recorded-age-earliest-v1',
      'evaluated_at',(p_request->>'evaluated_at')::timestamptz,'excluded_periods',jsonb_build_array(jsonb_build_object('start','2026-04-01','end_exclusive','2026-06-01')),
      'overlap_n',(select count(*) from (select item_id from item_rows group by item_id having count(distinct cohort_key)=2) overlap_rows),
      'cohorts',coalesce((select jsonb_agg(to_jsonb(summary) order by key) from cohort_summary summary),'[]'::jsonb),
      'metrics',coalesce((select jsonb_agg(to_jsonb(pair) order by array_position(array['reach','save_rate','share_rate','follow_rate','visit_rate','signal','item_count'],metric)) from metric_pairs pair),'[]'::jsonb),
      'timeline',coalesce((select jsonb_agg(to_jsonb(point) order by month,cohort,metric) from timeline point),'[]'::jsonb),
      'evidence',coalesce((select jsonb_agg(to_jsonb(row) order by cohort,workflow_published_at,item_id) from evidence row),'[]'::jsonb),
      'source_bounds',jsonb_build_object('first',(select min(source_timestamp) from item_rows where snapshot_date is not null),'last',(select max(source_timestamp) from item_rows where snapshot_date is not null))) as value
  )
  select value || jsonb_build_object('result_hash',encode(extensions.digest(value::text,'sha256'),'hex')) into result from base_result;
  if (select count(*) from jsonb_array_elements(result->'cohorts')) <> 2 then raise exception 'INVALID_ADVANCED_COMPARISON'; end if;
  return result;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception 'INVALID_ADVANCED_COMPARISON';
end;
$$;

revoke all on function public.admin_advanced_analytics_comparison(jsonb) from public;
revoke all on function public.admin_advanced_analytics_comparison(jsonb) from anon;
grant execute on function public.admin_advanced_analytics_comparison(jsonb) to authenticated;
