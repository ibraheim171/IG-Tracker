-- Reject stale singular assignment replacements before any participant write.

drop function public.admin_save_item_assignments(uuid, uuid, uuid, uuid);

create function public.admin_save_item_assignments(
  p_item uuid,
  p_writer uuid,
  p_expected_revision text,
  p_producer uuid default null,
  p_reviewer uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.items;
  expected_revision text := lower(btrim(coalesce(p_expected_revision, '')));
  current_revision text;
begin
  perform public.assert_can_use_app();

  if not public.is_admin() then
    raise exception 'ROLE_REQUIRED: تعديل تعيينات المادة يحتاج أدمن';
  end if;

  if p_item is null or p_writer is null then
    raise exception 'INVALID_PAYLOAD: المادة والكاتب مطلوبان';
  end if;

  if expected_revision !~ '^[0-9a-f]{32}$' then
    raise exception 'INVALID_PAYLOAD: نسخة التعيينات غير صحيحة';
  end if;

  select * into it from public.items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then raise exception 'ARCHIVED_IMMUTABLE: المادة في شهر مؤرشف'; end if;
  if it.status = 'published' then raise exception 'PUBLISHED_IMMUTABLE: المادة منشورة ولا يمكن تغيير تعييناتها'; end if;
  if it.status = 'cancelled' then raise exception 'CANCELLED_IMMUTABLE: المادة ملغاة ولا يمكن تغيير تعييناتها'; end if;

  perform 1
    from public.profiles
   where id in (p_writer, p_producer, p_reviewer)
   order by id
   for update;

  perform 1
    from public.item_participants
   where item_id = p_item
     and part in ('writer', 'producer', 'reviewer')
   order by part, user_id
   for update;

  select md5(coalesce(string_agg(
           participant.part::text || ':' || participant.user_id::text,
           '|' order by
             case participant.part
               when 'writer' then 1
               when 'producer' then 2
               when 'reviewer' then 3
               else 4
             end,
             participant.user_id
         ), ''))
    into current_revision
    from public.item_participants participant
   where participant.item_id = p_item
     and participant.part in ('writer', 'producer', 'reviewer');

  if current_revision <> expected_revision then
    raise exception 'ASSIGNMENTS_STALE: تغيّرت تعيينات الفريق منذ فتح البطاقة. حدّث التعيينات ثم أعد المحاولة';
  end if;

  if exists (
    select 1
      from public.item_participants participant
     where participant.item_id = p_item
       and participant.part in ('writer', 'producer', 'reviewer')
     group by participant.part
    having count(*) > 1
  ) then
    raise exception 'MULTIPLE_ASSIGNMENTS: تتضمن المادة أكثر من مكلّف في دور واحد ولا يمكن تعديلها من واجهة التعيين الفردي';
  end if;

  if not exists (
    select 1 from public.profiles
     where id = p_writer
       and active
       and not must_change_password
       and 'writer' = any(roles::text[])
  ) then
    raise exception 'ASSIGNEE_ROLE_REQUIRED: الكاتب المختار لا يملك دور الكاتب أو حسابه غير نشط';
  end if;

  if p_producer is not null and not exists (
    select 1 from public.profiles
     where id = p_producer
       and active
       and not must_change_password
       and 'producer' = any(roles::text[])
  ) then
    raise exception 'ASSIGNEE_ROLE_REQUIRED: المنتج المختار لا يملك دور المنتج أو حسابه غير نشط';
  end if;

  if p_reviewer is not null and not exists (
    select 1 from public.profiles
     where id = p_reviewer
       and active
       and not must_change_password
       and 'reviewer' = any(roles::text[])
  ) then
    raise exception 'ASSIGNEE_ROLE_REQUIRED: المراجع المختار لا يملك دور المراجع أو حسابه غير نشط';
  end if;

  delete from public.item_participants
   where item_id = p_item
     and part in ('writer', 'producer', 'reviewer');

  insert into public.item_participants (item_id, user_id, part, added_by)
  values (p_item, p_writer, 'writer', auth.uid());

  if p_producer is not null then
    insert into public.item_participants (item_id, user_id, part, added_by)
    values (p_item, p_producer, 'producer', auth.uid())
    on conflict (item_id, user_id, part) do nothing;
  end if;

  if p_reviewer is not null then
    insert into public.item_participants (item_id, user_id, part, added_by)
    values (p_item, p_reviewer, 'reviewer', auth.uid())
    on conflict (item_id, user_id, part) do nothing;
  end if;

  return (
    select jsonb_agg(jsonb_build_object('user_id', user_id, 'part', part) order by part, user_id)
      from public.item_participants
     where item_id = p_item
       and part in ('writer', 'producer', 'reviewer')
  );
end
$$;

revoke execute on function public.admin_save_item_assignments(uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_save_item_assignments(uuid, uuid, text, uuid, uuid)
  to authenticated;
