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

revoke all on function public.canonical_instagram_permalink(text) from public, anon, authenticated, service_role;

create or replace function public.canonical_instagram_shortcode(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select (regexp_match(
    public.canonical_instagram_permalink(p_value),
    '^https://www\.instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]+)/$'
  ))[1];
$$;

create or replace function public.normalize_analytics_metric_names(p_value text[])
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(array_agg(distinct metric order by metric), '{}'::text[])
  from unnest(coalesce(p_value, '{}'::text[])) as metric;
$$;

revoke all on function public.canonical_instagram_shortcode(text) from public, anon, authenticated, service_role;
revoke all on function public.normalize_analytics_metric_names(text[]) from public, anon, authenticated, service_role;

create table public.analytics_sync_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  request_sha256 text not null,
  signature_timestamp timestamptz not null,
  source_timestamp timestamptz not null,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('processing', 'accepted')),
  row_counts jsonb not null default '{}'::jsonb,
  received_count integer not null default 0 check (received_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  already_present_identical_count integer not null default 0 check (already_present_identical_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  safe_error_summary text,
  constraint analytics_sync_runs_signed_request_unique unique (signature_timestamp, request_sha256),
  constraint analytics_sync_runs_key_check check (char_length(idempotency_key) between 8 and 128),
  constraint analytics_sync_runs_sha_check check (request_sha256 ~ '^[0-9a-f]{64}$')
);

create index analytics_sync_runs_received_idx on public.analytics_sync_runs (received_at desc);
create index analytics_sync_runs_source_idx on public.analytics_sync_runs (source_timestamp desc);
create index analytics_sync_runs_idempotency_idx on public.analytics_sync_runs (idempotency_key, received_at desc);

create table public.ig_item_links (
  item_id uuid primary key references public.items(id) on delete cascade,
  media_id text not null unique references public.ig_posts(media_id) on delete cascade,
  linked_by uuid references public.profiles(id),
  linked_at timestamptz not null default now(),
  reason text not null,
  previous_legacy_media_id text,
  source text not null check (source in ('existing', 'exact_permalink', 'manual')),
  constraint ig_item_links_reason_check check (char_length(btrim(reason)) between 4 and 500),
  constraint ig_item_links_actor_check check (
    (source = 'manual' and linked_by is not null)
    or (source <> 'manual')
  ),
  constraint ig_item_links_legacy_audit_check check (
    previous_legacy_media_id is null
    or (source = 'manual' and previous_legacy_media_id <> media_id)
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
  source_timestamp timestamptz not null,
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
join public.ig_posts p on p.media_id = i.ig_media_id
where i.ig_media_id is not null
  and not i.is_archived
  and public.canonical_instagram_permalink(i.ig_permalink) is not null
  and public.canonical_instagram_permalink(p.permalink) is not null
  and (
    public.canonical_instagram_permalink(i.ig_permalink) = public.canonical_instagram_permalink(p.permalink)
    or public.canonical_instagram_shortcode(i.ig_permalink) = public.canonical_instagram_shortcode(p.permalink)
  )
  and not exists (
    select 1 from public.items other
    where other.ig_media_id = i.ig_media_id and other.id <> i.id and not other.is_archived
  )
on conflict do nothing;

create or replace function public.guard_item_analytics_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.ig_media_id is not distinct from old.ig_media_id then
    return new;
  end if;
  if new.ig_media_id is null then
    if exists (select 1 from public.ig_item_links where item_id = new.id) then
      raise exception 'AUTHORITATIVE_ANALYTICS_LINK_REQUIRED';
    end if;
    return new;
  end if;
  if not exists (
    select 1 from public.ig_item_links
    where item_id = new.id and media_id = new.ig_media_id
  ) then
    raise exception 'AUTHORITATIVE_ANALYTICS_LINK_REQUIRED';
  end if;
  return new;
end;
$$;

create trigger items_analytics_identity_guard
before update of ig_media_id on public.items
for each row execute function public.guard_item_analytics_identity();

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

create or replace view public.v_conflict_link_unresolved
with (security_invoker = true)
as
select i.id, i.ref, i.title, i.ig_permalink, i.published_at
from public.items i
where i.ig_permalink is not null
  and not exists (select 1 from public.ig_item_links l where l.item_id = i.id)
  and i.published_at < now() - interval '36 hours'
  and not i.is_archived;

create or replace view public.v_conflict_orphan_posts
with (security_invoker = true)
as
select p.media_id, p.permalink, p.published_at, p.caption, d.reach
from public.ig_posts p
left join public.ig_item_links l on l.media_id = p.media_id
left join public.v_post_latest d on d.media_id = p.media_id
where l.media_id is null
order by p.published_at desc;

create or replace function public.mark_published(
  p_item uuid,
  p_permalink text,
  p_at timestamptz default now(),
  p_override_reason text default null
) returns public.items
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  it public.items;
  v text[] := '{}';
  ovr boolean := false;
  canonical_permalink text;
  canonical_shortcode text;
begin
  perform public.assert_can_use_app();
  if not public.can_publish_items() then
    raise exception 'ROLE_REQUIRED: تعليم النشر يحتاج مسؤول النشر أو الأدمن';
  end if;

  select * into it from public.items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then raise exception 'ARCHIVED_IMMUTABLE'; end if;

  canonical_permalink := public.canonical_instagram_permalink(p_permalink);
  canonical_shortcode := public.canonical_instagram_shortcode(p_permalink);
  if canonical_permalink is null or canonical_shortcode is null then
    raise exception 'RULE_VIOLATION: الرابط ليس رابط HTTPS صالحاً لمنشور إنستغرام';
  end if;

  if it.status <> 'ready' then
    v := array_append(v, format('المادة ليست جاهزة للنشر (%s)', it.status));
  end if;
  if exists (
    select 1 from public.items other
    where other.id <> p_item
      and public.canonical_instagram_permalink(other.ig_permalink) is not null
      and public.canonical_instagram_shortcode(other.ig_permalink) = canonical_shortcode
  ) then
    v := array_append(v, 'هذا الرابط مربوط بمادة أخرى');
  end if;

  if array_length(v, 1) > 0 then
    if public.is_admin() and coalesce(btrim(p_override_reason), '') <> '' then
      ovr := true;
    else
      raise exception 'RULE_VIOLATION: %', array_to_string(v, ' · ');
    end if;
  end if;

  perform set_config('app.rpc', 'on', true);
  insert into public.transitions (item_id, from_status, to_status, actor_id,
                                  is_override, override_reason, violations)
  values (p_item, it.status, 'published', auth.uid(),
          ovr, nullif(btrim(coalesce(p_override_reason, '')), ''), nullif(v, '{}'));

  update public.items
  set status = 'published', published_at = p_at, ig_permalink = canonical_permalink
  where id = p_item
  returning * into it;

  perform public.refresh_slot_state(it.slot_id);
  return it;
end;
$$;

create or replace function public.admin_analytics_aggregates(
  p_start date,
  p_end date,
  p_media_type text default null
) returns table (
  dimension text,
  dimension_key text,
  dimension_name text,
  n integer,
  measured_reach_n integer,
  measured_save_rate_n integer,
  measured_share_rate_n integer,
  measured_signal_n integer,
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
      and (
        p_media_type is null
        or (p_media_type = 'REELS' and v.product_type = 'REELS')
        or (p_media_type = 'VIDEO' and v.media_type = 'VIDEO' and v.product_type is distinct from 'REELS')
        or (p_media_type in ('IMAGE', 'CAROUSEL_ALBUM') and v.media_type = p_media_type)
      )
  ), grouped as (
    select 'month'::text as group_dimension,
           to_char(date_trunc('month', v.published_at at time zone public.app_tz()), 'YYYY-MM') as group_key,
           to_char(date_trunc('month', v.published_at at time zone public.app_tz()), 'YYYY-MM') as group_name,
           count(*)::integer as group_n,
           count(v.reach)::integer as group_reach_n,
           count(v.save_rate)::integer as group_save_n,
           count(v.share_rate)::integer as group_share_n,
           count(v.signal)::integer as group_signal_n,
           percentile_cont(0.5) within group (order by v.reach)::double precision as group_reach,
           percentile_cont(0.5) within group (order by v.save_rate)::double precision as group_save,
           percentile_cont(0.5) within group (order by v.share_rate)::double precision as group_share,
           percentile_cont(0.5) within group (order by v.signal)::double precision as group_signal,
           true as group_sufficient
    from filtered v group by 2, 3
    union all
    select 'track', v.track_id::text, v.track_name, count(*)::integer,
           count(v.reach)::integer, count(v.save_rate)::integer,
           count(v.share_rate)::integer, count(v.signal)::integer,
           percentile_cont(0.5) within group (order by v.reach)::double precision,
           percentile_cont(0.5) within group (order by v.save_rate)::double precision,
           percentile_cont(0.5) within group (order by v.share_rate)::double precision,
           percentile_cont(0.5) within group (order by v.signal)::double precision,
           true
    from filtered v where v.track_id is not null group by v.track_id, v.track_name
    union all
    select 'idea_type', v.idea_type_id::text, v.idea_type, count(*)::integer,
           count(v.reach)::integer, count(v.save_rate)::integer,
           count(v.share_rate)::integer, count(v.signal)::integer,
           percentile_cont(0.5) within group (order by v.reach)::double precision,
           percentile_cont(0.5) within group (order by v.save_rate)::double precision,
           percentile_cont(0.5) within group (order by v.share_rate)::double precision,
           percentile_cont(0.5) within group (order by v.signal)::double precision,
           true
    from filtered v where v.idea_type_id is not null group by v.idea_type_id, v.idea_type
    union all
    select 'partner', pr.id::text, pr.name, count(*)::integer,
           count(v.reach)::integer, count(v.save_rate)::integer,
           count(v.share_rate)::integer, count(v.signal)::integer,
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
           count(v.reach)::integer, count(v.save_rate)::integer,
           count(v.share_rate)::integer, count(v.signal)::integer,
           case when count(v.reach) >= 5 then percentile_cont(0.5) within group (order by v.reach)::double precision end,
           case when count(v.save_rate) >= 5 then percentile_cont(0.5) within group (order by v.save_rate)::double precision end,
           case when count(v.share_rate) >= 5 then percentile_cont(0.5) within group (order by v.share_rate)::double precision end,
           case when count(v.signal) >= 5 then percentile_cont(0.5) within group (order by v.signal)::double precision end,
           count(v.signal) >= 5
    from filtered v
    join public.item_partners ip on ip.item_id = v.id
    join public.partners pr on pr.id = ip.partner_id
    where v.track_id is not null
    group by pr.id, pr.name, v.track_id, v.track_name
  )
  select group_dimension, group_key, group_name, group_n,
         group_reach_n, group_save_n, group_share_n, group_signal_n,
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

  insert into public.ig_item_links (
    item_id, media_id, linked_by, reason, previous_legacy_media_id, source
  ) values (
    p_item_id, p_media_id, auth.uid(), btrim(p_reason),
    case when target_item.ig_media_id is distinct from p_media_id then target_item.ig_media_id end,
    'manual'
  )
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
  received integer := 0;
  inserted integer := 0;
  updated integer := 0;
  identical integer := 0;
  posts_received integer := 0;
  posts_inserted integer := 0;
  posts_updated integer := 0;
  posts_identical integer := 0;
  post_daily_received integer := 0;
  post_daily_inserted integer := 0;
  post_daily_identical integer := 0;
  account_received integer := 0;
  account_inserted integer := 0;
  account_identical integer := 0;
  demographics_received integer := 0;
  demographics_inserted integer := 0;
  demographics_identical integer := 0;
  collabs_received integer := 0;
  collabs_inserted integer := 0;
  collabs_identical integer := 0;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'INVALID_PAYLOAD'; end if;
  if jsonb_typeof(coalesce(p_payload->'posts', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_payload->'post_daily', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_payload->'account_daily', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_payload->'demographics', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_payload->'collabs', '[]'::jsonb)) <> 'array'
  then raise exception 'INVALID_PAYLOAD'; end if;
  if jsonb_array_length(coalesce(p_payload->'posts', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_payload->'post_daily', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_payload->'account_daily', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_payload->'demographics', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_payload->'collabs', '[]'::jsonb)) > 500
  then raise exception 'BATCH_TOO_LARGE'; end if;

  -- All ingestion requests share one transaction lock. This makes the preflight
  -- comparison and subsequent inserts atomic even for different request keys.
  perform pg_advisory_xact_lock(hashtext('analytics-ingestion-v1'));
  insert into public.analytics_sync_runs (
    idempotency_key, request_sha256, signature_timestamp, source_timestamp, status
  ) values (
    p_idempotency_key, p_request_sha256, p_signature_timestamp, p_source_timestamp, 'processing'
  ) on conflict do nothing returning id into run_id;
  if run_id is null then return jsonb_build_object('replayed', true); end if;

  create temporary table pg_temp.analytics_incoming_posts on commit drop as
  select x.post_id as media_id, x.published_at,
         nullif(btrim(x.media_type), '') as media_type,
         nullif(btrim(x.product_type), '') as product_type,
         public.canonical_instagram_permalink(x.permalink) as permalink,
         nullif(left(x.caption, 500), '') as caption
  from jsonb_to_recordset(coalesce(p_payload->'posts', '[]'::jsonb))
    as x(post_id text, published_at timestamptz, media_type text, product_type text, permalink text, caption text);

  create temporary table pg_temp.analytics_incoming_post_daily on commit drop as
  select x.post_id as media_id, x.snapshot_date, x.age_days, x.likes, x.comments,
         x.reach, x.views, x.saved, x.shares, x.interactions, x.profile_visits,
         x.follows, x.avg_watch_ms,
         public.normalize_analytics_metric_names(x.missing_metrics) as missing_metrics,
         p_source_timestamp as source_timestamp
  from jsonb_to_recordset(coalesce(p_payload->'post_daily', '[]'::jsonb))
    as x(post_id text, snapshot_date date, age_days integer, likes integer, comments integer,
          reach integer, views integer, saved integer, shares integer, interactions integer,
          profile_visits integer, follows integer, avg_watch_ms integer, missing_metrics text[]);

  create temporary table pg_temp.analytics_incoming_account_daily on commit drop as
  select x.date, x.followers, x.media_count, x.reach, x.views, x.reach_followers,
         x.reach_non_followers, x.follows, x.unfollows,
         public.normalize_analytics_metric_names(x.missing_metrics) as missing_metrics,
         p_source_timestamp as source_timestamp
  from jsonb_to_recordset(coalesce(p_payload->'account_daily', '[]'::jsonb))
    as x(date date, followers integer, media_count integer, reach integer, views integer,
          reach_followers integer, reach_non_followers integer, follows integer, unfollows integer,
          missing_metrics text[]);

  create temporary table pg_temp.analytics_incoming_demographics on commit drop as
  select x.snapshot_date, btrim(x.dimension) as dimension, btrim(x.key) as key,
         x.value, p_source_timestamp as source_timestamp
  from jsonb_to_recordset(coalesce(p_payload->'demographics', '[]'::jsonb))
    as x(snapshot_date date, dimension text, key text, value integer);

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'collabs', '[]'::jsonb)) as x(partner text)
    where (select count(*) from public.partners pr
           where pr.name = btrim(x.partner) or btrim(x.partner) = any(pr.aliases)) <> 1
  ) then
    raise exception 'UNKNOWN_OR_AMBIGUOUS_PARTNER';
  end if;

  create temporary table pg_temp.analytics_incoming_collabs on commit drop as
  select x.date as collaboration_date, pr.id as partner_id,
         nullif(btrim(x.type), '') as collaboration_type,
         nullif(btrim(x.notes), '') as notes,
         x.net_follows_before, x.net_follows_after,
         x.follows_lift, x.reach_before, x.reach_after, x.reach_lift_pct,
         x.nonfollower_before, x.nonfollower_after, x.nonfollower_lift_pct,
         x.computed_at, p_source_timestamp as source_timestamp
  from jsonb_to_recordset(coalesce(p_payload->'collabs', '[]'::jsonb))
    as x(date date, partner text, type text, notes text, net_follows_before integer,
          net_follows_after integer, follows_lift integer, reach_before integer, reach_after integer,
          reach_lift_pct numeric, nonfollower_before integer, nonfollower_after integer,
          nonfollower_lift_pct numeric, computed_at timestamptz)
  join public.partners pr on pr.name = btrim(x.partner) or btrim(x.partner) = any(pr.aliases);

  if exists (select 1 from pg_temp.analytics_incoming_posts where permalink is null) then
    raise exception 'INVALID_PERMALINK';
  end if;

  -- A repeated key inside one payload is safe only when every normalized semantic
  -- value is identical. Different values reject the entire transaction.
  if exists (select 1 from pg_temp.analytics_incoming_posts t group by media_id having count(distinct to_jsonb(t)) > 1)
    or exists (select 1 from pg_temp.analytics_incoming_post_daily t group by media_id, snapshot_date having count(distinct to_jsonb(t)) > 1)
    or exists (select 1 from pg_temp.analytics_incoming_account_daily t group by date having count(distinct to_jsonb(t)) > 1)
    or exists (select 1 from pg_temp.analytics_incoming_demographics t group by snapshot_date, dimension, key having count(distinct to_jsonb(t)) > 1)
    or exists (select 1 from pg_temp.analytics_incoming_collabs t group by collaboration_date, partner_id, collaboration_type having count(distinct to_jsonb(t)) > 1)
  then
    raise exception 'DIVERGENT_DUPLICATE_IN_REQUEST';
  end if;

  lock table public.ig_posts, public.ig_post_daily, public.ig_account_daily,
    public.ig_demographics, public.ig_collabs in share row exclusive mode;

  if exists (
    select 1 from pg_temp.analytics_incoming_post_daily t
    join public.ig_post_daily e using (media_id, snapshot_date)
    where row(e.age_days, e.likes, e.comments, e.reach, e.views, e.saved, e.shares,
              e.interactions, e.profile_visits, e.follows, e.avg_watch_ms,
              public.normalize_analytics_metric_names(e.missing_metrics), e.source_timestamp)
      is distinct from
          row(t.age_days, t.likes, t.comments, t.reach, t.views, t.saved, t.shares,
              t.interactions, t.profile_visits, t.follows, t.avg_watch_ms,
              t.missing_metrics, t.source_timestamp)
  ) then raise exception 'DIVERGENT_POST_DAILY_SNAPSHOT'; end if;

  if exists (
    select 1 from pg_temp.analytics_incoming_account_daily t
    join public.ig_account_daily e using (date)
    where row(e.followers, e.media_count, e.reach, e.views, e.reach_followers,
              e.reach_non_followers, e.follows, e.unfollows,
              public.normalize_analytics_metric_names(e.missing_metrics), e.source_timestamp)
      is distinct from
          row(t.followers, t.media_count, t.reach, t.views, t.reach_followers,
              t.reach_non_followers, t.follows, t.unfollows,
              t.missing_metrics, t.source_timestamp)
  ) then raise exception 'DIVERGENT_ACCOUNT_DAILY_SNAPSHOT'; end if;

  if exists (
    select 1 from pg_temp.analytics_incoming_demographics t
    join public.ig_demographics e using (snapshot_date, dimension, key)
    where row(e.value, e.source_timestamp) is distinct from row(t.value, t.source_timestamp)
  ) then raise exception 'DIVERGENT_DEMOGRAPHIC_SNAPSHOT'; end if;

  if exists (
    select 1 from pg_temp.analytics_incoming_collabs t
    join public.ig_collabs e
      on e.collaboration_date = t.collaboration_date
     and e.partner_id = t.partner_id
     and e.collaboration_type is not distinct from t.collaboration_type
    where row(e.notes, e.net_follows_before, e.net_follows_after, e.follows_lift,
              e.reach_before, e.reach_after, e.reach_lift_pct,
              e.nonfollower_before, e.nonfollower_after, e.nonfollower_lift_pct,
              e.computed_at, e.source_timestamp)
      is distinct from
          row(t.notes, t.net_follows_before, t.net_follows_after, t.follows_lift,
              t.reach_before, t.reach_after, t.reach_lift_pct,
              t.nonfollower_before, t.nonfollower_after, t.nonfollower_lift_pct,
              t.computed_at, t.source_timestamp)
  ) then raise exception 'DIVERGENT_COLLAB_SNAPSHOT'; end if;

  select count(*) into posts_received from pg_temp.analytics_incoming_posts;
  select count(*) filter (where e.media_id is null),
         count(*) filter (where e.media_id is not null and
           row(e.published_at, e.media_type, e.product_type, e.permalink, e.caption)
           is distinct from row(t.published_at, t.media_type, t.product_type, t.permalink, t.caption))
    into posts_inserted, posts_updated
  from (select distinct on (media_id) * from pg_temp.analytics_incoming_posts order by media_id) t
  left join public.ig_posts e using (media_id);
  posts_identical := posts_received - posts_inserted - posts_updated;

  select count(*) into post_daily_received from pg_temp.analytics_incoming_post_daily;
  select count(*) into post_daily_inserted
  from (select distinct on (media_id, snapshot_date) * from pg_temp.analytics_incoming_post_daily order by media_id, snapshot_date) t
  where not exists (select 1 from public.ig_post_daily e where e.media_id = t.media_id and e.snapshot_date = t.snapshot_date);
  post_daily_identical := post_daily_received - post_daily_inserted;

  select count(*) into account_received from pg_temp.analytics_incoming_account_daily;
  select count(*) into account_inserted
  from (select distinct on (date) * from pg_temp.analytics_incoming_account_daily order by date) t
  where not exists (select 1 from public.ig_account_daily e where e.date = t.date);
  account_identical := account_received - account_inserted;

  select count(*) into demographics_received from pg_temp.analytics_incoming_demographics;
  select count(*) into demographics_inserted
  from (select distinct on (snapshot_date, dimension, key) * from pg_temp.analytics_incoming_demographics order by snapshot_date, dimension, key) t
  where not exists (select 1 from public.ig_demographics e where e.snapshot_date = t.snapshot_date and e.dimension = t.dimension and e.key = t.key);
  demographics_identical := demographics_received - demographics_inserted;

  select count(*) into collabs_received from pg_temp.analytics_incoming_collabs;
  select count(*) into collabs_inserted
  from (select distinct on (collaboration_date, partner_id, collaboration_type) * from pg_temp.analytics_incoming_collabs order by collaboration_date, partner_id, collaboration_type) t
  where not exists (
    select 1 from public.ig_collabs e
    where e.collaboration_date = t.collaboration_date and e.partner_id = t.partner_id
      and e.collaboration_type is not distinct from t.collaboration_type
  );
  collabs_identical := collabs_received - collabs_inserted;

  insert into public.ig_posts (media_id, published_at, media_type, product_type, permalink, caption, synced_at)
  select t.media_id, t.published_at, t.media_type, t.product_type, t.permalink, t.caption, now()
  from (select distinct on (media_id) * from pg_temp.analytics_incoming_posts order by media_id) t
  where not exists (select 1 from public.ig_posts e where e.media_id = t.media_id);

  update public.ig_posts e
  set published_at = t.published_at, media_type = t.media_type, product_type = t.product_type,
      permalink = t.permalink, caption = t.caption, synced_at = now()
  from (select distinct on (media_id) * from pg_temp.analytics_incoming_posts order by media_id) t
  where e.media_id = t.media_id
    and row(e.published_at, e.media_type, e.product_type, e.permalink, e.caption)
        is distinct from row(t.published_at, t.media_type, t.product_type, t.permalink, t.caption);

  insert into public.ig_post_daily (
    media_id, snapshot_date, age_days, likes, comments, reach, views, saved, shares,
    interactions, profile_visits, follows, avg_watch_ms, missing_metrics, source_timestamp, sync_run_id
  )
  select t.media_id, t.snapshot_date, t.age_days, t.likes, t.comments, t.reach, t.views,
         t.saved, t.shares, t.interactions, t.profile_visits, t.follows, t.avg_watch_ms,
         t.missing_metrics, t.source_timestamp, run_id
  from (select distinct on (media_id, snapshot_date) * from pg_temp.analytics_incoming_post_daily order by media_id, snapshot_date) t
  where not exists (select 1 from public.ig_post_daily e where e.media_id = t.media_id and e.snapshot_date = t.snapshot_date);

  insert into public.ig_account_daily (
    date, followers, media_count, reach, views, reach_followers, reach_non_followers,
    follows, unfollows, missing_metrics, source_timestamp, sync_run_id
  )
  select t.date, t.followers, t.media_count, t.reach, t.views, t.reach_followers,
         t.reach_non_followers, t.follows, t.unfollows, t.missing_metrics, t.source_timestamp, run_id
  from (select distinct on (date) * from pg_temp.analytics_incoming_account_daily order by date) t
  where not exists (select 1 from public.ig_account_daily e where e.date = t.date);

  insert into public.ig_demographics (snapshot_date, dimension, key, value, source_timestamp, sync_run_id)
  select t.snapshot_date, t.dimension, t.key, t.value, t.source_timestamp, run_id
  from (select distinct on (snapshot_date, dimension, key) * from pg_temp.analytics_incoming_demographics order by snapshot_date, dimension, key) t
  where not exists (select 1 from public.ig_demographics e where e.snapshot_date = t.snapshot_date and e.dimension = t.dimension and e.key = t.key);

  insert into public.ig_collabs (
    collaboration_date, partner_id, collaboration_type, notes, net_follows_before, net_follows_after,
    follows_lift, reach_before, reach_after, reach_lift_pct, nonfollower_before, nonfollower_after,
    nonfollower_lift_pct, computed_at, source_timestamp, sync_run_id
  )
  select t.collaboration_date, t.partner_id, t.collaboration_type, t.notes,
         t.net_follows_before, t.net_follows_after, t.follows_lift, t.reach_before,
         t.reach_after, t.reach_lift_pct, t.nonfollower_before, t.nonfollower_after,
         t.nonfollower_lift_pct, t.computed_at, t.source_timestamp, run_id
  from (select distinct on (collaboration_date, partner_id, collaboration_type) * from pg_temp.analytics_incoming_collabs order by collaboration_date, partner_id, collaboration_type) t
  where not exists (
    select 1 from public.ig_collabs e
    where e.collaboration_date = t.collaboration_date and e.partner_id = t.partner_id
      and e.collaboration_type is not distinct from t.collaboration_type
  );

  insert into public.ig_item_links (item_id, media_id, reason, source)
  select i.id, p.media_id, 'مطابقة تلقائية تامة للرابط الدائم', 'exact_permalink'
  from public.items i
  join public.ig_posts p
    on public.canonical_instagram_permalink(i.ig_permalink) is not null
   and public.canonical_instagram_permalink(p.permalink) is not null
   and (
     public.canonical_instagram_permalink(i.ig_permalink) = public.canonical_instagram_permalink(p.permalink)
     or public.canonical_instagram_shortcode(i.ig_permalink) = public.canonical_instagram_shortcode(p.permalink)
   )
  where not i.is_archived and i.status = 'published'
    and (i.ig_media_id is null or i.ig_media_id = p.media_id)
    and not exists (select 1 from public.ig_item_links l where l.item_id = i.id or l.media_id = p.media_id)
  on conflict do nothing;

  update public.items i set ig_media_id = l.media_id, updated_at = now()
  from public.ig_item_links l
  where l.item_id = i.id and i.ig_media_id is distinct from l.media_id and not i.is_archived;

  counts := jsonb_build_object(
    'posts', jsonb_build_object('received', posts_received, 'inserted', posts_inserted, 'updated', posts_updated, 'already_present_identical', posts_identical),
    'post_daily', jsonb_build_object('received', post_daily_received, 'inserted', post_daily_inserted, 'updated', 0, 'already_present_identical', post_daily_identical),
    'account_daily', jsonb_build_object('received', account_received, 'inserted', account_inserted, 'updated', 0, 'already_present_identical', account_identical),
    'demographics', jsonb_build_object('received', demographics_received, 'inserted', demographics_inserted, 'updated', 0, 'already_present_identical', demographics_identical),
    'collabs', jsonb_build_object('received', collabs_received, 'inserted', collabs_inserted, 'updated', 0, 'already_present_identical', collabs_identical)
  );

  received := posts_received + post_daily_received + account_received + demographics_received + collabs_received;
  inserted := posts_inserted + post_daily_inserted + account_inserted + demographics_inserted + collabs_inserted;
  updated := posts_updated;
  identical := posts_identical + post_daily_identical + account_identical + demographics_identical + collabs_identical;
  update public.analytics_sync_runs set status = 'accepted', row_counts = counts,
    received_count = received, inserted_count = inserted, updated_count = updated,
    already_present_identical_count = identical, rejected_count = 0,
    completed_at = now() where id = run_id;
  return jsonb_build_object(
    'replayed', false, 'run_id', run_id,
    'received_count', received, 'inserted_count', inserted, 'updated_count', updated,
    'already_present_identical_count', identical, 'rejected_count', 0,
    'row_counts', counts
  );
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
  public.ig_link_candidates from public, anon, authenticated, service_role;
