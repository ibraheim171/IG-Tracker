import type { MyMaterial, ParticipantPart } from "@/lib/ui-data";

type ParticipantItem = {
  id: string;
  ref: string;
  title: string;
  status: MyMaterial["item"]["status"];
  track_id: number | null;
  idea_type_id: number | null;
  tracks: { name: string; color_hex: string } | { name: string; color_hex: string }[] | null;
  idea_types: { name: string } | { name: string }[] | null;
  publishing_slots: { slot_at: string } | { slot_at: string }[] | null;
};

export type ParticipantItemRow = {
  item_id: string;
  part: ParticipantPart;
  items: ParticipantItem | ParticipantItem[] | null;
};

export const participantItemsSelect = "item_id, part, items(id, ref, title, status, track_id, idea_type_id, tracks(name,color_hex), idea_types(name), publishing_slots(slot_at))";

function one<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function buildMyMaterials(participantRows: ParticipantItemRow[] | null | undefined) {
  const materialsByItem = new Map<string, MyMaterial>();

  for (const row of participantRows ?? []) {
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

  return Array.from(materialsByItem.values()).sort((a, b) => a.item.title.localeCompare(b.item.title, "ar"));
}
