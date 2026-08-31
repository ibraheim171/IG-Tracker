import { TeamView } from "@/components/team-view";
import { requireAdmin } from "@/lib/auth";
import { buildMyMaterials, participantItemsSelect, type ParticipantItemRow } from "@/lib/my-materials-data";
import { createClient } from "@/lib/supabase/server";
import type { MyMaterial } from "@/lib/ui-data";
import type { TeamMemberOption } from "@/components/team-member-picker";

type SearchParams = Promise<{ member?: string | string[] }>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const materialsLoadError = "تعذر تحميل المواد. حاول مجددًا. رمز التشخيص: MATERIALS_LOAD";

function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TeamViewPage({ searchParams }: { searchParams: SearchParams }) {
  const adminProfile = await requireAdmin();
  const supabase = await createClient();
  const params = await searchParams;
  const rawMemberId = firstSearchValue(params.member);
  const requestedMemberId = rawMemberId && uuidPattern.test(rawMemberId) ? rawMemberId : null;

  const { data: profileRows, error: profilesError } = await supabase
    .from("profiles")
    .select("id, display_name, roles, active")
    .order("active", { ascending: false })
    .order("display_name", { ascending: true });

  const members = (profileRows ?? []) as unknown as TeamMemberOption[];
  const selectedMember = requestedMemberId ? members.find((member) => member.id === requestedMemberId) ?? null : null;
  const invalidMessage = profilesError
    ? "تعذر تحميل أعضاء الفريق. حاول مجددًا."
    : rawMemberId && !selectedMember
      ? "تعذر العثور على العضو المطلوب. اختر عضوًا من القائمة."
      : null;

  let materials: MyMaterial[] = [];
  let materialsError: string | null = null;
  if (selectedMember) {
    const { data: participantRows, error: participantRowsError } = await supabase
      .from("item_participants")
      .select(participantItemsSelect)
      .eq("user_id", selectedMember.id);

    if (participantRowsError) {
      materialsError = materialsLoadError;
    } else {
      materials = buildMyMaterials((participantRows ?? []) as unknown as ParticipantItemRow[]);
    }
  }

  return (
    <TeamView
      members={members}
      selectedMember={selectedMember}
      invalidMessage={invalidMessage}
      materialsError={materialsError}
      materials={materials}
      currentUserId={adminProfile.id}
      roles={adminProfile.roles}
    />
  );
}
