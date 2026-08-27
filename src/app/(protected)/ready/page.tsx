import { ReadyList } from "@/components/ready-list";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { IdeaTypeOption, PartnerOption, ReadyItem, TrackOption } from "@/lib/ui-data";

export default async function ReadyPage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const [{ data: readyItems }, { data: tracks }, { data: ideaTypes }, { data: partners }] = await Promise.all([
    supabase.from("v_ready_queue").select("id, ref, title, caption, production_file_url, track_id, track_name, color_hex, idea_type, slot_id, slot_at, partners").order("slot_at", { ascending: true }),
    supabase.from("tracks").select("id, name, color_hex").order("sort_order", { ascending: true }),
    supabase.from("idea_types").select("id, name").eq("active", true).order("id", { ascending: true }),
    supabase.from("partners").select("id, name").eq("active", true).order("name", { ascending: true }),
  ]);
  return <ReadyList initialItems={(readyItems ?? []) as ReadyItem[]} tracks={(tracks ?? []) as TrackOption[]} ideaTypes={(ideaTypes ?? []) as IdeaTypeOption[]} partners={(partners ?? []) as PartnerOption[]} currentUserId={profile.id} roles={profile.roles} />;
}
