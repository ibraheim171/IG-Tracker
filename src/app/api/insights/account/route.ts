import { NextRequest, NextResponse } from "next/server";
import { requireAnalyticsAdmin } from "@/lib/analytics-auth";
import { analyticsServiceClient } from "@/lib/analytics-server";
import { completeAccountDailyRange } from "@/lib/account-pulse";
import {
  insightUtcBounds,
  normalizeAccountDaily,
  summarizeAccountRange,
  validateInsightRange,
  type AccountDailyInsight,
} from "@/lib/insights";

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
  const validation = validateInsightRange(request.nextUrl.searchParams.get("start"), request.nextUrl.searchParams.get("end"));
  if (!validation.ok) return withCookies({ error: validation.message, code: "E_DATE_RANGE" }, 400, sessionResponse);

  let service;
  try { service = analyticsServiceClient(); } catch {
    return withCookies({ error: "خدمة الإحصائيات غير مهيأة في هذه البيئة.", code: "E_SERVER_CONFIG" }, 503, sessionResponse);
  }

  const bounds = insightUtcBounds(validation.range);
  const [dailyResult, publishedResult, slotsResult] = await Promise.all([
    service
      .from("ig_account_daily")
      .select("date,followers,media_count,reach,views,reach_followers,reach_non_followers,follows,unfollows,missing_metrics,source_timestamp")
      .gte("date", validation.range.start)
      .lte("date", validation.range.end)
      .order("date", { ascending: true }),
    auth.supabase
      .from("items")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .eq("is_archived", false)
      .gte("published_at", bounds.start)
      .lt("published_at", bounds.endExclusive),
    auth.supabase
      .from("publishing_slots")
      .select("id", { count: "exact", head: true })
      .gte("slot_at", bounds.start)
      .lt("slot_at", bounds.endExclusive),
  ]);
  if (dailyResult.error || publishedResult.error || slotsResult.error) {
    return withCookies({ error: "تعذر تحميل نبض الحساب. حاول مرة أخرى.", code: "E_ACCOUNT_INSIGHTS" }, 503, sessionResponse);
  }

  const daily = completeAccountDailyRange(
    validation.range,
    ((dailyResult.data ?? []) as AccountDailyInsight[]).map(normalizeAccountDaily),
  );
  return withCookies({
    range: validation.range,
    daily,
    summary: summarizeAccountRange(validation.range, daily),
    publishing: { published: publishedResult.count, slots: slotsResult.count },
  }, 200, sessionResponse);
}
