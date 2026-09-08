-- Analytics ingestion, exact post linking, and published weekly-report lifecycle.
-- This migration intentionally extends the existing Instagram mirror instead of
-- creating a second source of truth. It is not applied by this change.

alter table public.weekly_reports
  add column published_at timestamptz,
  add column published_by uuid references public.profiles(id),
  add column updated_at timestamptz not null default now();

create index weekly_reports_published_at_idx
  on public.weekly_reports (published_at desc)
  where published_at is not null;
create index weekly_reports_period_idx
  on public.weekly_reports (period_start desc, period_end desc);
create index weekly_reports_published_by_idx
  on public.weekly_reports (published_by)
  where published_by is not null;

revoke all on table public.weekly_reports from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.weekly_reports to service_role;

create or replace function public.canonical_instagram_permalink(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  with matched as (
    select regexp_match(
      btrim(p_value),
      '^https://(?:www\.)?instagram\.com/(p|reel|tv)/([A-Za-z0-9_-]+)/?(?:[?#].*)?$',
      'i'
    ) as parts
  )
  select case
    when parts is null then null
    else 'https://www.instagram.com/' || lower(parts[1]) || '/' || parts[2] || '/'
  end
  from matched;
$$;

revoke all on function public.canonical_instagram_permalink(text) from public;
grant execute on function public.canonical_instagram_permalink(text) to service_role;

create table public.analytics_sync_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  request_sha256 text not null unique,
  signature_timestamp timestamptz not null,
  source_timestamp timestamptz not null,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('processing', 'accepted')),
  row_counts jsonb not null default '{}'::jsonb,
  accepted_count integer not null default 0 check (accepted_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  safe_error_summary text,
  constraint analytics_sync_runs_key_check check (char_length(idempotency_key) between 8 and 128),
  constraint analytics_sync_runs_sha_check check (request_sha256 ~ '^[0-9a-f]{64}$')
);

create index analytics_sync_runs_received_idx on public.analytics_sync_runs (received_at desc);
create index analytics_sync_runs_source_idx on public.analytics_sync_runs (source_timestamp desc);

create table public.ig_item_links (
  item_id uuid primary key references public.items(id) on delete cascade,
  media_id text not null unique references public.ig_posts(media_id) on delete cascade,
  linked_by uuid references public.profiles(id),
  linked_at timestamptz not null default now(),
  reason text not null,
  source text not null check (source in ('existing', 'exact_permalink', 'manual')),
  constraint ig_item_links_reason_check check (char_length(btrim(reason)) between 4 and 500),
  constraint ig_item_links_actor_check check (
    (source = 'manual' and linked_by is not null)
    or (source <> 'manual')
  )
);

create index ig_item_links_media_idx on public.ig_item_links (media_id);
create index ig_item_links_actor_idx on public.ig_item_links (linked_by, linked_at desc)
  where linked_by is not null;

create table public.ig_collabs (
  id uuid primary key default gen_random_uuid(),
  collaboration_date date not null,
  partner_id smallint not null references public.partners(id),
  collaboration_type text,
  notes text,
  net_follows_before integer,
  net_follows_after integer,
  follows_lift integer,
  reach_before integer,
  reach_after integer,
  reach_lift_pct numeric,
  nonfollower_before integer,
  nonfollower_after integer,
  nonfollower_lift_pct numeric,
  computed_at timestamptz,
  sync_run_id uuid not null references public.analytics_sync_runs(id),
  created_at timestamptz not null default now(),
  unique nulls not distinct (collaboration_date, partner_id, collaboration_type)
);

create index ig_collabs_period_idx on public.ig_collabs (collaboration_date desc);
create index ig_collabs_partner_idx on public.ig_collabs (partner_id, collaboration_date desc);
create index ig_collabs_sync_idx on public.ig_collabs (sync_run_id);

alter table public.ig_post_daily
  add column missing_metrics text[] not null default '{}'::text[],
  add column source_timestamp timestamptz,
  add column sync_run_id uuid references public.analytics_sync_runs(id);
alter table public.ig_account_daily
  add column missing_metrics text[] not null default '{}'::text[],
  add column source_timestamp timestamptz,
  add column sync_run_id uuid references public.analytics_sync_runs(id);
