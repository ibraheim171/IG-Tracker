-- PostgREST builds its RPC schema cache from functions executable by browser
-- roles. Keep the actual writer private, while exposing a tiny gateway that
-- accepts calls only when the request JWT is the server-only service role.

begin;

alter function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text)
  rename to ingest_analytics_batch_impl;

revoke all on function public.ingest_analytics_batch_impl(jsonb, text, timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;

create function public.ingest_analytics_batch(
  p_payload jsonb,
  p_idempotency_key text,
  p_signature_timestamp timestamptz,
  p_source_timestamp timestamptz,
  p_request_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'ANALYTICS_INGESTION_FORBIDDEN';
  end if;

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
  from public;
grant execute on function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text)
  to anon, authenticated, service_role;

alter function public.ingest_analytics_batch(jsonb, text, timestamptz, timestamptz, text)
  owner to postgres;

notify pgrst, 'reload schema';

commit;
