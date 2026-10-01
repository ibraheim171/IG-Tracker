-- psql -X -v ON_ERROR_STOP=1 -v account_stock_disposable=1 -f this_file.sql
-- ONLY on a fresh disposable DB, as postgres, AFTER the complete migration chain
-- (including migrations/ bootstrap and Supabase auth/roles). Never Staging/Production.
-- Discard the DB afterward: these requests COMMIT immutable fixtures. One request
-- per transaction models the API and drops ingestion's ON COMMIT DROP temp tables.
\set ON_ERROR_STOP on
\if :{?account_stock_disposable}
\else
  \echo 'Refusing execution without -v account_stock_disposable=1'
  \quit 1
\endif
\if :account_stock_disposable
\else
  \quit 1
\endif

create temporary table account_stock_test_results (label text primary key, result jsonb) on commit preserve rows;
grant select, insert on account_stock_test_results to service_role;
create temporary table account_stock_test_payload (payload jsonb) on commit preserve rows;
insert into account_stock_test_payload values (
  '{"posts":[],"post_daily":[],"account_daily":[],"account_stock":[{"observation_key":"test.account.stock.0001","observed_at":"2026-09-30T03:00:00Z","source":"instagram_profile","followers_count":321,"media_count":null,"missing_metrics":["media_count"]}],"demographics":[],"collabs":[]}'
);
grant select on account_stock_test_payload to service_role;

-- Catch a privileged or misconfigured gateway independently of its return values.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_language l on l.oid = p.prolang
    where p.oid = 'public.ingest_analytics_batch(jsonb,text,timestamptz,timestamptz,text)'::regprocedure
      and not p.prosecdef and l.lanname = 'plpgsql'
      and p.proowner = 'postgres'::regrole::oid
      and p.proconfig @> array['search_path=pg_catalog, public']::text[]
  ) then raise exception 'ingestion wrapper must remain postgres-owned PL/pgSQL SECURITY INVOKER with a fixed search_path'; end if;
  if exists (
    select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid = 'public.ingest_analytics_batch(jsonb,text,timestamptz,timestamptz,text)'::regprocedure
      and a.privilege_type = 'EXECUTE' and a.grantee not in (p.proowner,'service_role'::regrole::oid)
  ) then raise exception 'ingestion wrapper EXECUTE is exposed beyond service_role and its owner'; end if;
end;
$$;

begin;
set local role service_role;
insert into account_stock_test_results
select 'initial', public.ingest_analytics_batch(payload, 'test.account.stock.request.0001',
  '2026-09-30T03:01:00Z', '2026-09-30T03:01:00Z', repeat('a',64)) from account_stock_test_payload;
-- A wrapper still bound to the pre-stock implementation cannot write this row.
do $$ begin
  if not exists (select 1 from public.ig_account_stock_observations
    where observation_key = 'test.account.stock.0001' and followers_count = 321
      and sync_run_id = (select (result->>'run_id')::uuid from account_stock_test_results where label = 'initial')) then
    raise exception 'public wrapper did not dispatch to the account-stock implementation';
  end if;
  begin
    perform public.ingest_analytics_batch_without_account_stock('{}','denied.request.legacy',now(),now(),repeat('d',64));
    raise exception 'service_role can execute the old ingestion implementation directly';
  exception when insufficient_privilege then null; end;
end; $$;
commit;

begin;
set local role service_role;
insert into account_stock_test_results
select 'identical', public.ingest_analytics_batch(payload, 'test.account.stock.request.0002',
  '2026-09-30T03:02:00Z', '2026-09-30T03:02:00Z', repeat('b',64)) from account_stock_test_payload;
commit;

begin;
set local role service_role;
insert into account_stock_test_results
select 'replay', public.ingest_analytics_batch(payload, 'test.account.stock.request.0001',
  '2026-09-30T03:01:00Z', '2026-09-30T03:01:00Z', repeat('a',64)) from account_stock_test_payload;
commit;

