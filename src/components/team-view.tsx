"use client";

import { MyMaterials } from "@/components/my-materials";
import { TeamMemberPicker, type TeamMemberOption } from "@/components/team-member-picker";
import type { TeamMemberOption as AssignmentTeamMemberOption } from "@/lib/admin-create-item";
import type { MyMaterial, RoleName } from "@/lib/ui-data";

type Props = {
  members: TeamMemberOption[];
  selectedMember: TeamMemberOption | null;
  invalidMessage: string | null;
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
  materialsError,
  materials,
  currentUserId,
  roles,
  assignmentTeamMembers,
  assignmentTeamMembersLoadError,
}: Props) {
  return (
    <MyMaterials
      title="عرض مهام الفريق"
      eyebrow="أدمن"
      materials={materials}
      currentUserId={currentUserId}
      roles={roles}
      teamMembers={assignmentTeamMembers}
      teamMembersLoadError={assignmentTeamMembersLoadError}
      showMaterialSections={Boolean(selectedMember) && !materialsError}
      beforeLists={(
        <div className="team-view-stack">
          <TeamMemberPicker members={members} selectedMemberId={selectedMember?.id ?? null} />
          {invalidMessage ? <p className="notice" role="alert">{invalidMessage}</p> : null}
          {selectedMember ? (
            <>
              <p className="notice">أنت تعرض مهام {selectedMember.display_name}. حسابك ما زال حساب الأدمن.</p>
              <p className="muted">عند فتح المادة ستستخدم صلاحياتك كأدمن، ولن تنفّذ أي إجراء باسم العضو.</p>
            </>
          ) : !invalidMessage ? (
            <p className="muted">اختر عضوًا لعرض المواد المسندة إليه.</p>
          ) : null}
          {materialsError ? <p className="notice" role="alert">{materialsError}</p> : null}
        </div>
      )}
    />
  );
}