revoke all on table public.v_post_latest, public.v_item_performance,
  public.v_track_month, public.v_partner_month, public.v_partner_track,
  public.v_conflict_published_no_link,
  public.v_conflict_link_unresolved, public.v_conflict_orphan_posts
  from public, anon, authenticated, service_role;
grant select on table public.analytics_sync_runs to service_role;
grant select on table public.ig_item_links to service_role;
grant select on table public.ig_collabs to service_role;
grant select on table public.ig_posts, public.ig_post_daily,
  public.ig_account_daily, public.ig_demographics to service_role;
grant select on table public.v_post_latest, public.v_item_performance,
  public.v_track_month, public.v_partner_month,
  public.v_partner_track, public.v_conflict_published_no_link,
  public.v_conflict_link_unresolved, public.v_conflict_orphan_posts to service_role;

revoke all on function public.guard_immutable_analytics_snapshot() from public, anon, authenticated, service_role;
revoke all on function public.guard_item_analytics_identity() from public, anon, authenticated, service_role;
revoke all on function public.mark_published(uuid, text, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_published(uuid, text, timestamptz, text) to authenticated;
revoke all on function public.admin_analytics_aggregates(date, date, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_analytics_aggregates(date, date, text) to authenticated;
revoke all on function public.admin_link_instagram_post(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_link_instagram_post(uuid, text, text) to authenticated;
revoke all on function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text) to service_role;

alter function public.mark_published(uuid, text, timestamptz, text) owner to postgres;
alter function public.admin_analytics_aggregates(date, date, text) owner to postgres;
alter function public.admin_link_instagram_post(uuid, text, text) owner to postgres;
alter function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text) owner to postgres;
