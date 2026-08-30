import { WaitingBoard } from "@/components/waiting-board";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { WaitingItem } from "@/lib/ui-data";

export default async function WaitingPage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const { data: waitingRows } = await supabase
    .from("v_waiting")
    .select("id, ref, title, status, track_id, track_name, slot_at, waiting_on, people")
    .order("waiting_on", { ascending: true })
    .order("slot_at", { ascending: true });
  const items: WaitingItem[] = ((waitingRows ?? []) as Omit<WaitingItem, "track_color">[]).map((item) => ({ ...item, track_color: null }));
  return <WaitingBoard items={items} currentUserId={profile.id} roles={profile.roles} />;
}
