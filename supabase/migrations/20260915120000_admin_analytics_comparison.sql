-- Guarded factual comparisons. Missing metrics remain null and exact-age reach
-- checkpoints are never mixed with each material's latest available snapshot.

create or replace function public.admin_analytics_comparison(
  p_start date,
  p_end date,
  p_dimension text,
  p_metric text,
  p_keys text[],
  p_media_type text default null
) returns table (
  dimension_key text,
  dimension_name text,
  participant_part text,
  total_n integer,
  measured_n integer,
  median_value double precision,
  is_thin boolean,
  has_partial_reels boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_active_user() or not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 365 then
    raise exception 'INVALID_PERIOD';
  end if;
  if p_dimension not in ('track', 'partner', 'partner_track', 'idea_type', 'media_type', 'person')
     or p_metric not in ('reach_d1', 'reach_d7', 'reach_d30', 'save_rate', 'share_rate', 'follow_rate', 'signal', 'item_count')
     or cardinality(p_keys) < 1 or cardinality(p_keys) > 20
     or (p_dimension not in ('person', 'partner_track') and cardinality(p_keys) < 2)
     or p_media_type is not null and p_media_type not in ('IMAGE', 'CAROUSEL_ALBUM', 'VIDEO', 'REELS') then
    raise exception 'INVALID_COMPARISON';
  end if;

  return query
  with item_metrics as (
    select
      i.id as item_id,
      i.track_id,
      t.name as track_name,
      i.idea_type_id,
      ty.name as idea_type_name,
      p.media_type,
      p.product_type,
      case
        when p_metric in ('reach_d1', 'reach_d7', 'reach_d30') then checkpoint.reach::double precision
        when p_metric = 'save_rate' and latest.reach > 0 and latest.saved is not null then latest.saved::double precision / latest.reach * 100
        when p_metric = 'share_rate' and latest.reach > 0 and latest.shares is not null then latest.shares::double precision / latest.reach * 100
        when p_metric = 'follow_rate' and latest.reach > 0 and latest.follows is not null then latest.follows::double precision / latest.reach * 100
        when p_metric = 'signal' and latest.reach > 0
          and latest.shares is not null and latest.saved is not null
          and latest.follows is not null and latest.profile_visits is not null
          and latest.comments is not null and latest.likes is not null
          then (latest.shares * 6 + latest.saved * 4 + latest.follows * 3 + latest.profile_visits * 2
            + latest.comments * 1.5 + latest.likes * 0.5)::double precision / latest.reach * 1000
        when p_metric = 'item_count' then 1::double precision
      end as metric_value,
      (p.product_type = 'REELS' and p_metric in ('follow_rate', 'signal')) as partial_reel
    from public.items i
    join public.ig_item_links link on link.item_id = i.id
    join public.ig_posts p on p.media_id = link.media_id
    join public.v_post_latest latest on latest.media_id = p.media_id
    left join public.tracks t on t.id = i.track_id
    left join public.idea_types ty on ty.id = i.idea_type_id
    left join lateral (
      select daily.reach
      from public.ig_post_daily daily
      where daily.media_id = p.media_id
        and daily.age_days = case p_metric when 'reach_d1' then 1 when 'reach_d7' then 7 when 'reach_d30' then 30 end
      order by daily.snapshot_date desc
      limit 1
    ) checkpoint on true
    where not i.is_archived
      and i.status = 'published'
      and i.published_at >= p_start::timestamp at time zone public.app_tz()
      and i.published_at < (p_end + 1)::timestamp at time zone public.app_tz()
      and (
        p_media_type is null
        or (p_media_type = 'REELS' and p.product_type = 'REELS')
        or (p_media_type = 'VIDEO' and p.media_type = 'VIDEO' and p.product_type is distinct from 'REELS')
        or (p_media_type in ('IMAGE', 'CAROUSEL_ALBUM') and p.media_type = p_media_type)
      )
  ), expanded as (
    select m.item_id, m.track_id::text as dimension_key, m.track_name as dimension_name,
           null::text as participant_part, m.metric_value, m.partial_reel
    from item_metrics m where p_dimension = 'track' and m.track_id is not null
    union all
    select m.item_id, m.idea_type_id::text, m.idea_type_name, null::text, m.metric_value, m.partial_reel
    from item_metrics m where p_dimension = 'idea_type' and m.idea_type_id is not null
    union all
    select m.item_id,
           case when m.product_type = 'REELS' then 'REELS' else m.media_type end,
           case when m.product_type = 'REELS' then 'ريلز'
                when m.media_type = 'CAROUSEL_ALBUM' then 'كاروسيل'
                when m.media_type = 'VIDEO' then 'فيديو'
                when m.media_type = 'IMAGE' then 'صورة'
                else m.media_type end,
           null::text, m.metric_value, m.partial_reel
    from item_metrics m where p_dimension = 'media_type' and m.media_type is not null
    union all
    select m.item_id, partner.id::text, partner.name, null::text, m.metric_value, m.partial_reel
    from item_metrics m
    join public.item_partners item_partner on item_partner.item_id = m.item_id
    join public.partners partner on partner.id = item_partner.partner_id
    where p_dimension = 'partner'
    union all
    select m.item_id, partner.id::text || ':' || m.track_id::text,
           partner.name || ' × ' || m.track_name, null::text, m.metric_value, m.partial_reel
    from item_metrics m
    join public.item_partners item_partner on item_partner.item_id = m.item_id
    join public.partners partner on partner.id = item_partner.partner_id
    where p_dimension = 'partner_track' and m.track_id is not null
    union all
    select m.item_id, participant.user_id::text, profile.display_name, participant.part::text,
           m.metric_value, m.partial_reel
    from item_metrics m
    join public.item_participants participant on participant.item_id = m.item_id
    join public.profiles profile on profile.id = participant.user_id
    where p_dimension = 'person'
  ), selected as (
    select expanded.* from expanded where expanded.dimension_key = any(p_keys)
  )
  select
    selected.dimension_key,
    selected.dimension_name,
    selected.participant_part,
    count(distinct selected.item_id)::integer as total_n,
    count(selected.metric_value)::integer as measured_n,
    case when p_metric = 'item_count' then count(distinct selected.item_id)::double precision
      else percentile_cont(0.5) within group (order by selected.metric_value)::double precision end as median_value,
    count(selected.metric_value) < 4 as is_thin,
    bool_or(selected.partial_reel) as has_partial_reels
  from selected
  group by selected.dimension_key, selected.dimension_name, selected.participant_part
  order by array_position(p_keys, selected.dimension_key), selected.participant_part nulls first;
end;
$$;

revoke all on function public.admin_analytics_comparison(date, date, text, text, text[], text) from public, anon, authenticated, service_role;
grant execute on function public.admin_analytics_comparison(date, date, text, text, text[], text) to authenticated;
alter function public.admin_analytics_comparison(date, date, text, text, text[], text) owner to postgres;