alter table public.ig_demographics
  add column source_timestamp timestamptz,
  add column sync_run_id uuid references public.analytics_sync_runs(id);

-- Before full daily collection began, zero in account views represented a failed
-- reading. Preserve that historical fact as NULL rather than a measured zero.
update public.ig_account_daily
set views = null,
    missing_metrics = array_append(missing_metrics, 'views')
where date < date '2026-08-11'
  and views = 0
  and not ('views' = any(missing_metrics));

update public.ig_post_daily
set missing_metrics = array_remove(array[
  case when likes is null then 'likes' end,
  case when comments is null then 'comments' end,
  case when reach is null then 'reach' end,
  case when views is null then 'views' end,
  case when saved is null then 'saved' end,
  case when shares is null then 'shares' end,
  case when interactions is null then 'interactions' end,
  case when profile_visits is null then 'profile_visits' end,
  case when follows is null then 'follows' end,
  case when avg_watch_ms is null then 'avg_watch_ms' end
]::text[], null);

update public.ig_account_daily
set missing_metrics = array_remove(array[
  case when followers is null then 'followers' end,
  case when media_count is null then 'media_count' end,
  case when reach is null then 'reach' end,
  case when views is null then 'views' end,
  case when reach_followers is null then 'reach_followers' end,
  case when reach_non_followers is null then 'reach_non_followers' end,
  case when follows is null then 'follows' end,
  case when unfollows is null then 'unfollows' end
]::text[], null);

create index ig_post_daily_age_idx on public.ig_post_daily (media_id, age_days, snapshot_date);
create index ig_post_daily_period_idx on public.ig_post_daily (snapshot_date desc, media_id);
create index ig_post_daily_sync_idx on public.ig_post_daily (sync_run_id) where sync_run_id is not null;
create index ig_account_daily_sync_idx on public.ig_account_daily (sync_run_id) where sync_run_id is not null;
create index ig_demographics_period_idx on public.ig_demographics (snapshot_date desc, dimension);
create index ig_demographics_sync_idx on public.ig_demographics (sync_run_id) where sync_run_id is not null;
create unique index ig_posts_permalink_unique_idx on public.ig_posts ((public.canonical_instagram_permalink(permalink)));
create unique index ig_posts_shortcode_unique_idx on public.ig_posts (shortcode) where shortcode is not null;
create index items_analytics_dimensions_idx on public.items (published_at desc, track_id, idea_type_id)
  where not is_archived and status = 'published';
create index item_partners_partner_item_idx on public.item_partners (partner_id, item_id);

insert into public.ig_item_links (item_id, media_id, reason, source)
select i.id, i.ig_media_id, 'رابط موجود قبل تفعيل سجل الربط', 'existing'
from public.items i
where i.ig_media_id is not null
  and not i.is_archived
  and not exists (
    select 1 from public.items other
    where other.ig_media_id = i.ig_media_id and other.id <> i.id and not other.is_archived
  )
on conflict do nothing;

create or replace function public.guard_immutable_analytics_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and new is not distinct from old then
    return new;
  end if;
  raise exception 'IMMUTABLE_ANALYTICS_SNAPSHOT';
end;
$$;

create trigger ig_post_daily_immutable
before update or delete on public.ig_post_daily
for each row execute function public.guard_immutable_analytics_snapshot();
create trigger ig_account_daily_immutable
before update or delete on public.ig_account_daily
for each row execute function public.guard_immutable_analytics_snapshot();
create trigger ig_demographics_immutable
before update or delete on public.ig_demographics
for each row execute function public.guard_immutable_analytics_snapshot();
create trigger ig_collabs_immutable
before update or delete on public.ig_collabs
for each row execute function public.guard_immutable_analytics_snapshot();

create or replace view public.v_post_latest
with (security_invoker = true)
as
select distinct on (media_id) *
from public.ig_post_daily
order by media_id, snapshot_date desc;

