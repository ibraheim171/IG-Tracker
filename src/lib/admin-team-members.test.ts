import assert from "node:assert/strict";
import test from "node:test";
import { fetchAdminTeamMembers, teamMembersAvailability, teamMembersForRole, teamMembersLoadError } from "./admin-team-members.ts";

test("يفصل فشل تحميل أعضاء الفريق عن القائمة الفارغة ويقبل إعادة المحاولة", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, json: async () => ({ error: "تعذر التحميل" }) };
    return {
      ok: true,
      json: async () => ({
        users: [
          { id: "active", display_name: "عضو نشط", email: "active@example.test", roles: ["writer"], active: true, must_change_password: false },
          { id: "inactive", display_name: "عضو معطل", email: "inactive@example.test", roles: ["writer"], active: false, must_change_password: false },
        ],
      }),
    };
  };

  const failed = await fetchAdminTeamMembers(fetcher);
  assert.deepEqual(failed, { teamMembers: [], error: teamMembersLoadError });
  assert.equal(teamMembersAvailability(failed.teamMembers, failed.error, false), "error");
  assert.equal(teamMembersAvailability(failed.teamMembers, failed.error, true), "loading");

  const retried = await fetchAdminTeamMembers(fetcher);
  assert.deepEqual(retried, {
    teamMembers: [{ id: "active", display_name: "عضو نشط", email: "active@example.test", roles: ["writer"] }],
    error: null,
  });
  assert.equal(teamMembersAvailability(retried.teamMembers, retried.error, false), "ready");
});

test("يبقى غياب أعضاء الفريق الفعلي مختلفًا عن تعذر التحميل", async () => {
  const result = await fetchAdminTeamMembers(async () => ({ ok: true, json: async () => ({ users: [] }) }));
  assert.deepEqual(result, { teamMembers: [], error: null });
  assert.equal(teamMembersAvailability(result.teamMembers, result.error, false), "empty");
});

test("تعرض محددات الدرج أعضاء الفريق النشطين بحسب الدور", async () => {
  const result = await fetchAdminTeamMembers(async () => ({
    ok: true,
    json: async () => ({
      users: [
        { id: "multi-role", display_name: "عضو متعدد", email: "multi@example.test", roles: ["writer", "producer", "reviewer"], active: true, must_change_password: false },
      ],
    }),
  }));

  assert.equal(teamMembersForRole(result.teamMembers, "writer")[0]?.id, "multi-role");
  assert.equal(teamMembersForRole(result.teamMembers, "producer")[0]?.id, "multi-role");
  assert.equal(teamMembersForRole(result.teamMembers, "reviewer")[0]?.id, "multi-role");
});
