create or replace function public.mark_published(
  p_item            uuid,
  p_permalink       text,
  p_at              timestamptz default now(),
  p_override_reason text default null
) returns public.items
language plpgsql security definer set search_path = public as $$
declare
  it  items;
  v   text[] := '{}';
  ovr boolean := false;
begin
  if not is_admin() then
    raise exception 'ROLE_REQUIRED: تعليم النشر يحتاج دور أدمن';
  end if;

  select * into it from items where id = p_item for update;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.is_archived then raise exception 'ARCHIVED_IMMUTABLE'; end if;

  if it.status <> 'ready' then
    v := array_append(v, format('المادة ليست جاهزة للنشر (%s)', it.status));
  end if;
  if coalesce(btrim(p_permalink), '') = '' then
    v := array_append(v, 'رابط المنشور مطلوب عند تعليم النشر');
  elsif p_permalink !~ '^https?://(www\.)?instagram\.com/(p|reel|tv)/[^/?#]+' then
    v := array_append(v, 'الرابط ليس رابط منشور إنستغرام صالحاً');
  elsif exists (select 1 from items where ig_permalink = p_permalink and id <> p_item) then
    v := array_append(v, 'هذا الرابط مربوط بمادة أخرى');
  end if;

  if array_length(v, 1) > 0 then
    if is_admin() and coalesce(btrim(p_override_reason), '') <> '' then
      ovr := true;
    else
      raise exception 'RULE_VIOLATION: %', array_to_string(v, ' · ');
    end if;
  end if;

  perform set_config('app.rpc', 'on', true);

  insert into transitions (item_id, from_status, to_status, actor_id,
                           is_override, override_reason, violations)
  values (p_item, it.status, 'published', auth.uid(),
          ovr, nullif(btrim(coalesce(p_override_reason, '')), ''), nullif(v, '{}'));

  update items
     set status       = 'published',
         published_at = p_at,
         ig_permalink = nullif(btrim(p_permalink), '')
   where id = p_item
   returning * into it;

  update publishing_slots set state = 'published' where id = it.slot_id;
  return it;
end $$;
