import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getProtectedProfileIssue } from "@/lib/admin-users-core";
import type { Database } from "@/lib/database.types";

const passwordPath = "/account/password";
const passwordApiPath = "/api/account/password";
const passwordRequiredBody = { error: "يجب تغيير كلمة المرور قبل متابعة استخدام المنصة.", code: "PASSWORD_CHANGE_REQUIRED" };

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookies) => cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) } });
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!user) return path === "/login" ? response : path.startsWith("/api/") ? NextResponse.json({ error: "انتهت الجلسة. سجّل الدخول مرة أخرى.", code: "E_SESSION" }, { status: 401 }) : NextResponse.redirect(new URL("/login", request.url));
  const { data: profile } = await supabase.from("profiles").select("must_change_password, active").eq("id", user.id).single();
  const issue = getProtectedProfileIssue(profile, { allowPasswordChange: path === passwordPath || path === passwordApiPath });
  if (issue === "E_SESSION" || issue === "E_ACCOUNT_DISABLED") {
    await supabase.auth.signOut();
    return copySessionCookies(response, path.startsWith("/api/") ? NextResponse.json({ error: "انتهت الجلسة. سجّل الدخول مرة أخرى.", code: issue }, { status: issue === "E_ACCOUNT_DISABLED" ? 403 : 401 }) : NextResponse.redirect(new URL("/login", request.url)));
  }
  if (issue === "PASSWORD_CHANGE_REQUIRED") {
    return copySessionCookies(response, path.startsWith("/api/") ? NextResponse.json(passwordRequiredBody, { status: 403 }) : NextResponse.redirect(new URL(passwordPath, request.url)));
  }
  if (!profile?.must_change_password && (path === "/login" || path === passwordPath)) return copySessionCookies(response, NextResponse.redirect(new URL("/health", request.url)));
  return response;
}

function copySessionCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach(({ name, value, ...options }) => target.cookies.set(name, value, options));
  return target;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"] };
