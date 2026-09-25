import { NextRequest, NextResponse } from "next/server";
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
  try { service = analyticsServiceClient(); } catch { return withCookies({ error: "خدمة التحليلات غير مهيأة في هذه البيئة.", code: "E_SERVER_CONFIG" }, 503, sessionResponse); }
  const [runs, posts, account, audience] = await Promise.all([
    service
      .from("analytics_sync_runs")
      .select("id,source_timestamp,received_at,status,received_count,inserted_count,updated_count,already_present_identical_count,rejected_count")
      .order("received_at", { ascending: false })
      .limit(20),
    service.from("ig_post_daily").select("snapshot_date").order("snapshot_date", { ascending: false }).limit(1),
    service.from("ig_account_daily").select("date").order("date", { ascending: false }).limit(1),
    service.from("ig_demographics").select("snapshot_date").order("snapshot_date", { ascending: false }).limit(1),
  ]);
  if (runs.error || posts.error || account.error || audience.error) {
    return withCookies({ error: "تعذر تحميل حالة تغطية التحليلات.", code: "E_ANALYTICS_HEALTH" }, 503, sessionResponse);
  }
  return withCookies({
    runs: runs.data ?? [],
    streams: {
      posts: posts.data?.[0]?.snapshot_date ?? null,
      account: account.data?.[0]?.date ?? null,
      audience: audience.data?.[0]?.snapshot_date ?? null,
    },
  }, 200, sessionResponse);
}
