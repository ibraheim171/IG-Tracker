-- ============================================================================
-- admin_reassign_tasks.sql — admin-only operational task reassignment
--
-- Moves current item_participants assignments from one profile to another.
-- This does not alter created_by, approvals, transitions, published items,
-- archived items, or any historical record.
-- ============================================================================

alter table public.admin_account_audit
  drop constraint if exists admin_account_audit_operation_check;

alter table public.admin_account_audit
  add constraint admin_account_audit_operation_check
  check (operation in (
    'create_user',
    'update_display_name',
    'update_email',
    'update_roles',
    'activate_user',
    'deactivate_user',
    'reset_password',
    'delete_user',
    'reassign_tasks'
  ));

create or replace function public.admin_reassign_tasks(
  p_source uuid,
  p_target uuid,
  p_parts public.participant_part[],
  p_reason text default null,
  p_dry_run boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  action_id uuid := gen_random_uuid();
  source_profile public.profiles%rowtype;
  target_profile public.profiles%rowtype;
  locked_profile public.profiles%rowtype;
  selected_parts public.participant_part[];
  unsupported_parts text[];
  trimmed_reason text := btrim(coalesce(p_reason, ''));
  summary jsonb := '[]'::jsonb;
  total_items integer := 0;
  duplicate_items integer := 0;
  inserted_count integer := 0;
  removed_count integer := 0;
  diagnostic text;
begin
  p_dry_run := coalesce(p_dry_run, true);

  perform public.assert_can_use_app();

  if not public.is_admin() then
    raise exception 'ROLE_REQUIRED: نقل المهام يحتاج دور أدمن';
  end if;

  if p_source is null or p_target is null then
    raise exception 'INVALID_INPUT: اختر العضوين';
  end if;

  if p_source = p_target then
    raise exception 'INVALID_INPUT: العضو المصدر والمستهدف يجب أن يكونا مختلفين';
  end if;

  perform pg_advisory_xact_lock(hashtext('admin_reassign_tasks'), hashtext(p_source::text));

  for locked_profile in
    select *
      from public.profiles
     where id in (p_source, p_target)
     order by id
     for update
  loop
    if locked_profile.id = p_source then
      source_profile := locked_profile;
    elsif locked_profile.id = p_target then
      target_profile := locked_profile;
    end if;
  end loop;

  if source_profile.id is null then
    raise exception 'SOURCE_NOT_FOUND: العضو المصدر غير موجود';
  end if;

  if target_profile.id is null then
    raise exception 'TARGET_NOT_FOUND: العضو المستهدف غير موجود';
  end if;

  if not target_profile.active then
    raise exception 'TARGET_INACTIVE: العضو المستهدف غير نشط';
  end if;

  select array_agg(distinct part order by part)
    into selected_parts
    from unnest(coalesce(p_parts, '{}'::public.participant_part[])) as selected(part)
   where part is not null;

  if array_length(selected_parts, 1) is null then
    raise exception 'PARTS_REQUIRED: اختر نوع مهمة واحداً على الأقل';
  end if;

  select array_agg(part::text order by part::text)
    into unsupported_parts
    from unnest(selected_parts) as selected(part)
   where not (part::text = any(target_profile.roles::text[]));

  if array_length(unsupported_parts, 1) is not null then
    raise exception 'TARGET_ROLE_REQUIRED: العضو المستهدف لا يحمل هذه الأدوار: %', array_to_string(unsupported_parts, ', ');
  end if;

  if not p_dry_run then
    if char_length(trimmed_reason) < 5 then
      raise exception 'REASON_REQUIRED: سبب النقل يجب أن يكون مكتوباً وواضحاً';
    end if;
    if char_length(trimmed_reason) > 500 then
      raise exception 'REASON_TOO_LONG: سبب النقل طويل جداً';
    end if;
  end if;

  with locked_assignments as (
    select ip.item_id, ip.part, i.status
      from public.item_participants ip
      join public.items i on i.id = ip.item_id
     where ip.user_id = p_source
       and ip.part = any(selected_parts)
       and not i.is_archived
       and i.status not in ('published', 'cancelled')
     order by ip.item_id, ip.part
     for update of ip
  ),
  grouped as (
    select part, status, count(*)::integer as n_items
      from locked_assignments
     group by part, status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'part', part,
           'status', status,
           'n_items', n_items
         ) order by part, status), '[]'::jsonb),
         coalesce(sum(n_items), 0)::integer
    into summary, total_items
    from grouped;

  select count(*)::integer
    into duplicate_items
    from public.item_participants source_assignment
    join public.items i on i.id = source_assignment.item_id
   where source_assignment.user_id = p_source
     and source_assignment.part = any(selected_parts)
     and not i.is_archived
     and i.status not in ('published', 'cancelled')
     and exists (
       select 1
         from public.item_participants target_assignment
        where target_assignment.item_id = source_assignment.item_id
          and target_assignment.user_id = p_target
          and target_assignment.part = source_assignment.part
     );

  if p_dry_run then
    return jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'source_user_id', p_source,
      'target_user_id', p_target,
      'parts', selected_parts,
      'total_items', total_items,
      'duplicate_items', duplicate_items,
      'summary', summary
    );
  end if;

  insert into public.admin_account_audit (
    actor_id,
    target_user_id,
    operation,
    reason,
    before_values,
    after_values,
    action_id,
    action_phase
  )
  values (
    actor_id,
    p_source,
    'reassign_tasks',
    trimmed_reason,
    jsonb_build_object(
      'source_user_id', p_source,
      'target_user_id', p_target,
      'parts', selected_parts,
      'total_items', total_items,
      'duplicate_items', duplicate_items,
      'summary', summary
    ),
    '{}'::jsonb,
    action_id,
    'started'
  );

  begin
    with movable as (
      select ip.item_id, ip.part
        from public.item_participants ip
        join public.items i on i.id = ip.item_id
       where ip.user_id = p_source
         and ip.part = any(selected_parts)
         and not i.is_archived
         and i.status not in ('published', 'cancelled')
       order by ip.item_id, ip.part
       for update of ip
    ),
    inserted as (
      insert into public.item_participants (item_id, user_id, part, added_by)
      select movable.item_id, p_target, movable.part, actor_id
        from movable
      on conflict (item_id, user_id, part) do nothing
      returning item_id, part
    ),
    removed as (
      delete from public.item_participants ip
       using movable
       where ip.item_id = movable.item_id
         and ip.user_id = p_source
         and ip.part = movable.part
      returning ip.item_id, ip.part
    )
    select (select count(*)::integer from inserted),
           (select count(*)::integer from removed)
      into inserted_count, removed_count;

    insert into public.admin_account_audit (
      actor_id,
      target_user_id,
      operation,
      reason,
      before_values,
      after_values,
      action_id,
      action_phase
    )
    values (
      actor_id,
      p_source,
      'reassign_tasks',
      trimmed_reason,
      jsonb_build_object(
        'source_user_id', p_source,
        'target_user_id', p_target,
        'parts', selected_parts,
        'total_items', total_items,
        'duplicate_items', duplicate_items,
        'summary', summary
      ),
      jsonb_build_object(
        'source_user_id', p_source,
        'target_user_id', p_target,
        'parts', selected_parts,
        'inserted_assignments', inserted_count,
        'removed_assignments', removed_count,
        'total_items', total_items,
        'duplicate_items', duplicate_items
      ),
      action_id,
      'succeeded'
    );
  exception when others then
    get stacked diagnostics diagnostic = returned_sqlstate;

    insert into public.admin_account_audit (
      actor_id,
      target_user_id,
      operation,
      reason,
      before_values,
      after_values,
      action_id,
      action_phase,
      diagnostic_code
    )
    values (
      actor_id,
      p_source,
      'reassign_tasks',
      trimmed_reason,
      jsonb_build_object(
        'source_user_id', p_source,
        'target_user_id', p_target,
        'parts', selected_parts,
        'total_items', total_items,
        'duplicate_items', duplicate_items,
        'summary', summary
      ),
      '{}'::jsonb,
      action_id,
      'failed',
      case
        when diagnostic ~ '^[A-Z0-9_]{1,59}$' then 'E_' || diagnostic
        else 'E_REASSIGN_TASKS_FAILED'
      end
    );

    return jsonb_build_object(
      'ok', false,
      'dry_run', false,
      'error', 'E_REASSIGN_TASKS_FAILED',
      'action_id', action_id
    );
  end;

  return jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'source_user_id', p_source,
    'target_user_id', p_target,
    'parts', selected_parts,
    'total_items', total_items,
    'duplicate_items', duplicate_items,
    'inserted_assignments', inserted_count,
    'removed_assignments', removed_count,
    'summary', summary,
    'action_id', action_id
  );
end
$$;

revoke execute on function public.admin_reassign_tasks(uuid, uuid, public.participant_part[], text, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_reassign_tasks(uuid, uuid, public.participant_part[], text, boolean)
  to authenticated;
