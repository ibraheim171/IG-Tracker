import type { AdminAuditOperation, AdminUser, AuditValues, Role } from "./admin-users";

export type AdminProfile = {
  id: string;
  display_name: string;
  roles: Role[];
  active: boolean;
  must_change_password: boolean;
  created_at: string;
};

export type AdminAuthUser = {
  id: string;
  email?: string;
  last_sign_in_at?: string | null;
};

export type DeletionReference = { label: string; count: number };

export type AdminActionErrorCode =
  | "E_AUTH_CREATE"
  | "E_AUTH_DELETE"
  | "E_AUTH_EMAIL"
  | "E_AUTH_LIST"
  | "E_AUTH_PASSWORD"
  | "E_AUTH_STATUS"
  | "E_AUDIT_WRITE"
  | "E_DUPLICATE_EMAIL"
  | "E_HAS_HISTORY"
  | "E_LAST_ADMIN"
  | "E_PROFILE_CREATE"
  | "E_PROFILE_NOT_FOUND"
  | "E_PROFILE_PASSWORD_FLAG"
  | "E_PROFILE_UPDATE"
  | "E_SELF_DELETE"
  | "E_SELF_DEMOTE"
  | "E_SELF_DISABLE"
  | "E_WEAK_PASSWORD";

export class AdminActionError extends Error {
  readonly code: AdminActionErrorCode;
  readonly details: { references?: DeletionReference[] };

  constructor(
    code: AdminActionErrorCode,
    details: { references?: DeletionReference[] } = {},
  ) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

export type AdminUserStore = {
  assertNotLastActiveAdmin(target: AdminProfile, nextRoles: Role[], nextActive: boolean): Promise<void>;
  createAuthUser(input: { email: string; password: string; displayName: string }): Promise<AdminAuthUser>;
  createProfile(input: { id: string; displayName: string; roles: Role[] }): Promise<AdminProfile>;
  deleteAuthUser(id: string): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  findAuthUserByEmail(email: string): Promise<AdminAuthUser | null>;
  getAuthUserById(id: string): Promise<AdminAuthUser | null>;
  getProfile(id: string): Promise<AdminProfile>;
  listDeletionReferences(userId: string): Promise<DeletionReference[]>;
  logAudit(input: {
    actorId: string;
    targetUserId: string;
    operation: AdminAuditOperation;
    reason?: string;
    beforeValues?: AuditValues;
    afterValues?: AuditValues;
  }): Promise<void>;
  setProfileMustChangePassword(id: string, mustChangePassword: boolean): Promise<AdminProfile>;
  toAdminUser(profile: AdminProfile, authUser?: AdminAuthUser | null): AdminUser;
  updateAuthEmail(id: string, email: string): Promise<AdminAuthUser>;
  updateAuthPassword(id: string, password: string): Promise<void>;
  updateAuthStatus(id: string, active: boolean): Promise<void>;
  updateProfile(id: string, changes: Partial<Pick<AdminProfile, "active" | "display_name" | "roles">>): Promise<AdminProfile>;
};

export function isAuthorizedAdminProfile(profile: Pick<AdminProfile, "active" | "must_change_password" | "roles"> | null | undefined) {
  return Boolean(profile?.active && !profile.must_change_password && profile.roles.includes("admin"));
}

export function isProtectedProfileAllowed(profile: Pick<AdminProfile, "active"> | null | undefined) {
  return Boolean(profile?.active);
}

export function sanitizeAuditValues(values: AuditValues): AuditValues {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => !/(password|token|secret|key)/i.test(key))
      .map(([key, value]) => [key, sanitizeAuditJson(value)]),
  ) as AuditValues;
}

function sanitizeAuditJson(value: AuditValues[string]): AuditValues[string] {
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditJson(item));
  if (value && typeof value === "object") return sanitizeAuditValues(value as AuditValues);
  return value;
}

export async function createAdminAccount(
  store: AdminUserStore,
  actorId: string,
  input: { email: string; displayName: string; roles: Role[]; password: string },
) {
  if (await store.findAuthUserByEmail(input.email)) throw new AdminActionError("E_DUPLICATE_EMAIL");
  let authUser: AdminAuthUser | null = null;
  let profile: AdminProfile | null = null;
  try {
    authUser = await store.createAuthUser(input);
    profile = await store.createProfile({ id: authUser.id, displayName: input.displayName, roles: input.roles });
    await store.logAudit({
      actorId,
      targetUserId: authUser.id,
      operation: "create_user",
      afterValues: sanitizeAuditValues({
        email: input.email,
        display_name: input.displayName,
        roles: input.roles,
        active: true,
        must_change_required: true,
      }),
    });
    return { user: store.toAdminUser(profile, authUser), temporaryPassword: input.password };
  } catch (caught) {
    if (profile) await settle(() => store.deleteProfile(profile!.id));
    if (authUser) await settle(() => store.deleteAuthUser(authUser!.id));
    if (caught instanceof AdminActionError) throw caught;
    throw new AdminActionError(profile ? "E_AUDIT_WRITE" : authUser ? "E_PROFILE_CREATE" : "E_AUTH_CREATE");
  }
}

