import { NextRequest, NextResponse } from "next/server";
import { comparisonMonthBuckets, validateComparisonQuery, type ComparisonResult } from "@/lib/analytics-comparison";
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

  if (request.nextUrl.searchParams.get("mode") === "options") {
    const [tracks, ideaTypes, partners, people] = await Promise.all([
      auth.supabase.from("tracks").select("id,name").order("sort_order"),
      auth.supabase.from("idea_types").select("id,name").eq("active", true).order("name"),
      auth.supabase.from("partners").select("id,name").eq("active", true).order("name"),
      auth.supabase.from("profiles").select("id,display_name").eq("active", true).order("display_name"),
    ]);
    if (tracks.error || ideaTypes.error || partners.error || people.error) return withCookies({ error: "تعذر تحميل عناصر المقارنة.", code: "E_COMPARISON_OPTIONS" }, 503, sessionResponse);
    return withCookies({ options: {
      track: (tracks.data ?? []).map((row) => ({ key: String(row.id), name: row.name })),
      idea_type: (ideaTypes.data ?? []).map((row) => ({ key: String(row.id), name: row.name })),
      partner: (partners.data ?? []).map((row) => ({ key: String(row.id), name: row.name })),
      person: (people.data ?? []).map((row) => ({ key: row.id, name: row.display_name })),
      media_type: [
        { key: "IMAGE", name: "صورة" },
        { key: "CAROUSEL_ALBUM", name: "كاروسيل" },
        { key: "VIDEO", name: "فيديو" },
        { key: "REELS", name: "ريلز" },
      ],
    } }, 200, sessionResponse);
  }

  const validation = validateComparisonQuery(request.nextUrl.searchParams);
  if (!validation.ok) return withCookies({ error: validation.message, code: validation.code }, 400, sessionResponse);
  const value = validation.value;
  const wantsTimeline = request.nextUrl.searchParams.get("view") === "timeline";
  let service;
  try { service = analyticsServiceClient(); } catch { return withCookies({ error: "خدمة الإحصائيات غير مهيأة.", code: "E_SERVER_CONFIG" }, 503, sessionResponse); }
  const buckets = wantsTimeline ? comparisonMonthBuckets(value.range) : [];
  const [result, sourceResult, timelineResults] = await Promise.all([
    auth.supabase.rpc("admin_analytics_comparison", {
      p_start: value.range.start,
      p_end: value.range.end,
      p_dimension: value.dimension,
      p_metric: value.metric,
      p_keys: value.keys,
      p_media_type: value.mediaType,
    }),
    service.from("analytics_sync_runs").select("source_timestamp").eq("status", "accepted").order("source_timestamp", { ascending: false }).limit(1).maybeSingle(),
    Promise.all(buckets.map(async (bucket) => ({
      bucket,
      result: await auth.supabase.rpc("admin_analytics_comparison", {
        p_start: bucket.start,
        p_end: bucket.end,
        p_dimension: value.dimension,
        p_metric: value.metric,
        p_keys: value.keys,
        p_media_type: value.mediaType,
      }),
    }))),
  ]);
  if (result.error || sourceResult.error || timelineResults.some((entry) => entry.result.error)) return withCookies({ error: "تعذر بناء المقارنة.", code: "E_COMPARISON_LOAD" }, 503, sessionResponse);
  const timeline = timelineResults.map(({ bucket, result: bucketResult }) => ({ month: bucket.key, rows: (bucketResult.data ?? []) as ComparisonResult[] }));
  return withCookies({ rows: (result.data ?? []) as ComparisonResult[], timeline, source_time: sourceResult.data?.source_timestamp ?? null }, 200, sessionResponse);
}
