import "server-only";

import { randomInt } from "crypto";
import { createClient as createSupabaseClient, type User } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import type { Database, Tables } from "@/lib/database.types";
import { toAdminAuditRows, type AdminAuditInput } from "@/lib/admin-audit-rows";
import { createRouteClient } from "@/lib/supabase/route";
import { isAuthorizedAdminProfile, type AdminActionErrorCode, type AdminUserStore } from "@/lib/admin-users-core";
import { type AdminAuditOperation, type AdminAuditPhase, type AdminUser, allowedRoles, type AuditValues, type Role } from "@/lib/admin-users";

type Profile = Tables<"profiles">;

export type AuthorizedAdmin = { id: string; profile: Pick<Profile, "active" | "must_change_password" | "roles"> };

const disabledBanDuration = "876000h";
const passwordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function adminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
  );
}

function adminUntypedClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
  );
}

export async function authorizeAdmin(request: NextRequest, response: NextResponse): Promise<AuthorizedAdmin | null> {
  const supabase = createRouteClient(request, response);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("roles, active, must_change_password").eq("id", user.id).single();
  if (!profile || !isAuthorizedAdminProfile(profile)) return null;
  return { id: user.id, profile };
}

export function isSameOriginMutation(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin === request.nextUrl.origin;
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return emailPattern.test(email);
}

export function normalizeDisplayName(displayName: string) {
  return displayName.trim().replace(/\s+/g, " ");
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && allowedRoles.includes(value as Role);
}

export function validRoles(value: unknown): value is Role[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isRole)) return false;
  return new Set(value).size === value.length;
}

export function generatePassword() {
  const required = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*"].map((group) => group[randomInt(group.length)]);
  const rest = Array.from({ length: 14 }, () => passwordAlphabet[randomInt(passwordAlphabet.length)]);
  return [...required, ...rest].sort(() => randomInt(3) - 1).join("");
}

