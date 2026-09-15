create table if not exists public.work_tracker_source_rows (
  id uuid primary key default gen_random_uuid(),
  source_file_hash text not null,
  source_sheet text not null,
  source_row integer not null,
  item_id uuid references public.items(id) on delete set null,
  publish_date date,
  title text,
  duplicate_key text,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  unique (source_file_hash, source_sheet, source_row)
);

create index if not exists work_tracker_source_rows_item_idx
  on public.work_tracker_source_rows (item_id);

create index if not exists work_tracker_source_rows_duplicate_idx
  on public.work_tracker_source_rows (source_file_hash, duplicate_key);

alter table public.work_tracker_source_rows enable row level security;

drop policy if exists work_tracker_source_rows_admin_select on public.work_tracker_source_rows;
create policy work_tracker_source_rows_admin_select
  on public.work_tracker_source_rows for select
  using (public.is_admin());

drop policy if exists work_tracker_source_rows_admin_modify on public.work_tracker_source_rows;
create policy work_tracker_source_rows_admin_modify
  on public.work_tracker_source_rows for all
  using (public.is_admin())
  with check (public.is_admin());
