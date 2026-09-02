-- ============================================================================
-- admin_audit_action_phases.sql — durable started/succeeded/failed audit phases
--
-- Adds action correlation and phase tracking for irreversible admin account
-- operations. Existing rows default to succeeded. This migration does not
-- modify account data, auth data, sessions, workflow data, or historical rows
-- beyond metadata defaults required by the new NOT NULL columns.
-- ============================================================================

alter table public.admin_account_audit
  add column action_id uuid not null default gen_random_uuid(),
  add column action_phase text not null default 'succeeded',
  add column diagnostic_code text;

alter table public.admin_account_audit
  add constraint admin_account_audit_action_phase_check
  check (action_phase in ('started', 'succeeded', 'failed'));

alter table public.admin_account_audit
  add constraint admin_account_audit_diagnostic_code_check
  check (
    diagnostic_code is null
    or diagnostic_code ~ '^E_[A-Z0-9_]{1,61}$'
  );

create index ix_admin_account_audit_action on public.admin_account_audit (action_id, created_at);

revoke update, delete, truncate on table public.admin_account_audit from public, anon, authenticated, service_role;
