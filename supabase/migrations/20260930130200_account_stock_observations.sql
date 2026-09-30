begin;

create table public.ig_account_stock_observations (
  observation_key text primary key,
  observed_at timestamptz not null,
  source text not null default 'instagram_profile',
  followers_count integer,
  media_count integer,
  missing_metrics text[] not null default '{}'::text[],
  source_timestamp timestamptz not null,
  sync_run_id uuid not null references public.analytics_sync_runs(id),
  created_at timestamptz not null default now(),
  constraint ig_account_stock_observations_key_check
    check (char_length(observation_key) between 8 and 128 and observation_key ~ '^[A-Za-z0-9._:-]+$'),
  constraint ig_account_stock_observations_source_check
    check (source = 'instagram_profile'),
  constraint ig_account_stock_observations_followers_nonnegative
    check (followers_count is null or followers_count >= 0),
  constraint ig_account_stock_observations_media_nonnegative
    check (media_count is null or media_count >= 0),
  constraint ig_account_stock_observations_measured_check
    check (followers_count is not null or media_count is not null),
  constraint ig_account_stock_observations_missing_names_check
    check (
      missing_metrics = public.normalize_analytics_metric_names(missing_metrics)
      and missing_metrics <@ array['followers_count', 'media_count']::text[]
    ),
  constraint ig_account_stock_observations_completeness_check
    check (
      (followers_count is null) = ('followers_count' = any(missing_metrics))
      and (media_count is null) = ('media_count' = any(missing_metrics))
    ),
  constraint ig_account_stock_observations_source_time_check
    check (observed_at <= source_timestamp),
  constraint ig_account_stock_observations_source_observed_unique
    unique (source, observed_at)
);

create index ig_account_stock_observations_observed_idx
  on public.ig_account_stock_observations (observed_at desc);
create index ig_account_stock_observations_sync_idx
  on public.ig_account_stock_observations (sync_run_id);

create trigger ig_account_stock_observations_immutable
before update or delete on public.ig_account_stock_observations
for each row execute function public.guard_immutable_analytics_snapshot();

alter table public.ig_account_stock_observations enable row level security;
alter table public.ig_account_stock_observations force row level security;

revoke all on table public.ig_account_stock_observations from public, anon, authenticated, service_role;
grant select on table public.ig_account_stock_observations to service_role;

alter function public.ingest_analytics_batch_impl(jsonb, text, timestamptz, timestamptz, text)
  rename to ingest_analytics_batch_without_account_stock;