-- RPC returns a replay marker; HTTP rejects that marker. This is not an HMAC test.
do $$
declare a jsonb; b jsonb; r jsonb;
begin
  select result into strict a from account_stock_test_results where label = 'initial';
  select result into strict b from account_stock_test_results where label = 'identical';
  select result into strict r from account_stock_test_results where label = 'replay';
  if a->>'received_count' is distinct from '1' or a->>'inserted_count' is distinct from '1'
    or a->>'already_present_identical_count' is distinct from '0' or a->>'rejected_count' is distinct from '0'
    or a#>>'{row_counts,account_stock,inserted}' is distinct from '1'
    or b->>'received_count' is distinct from '1' or b->>'inserted_count' is distinct from '0'
    or b->>'already_present_identical_count' is distinct from '1' or b->>'rejected_count' is distinct from '0'
    or b#>>'{row_counts,account_stock,already_present_identical}' is distinct from '1'
    or r->>'replayed' is distinct from 'true' or r->>'run_id' is distinct from a->>'run_id' then
    raise exception 'incorrect initial/retry/replay accounting';
  end if;
  if (select count(*) from public.ig_account_stock_observations where observation_key = 'test.account.stock.0001') <> 1
    or (select count(*) from public.analytics_sync_runs where idempotency_key like 'test.account.stock.request.%') <> 2 then
    raise exception 'retry or replay created extra rows';
  end if;
  if not exists (select 1 from public.ig_account_stock_observations
    where observation_key = 'test.account.stock.0001' and followers_count = 321 and media_count is null
      and missing_metrics = array['media_count'] and source_timestamp = '2026-09-30T03:01:00Z'
      and sync_run_id = (a->>'run_id')::uuid) then
    raise exception 'retry mutated immutable provenance';
  end if;
end;
$$;

begin;
insert into public.partners(name) values ('test.atomic.partner');
do $$
declare before_counts jsonb := '{}'; after_counts jsonb := '{}'; table_name text; n bigint;
  payload jsonb; probe jsonb;
  tables text[] := array['ig_posts','ig_post_daily','ig_account_daily','ig_account_stock_observations',
    'ig_demographics','ig_collabs','analytics_sync_runs','ig_item_links'];
begin
  foreach table_name in array tables loop
    execute format('select count(*) from public.%I',table_name) into n;
    before_counts := before_counts || jsonb_build_object(table_name,n);
  end loop;
  payload :=
      '{"posts":[{"post_id":"test.atomic.post","permalink":"https://www.instagram.com/p/TestAtomicStock/","published_at":"2026-09-28T03:00:00Z","media_type":"IMAGE","product_type":"FEED"}],
        "post_daily":[{"post_id":"test.atomic.post","snapshot_date":"2026-09-30","age_days":2,"reach":10,"missing_metrics":["likes","comments","views","saved","shares","interactions","profile_visits","follows","avg_watch_ms"]}],
        "account_daily":[{"date":"2026-09-28","reach":10,"missing_metrics":["followers","media_count","views","reach_followers","reach_non_followers","follows","unfollows"]}],
        "account_stock":[{"observation_key":"test.account.stock.0002","observed_at":"2026-09-30T03:03:00Z","source":"instagram_profile","followers_count":322,"media_count":null,"missing_metrics":["media_count"]},
          {"observation_key":"test.account.stock.0001","observed_at":"2026-09-30T03:00:00Z","source":"instagram_profile","followers_count":999,"media_count":null,"missing_metrics":["media_count"]}],
        "demographics":[{"snapshot_date":"2026-09-30","dimension":"country","key":"TEST","value":1}],
        "collabs":[{"date":"2026-09-30","partner":"test.atomic.partner","type":"test"}]}'::jsonb;
  -- Prove the other-stream fixtures really ingest, then deliberately roll the
  -- subtransaction back. Its temp tables roll back too, so no table-name collision.
  begin
    probe := public.ingest_analytics_batch(jsonb_set(payload,'{account_stock,1,followers_count}','321'),
      'test.account.stock.probe','2026-09-30T03:04:00Z','2026-09-30T03:04:00Z',repeat('e',64));
    if probe->>'inserted_count' is distinct from '6'
      or probe->>'already_present_identical_count' is distinct from '1' then
      raise exception 'invalid multi-stream rollback fixture';
    end if;
    raise exception 'ROLLBACK_TEST_PROBE';
  exception when others then if sqlerrm <> 'ROLLBACK_TEST_PROBE' then raise; end if; end;
  begin
    perform public.ingest_analytics_batch(payload,
      'test.account.stock.request.0003','2026-09-30T03:04:00Z','2026-09-30T03:04:00Z',repeat('c',64));
    raise exception 'divergent observation was accepted';
  exception when others then
    if sqlerrm <> 'DIVERGENT_ACCOUNT_STOCK_OBSERVATION' then raise; end if;
  end;
  foreach table_name in array tables loop
    execute format('select count(*) from public.%I',table_name) into n;
    after_counts := after_counts || jsonb_build_object(table_name,n);
  end loop;
  if after_counts is distinct from before_counts then
    raise exception 'divergent request partially committed: % -> %',before_counts,after_counts;
  end if;