export async function deleteAdminAccount(store: AdminUserStore, actorId: string, input: { id: string; reason: string }) {
  if (input.id === actorId) throw new AdminActionError("E_SELF_DELETE");
  const target = await store.getProfile(input.id);
  await store.assertNotLastActiveAdmin(target, [], false);
  const references = await store.listDeletionReferences(input.id);
  if (references.length > 0) throw new AdminActionError("E_HAS_HISTORY", { references });
  await store.deleteAuthUser(input.id);
  await store.logAudit({
    actorId,
    targetUserId: input.id,
    operation: "delete_user",
    reason: input.reason,
    beforeValues: sanitizeAuditValues(safeProfileValues(target)),
  });
  return { deleted: true, id: input.id };
}

export async function resetAdminPassword(
  store: AdminUserStore,
  actorId: string,
  input: { id: string; password: string; previousMustChangePassword: boolean },
) {
  await store.setProfileMustChangePassword(input.id, true);
  try {
    await store.updateAuthPassword(input.id, input.password);
  } catch (caught) {
    await settle(() => store.setProfileMustChangePassword(input.id, input.previousMustChangePassword));
    if (caught instanceof AdminActionError) throw caught;
    throw new AdminActionError("E_AUTH_PASSWORD");
  }
  await store.logAudit({
    actorId,
    targetUserId: input.id,
    operation: "reset_password",
    beforeValues: { must_change_required: input.previousMustChangePassword },
    afterValues: { must_change_required: true },
  });
  const [profile, authUser] = await Promise.all([store.getProfile(input.id), store.getAuthUserById(input.id)]);
  return { user: store.toAdminUser(profile, authUser), temporaryPassword: input.password };
}

export async function updateAdminAccount(
  store: AdminUserStore,
  actorId: string,
  input: {
    id: string;
    displayName?: string;
    email?: string;
    previousEmail?: string;
    roles?: Role[];
    active?: boolean;
    reason?: string;
  },
) {
  const target = await store.getProfile(input.id);
  if (input.id === actorId && input.roles && !input.roles.includes("admin")) throw new AdminActionError("E_SELF_DEMOTE");
  if (input.id === actorId && input.active === false) throw new AdminActionError("E_SELF_DISABLE");

  const nextRoles = input.roles ?? target.roles;
  const nextActive = typeof input.active === "boolean" ? input.active : target.active;
  await store.assertNotLastActiveAdmin(target, nextRoles, nextActive);

  if (input.email) {
    const duplicate = await store.findAuthUserByEmail(input.email);
    if (duplicate && duplicate.id !== input.id) throw new AdminActionError("E_DUPLICATE_EMAIL");
    await store.updateAuthEmail(input.id, input.email);
  }

  const profileChanges: Partial<Pick<AdminProfile, "active" | "display_name" | "roles">> = {};
  const audits: Array<{ operation: AdminAuditOperation; beforeValues: AuditValues; afterValues: AuditValues; reason?: string }> = [];

  if (input.displayName && input.displayName !== target.display_name) {
    profileChanges.display_name = input.displayName;
    audits.push({ operation: "update_display_name", beforeValues: { display_name: target.display_name }, afterValues: { display_name: input.displayName } });
  }
  if (input.roles && JSON.stringify(input.roles) !== JSON.stringify(target.roles)) {
    profileChanges.roles = input.roles;
    audits.push({ operation: "update_roles", beforeValues: { roles: target.roles }, afterValues: { roles: input.roles } });
  }
  if (typeof input.active === "boolean" && input.active !== target.active) {
    await store.updateAuthStatus(input.id, input.active);
    profileChanges.active = input.active;
    audits.push({
      operation: input.active ? "activate_user" : "deactivate_user",
      beforeValues: { active: target.active },
      afterValues: { active: input.active },
      reason: input.reason,
    });
  }

  let profile = target;
  try {
    if (Object.keys(profileChanges).length > 0) profile = await store.updateProfile(input.id, profileChanges);
  } catch (caught) {
    if (typeof input.active === "boolean" && input.active !== target.active) {
      await settle(() => store.updateAuthStatus(input.id, target.active));
    }
    if (caught instanceof AdminActionError) throw caught;
    throw new AdminActionError("E_PROFILE_UPDATE");
  }

  if (input.email) audits.push({ operation: "update_email", beforeValues: { email: input.previousEmail ?? "" }, afterValues: { email: input.email } });
  for (const audit of audits) await store.logAudit({ actorId, targetUserId: input.id, ...audit });

  const authUser = await store.getAuthUserById(input.id);
  return { user: store.toAdminUser(profile, authUser) };
}

function safeProfileValues(profile: AdminProfile): AuditValues {
  return { display_name: profile.display_name, roles: profile.roles, active: profile.active, must_change_required: profile.must_change_password };
}

async function settle(action: () => Promise<unknown>) {
  try {
    await action();
  } catch {
    // Cleanup is best effort. The caller receives the original failure code.
  }
}