create or replace view public.v_item_performance
with (security_invoker = true)
as
select
  i.id, i.ref, i.title, i.status, i.published_at,
  i.track_id, t.name as track_name, t.color_hex,
  i.idea_type_id, ty.name as idea_type,
  p.media_id, p.permalink, p.product_type,
  d.reach, d.views, d.likes, d.comments, d.saved, d.shares,
  d.follows, d.profile_visits,
  case when d.reach > 0 and d.saved is not null then round(d.saved::numeric / d.reach * 100, 2) end as save_rate,
  case when d.reach > 0 and d.shares is not null then round(d.shares::numeric / d.reach * 100, 2) end as share_rate,
  case when d.reach > 0 and d.follows is not null then round(d.follows::numeric / d.reach * 100, 2) end as follow_rate,
  case when d.reach > 0 and d.profile_visits is not null then round(d.profile_visits::numeric / d.reach * 100, 2) end as visit_rate,
  case when d.reach > 0
          and d.shares is not null and d.saved is not null
          and d.follows is not null and d.profile_visits is not null
          and d.comments is not null and d.likes is not null
    then round((
      d.shares * 6 + d.saved * 4 + d.follows * 3 + d.profile_visits * 2
      + d.comments * 1.5 + d.likes * 0.5
    )::numeric / d.reach * 1000, 1)
  end as signal,
  (cardinality(d.missing_metrics) > 0 or d.follows is null or d.profile_visits is null) as signal_partial,
  p.media_type,
  d.snapshot_date, d.age_days, d.source_timestamp, d.missing_metrics,
  d.interactions, d.avg_watch_ms,
  case when d.reach > 0
          and d.likes is not null and d.comments is not null
          and d.saved is not null and d.shares is not null
    then round((d.likes + d.comments + d.saved + d.shares)::numeric / d.reach * 100, 2)
  end as engagement_rate
from public.items i
join public.ig_item_links l on l.item_id = i.id
join public.ig_posts p on p.media_id = l.media_id
join public.v_post_latest d on d.media_id = p.media_id
left join public.tracks t on t.id = i.track_id
left join public.idea_types ty on ty.id = i.idea_type_id
where not i.is_archived;

