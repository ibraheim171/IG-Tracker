import "server-only";

import type { User } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import { getProtectedProfileIssue, type ProtectedProfileIssueCode } from "@/lib/admin-users-core";
import type { Tables } from "@/lib/database.types";
import { createRouteClient } from "@/lib/supabase/route";

type RouteProfile = Pick<Tables<"profiles">, "active" | "must_change_password" | "roles">;

export type RouteAuthError = { message: string; code: ProtectedProfileIssueCode; status: number };

export type RouteAuthResult =
  | { ok: true; supabase: ReturnType<typeof createRouteClient>; user: User; profile: RouteProfile }
  | { ok: false; error: RouteAuthError };

export const passwordChangeRequiredMessage = "يجب تغيير كلمة المرور قبل متابعة استخدام المنصة.";

export async function requireActiveRouteProfile(
  request: NextRequest,
  response: NextResponse,
  options: { allowPasswordChange?: boolean } = {},
): Promise<RouteAuthResult> {
  const supabase = createRouteClient(request, response);
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { ok: false, error: routeAuthError("E_SESSION") };

  const { data: profile } = await supabase
    .from("profiles")
    .select("roles, active, must_change_password")
    .eq("id", user.id)
    .single();

  const issue = getProtectedProfileIssue(profile, options);
  if (issue) return { ok: false, error: routeAuthError(issue) };
  if (!profile) return { ok: false, error: routeAuthError("E_SESSION") };

  return { ok: true, supabase, user, profile };
}

export function routeAuthError(code: ProtectedProfileIssueCode): RouteAuthError {
  if (code === "PASSWORD_CHANGE_REQUIRED") {
    return { message: passwordChangeRequiredMessage, code, status: 403 };
  }
  if (code === "E_ACCOUNT_DISABLED") {
    return { message: "هذا الحساب معطّل.", code, status: 403 };
  }
  return { message: "انتهت الجلسة. سجّل الدخول مرة أخرى.", code: "E_SESSION", status: 401 };
}
