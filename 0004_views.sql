-- ============================================================================
-- 0004_views.sql — the analytical rules, enforced once.
--
-- Median, not mean. Rates, not absolutes. n < 4 flagged. Archived months excluded
-- in the view definition itself, so a screen written six months from now cannot
-- forget the exclusion.
-- ============================================================================

-- Latest snapshot per post. Post-level insights are permanent, so "latest" is
-- always the most complete reading.
create or replace view v_post_latest as
select distinct on (media_id) *
  from ig_post_daily
 order by media_id, snapshot_date desc;

-- ============================== PER-ITEM PERFORMANCE ==============================

create or replace view v_item_performance as
select
  i.id, i.ref, i.title, i.status, i.published_at,
  i.track_id, t.name as track_name, t.color_hex,
  i.idea_type_id, ty.name as idea_type,
  p.media_id, p.permalink, p.product_type,
  d.reach, d.views, d.likes, d.comments, d.saved, d.shares,
  d.follows, d.profile_visits,

  case when d.reach > 0 then round(d.saved::numeric   / d.reach * 100, 2) end as save_rate,
  case when d.reach > 0 then round(d.shares::numeric  / d.reach * 100, 2) end as share_rate,
  case when d.reach > 0 then round(d.follows::numeric / d.reach * 100, 2) end as follow_rate,
  case when d.reach > 0 then round(d.profile_visits::numeric / d.reach * 100, 2) end as visit_rate,

  -- Signal strength: costly actions outweigh cheap ones. A share is worth twelve
  -- likes because it costs twelve times more to give.
  case when d.reach > 0 then round((
        coalesce(d.shares, 0) * 6
      + coalesce(d.saved, 0) * 4
      + coalesce(d.follows, 0) * 3
      + coalesce(d.profile_visits, 0) * 2
      + coalesce(d.comments, 0) * 1.5
      + coalesce(d.likes, 0) * 0.5
  )::numeric / d.reach * 1000, 1) end as signal,

  -- Reels never return profile_visits or follows. The number is still comparable
  -- within a format, not across formats — the flag says so out loud.
  (d.follows is null or d.profile_visits is null) as signal_partial

from items i
join ig_posts      p  on p.media_id = i.ig_media_id
join v_post_latest d  on d.media_id = p.media_id
left join tracks     t  on t.id = i.track_id
left join idea_types ty on ty.id = i.idea_type_id
where not i.is_archived;

-- ============================== GROUPED, MEDIAN-BASED ==============================

create or replace view v_track_month as
select
  date_trunc('month', published_at)::date as month,
  track_id, track_name, color_hex,
  count(*) as n,
  count(*) < 4 as is_thin,
  percentile_cont(0.5) within group (order by reach)      as median_reach,
  percentile_cont(0.5) within group (order by save_rate)  as median_save_rate,
  percentile_cont(0.5) within group (order by share_rate) as median_share_rate,
  percentile_cont(0.5) within group (order by signal)     as median_signal
from v_item_performance
where published_at is not null
group by 1, 2, 3, 4;

create or replace view v_partner_month as
select
  date_trunc('month', v.published_at)::date as month,
  pr.id as partner_id, pr.name as partner_name,
  count(*) as n,
  count(*) < 4 as is_thin,
  percentile_cont(0.5) within group (order by v.reach)      as median_reach,
  percentile_cont(0.5) within group (order by v.save_rate)  as median_save_rate,
  percentile_cont(0.5) within group (order by v.share_rate) as median_share_rate,
  percentile_cont(0.5) within group (order by v.signal)     as median_signal
from v_item_performance v
join item_partners ip on ip.item_id = v.id
join partners      pr on pr.id = ip.partner_id
where v.published_at is not null
group by 1, 2, 3;

-- Partner performance per track — the only input the collab suggestion is
-- allowed to read. Fewer than 5 collaborations means no recommendation.
create or replace view v_partner_track as
select
  pr.id as partner_id, pr.name as partner_name,
  v.track_id, v.track_name,
  count(*) as n,
  count(*) >= 5 as sample_sufficient,
  percentile_cont(0.5) within group (order by v.signal)    as median_signal,
  percentile_cont(0.5) within group (order by v.reach)     as median_reach,
  max(v.published_at) as last_collab_at
