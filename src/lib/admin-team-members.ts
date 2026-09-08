import type { TeamMemberOption } from "@/lib/admin-create-item";
import type { RoleName } from "@/lib/ui-data";

export type AdminTeamUser = {
  id: string;
  display_name: string;
  email: string;
  roles: RoleName[];
  active: boolean;
  must_change_password: boolean;
};

type FetchResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

export const teamMembersLoadError = "تعذر تحميل أعضاء الفريق. حاول مجددًا. رمز التشخيص: TEAM_MEMBERS_LOAD.";

export type TeamMembersAvailability = "loading" | "error" | "empty" | "ready";

export type TeamViewMemberOption = {
  id: string;
  display_name: string;
  roles: RoleName[];
  active: boolean;
};

export function resolveTeamViewTeamState(
  users: AdminTeamUser[],
  error: string | null,
  rawMemberId: string | null | undefined,
  requestedMemberId: string | null,
) {
  const members: TeamViewMemberOption[] = users.map((user) => ({
    id: user.id,
    display_name: user.display_name,
    roles: user.roles,
    active: user.active,
  }));
  const selectedMember = requestedMemberId ? members.find((member) => member.id === requestedMemberId) ?? null : null;
  const invalidMessage = error
    ? "تعذر تحميل أعضاء الفريق. حاول مجددًا."
    : rawMemberId && !selectedMember
      ? "تعذر العثور على العضو المطلوب. اختر عضوًا من القائمة."
      : null;
  return { members, selectedMember, invalidMessage, canLoadMaterials: Boolean(selectedMember) };
}

export function teamMembersAvailability(teamMembers: TeamMemberOption[], error: string | null, loading: boolean): TeamMembersAvailability {
  if (loading) return "loading";
  if (error) return "error";
  return teamMembers.length > 0 ? "ready" : "empty";
}

export function teamMembersForRole(teamMembers: TeamMemberOption[], role: "writer" | "producer" | "reviewer") {
  return teamMembers
    .filter((member) => member.roles.includes(role))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ar"));
}

export function activeTeamMemberOptions(users: AdminTeamUser[]): TeamMemberOption[] {
  return users
    .filter((user) => user.active && !user.must_change_password)
    .map((user) => ({
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      roles: user.roles,
    }));
}

export async function fetchAdminTeamMembers(fetcher: () => Promise<FetchResponse> = () => fetch("/api/admin/users", { cache: "no-store", credentials: "same-origin" })) {
  try {
    const response = await fetcher();
    const payload = (await response.json().catch(() => ({}))) as { users?: unknown };
    if (!response.ok || !Array.isArray(payload.users)) {
      return { teamMembers: [] as TeamMemberOption[], error: teamMembersLoadError };
    }
    return { teamMembers: activeTeamMemberOptions(payload.users as AdminTeamUser[]), error: null };
  } catch {
    return { teamMembers: [] as TeamMemberOption[], error: teamMembersLoadError };
  }
}
