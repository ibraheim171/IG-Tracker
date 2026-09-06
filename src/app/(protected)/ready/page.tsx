import { ReadyList } from "@/components/ready-list";
import { listAdminUsers } from "@/lib/admin-users-server";
import { activeTeamMemberOptions, teamMembersLoadError } from "@/lib/admin-team-members";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ReadyItem } from "@/lib/ui-data";
import { isAdminRole } from "@/lib/ui-data";

export default async function ReadyPage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const isAdmin = isAdminRole(profile.roles);
  const adminUsersPromise = isAdmin
    ? listAdminUsers().then((users) => ({ users, error: null })).catch(() => ({ users: [], error: teamMembersLoadError }))
    : Promise.resolve({ users: [], error: null });
  const { data: readyItems, error } = await supabase
    .from("v_ready_queue")
    .select("id, ref, title, caption, production_file_url, track_id, track_name, color_hex, idea_type, slot_id, slot_at, partners")
    .order("slot_at", { ascending: true });
  const adminUsersResult = await adminUsersPromise;
  const teamMembers = activeTeamMemberOptions(adminUsersResult.users);
  return <ReadyList initialItems={(readyItems ?? []) as ReadyItem[]} currentUserId={profile.id} roles={profile.roles} teamMembers={teamMembers} teamMembersLoadError={adminUsersResult.error} loadError={error ? "تعذر تحميل المواد الجاهزة للنشر. حاول مجددًا. رمز التشخيص: READY_LOAD." : null} />;
}
