-- Historical account rows from the confirmed June import cannot prove a zero
-- view count when the corresponding account snapshot fields are unavailable.
-- May is intentionally excluded from this corrective migration.
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
