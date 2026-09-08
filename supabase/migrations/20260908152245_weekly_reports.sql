create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  period_start date not null,
  period_end date not null,
  storage_path text not null unique,
  original_filename text not null,
  content_sha256 text not null,
  byte_size bigint not null,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint weekly_reports_title_check check (char_length(btrim(title)) between 1 and 160),
  constraint weekly_reports_period_check check (period_start <= period_end),
  constraint weekly_reports_filename_check check (char_length(btrim(original_filename)) between 1 and 255),
  constraint weekly_reports_sha256_check check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint weekly_reports_byte_size_check check (byte_size between 1 and 2097152)
);

create index weekly_reports_created_at_idx on public.weekly_reports (created_at desc);
create index weekly_reports_uploaded_by_idx on public.weekly_reports (uploaded_by);

alter table public.weekly_reports enable row level security;
alter table public.weekly_reports force row level security;

revoke all on table public.weekly_reports from public, anon, authenticated, service_role;
grant select, insert on table public.weekly_reports to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('weekly-reports', 'weekly-reports', false, 2097152, array['text/html'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "weekly reports bucket is server only"
on storage.buckets
as restrictive
for all
to anon, authenticated
using (id <> 'weekly-reports')
with check (id <> 'weekly-reports');

create policy "weekly report objects are server only"
on storage.objects
as restrictive
for all
to anon, authenticated
using (bucket_id <> 'weekly-reports')
with check (bucket_id <> 'weekly-reports');
