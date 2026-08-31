import { NextRequest, NextResponse } from "next/server";
import {
  adminClient,
  assertNotLastActiveAdmin,
  authorizeAdmin,
  findAuthUserByEmail,
  generatePassword,
  getDeletionReferences,
  getProfile,
  isSameOriginMutation,
  isValidEmail,
  listAdminUsers,
  logAdminAudit,
  normalizeDisplayName,
  normalizeEmail,
  safeError,
  toAdminUser,
  validatePassword,
  validRoles,
} from "@/lib/admin-users-server";
import type { AuditValues, Role } from "@/lib/admin-users";
import type { Database, Tables } from "@/lib/database.types";

type Profile = Tables<"profiles">;
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

const disabledBanDuration = "876000h";

function responseWithCookies(body: object, status: number, source: NextResponse) {
  const response = NextResponse.json(body, { status });
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

function jsonError(message: string, code: string, status: number, source: NextResponse) {
  return responseWithCookies({ error: message, code }, status, source);
}

async function requireAuthorized(request: NextRequest, sessionResponse: NextResponse) {
  const admin = await authorizeAdmin(request, sessionResponse);
  if (!admin) return { admin: null, error: jsonError("غير مصرح لك.", "E_FORBIDDEN", 403, sessionResponse) };
  return { admin, error: null };
}

function mutationAllowed(request: NextRequest, sessionResponse: NextResponse) {
  if (isSameOriginMutation(request)) return null;
  return jsonError("رُفض الطلب لأن مصدره غير مطابق للتطبيق.", "E_ORIGIN", 403, sessionResponse);
}

export async function GET(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  const { error } = await requireAuthorized(request, sessionResponse);
  if (error) return error;
  try {
    return responseWithCookies({ users: await listAdminUsers() }, 200, sessionResponse);
  } catch (caught) {
    const safe = safeError(caught);
    return jsonError(safe.message, safe.code, safe.status, sessionResponse);
  }
}

export async function POST(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  const originError = mutationAllowed(request, sessionResponse);
  if (originError) return originError;
  const { admin: actor, error } = await requireAuthorized(request, sessionResponse);
  if (error || !actor) return error;
  try {
    const body: unknown = await request.json();
    if (!isCreateBody(body)) return jsonError("البيانات المدخلة غير صحيحة.", "E_INVALID_INPUT", 400, sessionResponse);
    const email = normalizeEmail(body.email);
    const displayName = normalizeDisplayName(body.displayName);
    const password = body.passwordMode === "generated" ? generatePassword() : body.temporaryPassword.trim();
    if (!isValidEmail(email) || displayName.length === 0 || !validatePassword(password)) {
      return jsonError("البيانات المدخلة غير صحيحة.", "E_INVALID_INPUT", 400, sessionResponse);
    }
    if (await findAuthUserByEmail(email)) throw new Error("E_DUPLICATE_EMAIL");

    const service = adminClient();
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (createError || !created.user) return jsonError("تعذر إنشاء المستخدم.", "E_AUTH_CREATE", 400, sessionResponse);

    const { data: profile, error: profileError } = await service
      .from("profiles")
      .insert({ id: created.user.id, display_name: displayName, roles: body.roles, must_change_password: true, active: true })
      .select()
      .single();
    if (profileError || !profile) {
      await service.auth.admin.deleteUser(created.user.id);
      return jsonError("تعذر إنشاء ملف المستخدم.", "E_PROFILE_CREATE", 400, sessionResponse);
    }

    try {
      await logAdminAudit({
        actorId: actor.id,
        targetUserId: created.user.id,
        operation: "create_user",
        afterValues: { email, display_name: displayName, roles: body.roles, active: true, must_change_required: true },
      });
    } catch {
      await service.auth.admin.deleteUser(created.user.id);
      return jsonError("تعذر تسجيل العملية.", "E_AUDIT_WRITE", 400, sessionResponse);
    }

    return responseWithCookies({ user: toAdminUser(profile, created.user), temporaryPassword: password }, 200, sessionResponse);
  } catch (caught) {
    const safe = safeError(caught);
    return jsonError(safe.message, safe.code, safe.status, sessionResponse);
  }
}

export async function PATCH(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  const originError = mutationAllowed(request, sessionResponse);
  if (originError) return originError;
  const { admin: actor, error } = await requireAuthorized(request, sessionResponse);
  if (error || !actor) return error;
  try {
    const body: unknown = await request.json();
    if (isResetPasswordBody(body)) return resetPassword(actor.id, body, sessionResponse);
    if (!isUpdateBody(body)) return jsonError("البيانات المدخلة غير صحيحة.", "E_INVALID_INPUT", 400, sessionResponse);
    return updateUser(actor.id, body, sessionResponse);
  } catch (caught) {
    const safe = safeError(caught);
    return jsonError(safe.message, safe.code, safe.status, sessionResponse);
  }
}

export async function DELETE(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  const originError = mutationAllowed(request, sessionResponse);
  if (originError) return originError;
  const { admin: actor, error } = await requireAuthorized(request, sessionResponse);
  if (error || !actor) return error;
  try {
    const body: unknown = await request.json();
    if (!isDeleteBody(body)) return jsonError("سبب الحذف مطلوب.", "E_INVALID_INPUT", 400, sessionResponse);
    if (body.id === actor.id) return jsonError("لا يمكن للأدمن حذف حسابه.", "E_SELF_DELETE", 409, sessionResponse);

    const target = await getProfile(body.id);
    await assertNotLastActiveAdmin(target, [], false);
    const references = await getDeletionReferences(body.id);
    if (references.length > 0) {
      return responseWithCookies({ error: "لا يمكن حذف حساب له سجل تاريخي. عطّله بدلًا من ذلك.", code: "E_HAS_HISTORY", references }, 409, sessionResponse);
    }

    const service = adminClient();
    const { error: deleteError } = await service.auth.admin.deleteUser(body.id);
    if (deleteError) return jsonError("تعذر حذف المستخدم.", "E_AUTH_DELETE", 400, sessionResponse);
    await logAdminAudit({
      actorId: actor.id,
      targetUserId: body.id,
      operation: "delete_user",
      reason: body.reason,
      beforeValues: safeProfileValues(target),
    });
    return responseWithCookies({ deleted: true, id: body.id }, 200, sessionResponse);
  } catch (caught) {
    const safe = safeError(caught);
    return jsonError(safe.message, safe.code, safe.status, sessionResponse);
  }
}

async function updateUser(actorId: string, body: UpdateBody, sessionResponse: NextResponse) {
  const service = adminClient();
  const target = await getProfile(body.id);
  if (body.id === actorId && body.roles && !body.roles.includes("admin")) {
    return jsonError("لا يمكن للأدمن خفض صلاحياته بنفسه.", "E_SELF_DEMOTE", 409, sessionResponse);
  }
  if (body.id === actorId && body.active === false) {
    return jsonError("لا يمكن للأدمن تعطيل حسابه.", "E_SELF_DISABLE", 409, sessionResponse);
  }

  const nextRoles = body.roles ?? target.roles;
  const nextActive = typeof body.active === "boolean" ? body.active : target.active;
  await assertNotLastActiveAdmin(target, nextRoles, nextActive);

  let nextEmail: string | null = null;
  if (body.email) {
    nextEmail = normalizeEmail(body.email);
    if (!isValidEmail(nextEmail)) return jsonError("البريد غير صالح.", "E_INVALID_INPUT", 400, sessionResponse);
    const duplicate = await findAuthUserByEmail(nextEmail);
    if (duplicate && duplicate.id !== body.id) throw new Error("E_DUPLICATE_EMAIL");
  }

  const profileChanges: ProfileUpdate = {};
  const audits: Array<{ operation: "update_display_name" | "update_email" | "update_roles" | "activate_user" | "deactivate_user"; beforeValues: AuditValues; afterValues: AuditValues; reason?: string }> = [];

  if (typeof body.displayName === "string") {
    const displayName = normalizeDisplayName(body.displayName);
    if (displayName.length === 0) return jsonError("الاسم غير صالح.", "E_INVALID_INPUT", 400, sessionResponse);
    if (displayName !== target.display_name) {
      profileChanges.display_name = displayName;
      audits.push({ operation: "update_display_name", beforeValues: { display_name: target.display_name }, afterValues: { display_name: displayName } });
    }
  }
  if (body.roles && JSON.stringify(body.roles) !== JSON.stringify(target.roles)) {
    profileChanges.roles = body.roles;
    audits.push({ operation: "update_roles", beforeValues: { roles: target.roles }, afterValues: { roles: body.roles } });
  }
  if (typeof body.active === "boolean" && body.active !== target.active) {
    audits.push({
      operation: body.active ? "activate_user" : "deactivate_user",
      beforeValues: { active: target.active },
      afterValues: { active: body.active },
      reason: body.reason,
    });
  }

  if (typeof body.active === "boolean" && body.active !== target.active) {
    const ban = await service.auth.admin.updateUserById(body.id, { ban_duration: body.active ? "none" : disabledBanDuration });
    if (ban.error) return jsonError("تعذر تحديث حالة Auth.", "E_AUTH_STATUS", 400, sessionResponse);
    profileChanges.active = body.active;
  }

  if (Object.keys(profileChanges).length > 0) {
    const { error } = await service.from("profiles").update(profileChanges).eq("id", body.id);
    if (error) {
      if (typeof body.active === "boolean" && body.active !== target.active) {
        await service.auth.admin.updateUserById(body.id, { ban_duration: target.active ? "none" : disabledBanDuration });
      }
      return jsonError("تعذر حفظ ملف المستخدم.", "E_PROFILE_UPDATE", 400, sessionResponse);
    }
  }

  if (nextEmail) {
    const { data: authUser, error } = await service.auth.admin.updateUserById(body.id, { email: nextEmail, email_confirm: true });
    if (error || !authUser.user) return jsonError("تعذر تغيير البريد.", "E_AUTH_EMAIL", 400, sessionResponse);
    audits.push({ operation: "update_email", beforeValues: { email: body.previousEmail ?? "" }, afterValues: { email: nextEmail } });
  }

  for (const audit of audits) {
    await logAdminAudit({ actorId, targetUserId: body.id, ...audit });
  }

  const { data: authUser } = await service.auth.admin.getUserById(body.id);
  const updated = await getProfile(body.id);
  return responseWithCookies({ user: toAdminUser(updated, authUser.user ?? undefined) }, 200, sessionResponse);
}

async function resetPassword(actorId: string, body: ResetPasswordBody, sessionResponse: NextResponse) {
  const target = await getProfile(body.id);
  const password = body.passwordMode === "generated" ? generatePassword() : body.temporaryPassword.trim();
  if (!validatePassword(password)) return jsonError("كلمة المرور المؤقتة غير قوية بما يكفي.", "E_WEAK_PASSWORD", 400, sessionResponse);
  const service = adminClient();
  const { error: authError } = await service.auth.admin.updateUserById(body.id, { password });
  if (authError) return jsonError("تعذر إعادة ضبط كلمة المرور.", "E_AUTH_PASSWORD", 400, sessionResponse);
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", body.id)
    .select()
    .single();
  if (profileError || !profile) return jsonError("تم تغيير كلمة المرور، لكن تعذر فرض تغييرها.", "E_PROFILE_PASSWORD_FLAG", 400, sessionResponse);
  await logAdminAudit({
    actorId,
    targetUserId: body.id,
    operation: "reset_password",
    beforeValues: { must_change_required: target.must_change_password },
    afterValues: { must_change_required: true },
  });
  const { data: authUser } = await service.auth.admin.getUserById(body.id);
  return responseWithCookies({ user: toAdminUser(profile, authUser.user ?? undefined), temporaryPassword: password }, 200, sessionResponse);
}

function safeProfileValues(profile: Profile): AuditValues {
  return { display_name: profile.display_name, roles: profile.roles, active: profile.active, must_change_required: profile.must_change_password };
}

type CreateBody = { email: string; displayName: string; roles: Role[]; passwordMode: "manual" | "generated"; temporaryPassword: string };
function isCreateBody(value: unknown): value is CreateBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.email === "string"
    && typeof body.displayName === "string"
    && validRoles(body.roles)
    && (body.passwordMode === "manual" || body.passwordMode === "generated")
    && (body.passwordMode === "generated" || typeof body.temporaryPassword === "string");
}

type UpdateBody = { id: string; displayName?: string; email?: string; previousEmail?: string; roles?: Role[]; active?: boolean; reason?: string };
function isUpdateBody(value: unknown): value is UpdateBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.id === "string"
    && body.id.length > 0
    && (typeof body.displayName === "string" || typeof body.email === "string" || validRoles(body.roles) || typeof body.active === "boolean")
    && (body.roles === undefined || validRoles(body.roles))
    && (body.reason === undefined || typeof body.reason === "string")
    && (body.previousEmail === undefined || typeof body.previousEmail === "string");
}

type ResetPasswordBody = { action: "resetPassword"; id: string; passwordMode: "manual" | "generated"; temporaryPassword: string };
function isResetPasswordBody(value: unknown): value is ResetPasswordBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return body.action === "resetPassword"
    && typeof body.id === "string"
    && body.id.length > 0
    && (body.passwordMode === "manual" || body.passwordMode === "generated")
    && (body.passwordMode === "generated" || typeof body.temporaryPassword === "string");
}

type DeleteBody = { id: string; reason: string };
function isDeleteBody(value: unknown): value is DeleteBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.id === "string" && body.id.length > 0 && typeof body.reason === "string" && body.reason.trim().length >= 4;
}
