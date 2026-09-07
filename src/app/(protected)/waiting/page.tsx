import { WaitingBoard } from "@/components/waiting-board";
import { listAdminUsers } from "@/lib/admin-users-server";
import { activeTeamMemberOptions, teamMembersLoadError } from "@/lib/admin-team-members";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { WaitingItem } from "@/lib/ui-data";

export default async function WaitingPage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const isAdmin = profile.roles.includes("admin");
  const [waitingResult, adminUsersResult] = await Promise.all([
    supabase.from("v_waiting")
      .select("id, ref, title, status, track_id, track_name, slot_at, waiting_on, people")
      .order("waiting_on", { ascending: true })
      .order("slot_at", { ascending: true }),
    isAdmin
      ? listAdminUsers().then((users) => ({ users, error: null })).catch(() => ({ users: [], error: teamMembersLoadError }))
      : Promise.resolve({ users: [], error: null }),
  ]);
  const { data: waitingRows, error } = waitingResult;
  const teamMembers = activeTeamMemberOptions(adminUsersResult.users);
  const items: WaitingItem[] = ((waitingRows ?? []) as Omit<WaitingItem, "track_color">[]).map((item) => ({ ...item, track_color: null }));
  return <WaitingBoard items={items} currentUserId={profile.id} roles={profile.roles} teamMembers={teamMembers} teamMembersLoadError={adminUsersResult.error} loadError={error ? "تعذر تحميل قائمة الانتظار. حاول مجددًا. رمز التشخيص: WAITING_LOAD." : null} />;
}