export function validatePassword(password: string) {
  return password.length >= 12
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const admin = adminClient();
  const [{ data: profiles, error: profilesError }, authResult] = await Promise.all([
    admin.from("profiles").select("*").order("display_name", { ascending: true }),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (profilesError) throw new Error("E_PROFILE_LIST");
  if (authResult.error) throw new Error("E_AUTH_LIST");
  const authById = new Map(authResult.data.users.map((user) => [user.id, user]));
  return (profiles ?? []).map((profile) => toAdminUser(profile, authById.get(profile.id)));
}

export function toAdminUser(profile: Profile, user?: User): AdminUser {
  return {
    id: profile.id,
    display_name: profile.display_name,
    email: user?.email ?? "",
    roles: profile.roles,
    active: profile.active,
    must_change_password: profile.must_change_password,
    created_at: profile.created_at,
    last_sign_in_at: user?.last_sign_in_at ?? null,
  };
}

export async function findAuthUserByEmail(email: string) {
  const { data, error } = await adminClient().auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error("E_AUTH_LIST");
  return data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

export async function getProfile(id: string) {
  const { data, error } = await adminClient().from("profiles").select("*").eq("id", id).single();
  if (error || !data) throw new Error("E_PROFILE_NOT_FOUND");
  return data;
}

export async function assertNotLastActiveAdmin(target: Profile, nextRoles: Role[], nextActive: boolean) {
  if (!target.active || !target.roles.includes("admin") || (nextActive && nextRoles.includes("admin"))) return;
  const { count, error } = await adminClient()
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("active", true)
    .contains("roles", ["admin"]);
  if (error) throw new Error("E_ADMIN_COUNT");
  if ((count ?? 0) <= 1) throw new Error("E_LAST_ADMIN");
}

export async function getDeletionReferences(userId: string) {
  const admin = adminClient();
  const checks = [
    ["المواد المنشأة", admin.from("items").select("id", { count: "exact", head: true }).eq("created_by", userId)],
    ["المشاركات", admin.from("item_participants").select("item_id", { count: "exact", head: true }).or(`user_id.eq.${userId},added_by.eq.${userId}`)],
    ["الشركاء", admin.from("item_partners").select("item_id", { count: "exact", head: true }).eq("added_by", userId)],
    ["الموافقات", admin.from("approvals").select("id", { count: "exact", head: true }).eq("actor_id", userId)],
    ["transitions", admin.from("transitions").select("id", { count: "exact", head: true }).eq("actor_id", userId)],
    ["التقارير", admin.from("reports").select("id", { count: "exact", head: true }).eq("author_id", userId)],
    ["مسودات الذكاء الاصطناعي", admin.from("ai_drafts").select("id", { count: "exact", head: true }).or(`created_by.eq.${userId},approved_by.eq.${userId}`)],
    ["مطابقة روابط إنستغرام", admin.from("ig_link_candidates").select("id", { count: "exact", head: true }).eq("decided_by", userId)],
    ["الشركاء المنشأون", admin.from("partners").select("id", { count: "exact", head: true }).eq("created_by", userId)],
  ] as const;
  const results = await Promise.all(checks.map(async ([label, query]) => {
    const { count, error } = await query;
    if (error) throw new Error("E_REFERENCE_CHECK");
    return { label, count: count ?? 0 };
  }));
  return results.filter((result) => result.count > 0);
}

export async function logAdminAudit(input: {
  actorId: string;
  targetUserId: string;
  operation: AdminAuditOperation;
  actionId?: string;
  actionPhase?: AdminAuditPhase;
  diagnosticCode?: AdminActionErrorCode;
  reason?: string;
  beforeValues?: AuditValues;
  afterValues?: AuditValues;
}) {
  await logAdminAuditBatch([input]);
}

export async function logAdminAuditBatch(inputs: AdminAuditInput[]) {
  if (inputs.length === 0) return;
  const rows = toAdminAuditRows(inputs);
  const { error } = await adminUntypedClient().from("admin_account_audit").insert(rows);
  if (error) throw new Error("E_AUDIT_WRITE");
}

export function adminUserStore(): AdminUserStore {
  const service = adminClient();
  return {
    assertNotLastActiveAdmin,
    async createAuthUser(input) {
      const { data, error } = await service.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: { display_name: input.displayName },
      });
      if (error || !data.user) throw new Error("E_AUTH_CREATE");
      return data.user;
    },
    async createProfile(input) {
      const { data, error } = await service
        .from("profiles")
        .insert({ id: input.id, display_name: input.displayName, roles: input.roles, must_change_password: true, active: true })
        .select()
        .single();
      if (error || !data) throw new Error("E_PROFILE_CREATE");
      return data;
    },
    async deleteAuthUser(id) {
      const { error } = await service.auth.admin.deleteUser(id);
      if (error) throw new Error("E_AUTH_DELETE");
    },
    async deleteProfile(id) {
      const { error } = await service.from("profiles").delete().eq("id", id);
      if (error) throw new Error("E_PROFILE_UPDATE");
    },
    findAuthUserByEmail,
    async getAuthUserById(id) {
      const { data, error } = await service.auth.admin.getUserById(id);
      if (error) return null;
      return data.user ?? null;
    },
    getProfile,
    listDeletionReferences: getDeletionReferences,
    logAudit: logAdminAudit,
    logAuditBatch: logAdminAuditBatch,
    async setProfileMustChangePassword(id, mustChangePassword) {
      const { data, error } = await service.from("profiles").update({ must_change_password: mustChangePassword }).eq("id", id).select().single();
      if (error || !data) throw new Error("E_PROFILE_PASSWORD_FLAG");
      return data;
    },
    toAdminUser,
    async updateAuthEmail(id, email) {
      const { data, error } = await service.auth.admin.updateUserById(id, { email, email_confirm: true });
      if (error || !data.user) throw new Error("E_AUTH_EMAIL");
      return data.user;
    },
    async updateAuthPassword(id, password) {
      const { error } = await service.auth.admin.updateUserById(id, { password });
      if (error) throw new Error("E_AUTH_PASSWORD");
    },
    async updateAuthStatus(id, active) {
      const { error } = await service.auth.admin.updateUserById(id, { ban_duration: active ? "none" : disabledBanDuration });
      if (error) throw new Error("E_AUTH_STATUS");
    },
    async updateProfile(id, changes) {
      const { data, error } = await service.from("profiles").update(changes).eq("id", id).select().single();
      if (error || !data) throw new Error("E_PROFILE_UPDATE");
      return data;
    },
  };
}

export function safeError(caught: unknown) {
  if (caught instanceof Error) {
    if (caught.message === "E_LAST_ADMIN") return { message: "لا يمكن تنفيذ الإجراء لأنه سيقفل النظام بلا أدمن نشط.", code: "E_LAST_ADMIN", status: 409 };
    if (caught.message === "E_DUPLICATE_EMAIL") return { message: "البريد مستخدم لحساب آخر.", code: "E_DUPLICATE_EMAIL", status: 409 };
    if (caught.message === "E_HAS_HISTORY") return { message: "لا يمكن حذف حساب له سجل تاريخي. عطّله بدلًا من ذلك.", code: "E_HAS_HISTORY", status: 409 };
    if (caught.message === "E_ORIGIN") return { message: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN", status: 403 };
    if (caught.message === "E_SELF_DELETE") return { message: "لا يمكن للأدمن حذف حسابه.", code: "E_SELF_DELETE", status: 409 };
    if (caught.message === "E_SELF_DEMOTE") return { message: "لا يمكن للأدمن خفض صلاحياته بنفسه.", code: "E_SELF_DEMOTE", status: 409 };
    if (caught.message === "E_SELF_DISABLE") return { message: "لا يمكن للأدمن تعطيل حسابه.", code: "E_SELF_DISABLE", status: 409 };
    if (caught.message === "E_AUTH_CREATE") return { message: "تعذر إنشاء المستخدم.", code: "E_AUTH_CREATE", status: 400 };
    if (caught.message === "E_PROFILE_CREATE") return { message: "تعذر إنشاء ملف المستخدم.", code: "E_PROFILE_CREATE", status: 400 };
    if (caught.message === "E_AUDIT_WRITE") return { message: "تعذر تسجيل العملية.", code: "E_AUDIT_WRITE", status: 400 };
    if (caught.message === "E_AUTH_DELETE") return { message: "تعذر حذف المستخدم.", code: "E_AUTH_DELETE", status: 400 };
    if (caught.message === "E_AUTH_EMAIL") return { message: "تعذر تغيير البريد.", code: "E_AUTH_EMAIL", status: 400 };
    if (caught.message === "E_AUTH_PASSWORD") return { message: "تعذر إعادة ضبط كلمة المرور.", code: "E_AUTH_PASSWORD", status: 400 };
    if (caught.message === "E_AUTH_STATUS") return { message: "تعذر تحديث حالة Auth.", code: "E_AUTH_STATUS", status: 400 };
    if (caught.message === "E_PROFILE_UPDATE") return { message: "تعذر حفظ ملف المستخدم.", code: "E_PROFILE_UPDATE", status: 400 };
    if (caught.message === "E_PROFILE_PASSWORD_FLAG") return { message: "تعذر فرض تغيير كلمة المرور.", code: "E_PROFILE_PASSWORD_FLAG", status: 400 };
  }
  return { message: "تعذر تنفيذ الإجراء الآن.", code: "E_ADMIN_USERS", status: 400 };
}
