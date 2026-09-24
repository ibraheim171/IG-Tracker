import { InsightsShell } from "@/components/insights/insights-shell";
import { currentMonthRange } from "@/lib/account-pulse";
import { requireAdmin } from "@/lib/auth";
import { activeTeamMemberOptions, teamMembersLoadError } from "@/lib/admin-team-members";
import { listAdminUsers } from "@/lib/admin-users-server";
import { parseInsightSection } from "@/lib/analytics-table";

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const query = await searchParams;
  const profile = await requireAdmin();
  const memberResult = await listAdminUsers()
    .then((users) => ({ members: activeTeamMemberOptions(users), error: null }))
    .catch(() => ({ members: [], error: teamMembersLoadError }));
  return <InsightsShell initialSection={parseInsightSection(query.section ?? null)} initialRange={currentMonthRange()} currentUserId={profile.id} roles={profile.roles} teamMembers={memberResult.members} teamMembersLoadError={memberResult.error} />;
}
