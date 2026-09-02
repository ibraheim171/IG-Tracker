import { NextRequest, NextResponse } from "next/server";
import {
  AdminActionError,
  createAdminAccount,
  deleteAdminAccount,
  resetAdminPassword,
  updateAdminAccount,
} from "@/lib/admin-users-core";
import {
  adminUserStore,
  authorizeAdmin,
  generatePassword,
  isSameOriginMutation,
  isValidEmail,
  listAdminUsers,
  normalizeDisplayName,
  normalizeEmail,
  safeError,
  validatePassword,
  validRoles,
} from "@/lib/admin-users-server";
import type { Role } from "@/lib/admin-users";

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
    const result = await createAdminAccount(adminUserStore(), actor.id, { email, displayName, roles: body.roles, password });
    return responseWithCookies(result, 200, sessionResponse);
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

    const result = await deleteAdminAccount(adminUserStore(), actor.id, body);
    return responseWithCookies(result, 200, sessionResponse);
  } catch (caught) {
    if (caught instanceof AdminActionError && caught.code === "E_HAS_HISTORY") {
      return responseWithCookies({ error: "لا يمكن حذف حساب له سجل تاريخي. عطّله بدلًا من ذلك.", code: caught.code, references: caught.details.references ?? [] }, 409, sessionResponse);
    }
    const safe = safeError(caught);
    return jsonError(safe.message, safe.code, safe.status, sessionResponse);
  }
}

async function updateUser(actorId: string, body: UpdateBody, sessionResponse: NextResponse) {
  let nextEmail: string | null = null;
  if (body.email) {
    nextEmail = normalizeEmail(body.email);
    if (!isValidEmail(nextEmail)) return jsonError("البريد غير صالح.", "E_INVALID_INPUT", 400, sessionResponse);
  }
  let displayName: string | undefined;
  if (typeof body.displayName === "string") {
    displayName = normalizeDisplayName(body.displayName);
    if (displayName.length === 0) return jsonError("الاسم غير صالح.", "E_INVALID_INPUT", 400, sessionResponse);
  }
  const result = await updateAdminAccount(adminUserStore(), actorId, { ...body, displayName, email: nextEmail ?? undefined });
  return responseWithCookies(result, 200, sessionResponse);
}

async function resetPassword(actorId: string, body: ResetPasswordBody, sessionResponse: NextResponse) {
  const password = body.passwordMode === "generated" ? generatePassword() : body.temporaryPassword.trim();
  if (!validatePassword(password)) return jsonError("كلمة المرور المؤقتة غير قوية بما يكفي.", "E_WEAK_PASSWORD", 400, sessionResponse);
  const store = adminUserStore();
  const result = await resetAdminPassword(store, actorId, { id: body.id, password });
  return responseWithCookies(result, 200, sessionResponse);
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
