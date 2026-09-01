import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  AdminActionError,
  type AdminProfile,
  type AdminUserStore,
  createAdminAccount,
  deleteAdminAccount,
  getProtectedProfileIssue,
  isActiveProfileAllowed,
  isAuthorizedAdminProfile,
  isProtectedProfileAllowed,
  resetAdminPassword,
  sanitizeAuditValues,
  updateAdminAccount,
} from "./admin-users-core.ts";
import { createEmptyUserDraft } from "./admin-users-form.ts";
import type { Role } from "./admin-users.ts";

const actorId = "00000000-0000-0000-0000-000000000001";
const targetId = "00000000-0000-0000-0000-000000000002";

test("authorization rejects non-admin, disabled admin, and must-change-password admin", () => {
  assert.equal(isAuthorizedAdminProfile(profile({ roles: ["writer"] })), false);
  assert.equal(isAuthorizedAdminProfile(profile({ active: false, roles: ["admin"] })), false);
  assert.equal(isAuthorizedAdminProfile(profile({ must_change_password: true, roles: ["admin"] })), false);
  assert.equal(isAuthorizedAdminProfile(profile({ roles: ["admin"] })), true);
});

test("disabled profiles are rejected from protected app access even with an existing token", () => {
  assert.equal(isActiveProfileAllowed(profile({ active: true, must_change_password: true })), true);
  assert.equal(isProtectedProfileAllowed(profile({ active: true })), true);
  assert.equal(isProtectedProfileAllowed(profile({ active: false })), false);
  assert.equal(isProtectedProfileAllowed(profile({ active: true, must_change_password: true })), false);
  assert.equal(isProtectedProfileAllowed(null), false);
});

test("protected profile guard blocks must-change users from app pages but allows password page", () => {
  assert.equal(getProtectedProfileIssue(profile({ must_change_password: true })), "PASSWORD_CHANGE_REQUIRED");
  assert.equal(getProtectedProfileIssue(profile({ must_change_password: true }), { allowPasswordChange: true }), null);
  assert.equal(getProtectedProfileIssue(profile({ active: false, must_change_password: true }), { allowPasswordChange: true }), "E_ACCOUNT_DISABLED");
  assert.equal(getProtectedProfileIssue(profile({ must_change_password: false })), null);
});

test("deletion is blocked when business history exists", async () => {
  const store = mockStore({
    listDeletionReferences: async () => [{ label: "items.created_by", count: 1 }],
  });

  await assert.rejects(
    () => deleteAdminAccount(store, actorId, { id: targetId, reason: "duplicate account" }),
    (error: unknown) => {
      assert.equal(error instanceof AdminActionError, true);
      assert.equal((error as AdminActionError).code, "E_HAS_HISTORY");
      assert.deepEqual((error as AdminActionError).details.references, [{ label: "items.created_by", count: 1 }]);
      return true;
    },
  );
  assert.equal(store.calls.includes(`deleteAuthUser:${targetId}`), false);
  assert.equal(store.calls.some((call) => call.startsWith("logAudit:delete_user")), false);
});

test("deletion is allowed for an account without business history and audit history is not a blocker", async () => {
  const source = await readFile(new URL("admin-users-server.ts", import.meta.url), "utf8");
  assert.equal(source.includes("[\"سجل الإدارة\""), false);

  const store = mockStore();
  const result = await deleteAdminAccount(store, actorId, { id: targetId, reason: "never used" });

  assert.deepEqual(result, { deleted: true, id: targetId });
  assert.deepEqual(store.calls.filter((call) => call.includes(targetId)), [
    `getProfile:${targetId}`,
    `guard:${targetId}:false`,
    `listDeletionReferences:${targetId}`,
    `deleteAuthUser:${targetId}`,
    `logAudit:delete_user:${targetId}`,
  ]);
});

