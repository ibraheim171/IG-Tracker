-- Strict immutable snapshots for server-recomputed advanced comparisons.

create or replace function public.valid_advanced_report_context_snapshot(
  p_snapshot jsonb,
  p_formula_version text
) returns boolean
language sql
immutable
set search_path = pg_catalog, extensions
as $$
  select p_formula_version = 'analytics-formulas-v2'
    and jsonb_typeof(p_snapshot) = 'object'
    and p_snapshot->>'kind' = 'advanced_comparison'
    and jsonb_typeof(p_snapshot->'request') = 'object'
    and jsonb_typeof(p_snapshot->'result') = 'object'
    and p_snapshot->'result'->'request' = p_snapshot->'request'
    and p_snapshot->'result'->>'formula_version' = 'analytics-formulas-v2'
    and p_snapshot->'result'->>'checkpoint_policy_version' = 'recorded-age-earliest-v1'
    and coalesce(p_snapshot->'result'->>'result_hash', '') ~ '^[0-9a-f]{64}$'
    and p_snapshot->'result'->>'result_hash' = encode(extensions.digest(((p_snapshot->'result') - 'result_hash')::text, 'sha256'), 'hex')
    and jsonb_typeof(p_snapshot->'request'->'cohorts') = 'array'
    and jsonb_array_length(p_snapshot->'request'->'cohorts') = 2
    and (p_snapshot->'request'->>'checkpoint') in ('1', '7', '30')
    and jsonb_typeof(p_snapshot->'request'->'metrics') = 'array'
    and jsonb_array_length(p_snapshot->'request'->'metrics') between 1 and 7
    and jsonb_typeof(p_snapshot->'result'->'metrics') = 'array'
    and jsonb_typeof(p_snapshot->'result'->'timeline') = 'array'
    and jsonb_typeof(p_snapshot->'result'->'evidence') = 'array'
    and jsonb_typeof(p_snapshot->'result'->'cohorts') = 'array'
    and jsonb_array_length(p_snapshot->'result'->'cohorts') = 2
    and jsonb_typeof(p_snapshot->'warnings') = 'array'
    and not exists (
      select 1 from jsonb_array_elements_text(p_snapshot->'warnings') warning
      where warning not in ('small_sample', 'incomplete_measurement', 'reels_structural_limits')
    )
    and jsonb_typeof(p_snapshot->'created_time') = 'string'
    and (jsonb_typeof(p_snapshot->'source_time') in ('string', 'null'));
$$;

create or replace function public.admin_add_report_context_block(
  p_report_id uuid,
  p_block_type text,
  p_title text,
  p_input_snapshot jsonb,
  p_formula_version text
) returns public.report_context_blocks
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result public.report_context_blocks;
begin
  if not public.is_active_user() or not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.reports where id = p_report_id) then raise exception 'REPORT_NOT_FOUND'; end if;
  if p_block_type not in ('account', 'comparison', 'partner_track', 'posts', 'audience')
     or char_length(btrim(coalesce(p_title, ''))) not between 1 and 160
     or p_input_snapshot is null
     or octet_length(p_input_snapshot::text) > 65536
     or not (
       public.valid_report_context_snapshot(p_input_snapshot, p_formula_version)
       or public.valid_advanced_report_context_snapshot(p_input_snapshot, p_formula_version)
     ) then
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

revoke all on function public.valid_advanced_report_context_snapshot(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_add_report_context_block(uuid, text, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_report_context_block(uuid, text, text, jsonb, text) to authenticated;
