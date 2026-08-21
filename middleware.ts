import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookies) => cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) } });
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!user) return path === "/login" ? response : NextResponse.redirect(new URL("/login", request.url));
  const { data: profile } = await supabase.from("profiles").select("must_change_password, active").eq("id", user.id).single();
  if (!profile?.active) { await supabase.auth.signOut(); return NextResponse.redirect(new URL("/login", request.url)); }
  if (profile.must_change_password && path !== "/account/password") return NextResponse.redirect(new URL("/account/password", request.url));
  if (!profile.must_change_password && (path === "/login" || path === "/account/password")) return NextResponse.redirect(new URL("/health", request.url));
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
