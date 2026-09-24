import { NextRequest, NextResponse } from "next/server";
import { latestAudienceSnapshot } from "@/lib/account-pulse";
import { requireAnalyticsAdmin } from "@/lib/analytics-auth";
import { analyticsServiceClient } from "@/lib/analytics-server";

function withCookies(body: object, status: number, source: NextResponse) {
  const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

function isSameOriginRead(request: NextRequest) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  try {
    if (origin) return new URL(origin).origin === request.nextUrl.origin;
    if (referer) return new URL(referer).origin === request.nextUrl.origin;
  } catch { return false; }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export async function GET(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  if (!isSameOriginRead(request)) return withCookies({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403, sessionResponse);
  const auth = await requireAnalyticsAdmin(request, sessionResponse);
  if (!auth.ok) return withCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, sessionResponse);

  let service;
  try { service = analyticsServiceClient(); } catch {
    return withCookies({ error: "خدمة الإحصائيات غير مهيأة في هذه البيئة.", code: "E_SERVER_CONFIG" }, 503, sessionResponse);
  }

  const latestResult = await service
    .from("ig_demographics")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestResult.error) return withCookies({ error: "تعذر تحميل لقطة الجمهور.", code: "E_AUDIENCE_INSIGHTS" }, 503, sessionResponse);
  const latest = latestResult.data;
  if (!latest?.snapshot_date) return withCookies({ snapshot: latestAudienceSnapshot([]) }, 200, sessionResponse);

  const rowsResult = await service
    .from("ig_demographics")
    .select("snapshot_date,dimension,key,value,source_timestamp")
    .eq("snapshot_date", latest.snapshot_date)
    .order("dimension")
    .order("value", { ascending: false });
  if (rowsResult.error) return withCookies({ error: "تعذر تحميل لقطة الجمهور.", code: "E_AUDIENCE_INSIGHTS" }, 503, sessionResponse);
  return withCookies({ snapshot: latestAudienceSnapshot(rowsResult.data ?? []) }, 200, sessionResponse);
}
