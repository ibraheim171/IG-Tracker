import { SlotsBoard } from "@/components/slots-board";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { BoardItem, BoardSlot } from "@/lib/ui-data";

type ItemWithLookups = {
  id: string;
  ref: string;
  title: string;
  status: BoardItem["status"];
  slot_id: string | null;
  track_id: number | null;
  idea_type_id: number | null;
};

export default async function HomePage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const since = new Date(Date.now() - 4 * 86_400_000).toISOString();
  const [{ data: slotsData }, { data: waitingRows }] = await Promise.all([
    supabase.from("v_slot_board").select("slot_id, slot_at, state, n_items, n_ready").gte("slot_at", since).order("slot_at", { ascending: true }),
    supabase.from("v_waiting").select("id, waiting_on"),
  ]);
  const slots = (slotsData ?? []) as BoardSlot[];
  const slotIds = slots.map((slot) => slot.slot_id).filter((id): id is string => Boolean(id));
  const { data: itemRows } = slotIds.length
    ? await supabase.from("items").select("id, ref, title, status, slot_id, track_id, idea_type_id").in("slot_id", slotIds)
    : { data: [] };
  const rawItems = (itemRows ?? []) as unknown as ItemWithLookups[];
  const waitingById = new Map((waitingRows ?? []).map((row) => [row.id, row.waiting_on]));
  const items: BoardItem[] = rawItems.map((item) => ({
    id: item.id,
    ref: item.ref,
    title: item.title,
    status: item.status,
    slot_id: item.slot_id,
    track_id: item.track_id,
    idea_type_id: item.idea_type_id,
    track_name: null,
    track_color: null,
    idea_type: null,
    waiting_on: waitingById.get(item.id) ?? null,
  }));
  return <SlotsBoard slots={slots} items={items} currentUserId={profile.id} roles={profile.roles} />;
}
