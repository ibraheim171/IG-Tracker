import { randomBytes } from "crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { createRouteClient } from "@/lib/supabase/route";

type Role = Database["public"]["Enums"]["role_name"];
const allowedRoles: Role[] = ["writer", "reviewer", "producer", "admin"];

function isRole(value: unknown): value is Role { return typeof value === "string" && allowedRoles.includes(value as Role); }
function validRoles(value: unknown): value is Role[] { return Array.isArray(value) && value.length > 0 && value.every(isRole); }
function generatePassword() { return randomBytes(9).toString("base64url").slice(0, 12); }

async function authorize(request: NextRequest, response: NextResponse) {
  const supabase = createRouteClient(request, response);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("roles, active").eq("id", user.id).single();
  return profile?.active && profile.roles.includes("admin") ? user : null;
}

function responseWithCookies(body: object, status: number, source: NextResponse) {
  const response = NextResponse.json(body, { status });
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

function adminClient() {
  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  const caller = await authorize(request, sessionResponse);
  if (!caller) return responseWithCookies({ error: "غير مصرح لك." }, 403, sessionResponse);
  const body: unknown = await request.json();
  if (!isCreateBody(body)) return responseWithCookies({ error: "البيانات المدخلة غير صحيحة." }, 400, sessionResponse);
  const password = generatePassword(); const admin = adminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email: body.email, password, email_confirm: true });
  if (createError || !created.user) return responseWithCookies({ error: "تعذر إنشاء المستخدم." }, 400, sessionResponse);
  const { data: profile, error: profileError } = await admin.from("profiles").insert({ id: created.user.id, display_name: body.displayName, roles: body.roles, must_change_password: true }).select().single();
  if (profileError || !profile) { await admin.auth.admin.deleteUser(created.user.id); return responseWithCookies({ error: "تعذر إنشاء ملف المستخدم." }, 400, sessionResponse); }
  return responseWithCookies({ profile, password }, 200, sessionResponse);
}

export async function PATCH(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  const caller = await authorize(request, sessionResponse);
  if (!caller) return responseWithCookies({ error: "غير مصرح لك." }, 403, sessionResponse);
  const body: unknown = await request.json();
  if (!isUpdateBody(body)) return responseWithCookies({ error: "البيانات المدخلة غير صحيحة." }, 400, sessionResponse);
  const changes: Database["public"]["Tables"]["profiles"]["Update"] = {};
  if (typeof body.active === "boolean") changes.active = body.active;
  if (body.roles) changes.roles = body.roles;
  const { data: profile, error } = await adminClient().from("profiles").update(changes).eq("id", body.id).select().single();
  if (error || !profile) return responseWithCookies({ error: "تعذر حفظ التغييرات." }, 400, sessionResponse);
  return responseWithCookies({ profile }, 200, sessionResponse);
}

type CreateBody = { email: string; displayName: string; roles: Role[] };
function isCreateBody(value: unknown): value is CreateBody { if (typeof value !== "object" || value === null) return false; const body = value as Record<string, unknown>; return typeof body.email === "string" && body.email.length > 0 && typeof body.displayName === "string" && body.displayName.length > 0 && validRoles(body.roles); }
type UpdateBody = { id: string; active?: boolean; roles?: Role[] };
function isUpdateBody(value: unknown): value is UpdateBody { if (typeof value !== "object" || value === null) return false; const body = value as Record<string, unknown>; return typeof body.id === "string" && body.id.length > 0 && (typeof body.active === "boolean" || validRoles(body.roles)); }
