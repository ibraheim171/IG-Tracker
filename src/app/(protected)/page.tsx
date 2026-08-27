import { SlotsBoard } from "@/components/slots-board";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { BoardItem, BoardSlot, IdeaTypeOption, PartnerOption, TrackOption } from "@/lib/ui-data";

type ItemWithLookups = {
  id: string;
  ref: string;
  title: string;
  status: BoardItem["status"];
  slot_id: string | null;
  track_id: number | null;
  idea_type_id: number | null;
  tracks: { name: string; color_hex: string } | { name: string; color_hex: string }[] | null;
  idea_types: { name: string } | { name: string }[] | null;
};

function one<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function HomePage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const since = new Date(Date.now() - 4 * 86_400_000).toISOString();
  const [{ data: slotsData }, { data: tracks }, { data: ideaTypes }, { data: partners }, { data: waitingRows }] = await Promise.all([
    supabase.from("v_slot_board").select("slot_id, slot_at, state, n_items, n_ready").gte("slot_at", since).order("slot_at", { ascending: true }),
    supabase.from("tracks").select("id, name, color_hex").order("sort_order", { ascending: true }),
    supabase.from("idea_types").select("id, name").eq("active", true).order("id", { ascending: true }),
    supabase.from("partners").select("id, name").eq("active", true).order("name", { ascending: true }),
    supabase.from("v_waiting").select("id, waiting_on"),
  ]);
  const slots = (slotsData ?? []) as BoardSlot[];
  const slotIds = slots.map((slot) => slot.slot_id).filter((id): id is string => Boolean(id));
  const { data: itemRows } = slotIds.length
    ? await supabase.from("items").select("id, ref, title, status, slot_id, track_id, idea_type_id, tracks(name,color_hex), idea_types(name)").in("slot_id", slotIds)
    : { data: [] };
  const rawItems = (itemRows ?? []) as unknown as ItemWithLookups[];
  const waitingById = new Map((waitingRows ?? []).map((row) => [row.id, row.waiting_on]));
  const items: BoardItem[] = rawItems.map((item) => {
    const track = one(item.tracks);
    const ideaType = one(item.idea_types);
    return {
      id: item.id,
      ref: item.ref,
      title: item.title,
      status: item.status,
      slot_id: item.slot_id,
      track_id: item.track_id,
      idea_type_id: item.idea_type_id,
      track_name: track?.name ?? null,
      track_color: track?.color_hex ?? null,
      idea_type: ideaType?.name ?? null,
      waiting_on: waitingById.get(item.id) ?? null,
    };
  });
  return <SlotsBoard slots={slots} items={items} tracks={(tracks ?? []) as TrackOption[]} ideaTypes={(ideaTypes ?? []) as IdeaTypeOption[]} partners={(partners ?? []) as PartnerOption[]} currentUserId={profile.id} roles={profile.roles} />;
}