create or replace function public.admin_analytics_aggregates(
  p_start date,
  p_end date,
  p_media_type text default null
) returns table (
  dimension text,
  dimension_key text,
  dimension_name text,
  n integer,
  median_reach double precision,
  median_save_rate double precision,
  median_share_rate double precision,
  median_signal double precision,
  sample_sufficient boolean
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

  return query
  with filtered as (
    select v.*
    from public.v_item_performance v
    where v.published_at >= p_start::timestamp at time zone public.app_tz()
      and v.published_at < (p_end + 1)::timestamp at time zone public.app_tz()
      and (p_media_type is null or v.media_type = p_media_type)
  ), grouped as (
    select 'month'::text as group_dimension,
           to_char(date_trunc('month', v.published_at at time zone public.app_tz()), 'YYYY-MM') as group_key,
           to_char(date_trunc('month', v.published_at at time zone public.app_tz()), 'YYYY-MM') as group_name,
           count(*)::integer as group_n,
           percentile_cont(0.5) within group (order by v.reach)::double precision as group_reach,
           percentile_cont(0.5) within group (order by v.save_rate)::double precision as group_save,
           percentile_cont(0.5) within group (order by v.share_rate)::double precision as group_share,
           percentile_cont(0.5) within group (order by v.signal)::double precision as group_signal,
           true as group_sufficient
    from filtered v group by 2, 3
    union all
    select 'track', v.track_id::text, v.track_name, count(*)::integer,
           percentile_cont(0.5) within group (order by v.reach)::double precision,
           percentile_cont(0.5) within group (order by v.save_rate)::double precision,
           percentile_cont(0.5) within group (order by v.share_rate)::double precision,
           percentile_cont(0.5) within group (order by v.signal)::double precision,
           true
    from filtered v where v.track_id is not null group by v.track_id, v.track_name
    union all
    select 'idea_type', v.idea_type_id::text, v.idea_type, count(*)::integer,
           percentile_cont(0.5) within group (order by v.reach)::double precision,
           percentile_cont(0.5) within group (order by v.save_rate)::double precision,
           percentile_cont(0.5) within group (order by v.share_rate)::double precision,
           percentile_cont(0.5) within group (order by v.signal)::double precision,
           true
    from filtered v where v.idea_type_id is not null group by v.idea_type_id, v.idea_type
    union all
    select 'partner', pr.id::text, pr.name, count(*)::integer,
           percentile_cont(0.5) within group (order by v.reach)::double precision,
           percentile_cont(0.5) within group (order by v.save_rate)::double precision,
           percentile_cont(0.5) within group (order by v.share_rate)::double precision,
           percentile_cont(0.5) within group (order by v.signal)::double precision,
           true
    from filtered v
    join public.item_partners ip on ip.item_id = v.id
    join public.partners pr on pr.id = ip.partner_id
    group by pr.id, pr.name
    union all
    select 'partner_track', pr.id::text || ':' || v.track_id::text,
           pr.name || ' × ' || v.track_name, count(*)::integer,
           case when count(*) >= 5 then percentile_cont(0.5) within group (order by v.reach)::double precision end,
           case when count(*) >= 5 then percentile_cont(0.5) within group (order by v.save_rate)::double precision end,
           case when count(*) >= 5 then percentile_cont(0.5) within group (order by v.share_rate)::double precision end,
           case when count(*) >= 5 then percentile_cont(0.5) within group (order by v.signal)::double precision end,
           count(*) >= 5
    from filtered v
    join public.item_partners ip on ip.item_id = v.id
    join public.partners pr on pr.id = ip.partner_id
    where v.track_id is not null
    group by pr.id, pr.name, v.track_id, v.track_name
  )
  select group_dimension, group_key, group_name, group_n,
         group_reach, group_save, group_share, group_signal, group_sufficient
  from grouped
  order by group_dimension, group_n desc, group_name;
end;
$$;

create or replace function public.admin_link_instagram_post(
  p_item_id uuid,
  p_media_id text,
  p_reason text
) returns public.ig_item_links
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result public.ig_item_links;
  target_item public.items;
begin
  if not public.is_active_user() or not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 4 then
    raise exception 'REASON_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext('ig-item-link:' || p_item_id::text));
  perform pg_advisory_xact_lock(hashtext('ig-media-link:' || p_media_id));
  select * into target_item from public.items where id = p_item_id for update;
  if target_item.id is null or target_item.is_archived or target_item.status <> 'published' then
    raise exception 'ITEM_NOT_ELIGIBLE';
  end if;
  if not exists (select 1 from public.ig_posts where media_id = p_media_id) then
    raise exception 'POST_NOT_FOUND';
  end if;
  if exists (select 1 from public.ig_item_links where item_id = p_item_id or media_id = p_media_id) then
    raise exception 'LINK_CONFLICT';
  end if;
  if exists (select 1 from public.items where ig_media_id = p_media_id and id <> p_item_id) then
    raise exception 'LINK_CONFLICT';
  end if;

  insert into public.ig_item_links (item_id, media_id, linked_by, reason, source)
  values (p_item_id, p_media_id, auth.uid(), btrim(p_reason), 'manual')
  returning * into result;
  update public.items set ig_media_id = p_media_id, updated_at = now() where id = p_item_id;
  return result;
end;
$$;

create or replace function public.ingest_analytics_batch(
  p_payload jsonb,
  p_idempotency_key text,
  p_signature_timestamp timestamptz,
  p_source_timestamp timestamptz,
  p_request_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  run_id uuid;
  counts jsonb;
  accepted integer;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'INVALID_PAYLOAD'; end if;
  insert into public.analytics_sync_runs (
    idempotency_key, request_sha256, signature_timestamp, source_timestamp, status
  ) values (
    p_idempotency_key, p_request_sha256, p_signature_timestamp, p_source_timestamp, 'processing'
  ) on conflict do nothing returning id into run_id;
  if run_id is null then return jsonb_build_object('replayed', true); end if;

  insert into public.ig_posts (media_id, published_at, media_type, product_type, permalink, caption, synced_at)
  select x.post_id, x.published_at, x.media_type, x.product_type,
         public.canonical_instagram_permalink(x.permalink), nullif(left(x.caption, 500), ''), now()
  from jsonb_to_recordset(coalesce(p_payload->'posts', '[]'::jsonb))
    as x(post_id text, published_at timestamptz, media_type text, product_type text, permalink text, caption text)
  on conflict (media_id) do update set
    published_at = excluded.published_at,
    media_type = excluded.media_type,
    product_type = excluded.product_type,
    permalink = excluded.permalink,
    caption = excluded.caption,
    synced_at = excluded.synced_at;

  insert into public.ig_post_daily (
    media_id, snapshot_date, age_days, likes, comments, reach, views, saved, shares,
    interactions, profile_visits, follows, avg_watch_ms, missing_metrics, source_timestamp, sync_run_id
  )
  select x.post_id, x.snapshot_date, x.age_days, x.likes, x.comments, x.reach, x.views, x.saved,
         x.shares, x.interactions, x.profile_visits, x.follows, x.avg_watch_ms,
         coalesce(x.missing_metrics, '{}'::text[]), p_source_timestamp, run_id
  from jsonb_to_recordset(coalesce(p_payload->'post_daily', '[]'::jsonb))
    as x(post_id text, snapshot_date date, age_days integer, likes integer, comments integer,
         reach integer, views integer, saved integer, shares integer, interactions integer,
         profile_visits integer, follows integer, avg_watch_ms integer, missing_metrics text[])
  on conflict (media_id, snapshot_date) do nothing;

  insert into public.ig_account_daily (
    date, followers, media_count, reach, views, reach_followers, reach_non_followers,
    follows, unfollows, missing_metrics, source_timestamp, sync_run_id
  )
  select x.date, x.followers, x.media_count, x.reach, x.views, x.reach_followers,
         x.reach_non_followers, x.follows, x.unfollows, coalesce(x.missing_metrics, '{}'::text[]),
         p_source_timestamp, run_id
  from jsonb_to_recordset(coalesce(p_payload->'account_daily', '[]'::jsonb))
    as x(date date, followers integer, media_count integer, reach integer, views integer,
         reach_followers integer, reach_non_followers integer, follows integer, unfollows integer,
         missing_metrics text[])
  on conflict (date) do nothing;

  insert into public.ig_demographics (snapshot_date, dimension, key, value, source_timestamp, sync_run_id)
  select x.snapshot_date, x.dimension, x.key, x.value, p_source_timestamp, run_id
  from jsonb_to_recordset(coalesce(p_payload->'demographics', '[]'::jsonb))
    as x(snapshot_date date, dimension text, key text, value integer)
  on conflict (snapshot_date, dimension, key) do nothing;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'collabs', '[]'::jsonb)) as x(partner text)
    where not exists (
      select 1 from public.partners pr
      where pr.name = btrim(x.partner) or btrim(x.partner) = any(pr.aliases)
    )
  ) then
    raise exception 'UNKNOWN_PARTNER';
  end if;

  insert into public.ig_collabs (
    collaboration_date, partner_id, collaboration_type, notes, net_follows_before, net_follows_after,
    follows_lift, reach_before, reach_after, reach_lift_pct, nonfollower_before, nonfollower_after,
    nonfollower_lift_pct, computed_at, sync_run_id
  )
  select x.date, pr.id, x.type, x.notes, x.net_follows_before, x.net_follows_after,
         x.follows_lift, x.reach_before, x.reach_after, x.reach_lift_pct,
         x.nonfollower_before, x.nonfollower_after, x.nonfollower_lift_pct, x.computed_at, run_id
  from jsonb_to_recordset(coalesce(p_payload->'collabs', '[]'::jsonb))
    as x(date date, partner text, type text, notes text, net_follows_before integer,
         net_follows_after integer, follows_lift integer, reach_before integer, reach_after integer,
         reach_lift_pct numeric, nonfollower_before integer, nonfollower_after integer,
         nonfollower_lift_pct numeric, computed_at timestamptz)
  join public.partners pr on pr.name = btrim(x.partner) or btrim(x.partner) = any(pr.aliases)
  on conflict (collaboration_date, partner_id, collaboration_type) do nothing;

  insert into public.ig_item_links (item_id, media_id, reason, source)
  select i.id, p.media_id, 'مطابقة تلقائية تامة للرابط الدائم', 'exact_permalink'
  from public.items i
  join public.ig_posts p
    on public.canonical_instagram_permalink(i.ig_permalink) = public.canonical_instagram_permalink(p.permalink)
    or (i.ig_shortcode is not null and i.ig_shortcode = p.shortcode)
  where i.ig_permalink is not null and not i.is_archived and i.status = 'published'
    and not exists (select 1 from public.ig_item_links l where l.item_id = i.id or l.media_id = p.media_id)
  on conflict do nothing;

  update public.items i set ig_media_id = l.media_id, updated_at = now()
  from public.ig_item_links l
  where l.item_id = i.id and i.ig_media_id is null and not i.is_archived;

  counts := jsonb_build_object(
    'posts', jsonb_array_length(coalesce(p_payload->'posts', '[]'::jsonb)),
    'post_daily', jsonb_array_length(coalesce(p_payload->'post_daily', '[]'::jsonb)),
    'account_daily', jsonb_array_length(coalesce(p_payload->'account_daily', '[]'::jsonb)),
    'demographics', jsonb_array_length(coalesce(p_payload->'demographics', '[]'::jsonb)),
    'collabs', jsonb_array_length(coalesce(p_payload->'collabs', '[]'::jsonb))
  );
  accepted := (select sum(value::text::integer) from jsonb_each(counts));
  update public.analytics_sync_runs set status = 'accepted', row_counts = counts,
    accepted_count = accepted, completed_at = now() where id = run_id;
  return jsonb_build_object('replayed', false, 'run_id', run_id, 'accepted', accepted);
