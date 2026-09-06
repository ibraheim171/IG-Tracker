import assert from "node:assert/strict";
import test from "node:test";
import { fetchAdminTeamMembers, teamMembersLoadError } from "./admin-team-members.ts";

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

  assert.deepEqual(await fetchAdminTeamMembers(fetcher), { teamMembers: [], error: teamMembersLoadError });
  assert.deepEqual(await fetchAdminTeamMembers(fetcher), {
    teamMembers: [{ id: "active", display_name: "عضو نشط", email: "active@example.test", roles: ["writer"] }],
    error: null,
  });
});

test("يبقى غياب أعضاء الفريق الفعلي مختلفًا عن تعذر التحميل", async () => {
  const result = await fetchAdminTeamMembers(async () => ({ ok: true, json: async () => ({ users: [] }) }));
  assert.deepEqual(result, { teamMembers: [], error: null });
});
