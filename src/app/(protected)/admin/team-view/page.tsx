import { TeamView } from "@/components/team-view";
import { activeTeamMemberOptions, resolveTeamViewTeamState, teamMembersLoadError } from "@/lib/admin-team-members";
import { listAdminUsers } from "@/lib/admin-users-server";
import { requireAdmin } from "@/lib/auth";
import { buildMyMaterials, participantItemsSelect, type ParticipantItemRow } from "@/lib/my-materials-data";
import { createClient } from "@/lib/supabase/server";
import type { MyMaterial } from "@/lib/ui-data";

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

  const adminUsersResult = await listAdminUsers()
    .then((users) => ({ users, error: null }))
    .catch(() => ({ users: [], error: teamMembersLoadError }));
  const teamState = resolveTeamViewTeamState(adminUsersResult.users, adminUsersResult.error, rawMemberId, requestedMemberId);

  let materials: MyMaterial[] = [];
  let materialsError: string | null = null;
  if (teamState.canLoadMaterials && teamState.selectedMember) {
    const { data: participantRows, error: participantRowsError } = await supabase
      .from("item_participants")
      .select(participantItemsSelect)
      .eq("user_id", teamState.selectedMember.id);

    if (participantRowsError) {
      materialsError = materialsLoadError;
    } else {
      materials = buildMyMaterials((participantRows ?? []) as unknown as ParticipantItemRow[]);
    }
  }

  return (
    <TeamView
      members={teamState.members}
      selectedMember={teamState.selectedMember}
      invalidMessage={teamState.invalidMessage}
      materialsError={materialsError}
      materials={materials}
      currentUserId={adminProfile.id}
      roles={adminProfile.roles}
      assignmentTeamMembers={activeTeamMemberOptions(adminUsersResult.users)}
      assignmentTeamMembersLoadError={adminUsersResult.error}
    />
  );
}