end;
$$;

alter table public.analytics_sync_runs enable row level security;
alter table public.analytics_sync_runs force row level security;
alter table public.ig_item_links enable row level security;
alter table public.ig_item_links force row level security;
alter table public.ig_collabs enable row level security;
alter table public.ig_collabs force row level security;
alter table public.ig_posts force row level security;
alter table public.ig_post_daily force row level security;
alter table public.ig_account_daily force row level security;
alter table public.ig_demographics force row level security;

drop policy if exists read_all on public.ig_posts;
drop policy if exists active_user_guard on public.ig_posts;
drop policy if exists password_ready_user_guard on public.ig_posts;
drop policy if exists read_all on public.ig_post_daily;
drop policy if exists active_user_guard on public.ig_post_daily;
drop policy if exists password_ready_user_guard on public.ig_post_daily;
drop policy if exists read_all on public.ig_account_daily;
drop policy if exists active_user_guard on public.ig_account_daily;
drop policy if exists password_ready_user_guard on public.ig_account_daily;
drop policy if exists read_all on public.ig_demographics;
drop policy if exists active_user_guard on public.ig_demographics;
drop policy if exists password_ready_user_guard on public.ig_demographics;
drop policy if exists read_all on public.ig_link_candidates;
drop policy if exists active_user_guard on public.ig_link_candidates;
drop policy if exists password_ready_user_guard on public.ig_link_candidates;
drop policy if exists admin_fix_links on public.ig_link_candidates;

