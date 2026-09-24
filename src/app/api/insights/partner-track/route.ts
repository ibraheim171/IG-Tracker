import { NextRequest, NextResponse } from "next/server";
import { comparisonMetrics, type ComparisonMetric, type ComparisonResult } from "@/lib/analytics-comparison";
import { requireAnalyticsAdmin } from "@/lib/analytics-auth";
import { insightUtcBounds, validateInsightRange } from "@/lib/insights";
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

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

export async function GET(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  if (!isSameOriginRead(request)) return withCookies({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403, sessionResponse);
  const auth = await requireAnalyticsAdmin(request, sessionResponse);
  if (!auth.ok) return withCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, sessionResponse);
  const range = validateInsightRange(request.nextUrl.searchParams.get("start"), request.nextUrl.searchParams.get("end"));
  if (!range.ok) return withCookies({ error: range.message, code: "E_DATE_RANGE" }, 400, sessionResponse);
  const rawMetric = request.nextUrl.searchParams.get("metric") ?? "signal";
  if (!comparisonMetrics.includes(rawMetric as ComparisonMetric)) return withCookies({ error: "المقياس غير صحيح.", code: "E_METRIC" }, 400, sessionResponse);
  const metric = rawMetric as ComparisonMetric;
  const selectedPartner = request.nextUrl.searchParams.get("partner_id");
  if (selectedPartner && !/^\d{1,10}$/.test(selectedPartner)) return withCookies({ error: "الشريك غير صحيح.", code: "E_PARTNER" }, 400, sessionResponse);

  const bounds = insightUtcBounds(range.range);
  const activityResult = await auth.supabase
    .from("item_partners")
    .select("partner_id,item_id,partners!inner(id,name),items!inner(id,track_id,published_at,is_archived)")
    .eq("items.is_archived", false)
    .gte("items.published_at", bounds.start)
    .lt("items.published_at", bounds.endExclusive);
  if (activityResult.error) return withCookies({ error: "تعذر تحميل تقاطعات الشركاء والمسارات.", code: "E_MATRIX_ACTIVITY" }, 503, sessionResponse);

  const activity = (activityResult.data ?? []).flatMap((row) => {
    const partner = Array.isArray(row.partners) ? row.partners[0] : row.partners;
    const item = Array.isArray(row.items) ? row.items[0] : row.items;
    return partner && item?.track_id ? [{ partner_id: String(row.partner_id), partner_name: partner.name, track_id: String(item.track_id), item_id: row.item_id }] : [];
  });
  const partnerIds = [...new Set(activity.map((row) => row.partner_id))];
  const trackIds = [...new Set(activity.map((row) => row.track_id))];
  const partners = partnerIds.map((id) => ({ partner_id: id, name: activity.find((row) => row.partner_id === id)?.partner_name ?? id }));
  const trackResult = trackIds.length ? await auth.supabase.from("tracks").select("id,name,sort_order").in("id", trackIds.map(Number)).order("sort_order") : { data: [], error: null };
  if (trackResult.error) return withCookies({ error: "تعذر تحميل أسماء المسارات.", code: "E_MATRIX_TRACKS" }, 503, sessionResponse);
  const tracks = (trackResult.data ?? []).map((row) => ({ track_id: String(row.id), name: row.name }));
  const keys = partners.flatMap((partner) => tracks.map((track) => `${partner.partner_id}:${track.track_id}`));
  const rpcResults = await Promise.all(chunks(keys, 20).map((batch) => auth.supabase.rpc("admin_analytics_comparison", {
    p_start: range.range.start,
    p_end: range.range.end,
    p_dimension: "partner_track",
    p_metric: metric,
    p_keys: batch,
    p_media_type: null,
  })));
  if (rpcResults.some((result) => result.error)) return withCookies({ error: "تعذر حساب مصفوفة الشركاء والمسارات.", code: "E_MATRIX_LOAD" }, 503, sessionResponse);
  const rows = rpcResults.flatMap((result) => (result.data ?? []) as ComparisonResult[]);

  let history: Array<Record<string, unknown>> = [];
  if (selectedPartner) {
    const itemIds = activity.filter((row) => row.partner_id === selectedPartner).map((row) => row.item_id);
    if (itemIds.length) {
      const historyResult = await auth.supabase
        .from("v_item_performance")
        .select("id,ref,title,published_at,track_name,media_type,product_type,reach,save_rate,share_rate,follow_rate,signal,missing_metrics,signal_partial")
        .in("id", itemIds)
        .order("published_at", { ascending: true });
      if (historyResult.error) return withCookies({ error: "تعذر تحميل سجل التعاون.", code: "E_MATRIX_HISTORY" }, 503, sessionResponse);
      history = historyResult.data ?? [];
    }
  }

  let sourceTime: string | null = null;
  try {
    const sourceResult = await analyticsServiceClient().from("analytics_sync_runs").select("source_timestamp").eq("status", "accepted").order("source_timestamp", { ascending: false }).limit(1).maybeSingle();
    if (sourceResult.error) return withCookies({ error: "تعذر تحميل وقت مصدر القياس.", code: "E_MATRIX_SOURCE" }, 503, sessionResponse);
    sourceTime = sourceResult.data?.source_timestamp ?? null;
  } catch { return withCookies({ error: "خدمة الإحصائيات غير مهيأة.", code: "E_SERVER_CONFIG" }, 503, sessionResponse); }

  return withCookies({ partners, tracks, rows, history, source_time: sourceTime }, 200, sessionResponse);
}
