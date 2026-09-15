import type { NextRequest, NextResponse } from "next/server";
import { requireActiveRouteProfile } from "@/lib/route-auth";
import { canAccessRawAnalytics } from "@/lib/analytics-core";

export async function requireAnalyticsAdmin(request: NextRequest, response: NextResponse) {
  const auth = await requireActiveRouteProfile(request, response);
  if (!auth.ok) return auth;
  if (!canAccessRawAnalytics(auth.profile)) {
    return { ok: false as const, error: { message: "غير مصرح لك بعرض بيانات التحليلات التفصيلية.", code: "E_FORBIDDEN", status: 403 } };
  }
  return auth;
}
