import { NextRequest, NextResponse } from "next/server";
import { parseAnalyticsMediaFilter } from "@/lib/analytics-core";
import { requireAnalyticsAdmin } from "@/lib/analytics-auth";
import { analyticsServiceClient } from "@/lib/analytics-server";
import { buildInsightsSnapshot, insightUtcBounds, validateInsightRange, type PartnerActivity, type PerformanceAggregate, type PerformanceDetail, type PostCheckpoint } from "@/lib/insights";

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
  const mediaFilter = parseAnalyticsMediaFilter(request.nextUrl.searchParams.get("media_type"));
  if (!mediaFilter.ok) return withCookies({ error: "نوع الوسائط غير صحيح.", code: mediaFilter.code }, 400, sessionResponse);
  const mediaType = mediaFilter.value;
  const { start: periodStart, endExclusive: periodEnd } = insightUtcBounds(validation.range);
  const slotStart = new Date() > new Date(periodStart) ? new Date().toISOString() : periodStart;
  let service;
  try { service = analyticsServiceClient(); } catch { return withCookies({ error: "خدمة الإحصائيات غير مهيأة في هذه البيئة.", code: "E_SERVER_CONFIG" }, 503, sessionResponse); }
  let performanceQuery = service.from("v_item_performance").select("*").gte("published_at", periodStart).lt("published_at", periodEnd).order("published_at", { ascending: false });
  if (mediaType === "REELS") performanceQuery = performanceQuery.eq("product_type", "REELS");
  else if (mediaType === "VIDEO") performanceQuery = performanceQuery.eq("media_type", "VIDEO").or("product_type.neq.REELS,product_type.is.null");
  else if (mediaType) performanceQuery = performanceQuery.eq("media_type", mediaType);
  const results = await Promise.all([
    auth.supabase.from("items").select("id,status,is_archived,published_at"),
    auth.supabase.from("v_slot_board").select("slot_id,slot_at,state,n_items,n_ready").gte("slot_at", slotStart).lt("slot_at", periodEnd).order("slot_at"),
    auth.supabase.from("v_conflict_slot_passed_unpublished").select("id"),
    auth.supabase.from("v_waiting").select("id,waiting_on").not("waiting_on", "is", null),
    service.from("item_partners").select("partner_id,item_id,partners!inner(id,name),items!inner(id,published_at,is_archived,track_id)").eq("items.is_archived", false).gte("items.published_at", periodStart).lt("items.published_at", periodEnd),
    performanceQuery,
    auth.supabase.rpc("admin_analytics_aggregates", { p_start: validation.range.start, p_end: validation.range.end, p_media_type: mediaType || null }),
    service.from("ig_account_daily").select("date,followers,media_count,reach,views,reach_followers,reach_non_followers,follows,unfollows,missing_metrics").gte("date", validation.range.start).lte("date", validation.range.end).order("date", { ascending: false }),
    service.from("ig_demographics").select("snapshot_date,dimension,key,value").gte("snapshot_date", validation.range.start).lte("snapshot_date", validation.range.end).order("snapshot_date", { ascending: false }),
    service.from("ig_collabs").select("collaboration_date,collaboration_type,follows_lift,reach_lift_pct,nonfollower_lift_pct,partners!inner(name)").gte("collaboration_date", validation.range.start).lte("collaboration_date", validation.range.end).order("collaboration_date", { ascending: false }),
    service.from("analytics_sync_runs").select("id,source_timestamp,received_at,status,row_counts,received_count,inserted_count,updated_count,already_present_identical_count,rejected_count").order("received_at", { ascending: false }).limit(20),
  ]);
  if (results.some((result) => result.error)) return withCookies({ error: "تعذر تحميل بيانات الإحصائيات. حاول مرة أخرى.", code: "E_INSIGHTS_LOAD" }, 503, sessionResponse);
  const [items, slots, overdue, waiting, partnerActivity, performance, aggregateRows, account, demographics, collabs, syncRuns] = results;
  const activity = (partnerActivity.data ?? []).flatMap((row): PartnerActivity[] => {
    const partner = Array.isArray(row.partners) ? row.partners[0] : row.partners;
    const item = Array.isArray(row.items) ? row.items[0] : row.items;
    return partner && item?.published_at ? [{ partner_id: row.partner_id, partner_name: partner.name, item_id: row.item_id, track_id: item.track_id, published_at: item.published_at }] : [];
  });
  const rawPerformance = (performance.data ?? []) as unknown as Omit<PerformanceDetail, "checkpoints">[];
  const mediaIds = rawPerformance.map((row) => row.media_id);
  const checkpointResult = mediaIds.length ? await service.from("ig_post_daily").select("media_id,age_days,snapshot_date,reach,saved,shares,follows,profile_visits,comments,likes").in("media_id", mediaIds).in("age_days", [1, 7, 30]) : { data: [], error: null };
  if (checkpointResult.error) return withCookies({ error: "تعذر تحميل نقاط القياس اليومية.", code: "E_CHECKPOINTS" }, 503, sessionResponse);
  const details: PerformanceDetail[] = rawPerformance.map((row) => ({ ...row, missing_metrics: row.missing_metrics ?? [], signal_partial: row.signal_partial === true, checkpoints: Object.fromEntries([1, 7, 30].map((age) => {
    const point = (checkpointResult.data ?? []).find((candidate) => candidate.media_id === row.media_id && candidate.age_days === age);
    if (!point) return [`D${age}`, null];
    const complete = point.reach && point.reach > 0 && [point.shares, point.saved, point.follows, point.profile_visits, point.comments, point.likes].every((value) => value !== null);
    const signal = complete ? (point.shares! * 6 + point.saved! * 4 + point.follows! * 3 + point.profile_visits! * 2 + point.comments! * 1.5 + point.likes! * 0.5) / point.reach! * 1000 : null;
    return [`D${age}`, { age_days: point.age_days, snapshot_date: point.snapshot_date, reach: point.reach, saved: point.saved, shares: point.shares, signal } satisfies PostCheckpoint];
  })) }));
  const aggregates = (aggregateRows.data ?? []).map((row): PerformanceAggregate => ({
    dimension: row.dimension as PerformanceAggregate["dimension"], key: row.dimension_key,
    name: row.dimension_name, n: row.n,
    measured_reach_n: row.measured_reach_n,
    measured_save_rate_n: row.measured_save_rate_n,
    measured_share_rate_n: row.measured_share_rate_n,
    measured_signal_n: row.measured_signal_n,
    median_reach: row.median_reach,
    median_save_rate: row.median_save_rate, median_share_rate: row.median_share_rate,
    median_signal: row.median_signal, sample_sufficient: row.sample_sufficient,
  }));
  const snapshot = buildInsightsSnapshot({ range: validation.range, items: items.data ?? [], slots: (slots.data ?? []).flatMap((row) => row.slot_id && row.slot_at ? [{ slot_id: row.slot_id, slot_at: row.slot_at, state: row.state, n_items: row.n_items ?? 0, n_ready: row.n_ready ?? 0 }] : []), overdueItemIds: (overdue.data ?? []).flatMap((row) => row.id ? [row.id] : []), blockedItemIds: (waiting.data ?? []).flatMap((row) => row.id ? [row.id] : []), partnerActivity: activity, partnerPerformance: [] });
  snapshot.performance = details;
  snapshot.aggregates = aggregates.filter((row) => row.dimension !== "partner_track");
  snapshot.partner_track_matrix = aggregates.filter((row) => row.dimension === "partner_track");
  snapshot.account_daily = account.data ?? [];
  snapshot.demographics = demographics.data ?? [];
  snapshot.collabs = (collabs.data ?? []).flatMap((row) => {
    const partner = Array.isArray(row.partners) ? row.partners[0] : row.partners;
    return partner ? [{ collaboration_date: row.collaboration_date, partner: partner.name, collaboration_type: row.collaboration_type, follows_lift: row.follows_lift, reach_lift_pct: row.reach_lift_pct, nonfollower_lift_pct: row.nonfollower_lift_pct }] : [];
  });
  snapshot.sync_runs = syncRuns.data ?? [];
  return withCookies({ snapshot }, 200, sessionResponse);
}
