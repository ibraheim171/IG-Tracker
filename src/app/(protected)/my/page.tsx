import { MyMaterials } from "@/components/my-materials";
import { listAdminUsers } from "@/lib/admin-users-server";
import { activeTeamMemberOptions, teamMembersLoadError } from "@/lib/admin-team-members";
import { getCurrentProfile } from "@/lib/auth";
import { buildMyMaterials, participantItemsSelect, type ParticipantItemRow } from "@/lib/my-materials-data";
import { createClient } from "@/lib/supabase/server";

const materialsLoadError = "تعذر تحميل المواد. حاول مجددًا. رمز التشخيص: MATERIALS_LOAD.";

export default async function MyPage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const isAdmin = profile.roles.includes("admin");
  const [participantRowsResult, adminUsersResult] = await Promise.all([
    supabase.from("item_participants").select(participantItemsSelect).eq("user_id", profile.id),
    isAdmin
      ? listAdminUsers().then((users) => ({ users, error: null })).catch(() => ({ users: [], error: teamMembersLoadError }))
      : Promise.resolve({ users: [], error: null }),
  ]);
  const teamMembers = activeTeamMemberOptions(adminUsersResult.users);
  const { data: participantRows, error: participantRowsError } = participantRowsResult;

  if (participantRowsError) {
    return (
      <MyMaterials
        materials={[]}
        currentUserId={profile.id}
        roles={profile.roles}
        teamMembers={teamMembers}
        teamMembersLoadError={adminUsersResult.error}
        showMaterialSections={false}
        loadError={materialsLoadError}
      />
    );
  }

  const materials = buildMyMaterials((participantRows ?? []) as unknown as ParticipantItemRow[]);
  return <MyMaterials materials={materials} currentUserId={profile.id} roles={profile.roles} teamMembers={teamMembers} teamMembersLoadError={adminUsersResult.error} />;
}
