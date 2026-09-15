-- Correct the initial reconciliation scope: only archived source materials are excluded.
-- A calendar month is never an exclusion rule for Instagram records.

insert into public.ig_item_links (item_id, media_id, reason, source)
select i.id, p.media_id, 'مطابقة تلقائية تامة للرابط الدائم', 'exact_permalink'
from public.items i
join public.ig_posts p
  on public.canonical_instagram_permalink(i.ig_permalink) is not null
 and public.canonical_instagram_permalink(p.permalink) is not null
 and (public.canonical_instagram_permalink(i.ig_permalink) = public.canonical_instagram_permalink(p.permalink) or public.canonical_instagram_shortcode(i.ig_permalink) = public.canonical_instagram_shortcode(p.permalink))
where not i.is_archived
  and i.status = 'published'
  and (i.ig_media_id is null or i.ig_media_id = p.media_id)
  and not exists (select 1 from public.ig_item_links l where l.item_id = i.id or l.media_id = p.media_id)
on conflict do nothing;

update public.items i
set ig_media_id = l.media_id, updated_at = now()
from public.ig_item_links l
where l.item_id = i.id and l.source = 'exact_permalink' and i.ig_media_id is distinct from l.media_id and not i.is_archived;
