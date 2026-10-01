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

-- Recompile the gateway after the implementation rename so existing sessions
-- resolve the current implementation instead of retaining the previous OID.
create or replace function public.ingest_analytics_batch(
  p_payload jsonb,
  p_idempotency_key text,
  p_signature_timestamp timestamptz,
  p_source_timestamp timestamptz,
  p_request_sha256 text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  return public.ingest_analytics_batch_impl(
    p_payload,
    p_idempotency_key,
    p_signature_timestamp,
    p_source_timestamp,
    p_request_sha256
  );
end;
$$;

revoke all on function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text)
  to service_role;
alter function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text)
  owner to postgres;

-- Preserve legacy report blocks while requiring provenance for new account-stock snapshots.
alter function public.valid_report_context_snapshot(jsonb, text)
  rename to valid_report_context_snapshot_v1;

revoke all on function public.valid_report_context_snapshot_v1(jsonb, text)
  from public, anon, authenticated, service_role;

-- Match the TypeScript stock timestamp grammar; always require an explicit zone.
-- TypeScript preserves PostgreSQL microseconds when comparing instants.
create function public.valid_report_stock_timestamp(p_value text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$'
    or left(p_value, 4)::integer = 0 then return false; end if;
  perform left(p_value, 10)::date;
  perform p_value::timestamptz;
  return true;
exception when data_exception then return false;
end;
$$;

revoke all on function public.valid_report_stock_timestamp(text) from public, anon, authenticated, service_role;
alter function public.valid_report_stock_timestamp(text) owner to postgres;

create function public.valid_report_context_snapshot(
  p_snapshot jsonb,
  p_formula_version text
) returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  observation jsonb;
  metric text;
  expected_missing text[];
begin
  if p_formula_version = 'analytics-formulas-v1' then
    return public.valid_report_context_snapshot_v1(p_snapshot, p_formula_version);
  end if;
  if p_formula_version is distinct from 'analytics-formulas-v2' then return false; end if;
  if p_snapshot->>'metric' is distinct from 'account_overview' then
    return coalesce(public.valid_report_context_snapshot_v1(p_snapshot, 'analytics-formulas-v1'), false);
  end if;
  if p_snapshot->>'formula' is distinct from 'تدفقات الحساب يومية؛ رصيد المتابعين والمواد لقطات مستقلة بوقت رصد حقيقي؛ التغير محسوب بين رصدين مقاسين فقط'
    or not coalesce(public.valid_report_context_snapshot_v1(
      jsonb_set(p_snapshot - 'stock_observations', '{formula}',
        to_jsonb('المتابعون: آخر قياس؛ التغير: آخر قياس ناقص أول قياس؛ إجماليات الوصول والمشاهدات تظهر فقط عند اكتمال أيام الفترة'::text)),
      'analytics-formulas-v1'), false)
    or jsonb_typeof(p_snapshot->'stock_observations') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_snapshot->'stock_observations') > 366 then return false; end if;
  if p_snapshot->'source_time' <> 'null'::jsonb
    and not public.valid_report_stock_timestamp(p_snapshot->>'source_time') then return false; end if;
  for observation in select value from jsonb_array_elements(p_snapshot->'stock_observations') loop
    if jsonb_typeof(observation) is distinct from 'object'
      or not (observation ?& array['observation_key', 'observed_at', 'source_time', 'followers_count', 'media_count', 'missing_metrics'])
      or jsonb_typeof(observation->'observation_key') is distinct from 'string'
      or (observation->>'observation_key') !~ '^[A-Za-z0-9._:-]{8,128}$'
      or jsonb_typeof(observation->'observed_at') is distinct from 'string'
      or jsonb_typeof(observation->'source_time') is distinct from 'string'
      or not public.valid_report_stock_timestamp(observation->>'observed_at')
      or not public.valid_report_stock_timestamp(observation->>'source_time') then return false; end if;
    if (observation->>'observed_at')::timestamptz > (observation->>'source_time')::timestamptz then return false; end if;
    foreach metric in array array['followers_count', 'media_count'] loop
      if jsonb_typeof(observation->metric) not in ('number', 'null') then return false; end if;
      if jsonb_typeof(observation->metric) = 'number' then
        if (observation->>metric)::numeric < 0 or (observation->>metric)::numeric > 2147483647
          or trunc((observation->>metric)::numeric) <> (observation->>metric)::numeric then return false; end if;
      end if;
    end loop;
    if observation->'followers_count' = 'null'::jsonb and observation->'media_count' = 'null'::jsonb then return false; end if;
    expected_missing := array_remove(array[
      case when observation->'followers_count' = 'null'::jsonb then 'followers_count' end,
      case when observation->'media_count' = 'null'::jsonb then 'media_count' end
    ]::text[], null);
    -- Exact equality enforces the allowlist, order, uniqueness, and NULL agreement.
    if observation->'missing_metrics' is distinct from to_jsonb(expected_missing) then return false; end if;
  end loop;
  return true;
exception when data_exception then return false;
end;
$$;

revoke all on function public.valid_report_context_snapshot(jsonb, text)
  from public, anon, authenticated, service_role;
alter function public.valid_report_context_snapshot(jsonb, text) owner to postgres;

-- Rebind the RPC after the validator rename and keep the larger bound account-v2-only.
-- A 366-day UI-shaped snapshot measures 129798 compact UTF-8 bytes in Node.
-- JSONB whitespace estimate: 137203 bytes; the disposable SQL test measures it.
create or replace function public.admin_add_report_context_block(
  p_report_id uuid, p_block_type text, p_title text, p_input_snapshot jsonb, p_formula_version text
) returns public.report_context_blocks
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result public.report_context_blocks;
  max_bytes integer := case when p_block_type = 'account'
    and p_formula_version = 'analytics-formulas-v2'
    and p_input_snapshot->>'metric' = 'account_overview' then 262144 else 65536 end;
begin
  if not public.is_active_user() or not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.reports where id = p_report_id) then raise exception 'REPORT_NOT_FOUND'; end if;
  if p_block_type not in ('account', 'comparison', 'partner_track', 'posts', 'audience')
    or char_length(btrim(coalesce(p_title, ''))) not between 1 and 160
    or p_input_snapshot is null or octet_length(p_input_snapshot::text) > max_bytes
    or not coalesce(public.valid_report_context_snapshot(p_input_snapshot, p_formula_version)
      or public.valid_advanced_report_context_snapshot(p_input_snapshot, p_formula_version), false) then
    raise exception 'INVALID_REPORT_CONTEXT';
  end if;
  perform 1 from public.reports where id = p_report_id for update;
  insert into public.report_context_blocks (report_id, block_type, title, input_snapshot, formula_version, position, created_by)
  values (p_report_id, p_block_type, btrim(p_title), p_input_snapshot, btrim(p_formula_version),
    coalesce((select max(position) + 1 from public.report_context_blocks where report_id = p_report_id), 0), auth.uid())
  returning * into result;
  return result;
end;
$$;
revoke all on function public.admin_add_report_context_block(uuid, text, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_report_context_block(uuid, text, text, jsonb, text) to authenticated;
alter function public.admin_add_report_context_block(uuid, text, text, jsonb, text) owner to postgres;

notify pgrst, 'reload schema';

commit;
