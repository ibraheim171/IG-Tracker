import { ReadyList } from "@/components/ready-list";
import { listAdminUsers } from "@/lib/admin-users-server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { TeamMemberOption } from "@/lib/admin-create-item";
import type { ReadyItem } from "@/lib/ui-data";
import { isAdminRole } from "@/lib/ui-data";

export default async function ReadyPage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const isAdmin = isAdminRole(profile.roles);
  const adminUsersPromise = isAdmin ? listAdminUsers().catch(() => []) : Promise.resolve([]);
  const { data: readyItems } = await supabase
    .from("v_ready_queue")
    .select("id, ref, title, caption, production_file_url, track_id, track_name, color_hex, idea_type, slot_id, slot_at, partners")
    .order("slot_at", { ascending: true });
  const adminUsers = await adminUsersPromise;
  const teamMembers: TeamMemberOption[] = adminUsers
    .filter((user) => user.active && !user.must_change_password)
    .map((user) => ({
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      roles: user.roles,
    }));
  return <ReadyList initialItems={(readyItems ?? []) as ReadyItem[]} currentUserId={profile.id} roles={profile.roles} teamMembers={teamMembers} />;
}