from v_item_performance v
join item_partners ip on ip.item_id = v.id
join partners      pr on pr.id = ip.partner_id
where v.published_at is not null
group by 1, 2, 3, 4;

-- ============================== OPERATIONS ==============================

create or replace view v_waiting as
select
  i.id, i.ref, i.title, i.status, i.track_id, t.name as track_name,
  s.slot_at,
  case i.status
    when 'idea'             then 'كتابة'
    when 'writing'          then 'اعتماد المحتوى'
    when 'content_approved' then 'الإنتاج'
    when 'in_production'    then 'اعتماد التصميم'
    when 'design_approved'  then 'استيفاء شروط الجاهزية'
    when 'ready'            then 'النشر'
  end as waiting_on,
  (select string_agg(pf.display_name, ' · ')
     from item_participants ipa join profiles pf on pf.id = ipa.user_id
    where ipa.item_id = i.id) as people
from items i
left join tracks t on t.id = i.track_id
left join publishing_slots s on s.id = i.slot_id
where not i.is_archived
  and i.status not in ('published', 'cancelled');

-- The screen that forces everything through the platform: caption and file link
-- live here, and nowhere else.
create or replace view v_ready_queue as
select
  i.id, i.ref, i.title, i.caption, i.production_file_url,
  i.track_id, t.name as track_name, t.color_hex,
  ty.name as idea_type,
  s.id as slot_id, s.slot_at,
  (select string_agg(pr.name, ' · ')
     from item_partners ip join partners pr on pr.id = ip.partner_id
    where ip.item_id = i.id) as partners
from items i
join publishing_slots s on s.id = i.slot_id
left join tracks t on t.id = i.track_id
left join idea_types ty on ty.id = i.idea_type_id
where i.status = 'ready' and not i.is_archived;

-- Upcoming slots including the empty ones — an empty slot must be visible before
-- its date, not discovered after it.
create or replace view v_slot_board as
select
  s.id as slot_id, s.slot_at, s.state,
  count(i.id) filter (where i.id is not null) as n_items,
  count(i.id) filter (where i.status = 'ready') as n_ready
from publishing_slots s
left join items i on i.slot_id = s.id and not i.is_archived
where s.slot_at >= now() - interval '7 days'
group by 1, 2, 3
order by s.slot_at;

-- ============================== CONFLICTS ==============================

create or replace view v_conflict_published_no_link as
select i.id, i.ref, i.title, i.published_at
  from items i
 where i.status = 'published' and i.ig_permalink is null and not i.is_archived;

create or replace view v_conflict_link_unresolved as
select i.id, i.ref, i.title, i.ig_permalink, i.published_at
  from items i
 where i.ig_permalink is not null and i.ig_media_id is null
   and i.published_at < now() - interval '36 hours'
   and not i.is_archived;

create or replace view v_conflict_orphan_posts as
select p.media_id, p.permalink, p.published_at, p.caption, d.reach
  from ig_posts p
  left join items i on i.ig_media_id = p.media_id or i.ig_shortcode = p.shortcode
  left join v_post_latest d on d.media_id = p.media_id
 where i.id is null
 order by p.published_at desc;

create or replace view v_conflict_slot_passed_unpublished as
select i.id, i.ref, i.title, i.status, s.slot_at
  from items i
  join publishing_slots s on s.id = i.slot_id
 where s.slot_at < now() and i.status <> 'published' and not i.is_archived;

-- ============================== VIEW SECURITY ==============================
-- Views default to the creator's privileges, which would silently bypass RLS.
-- Force them to run as the caller (Postgres 15+).
do $$
declare v text;
begin
  foreach v in array array[
    'v_post_latest','v_item_performance','v_track_month','v_partner_month',
    'v_partner_track','v_waiting','v_ready_queue','v_slot_board',
    'v_conflict_published_no_link','v_conflict_link_unresolved',
    'v_conflict_orphan_posts','v_conflict_slot_passed_unpublished'
  ] loop
    execute format('alter view %I set (security_invoker = true)', v);
  end loop;
end $$;