end;
$$;
rollback;

-- Catalog AND execution checks, not just source assertions.
do $$
declare role_name text; operation text; routine text;
begin
  if not exists (select 1 from pg_class where oid = 'public.ig_account_stock_observations'::regclass
    and relrowsecurity and relforcerowsecurity)
    or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ig_account_stock_observations') then
    raise exception 'stock RLS must be forced with no browser policies';
  end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach operation in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(role_name,'public.ig_account_stock_observations',operation)
        is distinct from (role_name = 'service_role' and operation = 'SELECT') then
        raise exception 'unexpected stock grant: % %',role_name,operation;
      end if;
    end loop;
    foreach routine in array array['ingest_analytics_batch','ingest_analytics_batch_impl'] loop
      if has_function_privilege(role_name,'public.' || routine || '(jsonb,text,timestamptz,timestamptz,text)','EXECUTE')
        is distinct from (role_name = 'service_role') then
        raise exception 'unexpected ingestion EXECUTE: % %',role_name,routine;
      end if;
    end loop;
    if has_function_privilege(role_name,'public.valid_report_stock_timestamp(text)','EXECUTE')
      or has_function_privilege(role_name,'public.valid_report_context_snapshot(jsonb,text)','EXECUTE')
      or has_function_privilege(role_name,'public.ingest_analytics_batch_without_account_stock(jsonb,text,timestamptz,timestamptz,text)','EXECUTE') then
      raise exception 'internal helper exposed to %',role_name;
    end if;
  end loop;
  if exists (select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where c.oid = 'public.ig_account_stock_observations'::regclass and a.grantee = 0) then
    raise exception 'PUBLIC stock grant';
  end if;
  begin
    update public.ig_account_stock_observations set followers_count = 999 where observation_key = 'test.account.stock.0001';
    raise exception 'immutable stock UPDATE succeeded';
  exception when others then if sqlerrm <> 'IMMUTABLE_ANALYTICS_SNAPSHOT' then raise; end if; end;
  begin
    delete from public.ig_account_stock_observations where observation_key = 'test.account.stock.0001';
    raise exception 'immutable stock DELETE succeeded';
  exception when others then if sqlerrm <> 'IMMUTABLE_ANALYTICS_SNAPSHOT' then raise; end if; end;
end;
$$;

begin;
set local role anon;
do $$ begin
  begin perform 1 from public.ig_account_stock_observations; raise exception 'anon SELECT succeeded';
    exception when insufficient_privilege then null; end;
  begin perform public.ingest_analytics_batch('{}','denied.request.anon',now(),now(),repeat('d',64));
    raise exception 'anon ingestion succeeded'; exception when insufficient_privilege then null; end;
end; $$;
rollback;
begin;
set local role authenticated;
do $$ begin
  begin perform 1 from public.ig_account_stock_observations; raise exception 'authenticated SELECT succeeded';
    exception when insufficient_privilege then null; end;
  begin perform public.ingest_analytics_batch('{}','denied.request.auth',now(),now(),repeat('d',64));
    raise exception 'authenticated ingestion succeeded'; exception when insufficient_privilege then null; end;
end; $$;
rollback;

