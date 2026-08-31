import "server-only";

import { randomInt } from "crypto";
import { createClient as createSupabaseClient, type User } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import type { Database, Tables } from "@/lib/database.types";
import { createRouteClient } from "@/lib/supabase/route";
import { type AdminAuditOperation, type AdminUser, allowedRoles, type AuditValues, type Role } from "@/lib/admin-users";

type Profile = Tables<"profiles">;

export type AuthorizedAdmin = { id: string; profile: Pick<Profile, "active" | "must_change_password" | "roles"> };

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
  if (!profile?.active || profile.must_change_password || !profile.roles.includes("admin")) return null;
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
  const untyped = adminUntypedClient();
  const checks = [
    ["المواد المنشأة", admin.from("items").select("id", { count: "exact", head: true }).eq("created_by", userId)],
    ["المشاركات", admin.from("item_participants").select("item_id", { count: "exact", head: true }).or(`user_id.eq.${userId},added_by.eq.${userId}`)],
    ["الشركاء", admin.from("item_partners").select("item_id", { count: "exact", head: true }).eq("added_by", userId)],
    ["الموافقات", admin.from("approvals").select("id", { count: "exact", head: true }).eq("actor_id", userId)],
    ["transitions", admin.from("transitions").select("id", { count: "exact", head: true }).eq("actor_id", userId)],
    ["التقارير", admin.from("reports").select("id", { count: "exact", head: true }).eq("author_id", userId)],
    ["سجل الإدارة", untyped.from("admin_account_audit").select("id", { count: "exact", head: true }).or(`actor_id.eq.${userId},target_user_id.eq.${userId}`)],
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
  reason?: string;
  beforeValues?: AuditValues;
  afterValues?: AuditValues;
}) {
  const row = {
    actor_id: input.actorId,
    target_user_id: input.targetUserId,
    operation: input.operation,
    reason: input.reason ? input.reason.trim() : null,
    before_values: input.beforeValues ?? {},
    after_values: input.afterValues ?? {},
  };
  const { error } = await adminUntypedClient().from("admin_account_audit").insert(row);
  if (error) throw new Error("E_AUDIT_WRITE");
}

export function safeError(caught: unknown) {
  if (caught instanceof Error) {
    if (caught.message === "E_LAST_ADMIN") return { message: "لا يمكن تنفيذ الإجراء لأنه سيقفل النظام بلا أدمن نشط.", code: "E_LAST_ADMIN", status: 409 };
    if (caught.message === "E_DUPLICATE_EMAIL") return { message: "البريد مستخدم لحساب آخر.", code: "E_DUPLICATE_EMAIL", status: 409 };
    if (caught.message === "E_HAS_HISTORY") return { message: "لا يمكن حذف حساب له سجل تاريخي. عطّله بدلًا من ذلك.", code: "E_HAS_HISTORY", status: 409 };
    if (caught.message === "E_ORIGIN") return { message: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN", status: 403 };
  }
  return { message: "تعذر تنفيذ الإجراء الآن.", code: "E_ADMIN_USERS", status: 400 };
}
