-- ============================================================================
-- 0013_admin_account_audit.sql — durable account administration log and guards
--
-- Adds append-only audit storage for account administration and database-level
-- protection against losing the last active admin. It does not alter item
-- workflow, publishing, reports, or historical content data.
-- ============================================================================

create table public.admin_account_audit (
  id             bigserial primary key,
  actor_id       uuid not null,
  target_user_id uuid not null,
  operation      text not null check (operation in (
    'create_user',
    'update_display_name',
    'update_email',
    'update_roles',
    'activate_user',
    'deactivate_user',
    'reset_password',
    'delete_user'
  )),
  reason         text,
  before_values  jsonb not null default '{}'::jsonb,
  after_values   jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index ix_admin_account_audit_target on public.admin_account_audit (target_user_id, created_at desc);
create index ix_admin_account_audit_actor on public.admin_account_audit (actor_id, created_at desc);
create index ix_admin_account_audit_operation on public.admin_account_audit (operation, created_at desc);

alter table public.admin_account_audit enable row level security;

revoke all privileges on table public.admin_account_audit from public, anon, authenticated;
grant select on table public.admin_account_audit to authenticated;
grant select, insert on table public.admin_account_audit to service_role;
grant usage, select on sequence public.admin_account_audit_id_seq to service_role;

create policy admin_read_account_audit on public.admin_account_audit
  for select to authenticated
  using (public.is_admin());

create or replace function public.guard_last_active_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_admins integer;
  next_is_active_admin boolean;
begin
  if tg_op = 'UPDATE' then
    next_is_active_admin := new.active and 'admin'::role_name = any(new.roles);
    if not (old.active and 'admin'::role_name = any(old.roles)) or next_is_active_admin then
      return new;
    end if;
  elsif tg_op = 'DELETE' then
    if not (old.active and 'admin'::role_name = any(old.roles)) then
      return old;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('profiles:last-active-admin'));

  select count(*) into active_admins
    from public.profiles
   where active
     and 'admin'::role_name = any(roles);

  if active_admins <= 1 then
    raise exception 'LAST_ACTIVE_ADMIN_REQUIRED';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

drop trigger if exists trg_profiles_last_active_admin on public.profiles;
create trigger trg_profiles_last_active_admin
  before update of active, roles or delete on public.profiles
  for each row execute function public.guard_last_active_admin();

create or replace function public.guard_profile_self_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id
     and (
       old.active is distinct from new.active
       or old.must_change_password is distinct from new.must_change_password
       or old.roles is distinct from new.roles
     ) then
    raise exception 'PROFILE_SELF_SENSITIVE_UPDATE_BLOCKED';
  end if;
  return new;
end
$$;

drop trigger if exists trg_profiles_self_sensitive_columns on public.profiles;
create trigger trg_profiles_self_sensitive_columns
  before update of active, must_change_password, roles on public.profiles
  for each row execute function public.guard_profile_self_sensitive_columns();

revoke execute on function public.guard_last_active_admin() from public, anon, authenticated;
revoke execute on function public.guard_profile_self_sensitive_columns() from public, anon, authenticated;
