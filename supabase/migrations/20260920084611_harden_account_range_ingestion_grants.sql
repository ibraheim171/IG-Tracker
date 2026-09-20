-- Account-range ingestion is server-to-server only. The Apps Script delivery
-- path reaches ingest_analytics_batch through the signed internal endpoint.
-- This SECURITY DEFINER helper must not be callable through PostgREST by
-- anonymous or authenticated users.

revoke all on function public.ingest_account_range_snapshots(jsonb, timestamptz, uuid) from public;
revoke all on function public.ingest_account_range_snapshots(jsonb, timestamptz, uuid) from anon;
revoke all on function public.ingest_account_range_snapshots(jsonb, timestamptz, uuid) from authenticated;
grant execute on function public.ingest_account_range_snapshots(jsonb, timestamptz, uuid) to service_role;
