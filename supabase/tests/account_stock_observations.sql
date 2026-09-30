-- Run only against a disposable database after the full tracked migration chain.
-- The outer transaction guarantees this verification leaves no rows behind.
begin;

do $$
begin
  if has_function_privilege('anon', 'public.ingest_analytics_batch(jsonb,text,timestamptz,timestamptz,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ingest_analytics_batch(jsonb,text,timestamptz,timestamptz,text)', 'EXECUTE') then
    raise exception 'browser roles can execute guarded analytics ingestion';
  end if;
  if not has_function_privilege('service_role', 'public.ingest_analytics_batch(jsonb,text,timestamptz,timestamptz,text)', 'EXECUTE') then
    raise exception 'service_role cannot execute guarded analytics ingestion';
  end if;
  if has_table_privilege('anon', 'public.ig_account_stock_observations', 'SELECT')
     or has_table_privilege('authenticated', 'public.ig_account_stock_observations', 'SELECT')
     or has_table_privilege('service_role', 'public.ig_account_stock_observations', 'INSERT,UPDATE,DELETE') then
    raise exception 'account stock table grants are broader than designed';
  end if;
end;
$$;

set local role service_role;

create temporary table account_stock_test_results (label text primary key, result jsonb) on commit drop;

insert into account_stock_test_results values (
  'initial',
  public.ingest_analytics_batch(
    '{"posts":[],"post_daily":[],"account_daily":[],"account_stock":[{"observation_key":"test.account.stock.0001","observed_at":"2026-09-30T03:00:00Z","source":"instagram_profile","followers_count":321,"media_count":null,"missing_metrics":["media_count"]}],"demographics":[],"collabs":[]}'::jsonb,
    'test.account.stock.request.0001',
    '2026-09-30T03:01:00Z',
    '2026-09-30T03:01:00Z',
    repeat('a', 64)
  )
);

insert into account_stock_test_results values (
  'identical',
  public.ingest_analytics_batch(
    '{"posts":[],"post_daily":[],"account_daily":[],"account_stock":[{"observation_key":"test.account.stock.0001","observed_at":"2026-09-30T03:00:00Z","source":"instagram_profile","followers_count":321,"media_count":null,"missing_metrics":["media_count"]}],"demographics":[],"collabs":[]}'::jsonb,
    'test.account.stock.request.0002',
    '2026-09-30T03:02:00Z',
    '2026-09-30T03:02:00Z',
    repeat('b', 64)
  )
);

do $$
declare
  initial_result jsonb;
  identical_result jsonb;
  before_demographics integer;
  after_demographics integer;
begin
  select result into initial_result from account_stock_test_results where label = 'initial';
  select result into identical_result from account_stock_test_results where label = 'identical';
  if (initial_result->>'inserted_count')::integer <> 1
     or (initial_result->>'already_present_identical_count')::integer <> 0 then
    raise exception 'initial stock ingestion counts are not truthful';
  end if;
  if (identical_result->>'inserted_count')::integer <> 0
     or (identical_result->>'already_present_identical_count')::integer <> 1 then
    raise exception 'identical stock retry was not classified as already present';
  end if;

  select count(*) into before_demographics
  from public.ig_demographics
  where snapshot_date = '2099-12-31' and dimension = 'test' and key = 'atomic';

  begin
    perform public.ingest_analytics_batch(
      '{"posts":[],"post_daily":[],"account_daily":[],"account_stock":[{"observation_key":"test.account.stock.0001","observed_at":"2026-09-30T03:00:00Z","source":"instagram_profile","followers_count":999,"media_count":null,"missing_metrics":["media_count"]}],"demographics":[{"snapshot_date":"2099-12-31","dimension":"test","key":"atomic","value":1}],"collabs":[]}'::jsonb,
      'test.account.stock.request.0003',
      '2026-09-30T03:03:00Z',
      '2026-09-30T03:03:00Z',
      repeat('c', 64)
    );
    raise exception 'divergent stock reuse was accepted';
  exception
    when others then
      if sqlerrm <> 'DIVERGENT_ACCOUNT_STOCK_OBSERVATION' then raise; end if;
  end;

  select count(*) into after_demographics
  from public.ig_demographics
  where snapshot_date = '2099-12-31' and dimension = 'test' and key = 'atomic';
  if after_demographics <> before_demographics then
    raise exception 'divergent stock request partially wrote another stream';
  end if;
  if exists (
    select 1 from public.analytics_sync_runs
    where idempotency_key = 'test.account.stock.request.0003'
  ) then
    raise exception 'divergent stock request left an audit/run row';
  end if;
end;
$$;

reset role;
rollback;
