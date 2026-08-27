import { WaitingBoard } from "@/components/waiting-board";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { IdeaTypeOption, PartnerOption, TrackOption, WaitingItem } from "@/lib/ui-data";

export default async function WaitingPage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const [{ data: waitingRows }, { data: tracks }, { data: ideaTypes }, { data: partners }] = await Promise.all([
    supabase.from("v_waiting").select("id, ref, title, status, track_id, track_name, slot_at, waiting_on, people").order("waiting_on", { ascending: true }).order("slot_at", { ascending: true }),
    supabase.from("tracks").select("id, name, color_hex").order("sort_order", { ascending: true }),
    supabase.from("idea_types").select("id, name").eq("active", true).order("id", { ascending: true }),
    supabase.from("partners").select("id, name").eq("active", true).order("name", { ascending: true }),
  ]);
  const colorByTrack = new Map((tracks ?? []).map((track) => [track.id, track.color_hex]));
  const items: WaitingItem[] = ((waitingRows ?? []) as Omit<WaitingItem, "track_color">[]).map((item) => ({ ...item, track_color: item.track_id ? colorByTrack.get(item.track_id) ?? null : null }));
  return <WaitingBoard items={items} tracks={(tracks ?? []) as TrackOption[]} ideaTypes={(ideaTypes ?? []) as IdeaTypeOption[]} partners={(partners ?? []) as PartnerOption[]} currentUserId={profile.id} roles={profile.roles} />;
}