test("last-active-admin guard serializes concurrent destructive requests", async () => {
  let activeAdmins = 2;
  let gate = Promise.resolve();
  const profiles = new Map([
    ["admin-a", profile({ id: "admin-a", roles: ["admin"] })],
    ["admin-b", profile({ id: "admin-b", roles: ["admin"] })],
  ]);
  const store = mockStore({
    getProfile: async (id) => profiles.get(id) ?? profile({ id }),
    assertNotLastActiveAdmin: async (target, nextRoles, nextActive) => {
      const previous = gate;
      let release: () => void = () => undefined;
      gate = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        const removesAdmin = target.active && target.roles.includes("admin") && (!nextActive || !nextRoles.includes("admin"));
        if (removesAdmin) {
          if (activeAdmins <= 1) throw new AdminActionError("E_LAST_ADMIN");
          activeAdmins -= 1;
        }
      } finally {
        release();
      }
    },
  });

  const results = await Promise.allSettled([
    deleteAdminAccount(store, actorId, { id: "admin-a", reason: "first request" }),
    deleteAdminAccount(store, actorId, { id: "admin-b", reason: "second request" }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.equal(rejected?.reason instanceof AdminActionError, true);
  assert.equal((rejected?.reason as AdminActionError).code, "E_LAST_ADMIN");
  assert.equal(activeAdmins, 1);
});

test("migration uses an advisory transaction lock for last-active-admin protection", async () => {
  const migration = await readFile(new URL("../../supabase/migrations/0013_admin_account_audit.sql", import.meta.url), "utf8");
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('profiles:last-active-admin'\)\)/);
  assert.match(migration, /before update of active, roles or delete on public\.profiles/);
});

test("duplicate email is rejected before auth creation and no password is returned", async () => {
  const store = mockStore({
    findAuthUserByEmail: async () => ({ id: "existing-user", email: "used@example.com" }),
  });

  await assert.rejects(
    () => createAdminAccount(store, actorId, { email: "used@example.com", displayName: "Used", roles: ["writer"], password: "Secret123!" }),
    (error: unknown) => {
      assert.equal((error as AdminActionError).code, "E_DUPLICATE_EMAIL");
      return true;
    },
  );
  assert.equal(store.calls.some((call) => call.startsWith("createAuthUser")), false);
});

test("audit values remove password, token, secret, and key fields recursively", () => {
  const sanitized = sanitizeAuditValues({
    email: "safe@example.com",
    password: "Secret123!",
    nested: { temporaryPassword: "Secret123!", role: "writer", apiToken: "token" },
    service_role_key: "service-role",
  });

  assert.deepEqual(sanitized, { email: "safe@example.com", nested: { role: "writer" } });
});

test("create cleans up auth users when profile creation fails", async () => {
  const store = mockStore({
    createProfile: async () => { throw new AdminActionError("E_PROFILE_CREATE"); },
  });

  await assert.rejects(
    () => createAdminAccount(store, actorId, { email: "new@example.com", displayName: "New User", roles: ["writer"], password: "Secret123!" }),
    (error: unknown) => {
      assert.equal((error as AdminActionError).code, "E_PROFILE_CREATE");
      return true;
    },
  );
  assert.equal(store.calls.includes("deleteAuthUser:created-user"), true);
});

test("create cleans up profile and auth user when audit write fails", async () => {
  const store = mockStore({
    logAudit: async () => { throw new AdminActionError("E_AUDIT_WRITE"); },
  });

  await assert.rejects(
    () => createAdminAccount(store, actorId, { email: "new@example.com", displayName: "New User", roles: ["admin"], password: "Secret123!" }),
    (error: unknown) => {
      assert.equal((error as AdminActionError).code, "E_AUDIT_WRITE");
      return true;
    },
  );
  assert.equal(store.calls.includes("deleteProfile:created-user"), true);
  assert.equal(store.calls.includes("deleteAuthUser:created-user"), true);
});

test("password reset rolls profile flag back when auth password update fails", async () => {
  const flags: boolean[] = [];
  const store = mockStore({
    setProfileMustChangePassword: async (id, flag) => {
      flags.push(flag);
      return profile({ id, must_change_password: flag });
    },
    updateAuthPassword: async () => { throw new AdminActionError("E_AUTH_PASSWORD"); },
  });

  await assert.rejects(
    () => resetAdminPassword(store, actorId, { id: targetId, password: "NewSecret123!", previousMustChangePassword: false }),
    (error: unknown) => {
      assert.equal((error as AdminActionError).code, "E_AUTH_PASSWORD");
      return true;
    },
  );
  assert.deepEqual(flags, [true, false]);
});

