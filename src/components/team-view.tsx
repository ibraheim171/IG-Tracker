"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { MyMaterials } from "@/components/my-materials";
import { TeamMemberPicker, type TeamMemberOption } from "@/components/team-member-picker";
import type { TeamMemberOption as AssignmentTeamMemberOption } from "@/lib/admin-create-item";
import type { TeamViewMembersAvailability } from "@/lib/admin-team-members";
import type { MyMaterial, RoleName } from "@/lib/ui-data";

type Props = {
  members: TeamMemberOption[];
  selectedMember: TeamMemberOption | null;
  invalidMessage: string | null;
  membersAvailability: TeamViewMembersAvailability;
  materialsError: string | null;
  materials: MyMaterial[];
  currentUserId: string;
  roles: RoleName[];
  assignmentTeamMembers: AssignmentTeamMemberOption[];
  assignmentTeamMembersLoadError: string | null;
};

export function TeamView({
  members,
  selectedMember,
  invalidMessage,
  membersAvailability,
  materialsError,
  materials,
  currentUserId,
  roles,
  assignmentTeamMembers,
  assignmentTeamMembersLoadError,
}: Props) {
  const router = useRouter();
  const [retryingTeamMembers, startTeamMembersRetry] = useTransition();

  function retryTeamMembers() {
    startTeamMembersRetry(() => router.refresh());
  }

  return (
    <MyMaterials
      title="عرض مهام الفريق"
      eyebrow="أدمن"
      materials={materials}
      currentUserId={currentUserId}
      roles={roles}
      teamMembers={assignmentTeamMembers}
      teamMembersLoadError={assignmentTeamMembersLoadError}
      onRetryTeamMembers={retryTeamMembers}
      retryingTeamMembers={retryingTeamMembers}
      showMaterialSections={Boolean(selectedMember) && !materialsError}
      beforeLists={(
        <div className="team-view-stack">
          {membersAvailability === "ready" ? <TeamMemberPicker members={members} selectedMemberId={selectedMember?.id ?? null} /> : null}
          {membersAvailability === "empty" ? <p className="muted" role="status">لا يوجد أعضاء فريق متاحون.</p> : null}
          {invalidMessage ? <p className="notice" role="alert">{invalidMessage}</p> : null}
          {selectedMember ? (
            <>
              <p className="notice">أنت تعرض مهام {selectedMember.display_name}. حسابك ما زال حساب الأدمن.</p>
              <p className="muted">عند فتح المادة ستستخدم صلاحياتك كأدمن، ولن تنفّذ أي إجراء باسم العضو.</p>
            </>
          ) : !invalidMessage && membersAvailability === "ready" ? (
            <p className="muted">اختر عضوًا لعرض المواد المسندة إليه.</p>
          ) : null}
          {materialsError ? <p className="notice" role="alert">{materialsError}</p> : null}
        </div>
      )}
    />
  );
}
