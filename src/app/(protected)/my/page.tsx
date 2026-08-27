import { MyMaterials } from "@/components/my-materials";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { IdeaTypeOption, MyMaterial, PartnerOption, ParticipantPart, TrackOption } from "@/lib/ui-data";

type ParticipantItemRow = {
  item_id: string;
  part: ParticipantPart;
  items: {
    id: string;
    ref: string;
    title: string;
    status: MyMaterial["item"]["status"];
    track_id: number | null;
    idea_type_id: number | null;
    tracks: { name: string; color_hex: string } | { name: string; color_hex: string }[] | null;
    idea_types: { name: string } | { name: string }[] | null;
    publishing_slots: { slot_at: string } | { slot_at: string }[] | null;
  } | {
    id: string;
    ref: string;
    title: string;
    status: MyMaterial["item"]["status"];
    track_id: number | null;
    idea_type_id: number | null;
    tracks: { name: string; color_hex: string } | { name: string; color_hex: string }[] | null;
    idea_types: { name: string } | { name: string }[] | null;
    publishing_slots: { slot_at: string } | { slot_at: string }[] | null;
  }[] | null;
};

function one<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function MyPage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const [{ data: participantRows }, { data: tracks }, { data: ideaTypes }, { data: partners }] = await Promise.all([
    supabase.from("item_participants").select("item_id, part, items(id, ref, title, status, track_id, idea_type_id, tracks(name,color_hex), idea_types(name), publishing_slots(slot_at))").eq("user_id", profile.id),
    supabase.from("tracks").select("id, name, color_hex").order("sort_order", { ascending: true }),
    supabase.from("idea_types").select("id, name").eq("active", true).order("id", { ascending: true }),
    supabase.from("partners").select("id, name").eq("active", true).order("name", { ascending: true }),
  ]);

  const materialsByItem = new Map<string, MyMaterial>();
  for (const row of (participantRows ?? []) as unknown as ParticipantItemRow[]) {
    const item = one(row.items);
    if (!item) continue;

    const existing = materialsByItem.get(row.item_id);
    if (existing) {
      if (!existing.parts.includes(row.part)) existing.parts.push(row.part);
      continue;
    }

    const track = one(item.tracks);
    const ideaType = one(item.idea_types);
    const slot = one(item.publishing_slots);
    materialsByItem.set(row.item_id, {
      item_id: row.item_id,
      parts: [row.part],
      item: {
        id: item.id,
        ref: item.ref,
        title: item.title,
        status: item.status,
        track_id: item.track_id,
        idea_type_id: item.idea_type_id,
        track_name: track?.name ?? null,
        track_color: track?.color_hex ?? null,
        idea_type: ideaType?.name ?? null,
        slot_at: slot?.slot_at ?? null,
      },
    });
  }

  const materials = Array.from(materialsByItem.values()).sort((a, b) => a.item.title.localeCompare(b.item.title, "ar"));
  return <MyMaterials materials={materials} tracks={(tracks ?? []) as TrackOption[]} ideaTypes={(ideaTypes ?? []) as IdeaTypeOption[]} partners={(partners ?? []) as PartnerOption[]} currentUserId={profile.id} roles={profile.roles} />;
}
