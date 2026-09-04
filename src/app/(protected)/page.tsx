import { SlotsBoard } from "@/components/slots-board";
import { listAdminUsers } from "@/lib/admin-users-server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { TeamMemberOption } from "@/lib/admin-create-item";
import type { BoardItem, BoardSlot } from "@/lib/ui-data";
import { currentOwnerParts } from "@/lib/workflow-ui";

type ItemWithLookups = {
  id: string;
  ref: string;
  title: string;
  status: BoardItem["status"];
  slot_id: string | null;
  track_id: number | null;
  idea_type_id: number | null;
  item_participants: {
    part: "writer" | "producer" | "reviewer";
    profiles: { display_name: string } | { display_name: string }[] | null;
  }[];
};

function oneProfile(value: ItemWithLookups["item_participants"][number]["profiles"]) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function HomePage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const isAdmin = profile.roles.includes("admin");
  const since = new Date(Date.now() - 4 * 86_400_000).toISOString();
  const [{ data: slotsData }, { data: waitingRows }, { data: itemRows }, adminUsers] = await Promise.all([
    supabase.from("v_slot_board").select("slot_id, slot_at, state, n_items, n_ready").gte("slot_at", since).order("slot_at", { ascending: true }),
    supabase.from("v_waiting").select("id, waiting_on"),
    supabase.from("items").select("id, ref, title, status, slot_id, track_id, idea_type_id, item_participants(part, profiles:profiles!item_participants_user_id_fkey(display_name))").not("slot_id", "is", null),
    isAdmin ? listAdminUsers().catch(() => []) : Promise.resolve([]),
  ]);
  const slots = (slotsData ?? []) as BoardSlot[];
  const slotIds = new Set(slots.map((slot) => slot.slot_id).filter((id): id is string => Boolean(id)));
  const rawItems = ((itemRows ?? []) as ItemWithLookups[]).filter((item) => item.slot_id && slotIds.has(item.slot_id));
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
    current_assignees: item.item_participants
      .filter((participant) => currentOwnerParts(item.status).includes(participant.part))
      .map((participant) => oneProfile(participant.profiles)?.display_name)
      .filter((name): name is string => Boolean(name)),
  }));
  const teamMembers: TeamMemberOption[] = adminUsers
    .filter((user) => user.active && !user.must_change_password)
    .map((user) => ({
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      roles: user.roles,
    }));

  return <SlotsBoard slots={slots} items={items} currentUserId={profile.id} roles={profile.roles} teamMembers={teamMembers} />;
}
