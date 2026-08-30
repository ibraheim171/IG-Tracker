import { ReadyList } from "@/components/ready-list";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ReadyItem } from "@/lib/ui-data";

export default async function ReadyPage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const { data: readyItems } = await supabase
    .from("v_ready_queue")
    .select("id, ref, title, caption, production_file_url, track_id, track_name, color_hex, idea_type, slot_id, slot_at, partners")
    .order("slot_at", { ascending: true });
  return <ReadyList initialItems={(readyItems ?? []) as ReadyItem[]} currentUserId={profile.id} roles={profile.roles} />;
}