revoke all on function public.ingest_analytics_batch_without_account_stock(jsonb, text, timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;

create function public.ingest_analytics_batch_impl(
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
  base_result jsonb;
  run_id uuid;
  counts jsonb;
  stock_received integer := 0;
  stock_inserted integer := 0;
  stock_identical integer := 0;
  received integer := 0;
  inserted integer := 0;
  updated integer := 0;
  identical integer := 0;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(coalesce(p_payload->'account_stock', '[]'::jsonb)) <> 'array'
  then
    raise exception 'INVALID_PAYLOAD';
  end if;

  if jsonb_array_length(coalesce(p_payload->'posts', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_payload->'post_daily', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_payload->'account_daily', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_payload->'account_stock', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_payload->'demographics', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_payload->'collabs', '[]'::jsonb)) > 500
  then
    raise exception 'BATCH_TOO_LARGE';
  end if;

  perform pg_advisory_xact_lock(hashtext('analytics-ingestion-v1'));

  create temporary table pg_temp.analytics_incoming_account_stock on commit drop as
  select x.observation_key,
         x.observed_at,
         btrim(x.source) as source,
         x.followers_count,
         x.media_count,
         public.normalize_analytics_metric_names(x.missing_metrics) as missing_metrics,
         p_source_timestamp as source_timestamp
  from jsonb_to_recordset(coalesce(p_payload->'account_stock', '[]'::jsonb))
    as x(
      observation_key text,
      observed_at timestamptz,
      source text,
      followers_count integer,
      media_count integer,
      missing_metrics text[]
    );

  if exists (
    select 1
    from pg_temp.analytics_incoming_account_stock
    where observation_key is null
      or char_length(observation_key) not between 8 and 128
      or observation_key !~ '^[A-Za-z0-9._:-]+$'
      or observed_at is null
      or source is null
      or source <> 'instagram_profile'
      or followers_count < 0
      or media_count < 0
      or (followers_count is null and media_count is null)
      or observed_at > source_timestamp
      or not (missing_metrics <@ array['followers_count', 'media_count']::text[])
      or (followers_count is null) <> ('followers_count' = any(missing_metrics))
      or (media_count is null) <> ('media_count' = any(missing_metrics))
  ) then
    raise exception 'INVALID_ACCOUNT_STOCK_OBSERVATION';
  end if;

  if exists (
    select 1
    from pg_temp.analytics_incoming_account_stock t
    group by observation_key
    having count(distinct to_jsonb(t)) > 1
  ) then
    raise exception 'DIVERGENT_ACCOUNT_STOCK_OBSERVATION_IN_REQUEST';
  end if;

  if exists (
    select 1
    from pg_temp.analytics_incoming_account_stock
    group by source, observed_at
    having count(distinct observation_key) > 1
  ) then
    raise exception 'ACCOUNT_STOCK_OBSERVED_AT_CONFLICT';
  end if;

  lock table public.ig_account_stock_observations in share row exclusive mode;

  if exists (
    select 1
    from pg_temp.analytics_incoming_account_stock t
    join public.ig_account_stock_observations e using (observation_key)
    where row(e.observed_at, e.source, e.followers_count, e.media_count,
              public.normalize_analytics_metric_names(e.missing_metrics))
      is distinct from
          row(t.observed_at, t.source, t.followers_count, t.media_count, t.missing_metrics)
  ) then
    raise exception 'DIVERGENT_ACCOUNT_STOCK_OBSERVATION';
  end if;

  if exists (
    select 1
    from pg_temp.analytics_incoming_account_stock t
    join public.ig_account_stock_observations e
      on e.source = t.source and e.observed_at = t.observed_at
    where e.observation_key <> t.observation_key
  ) then
    raise exception 'ACCOUNT_STOCK_OBSERVED_AT_CONFLICT';
  end if;

  base_result := public.ingest_analytics_batch_without_account_stock(
    p_payload,
    p_idempotency_key,
    p_signature_timestamp,
    p_source_timestamp,
    p_request_sha256
  );

  if coalesce((base_result->>'replayed')::boolean, false) then
    return base_result;
  end if;

  run_id := (base_result->>'run_id')::uuid;
  select count(*) into stock_received from pg_temp.analytics_incoming_account_stock;
  select count(*) into stock_inserted
  from (
    select distinct on (observation_key) *
    from pg_temp.analytics_incoming_account_stock
    order by observation_key
  ) t
  where not exists (
    select 1 from public.ig_account_stock_observations e
    where e.observation_key = t.observation_key
  );
  stock_identical := stock_received - stock_inserted;

  insert into public.ig_account_stock_observations (
    observation_key,
    observed_at,
    source,
    followers_count,
    media_count,
    missing_metrics,
    source_timestamp,
    sync_run_id
  )
  select t.observation_key,
         t.observed_at,
         t.source,
         t.followers_count,
         t.media_count,
         t.missing_metrics,
         t.source_timestamp,
         run_id
  from (
    select distinct on (observation_key) *
    from pg_temp.analytics_incoming_account_stock
    order by observation_key
  ) t
  where not exists (
    select 1 from public.ig_account_stock_observations e
    where e.observation_key = t.observation_key
  );

  counts := coalesce(base_result->'row_counts', '{}'::jsonb) || jsonb_build_object(
    'account_stock', jsonb_build_object(
      'received', stock_received,
      'inserted', stock_inserted,
      'updated', 0,
      'already_present_identical', stock_identical
    )
  );
  received := coalesce((base_result->>'received_count')::integer, 0) + stock_received;
  inserted := coalesce((base_result->>'inserted_count')::integer, 0) + stock_inserted;
  updated := coalesce((base_result->>'updated_count')::integer, 0);
  identical := coalesce((base_result->>'already_present_identical_count')::integer, 0) + stock_identical;

  update public.analytics_sync_runs
  set row_counts = counts,
      received_count = received,
      inserted_count = inserted,
      updated_count = updated,
      already_present_identical_count = identical,
      rejected_count = 0,
      completed_at = now()
  where id = run_id;

  return jsonb_build_object(
    'replayed', false,
    'run_id', run_id,
    'received_count', received,
    'inserted_count', inserted,
    'updated_count', updated,
    'already_present_identical_count', identical,
    'rejected_count', 0,
    'row_counts', counts
  );
end;
$$;

revoke all on function public.ingest_analytics_batch_impl(jsonb, text, timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ingest_analytics_batch_impl(jsonb, text, timestamptz, timestamptz, text)
  to service_role;
alter function public.ingest_analytics_batch_impl(jsonb, text, timestamptz, timestamptz, text)
  owner to postgres;

-- Preserve legacy report blocks while requiring provenance for new account-stock snapshots.
alter function public.valid_report_context_snapshot(jsonb, text)
  rename to valid_report_context_snapshot_v1;

revoke all on function public.valid_report_context_snapshot_v1(jsonb, text)
  from public, anon, authenticated, service_role;

create function public.valid_report_context_snapshot(
  p_snapshot jsonb,
  p_formula_version text
) returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p_formula_version = 'analytics-formulas-v1' then
      public.valid_report_context_snapshot_v1(p_snapshot, p_formula_version)
    when p_formula_version = 'analytics-formulas-v2'
      and p_snapshot->>'metric' <> 'account_overview' then
      public.valid_report_context_snapshot_v1(p_snapshot, 'analytics-formulas-v1')
    when p_formula_version = 'analytics-formulas-v2'
      and p_snapshot->>'metric' = 'account_overview' then
      p_snapshot->>'formula' = 'تدفقات الحساب يومية؛ رصيد المتابعين والمواد لقطات مستقلة بوقت رصد حقيقي؛ التغير محسوب بين رصدين مقاسين فقط'
      and public.valid_report_context_snapshot_v1(
        jsonb_set(
          p_snapshot - 'stock_observations',
          '{formula}',
          to_jsonb('المتابعون: آخر قياس؛ التغير: آخر قياس ناقص أول قياس؛ إجماليات الوصول والمشاهدات تظهر فقط عند اكتمال أيام الفترة'::text)
        ),
        'analytics-formulas-v1'
      )
      and case when jsonb_typeof(p_snapshot->'stock_observations') = 'array' then
        jsonb_array_length(p_snapshot->'stock_observations') <= 366
        and not exists (
          select 1
          from jsonb_array_elements(p_snapshot->'stock_observations') observation
          where jsonb_typeof(observation) <> 'object'
            or jsonb_typeof(observation->'observation_key') <> 'string'
            or char_length(btrim(observation->>'observation_key')) not between 1 and 128
            or jsonb_typeof(observation->'observed_at') <> 'string'
            or jsonb_typeof(observation->'source_time') <> 'string'
            or not (observation ? 'followers_count')
            or not (observation ? 'media_count')
            or not (observation ? 'missing_metrics')
            or jsonb_typeof(observation->'followers_count') not in ('number', 'null')
            or jsonb_typeof(observation->'media_count') not in ('number', 'null')
            or (jsonb_typeof(observation->'followers_count') = 'number'
                and (observation->>'followers_count') !~ '^[0-9]+$')
            or (jsonb_typeof(observation->'media_count') = 'number'
                and (observation->>'media_count') !~ '^[0-9]+$')
            or jsonb_typeof(observation->'missing_metrics') <> 'array'
            or (jsonb_typeof(observation->'followers_count') = 'null'
                and jsonb_typeof(observation->'media_count') = 'null')
            or (jsonb_typeof(observation->'followers_count') = 'null')
                <> ((observation->'missing_metrics') ? 'followers_count')
            or (jsonb_typeof(observation->'media_count') = 'null')
                <> ((observation->'missing_metrics') ? 'media_count')
            or case when jsonb_typeof(observation->'missing_metrics') = 'array' then
              exists (
                select 1 from jsonb_array_elements_text(observation->'missing_metrics') metric
                where metric not in ('followers_count', 'media_count')
              )
            else true end
        )
      else false end
    else false
  end;
$$;

revoke all on function public.valid_report_context_snapshot(jsonb, text)
  from public, anon, authenticated, service_role;
alter function public.valid_report_context_snapshot(jsonb, text) owner to postgres;

notify pgrst, 'reload schema';

commit;