test("active-status update rolls auth ban state back when profile update fails", async () => {
  const statuses: boolean[] = [];
  const store = mockStore({
    updateAuthStatus: async (_id, active) => { statuses.push(active); },
    updateProfile: async () => { throw new AdminActionError("E_PROFILE_UPDATE"); },
  });

  await assert.rejects(
    () => updateAdminAccount(store, actorId, { id: targetId, active: false, reason: "offboarded" }),
    (error: unknown) => {
      assert.equal((error as AdminActionError).code, "E_PROFILE_UPDATE");
      return true;
    },
  );
  assert.deepEqual(statuses, [false, true]);
});

test("create user form clears via state and does not call DOM reset after async submit", async () => {
  const source = await readFile(new URL("../app/(protected)/admin/users/users-manager.tsx", import.meta.url), "utf8");

  assert.equal(source.includes(".reset("), false);
  assert.match(source, /setCreateDraft\(createEmptyUserDraft\(\)\)/);
  assert.deepEqual(createEmptyUserDraft(), {
    displayName: "",
    email: "",
    roles: ["writer"],
    passwordMode: "generated",
    temporaryPassword: "",
  });
});

test("server pages and middleware enforce must-change without redirect loops", async () => {
  const authSource = await readFile(new URL("auth.ts", import.meta.url), "utf8");
  const middleware = await readFile(new URL("../../middleware.ts", import.meta.url), "utf8");
  const protectedPasswordPageExists = await fileExists(new URL("../app/(protected)/account/password/page.tsx", import.meta.url));
  const publicPasswordPageExists = await fileExists(new URL("../app/account/password/page.tsx", import.meta.url));

  assert.match(authSource, /PASSWORD_CHANGE_REQUIRED[\s\S]*redirect\("\/account\/password"\)/);
  assert.match(middleware, /passwordPath = "\/account\/password"/);
  assert.match(middleware, /passwordApiPath = "\/api\/account\/password"/);
  assert.match(middleware, /NextResponse\.json\(passwordRequiredBody, \{ status: 403 \}\)/);
  assert.equal(protectedPasswordPageExists, false);
  assert.equal(publicPasswordPageExists, true);
});

test("protected material APIs reject must-change sessions before loading data", async () => {
  const itemDetails = await readFile(new URL("../app/api/item-details/route.ts", import.meta.url), "utf8");
  const referenceData = await readFile(new URL("../app/api/reference-data/route.ts", import.meta.url), "utf8");
  const adminStage = await readFile(new URL("../app/api/admin/change-item-stage/route.ts", import.meta.url), "utf8");
  const routeAuth = await readFile(new URL("route-auth.ts", import.meta.url), "utf8");

  for (const source of [itemDetails, referenceData, adminStage]) {
    assert.match(source, /requireActiveRouteProfile\(request, cookieResponse\)/);
    assert.match(source, /auth\.error\.code/);
  }
  assert.match(routeAuth, /PASSWORD_CHANGE_REQUIRED/);
  assert.match(routeAuth, /select\("roles, active, must_change_password"\)/);
});

test("password change route clears the flag only after auth password update succeeds", async () => {
  const source = await readFile(new URL("../app/api/account/password/route.ts", import.meta.url), "utf8");
  const authUpdateIndex = source.indexOf("supabase.auth.updateUser({ password: body.password })");
  const profileUpdateIndex = source.indexOf("update({ must_change_password: false })");

  assert.notEqual(authUpdateIndex, -1);
  assert.notEqual(profileUpdateIndex, -1);
  assert.ok(authUpdateIndex < profileUpdateIndex);
  assert.match(source, /allowPasswordChange: true/);
  assert.match(source, /E_PROFILE_PASSWORD_FLAG/);
  assert.equal(/console\.(log|error|warn)|logAudit|admin_account_audit/.test(source), false);
});

test("admin create and reset force password change without auditing passwords", async () => {
  const serverSource = await readFile(new URL("admin-users-server.ts", import.meta.url), "utf8");
  const coreSource = await readFile(new URL("admin-users-core.ts", import.meta.url), "utf8");
  const createAuditBlock = coreSource.match(/operation: "create_user"[\s\S]*?afterValues: sanitizeAuditValues\(\{[\s\S]*?\}\),/)?.[0] ?? "";

  assert.match(serverSource, /insert\(\{ id: input\.id, display_name: input\.displayName, roles: input\.roles, must_change_password: true, active: true \}\)/);
  assert.match(coreSource, /setProfileMustChangePassword\(input\.id, true\)/);
  assert.equal(/temporaryPassword|password/.test(createAuditBlock), false);
});

