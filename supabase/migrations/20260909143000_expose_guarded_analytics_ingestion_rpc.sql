-- Keep the analytics writer callable only by the server's service role.
-- The gateway is SECURITY INVOKER so Supabase secret and legacy service keys
-- are authorized by the API role itself; no JWT claim parsing is required.

begin;

alter function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text)
  rename to ingest_analytics_batch_impl;

revoke all on function public.ingest_analytics_batch_impl(jsonb, text, timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ingest_analytics_batch_impl(jsonb, text, timestamptz, timestamptz, text)
  to service_role;

create function public.ingest_analytics_batch(
  p_payload jsonb,
  p_idempotency_key text,
  p_signature_timestamp timestamptz,
  p_source_timestamp timestamptz,
  p_request_sha256 text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  return public.ingest_analytics_batch_impl(
    p_payload,
    p_idempotency_key,
    p_signature_timestamp,
    p_source_timestamp,
    p_request_sha256
  );
end;
$$;

revoke all on function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text)
  to service_role;

alter function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text)
  owner to postgres;

notify pgrst, 'reload schema';

commit;