-- Test actual admin RPC after rename (not only the validation helper).
-- Report fixtures/JWT test identities roll back; these are not credentials.
begin;
create temporary table account_stock_report_fixture (admin_id uuid, report_id uuid, v1 jsonb, v2 jsonb);
insert into account_stock_report_fixture values (gen_random_uuid(),gen_random_uuid(),
  '{"period":{"start":"2026-09-01","end":"2026-09-30"},"filters":{},"metric":"account_overview",
    "formula":"المتابعون: آخر قياس؛ التغير: آخر قياس ناقص أول قياس؛ إجماليات الوصول والمشاهدات تظهر فقط عند اكتمال أيام الفترة",
    "selection":[],"values":[{"label":"المتابعون","value":321,"measured_n":1}],"series":[],
    "completeness":{"measured_n":1,"expected_n":1},"warnings":[],"source_time":"2026-09-30T03:01:00Z"}',null);
update account_stock_report_fixture set v2 = jsonb_set(v1,'{formula}',
  '"تدفقات الحساب يومية؛ رصيد المتابعين والمواد لقطات مستقلة بوقت رصد حقيقي؛ التغير محسوب بين رصدين مقاسين فقط"')
  || '{"stock_observations":[{"observation_key":"test.account.stock.0001","observed_at":"2026-09-30T03:00:00Z","followers_count":321,"media_count":null,"missing_metrics":["media_count"],"source_time":"2026-09-30T03:01:00Z"}]}';
insert into auth.users(id) select admin_id from account_stock_report_fixture;
insert into public.profiles(id,display_name,roles,active,must_change_password)
select admin_id,'Disposable stock test',array['admin']::public.role_name[],true,false from account_stock_report_fixture;
insert into public.reports(id,month,title,author_id)
select report_id,'2026-09-01','Disposable stock test',admin_id from account_stock_report_fixture;
grant select on account_stock_report_fixture to authenticated;
select set_config('request.jwt.claim.sub',admin_id::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true)
from account_stock_report_fixture;
set local role authenticated;
do $$
declare f record; legacy public.report_context_blocks; current_block public.report_context_blocks;
  bad jsonb; patch jsonb; n integer; large_snapshot jsonb; dates jsonb; observations jsonb;