test("migration blocks must-change users at RLS and RPC layers", async () => {
  const migrations = await readdir(new URL("../../supabase/migrations", import.meta.url));
  const guardMigration = migrations.find((name) => name.endsWith("_must_change_password_app_guard.sql"));
  assert.ok(guardMigration);
  const source = await readFile(new URL(`../../supabase/migrations/${guardMigration}`, import.meta.url), "utf8");

  assert.match(source, /create or replace function public\.can_use_app\(\)/);
  assert.match(source, /and not must_change_password/);
  assert.match(source, /create policy password_ready_user_guard on public\.items[\s\S]*as restrictive/);
  assert.match(source, /create policy password_ready_user_guard on public\.item_partners[\s\S]*as restrictive/);
  assert.match(source, /raise exception 'PASSWORD_CHANGE_REQUIRED:/);
  for (const name of ["advance_item", "reject_item", "mark_published", "assign_slot", "admin_change_item_stage"]) {
    assert.match(source, new RegExp(`create or replace function public\\.${name}[\\s\\S]*?perform public\\.assert_can_use_app\\(\\);`));
  }
});

function profile(overrides: Partial<AdminProfile> = {}): AdminProfile {
  return {
    id: targetId,
    display_name: "Target User",
    roles: ["writer"],
    active: true,
    must_change_password: false,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockStore(overrides: Partial<AdminUserStore> = {}): AdminUserStore & { calls: string[] } {
  const calls: string[] = [];
  const defaults: AdminUserStore = {
    assertNotLastActiveAdmin: async (target, _nextRoles, nextActive) => {
      calls.push(`guard:${target.id}:${nextActive}`);
    },
    createAuthUser: async (input) => {
      calls.push(`createAuthUser:${input.email}`);
      return { id: "created-user", email: input.email };
    },
    createProfile: async (input) => {
      calls.push(`createProfile:${input.id}`);
      return profile({ id: input.id, display_name: input.displayName, roles: input.roles, must_change_password: true });
    },
    deleteAuthUser: async (id) => {
      calls.push(`deleteAuthUser:${id}`);
    },
    deleteProfile: async (id) => {
      calls.push(`deleteProfile:${id}`);
    },
    findAuthUserByEmail: async (email) => {
      calls.push(`findAuthUserByEmail:${email}`);
      return null;
    },
    getAuthUserById: async (id) => {
      calls.push(`getAuthUserById:${id}`);
      return { id, email: "target@example.com" };
    },
    getProfile: async (id) => {
      calls.push(`getProfile:${id}`);
      return profile({ id });
    },
    listDeletionReferences: async (id) => {
      calls.push(`listDeletionReferences:${id}`);
      return [];
    },
    logAudit: async (input) => {
      calls.push(`logAudit:${input.operation}:${input.targetUserId}`);
    },
    setProfileMustChangePassword: async (id, mustChangePassword) => {
      calls.push(`setProfileMustChangePassword:${id}:${mustChangePassword}`);
      return profile({ id, must_change_password: mustChangePassword });
    },
    toAdminUser: (item, authUser) => ({
      id: item.id,
      display_name: item.display_name,
      email: authUser?.email ?? "",
      roles: item.roles,
      active: item.active,
      must_change_password: item.must_change_password,
      created_at: item.created_at,
      last_sign_in_at: authUser?.last_sign_in_at ?? null,
    }),
    updateAuthEmail: async (id, email) => {
      calls.push(`updateAuthEmail:${id}:${email}`);
      return { id, email };
    },
    updateAuthPassword: async (id) => {
      calls.push(`updateAuthPassword:${id}`);
    },
    updateAuthStatus: async (id, active) => {
      calls.push(`updateAuthStatus:${id}:${active}`);
    },
    updateProfile: async (id, changes) => {
      calls.push(`updateProfile:${id}:${Object.keys(changes).sort().join(",")}`);
      return profile({ id, ...changes });
    },
  };
  return Object.assign(defaults, overrides, { calls });
}

async function fileExists(url: URL) {
  try {
    await readFile(url, "utf8");
    return true;
  } catch {
    return false;
  }
}
