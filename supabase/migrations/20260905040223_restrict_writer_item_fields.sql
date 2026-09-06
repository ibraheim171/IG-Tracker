create or replace function public.save_item_fields(
  p_item uuid,
  p_fields jsonb
) returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.items;
  requested text[];
  allowed text[] := '{}';
  forbidden text[];
begin
  perform public.assert_can_use_app();

  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'INVALID_PAYLOAD: أرسل حقولاً صحيحة للحفظ';
  end if;

  select coalesce(array_agg(key order by key), '{}')
    into requested
    from jsonb_object_keys(p_fields) as keys(key);

  if array_length(requested, 1) is null then
    raise exception 'INVALID_PAYLOAD: لا توجد حقول للحفظ';
  end if;

  select * into it from public.items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then raise exception 'ARCHIVED_IMMUTABLE: المادة في شهر مؤرشف'; end if;

  if public.is_admin() then
    allowed := array['title', 'track_id', 'idea_type_id', 'caption', 'notes', 'writer_delivery_url', 'production_file_url', 'priority'];
  else
    if public.is_item_participant_part(p_item, 'writer') then
      allowed := allowed || array['caption', 'notes', 'writer_delivery_url'];
    end if;
    if public.is_item_participant_part(p_item, 'producer') then
      allowed := allowed || array['production_file_url'];
    end if;
  end if;

  select coalesce(array_agg(field order by field), '{}')
    into forbidden
    from unnest(requested) as field
   where not (field = any(allowed));

  if array_length(forbidden, 1) is not null then
    raise exception 'FIELD_FORBIDDEN: %', array_to_string(forbidden, ', ');
  end if;

  if p_fields ? 'title' and coalesce(btrim(p_fields ->> 'title'), '') = '' then
    raise exception 'INVALID_PAYLOAD: العنوان مطلوب';
  end if;

  if p_fields ? 'writer_delivery_url' and not public.is_safe_https_url(p_fields ->> 'writer_delivery_url') then
    raise exception 'INVALID_LINK: رابط تسليم الكاتب يجب أن يكون HTTPS صالحاً';
  end if;

  if p_fields ? 'production_file_url' and not public.is_safe_https_url(p_fields ->> 'production_file_url') then
    raise exception 'INVALID_LINK: رابط ملف الإنتاج يجب أن يكون HTTPS صالحاً';
  end if;

  update public.items
     set title = case when p_fields ? 'title' then btrim(p_fields ->> 'title') else title end,
         track_id = case when p_fields ? 'track_id' then nullif(p_fields ->> 'track_id', '')::smallint else track_id end,
         idea_type_id = case when p_fields ? 'idea_type_id' then nullif(p_fields ->> 'idea_type_id', '')::smallint else idea_type_id end,
         caption = case when p_fields ? 'caption' then nullif(btrim(coalesce(p_fields ->> 'caption', '')), '') else caption end,
         notes = case when p_fields ? 'notes' then nullif(btrim(coalesce(p_fields ->> 'notes', '')), '') else notes end,
         writer_delivery_url = case when p_fields ? 'writer_delivery_url' then nullif(btrim(coalesce(p_fields ->> 'writer_delivery_url', '')), '') else writer_delivery_url end,
         production_file_url = case when p_fields ? 'production_file_url' then nullif(btrim(coalesce(p_fields ->> 'production_file_url', '')), '') else production_file_url end,
         priority = case when p_fields ? 'priority' then nullif(p_fields ->> 'priority', '')::smallint else priority end
   where id = p_item
   returning * into it;

  return it;
end
$$;

revoke execute on function public.save_item_fields(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_item_fields(uuid, jsonb) to authenticated;

revoke insert, update, delete on table public.items from public, anon, authenticated;
revoke truncate on table
  public.items,
  public.item_participants,
  public.partners,
  public.item_partners,
  public.publishing_slots
from public, anon, authenticated;
