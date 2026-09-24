-- Historical account rows from the confirmed June import cannot prove a zero
-- view count when the corresponding account snapshot fields are unavailable.
-- May is intentionally excluded from this corrective migration.
-- The table is immutable by default. The guard is disabled only inside this
-- transaction and re-enabled before commit so this one reviewed correction can
-- be applied without weakening normal ingestion safeguards.
begin;

alter table public.ig_account_daily
  disable trigger ig_account_daily_immutable;

update public.ig_account_daily
set
  views = null,
  missing_metrics = case
    when missing_metrics is null then array['views']::text[]
    when missing_metrics @> array['views']::text[] then missing_metrics
    else array_append(missing_metrics, 'views')
  end
where date between date '2026-06-01' and date '2026-06-12'
  and views = 0
  and followers is null
  and media_count is null
  and reach is not null;

alter table public.ig_account_daily
  enable trigger ig_account_daily_immutable;

commit;
