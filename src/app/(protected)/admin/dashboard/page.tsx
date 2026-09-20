import { AdminDashboard } from "@/components/admin-dashboard";
import { activeTeamMemberOptions, teamMembersLoadError } from "@/lib/admin-team-members";
import { listAdminUsers } from "@/lib/admin-users-server";
import { requireAdmin } from "@/lib/auth";

export default async function AdminDashboardPage() {
  const profile = await requireAdmin();
  const memberResult = await listAdminUsers()
    .then((users) => ({ members: activeTeamMemberOptions(users), error: null }))
    .catch(() => ({ members: [], error: teamMembersLoadError }));
  return <AdminDashboard currentUserId={profile.id} roles={profile.roles} teamMembers={memberResult.members} teamMembersLoadError={memberResult.error} />;
}
