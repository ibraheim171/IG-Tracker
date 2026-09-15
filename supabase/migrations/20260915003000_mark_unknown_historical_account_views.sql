-- Historical account rows without account snapshots cannot prove a true zero view count.
-- Preserve the measured reach, but mark the placeholder view value as unavailable.
update public.ig_account_daily
set
  views = null,
  missing_metrics = array_append(missing_metrics, 'views')
where views = 0
  and followers is null
  and media_count is null
  and reach is not null;