begin
  select * into strict f from account_stock_report_fixture;
  legacy := public.admin_add_report_context_block(f.report_id,'account','Legacy v1',f.v1,'analytics-formulas-v1');
  current_block := public.admin_add_report_context_block(f.report_id,'account','Stock v2',f.v2,'analytics-formulas-v2');
  if legacy.input_snapshot is distinct from f.v1 or current_block.input_snapshot is distinct from f.v2 then
    raise exception 'RPC changed or rejected valid v1/v2';
  end if;
  for patch in select value from jsonb_array_elements('[
    {"observation_key":"short"},{"observation_key":"bad key!"},{"observation_key":"stock-001\n"},
    {"observed_at":"2026-09-30T03:00:00"},{"source_time":"2026-09-30"},
    {"observed_at":"2026-02-30T03:00:00Z"},{"observed_at":"2026-09-30T24:00:00Z"},
    {"observed_at":"2026-09-30T03:00:00+15:00"},{"observed_at":"2026-09-30T03:02:00Z"},
    {"observed_at":"2026-09-30T03:01:00.000001Z","source_time":"2026-09-30T03:01:00.000000Z"},
    {"followers_count":-1},{"followers_count":1.5},{"followers_count":2147483648},
    {"missing_metrics":[]},{"missing_metrics":["media_count","media_count"]},
    {"missing_metrics":["unknown"]},{"followers_count":null,"missing_metrics":["followers_count","media_count"]}
  ]'::jsonb) loop
    bad := jsonb_set(f.v2,'{stock_observations,0}',(f.v2#>'{stock_observations,0}') || patch);
    begin
      perform public.admin_add_report_context_block(f.report_id,'account','Invalid stock',bad,'analytics-formulas-v2');
      raise exception 'RPC accepted invalid v2: %',patch;
    exception when others then if sqlerrm <> 'INVALID_REPORT_CONTEXT' then raise; end if; end;
  end loop;
  bad := jsonb_set(f.v2,'{stock_observations,0,observation_key}',to_jsonb(repeat('a',129)));
  begin
    perform public.admin_add_report_context_block(f.report_id,'account','Long key',bad,'analytics-formulas-v2');
    raise exception 'RPC accepted long key';
  exception when others then if sqlerrm <> 'INVALID_REPORT_CONTEXT' then raise; end if; end;
  bad := jsonb_set(f.v2,'{completeness}','{"measured_n":2,"expected_n":1}');
  begin
    perform public.admin_add_report_context_block(f.report_id,'account','Bad completeness',bad,'analytics-formulas-v2');
    raise exception 'RPC accepted invalid completeness';
  exception when others then if sqlerrm <> 'INVALID_REPORT_CONTEXT' then raise; end if; end;
  bad := jsonb_set(f.v2,'{source_time}','"2026-09-30"');
  begin
    perform public.admin_add_report_context_block(f.report_id,'account','Unzoned source',bad,'analytics-formulas-v2');
    raise exception 'RPC accepted unzoned source timestamp';
  exception when others then if sqlerrm <> 'INVALID_REPORT_CONTEXT' then raise; end if; end;
  select count(*) into n from public.report_context_blocks where report_id = f.report_id;
  if n <> 2 then raise exception 'invalid report attempts wrote blocks: %',n; end if;

  -- Actual PostgreSQL JSONB byte measurement of the UI-shaped 366-day fixture.
  select jsonb_agg(jsonb_build_object('date',to_char(date '2025-01-01' + i,'YYYY-MM-DD'),'value',2147483647) order by i),
    jsonb_agg(jsonb_build_object('observation_key','gas.account_stock.' || lpad(i::text,64,'0'),
      'observed_at',to_char(date '2025-01-01' + i,'YYYY-MM-DD') || 'T03:00:00.000Z',
      'followers_count',2147483647,'media_count',null,'missing_metrics',array['media_count'],
      'source_time',to_char(date '2025-01-01' + i,'YYYY-MM-DD') || 'T03:01:00.000Z') order by i)
  into dates,observations from generate_series(0,365) as g(i);
  large_snapshot := f.v2 || jsonb_build_object('period',jsonb_build_object('start','2025-01-01','end','2026-01-01'),
    'selection',jsonb_build_array(jsonb_build_object('key','instagram:aqsana2026','label','حساب أقصانا')),
    'values',(select jsonb_agg(jsonb_build_object('label','المتابعون في آخر رصد','value',2147483647,'measured_n',366)) from generate_series(1,8)),
    'series',jsonb_build_array(jsonb_build_object('key','reach','label','الوصول','points',dates),
      jsonb_build_object('key','reach_non_followers','label','الوصول','points',dates)),
    'completeness',jsonb_build_object('measured_n',366,'expected_n',366),
    'source_time','2026-01-01T03:01:00.000Z','stock_observations',observations);
  n := octet_length(large_snapshot::text);
  raise notice '366-day account snapshot actual JSONB UTF-8 bytes: %',n;
  if n <= 65536 or n > 262144 then raise exception 'unexpected measured size: %',n; end if;
  current_block := public.admin_add_report_context_block(f.report_id,'account','366 days',large_snapshot,'analytics-formulas-v2');
  if current_block.input_snapshot is distinct from large_snapshot then raise exception 'large snapshot truncated'; end if;
  bad := jsonb_set(large_snapshot,'{filters}',jsonb_build_object('padding',repeat('x',262144)));
  begin
    perform public.admin_add_report_context_block(f.report_id,'account','Oversized',bad,'analytics-formulas-v2');
    raise exception 'RPC accepted oversized v2';
  exception when others then if sqlerrm <> 'INVALID_REPORT_CONTEXT' then raise; end if; end;
  bad := f.v1 || jsonb_build_object('filters',jsonb_build_object('padding',repeat('x',65536)));
  begin
    perform public.admin_add_report_context_block(f.report_id,'account','Oversized legacy',bad,'analytics-formulas-v1');
    raise exception 'RPC widened legacy size limit';
  exception when others then if sqlerrm <> 'INVALID_REPORT_CONTEXT' then raise; end if; end;
end;
$$;
rollback;
\echo 'PASS: stock insert/retry/replay/atomic rejection, privileges/RLS, admin RPC v1/v2 and bounded report size'
