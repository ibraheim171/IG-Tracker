-- Immutable factual analytics snapshots selected by an admin for monthly reports.

create table public.report_context_blocks (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  block_type text not null check (block_type in ('account', 'comparison', 'partner_track', 'posts', 'audience')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  input_snapshot jsonb not null,
  formula_version text not null,
  position integer not null check (position >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (report_id, position)
);

create index report_context_blocks_report_idx on public.report_context_blocks (report_id, position);
alter table public.report_context_blocks enable row level security;
alter table public.report_context_blocks force row level security;

create or replace function public.guard_immutable_report_context()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
     or new.report_id is distinct from old.report_id
     or new.block_type is distinct from old.block_type
     or new.title is distinct from old.title
     or new.input_snapshot is distinct from old.input_snapshot
     or new.formula_version is distinct from old.formula_version
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'IMMUTABLE_REPORT_CONTEXT';
  end if;
  return new;
end;
$$;

create trigger report_context_blocks_immutable
before update on public.report_context_blocks
for each row execute function public.guard_immutable_report_context();

create or replace function public.valid_report_context_snapshot(
  p_snapshot jsonb,
  p_formula_version text
) returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_formula_version = 'analytics-formulas-v1'
    and jsonb_typeof(p_snapshot) = 'object'
    and jsonb_typeof(p_snapshot->'filters') = 'object'
    and p_snapshot->>'metric' in ('account_overview', 'audience_snapshot', 'posts_snapshot', 'reach_d1', 'reach_d7', 'reach_d30', 'save_rate', 'share_rate', 'follow_rate', 'signal', 'item_count')
    and p_snapshot->>'formula' = case p_snapshot->>'metric'
      when 'account_overview' then 'المتابعون: آخر قياس؛ التغير: آخر قياس ناقص أول قياس؛ إجماليات الوصول والمشاهدات تظهر فقط عند اكتمال أيام الفترة'
      when 'audience_snapshot' then 'قيم ديموغرافية تراكمية كما أعادتها أحدث لقطة من Meta'
      when 'posts_snapshot' then 'قيم كل منشور من أحدث لقطة محفوظة دون تجميع'
      when 'reach_d1' then 'وسيط الوصول عند عمر يوم واحد بالضبط'
      when 'reach_d7' then 'وسيط الوصول عند عمر 7 أيام بالضبط'
      when 'reach_d30' then 'وسيط الوصول عند عمر 30 يومًا بالضبط'
      when 'save_rate' then 'معدل الحفظ = الحفظ ÷ الوصول × 100'
      when 'share_rate' then 'معدل المشاركة = المشاركات ÷ الوصول × 100'
      when 'follow_rate' then 'معدل المتابعة = المتابعات ÷ الوصول × 100'
      when 'signal' then 'قوة الإشارة = (6×المشاركات + 4×الحفظ + 3×المتابعات + 2×زيارات الملف + 1.5×التعليقات + 0.5×الإعجابات) ÷ الوصول × 1000'
      when 'item_count' then 'عدد المواد المنشورة المطابقة للمرشحات'
    end
    and case when jsonb_typeof(p_snapshot->'selection') = 'array' then
      jsonb_array_length(p_snapshot->'selection') <= 100
      and not exists (
        select 1 from jsonb_array_elements(p_snapshot->'selection') selected
        where jsonb_typeof(selected) <> 'object'
          or jsonb_typeof(selected->'key') <> 'string' or btrim(selected->>'key') = ''
          or jsonb_typeof(selected->'label') <> 'string' or btrim(selected->>'label') = ''
      )
    else false end
    and case when jsonb_typeof(p_snapshot->'values') = 'array' then
      jsonb_array_length(p_snapshot->'values') between 1 and 100
      and not exists (
        select 1 from jsonb_array_elements(p_snapshot->'values') measured
        where jsonb_typeof(measured) <> 'object'
          or jsonb_typeof(measured->'label') <> 'string' or btrim(measured->>'label') = ''
          or jsonb_typeof(measured->'value') not in ('number', 'null')
          or jsonb_typeof(measured->'measured_n') <> 'number'
          or (measured->>'measured_n') !~ '^[0-9]+$'
          or (jsonb_typeof(measured->'total_n') is not null and (
            jsonb_typeof(measured->'total_n') <> 'number'
            or (measured->>'total_n') !~ '^[0-9]+$'
            or (measured->>'measured_n')::integer > (measured->>'total_n')::integer
          ))
          or (jsonb_typeof(measured->'value') = 'number' and (measured->>'measured_n')::integer = 0)
      )
    else false end
    and case when jsonb_typeof(p_snapshot->'series') = 'array' then jsonb_array_length(p_snapshot->'series') <= 20 else false end
    and (jsonb_typeof(p_snapshot->'completeness') = 'null' or (
      jsonb_typeof(p_snapshot->'completeness') = 'object'
      and (p_snapshot->'completeness'->>'measured_n') ~ '^[0-9]+$'
      and (p_snapshot->'completeness'->>'expected_n') ~ '^[0-9]+$'
      and (p_snapshot->'completeness'->>'measured_n')::integer <= (p_snapshot->'completeness'->>'expected_n')::integer
    ))
    and case when jsonb_typeof(p_snapshot->'warnings') = 'array' then
      not exists (
        select 1 from jsonb_array_elements_text(p_snapshot->'warnings') warning
        where warning not in ('small_sample', 'incomplete_measurement', 'reels_structural_limits', 'meta_demographics_snapshot', 'partial_range')
      )
    else false end
    and (jsonb_typeof(p_snapshot->'source_time') in ('string', 'null'))
    and (jsonb_typeof(p_snapshot->'period') in ('object', 'null'));
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
     or not public.valid_report_context_snapshot(p_input_snapshot, p_formula_version) then
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

create or replace function public.admin_reorder_report_context_blocks(
  p_report_id uuid,
  p_order uuid[]
) returns setof public.report_context_blocks
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_active_user() or not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.reports where id = p_report_id for update;
  if not found then raise exception 'REPORT_NOT_FOUND'; end if;
  if cardinality(p_order) <> (select count(*) from public.report_context_blocks where report_id = p_report_id)
     or cardinality(p_order) <> (select count(distinct id) from unnest(p_order) as selected(id))
     or exists (select 1 from unnest(p_order) as selected(id) where not exists (
       select 1 from public.report_context_blocks block where block.id = selected.id and block.report_id = p_report_id
     )) then raise exception 'INVALID_BLOCK_ORDER'; end if;
  update public.report_context_blocks block
  set position = ordered.position + 1000000
  from unnest(p_order) with ordinality as ordered(id, position)
  where block.id = ordered.id and block.report_id = p_report_id;
  update public.report_context_blocks set position = position - 1000001 where report_id = p_report_id;
  return query select * from public.report_context_blocks where report_id = p_report_id order by position;
end;
$$;

create or replace function public.admin_delete_report_context_block(
  p_report_id uuid,
  p_block_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_active_user() or not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.reports where id = p_report_id for update;
  if not found then raise exception 'REPORT_NOT_FOUND'; end if;
  delete from public.report_context_blocks where id = p_block_id and report_id = p_report_id;
  if not found then raise exception 'BLOCK_NOT_FOUND'; end if;
end;
$$;

revoke all on table public.report_context_blocks from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.report_context_blocks to service_role;
revoke all on function public.admin_add_report_context_block(uuid, text, text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_reorder_report_context_blocks(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.admin_delete_report_context_block(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.valid_report_context_snapshot(jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_report_context_block(uuid, text, text, jsonb, text) to authenticated;
grant execute on function public.admin_reorder_report_context_blocks(uuid, uuid[]) to authenticated;
grant execute on function public.admin_delete_report_context_block(uuid, uuid) to authenticated;