revoke all on table public.analytics_sync_runs, public.ig_item_links, public.ig_collabs,
  public.ig_posts, public.ig_post_daily, public.ig_account_daily, public.ig_demographics,
  public.ig_link_candidates from public, anon, authenticated;
revoke all on table public.v_post_latest, public.v_item_performance,
  public.v_track_month, public.v_partner_month, public.v_partner_track,
  public.v_conflict_published_no_link,
  public.v_conflict_link_unresolved, public.v_conflict_orphan_posts
  from public, anon, authenticated;
grant select, insert, update on table public.analytics_sync_runs to service_role;
grant select, insert on table public.ig_item_links to service_role;
grant select, insert on table public.ig_collabs to service_role;
grant select, insert, update on table public.ig_posts to service_role;
grant select, insert, update on table public.ig_post_daily, public.ig_account_daily, public.ig_demographics to service_role;
grant select on table public.v_post_latest, public.v_item_performance,
  public.v_track_month, public.v_partner_month,
  public.v_partner_track, public.v_conflict_published_no_link,
  public.v_conflict_link_unresolved, public.v_conflict_orphan_posts to service_role;

revoke all on function public.guard_immutable_analytics_snapshot() from public;
revoke all on function public.admin_analytics_aggregates(date, date, text) from public, anon;
grant execute on function public.admin_analytics_aggregates(date, date, text) to authenticated;
revoke all on function public.admin_link_instagram_post(uuid, text, text) from public, anon;
grant execute on function public.admin_link_instagram_post(uuid, text, text) to authenticated;
revoke all on function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text) to service_role;
