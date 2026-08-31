import { MyMaterials } from "@/components/my-materials";
import { getCurrentProfile } from "@/lib/auth";
import { buildMyMaterials, participantItemsSelect, type ParticipantItemRow } from "@/lib/my-materials-data";
import { createClient } from "@/lib/supabase/server";

export default async function MyPage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const { data: participantRows } = await supabase
    .from("item_participants")
    .select(participantItemsSelect)
    .eq("user_id", profile.id);

  const materials = buildMyMaterials((participantRows ?? []) as unknown as ParticipantItemRow[]);
  return <MyMaterials materials={materials} currentUserId={profile.id} roles={profile.roles} />;
}
