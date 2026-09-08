import { NextRequest, NextResponse } from "next/server";
import { buildInsightsSnapshot, insightUtcBounds, validateInsightRange, type PartnerActivity, type PartnerPerformance } from "@/lib/insights";
import { requireActiveRouteProfile } from "@/lib/route-auth";

function withCookies(body: object, status: number, source: NextResponse) {
  const response = NextResponse.json(body, { status });
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

export async function GET(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  const auth = await requireActiveRouteProfile(request, sessionResponse);
  if (!auth.ok) return withCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, sessionResponse);
  const validation = validateInsightRange(request.nextUrl.searchParams.get("start"), request.nextUrl.searchParams.get("end"));
  if (!validation.ok) return withCookies({ error: validation.message, code: "E_DATE_RANGE" }, 400, sessionResponse);
  const { start: periodStart, endExclusive: periodEnd } = insightUtcBounds(validation.range);
  const slotStart = new Date() > new Date(periodStart) ? new Date().toISOString() : periodStart;

  const [items, slots, overdue, waiting, partnerActivity, partnerPerformance] = await Promise.all([
    auth.supabase.from("items").select("id,status,is_archived,published_at"),
    auth.supabase.from("v_slot_board").select("slot_id,slot_at,state,n_items,n_ready").gte("slot_at", slotStart).lt("slot_at", periodEnd).order("slot_at"),
    auth.supabase.from("v_conflict_slot_passed_unpublished").select("id"),
    auth.supabase.from("v_waiting").select("id,waiting_on").not("waiting_on", "is", null),
    auth.supabase
      .from("item_partners")
      .select("partner_id,item_id,partners!inner(id,name),items!inner(id,published_at,is_archived,track_id)")
      .eq("items.is_archived", false)
      .gte("items.published_at", periodStart)
      .lt("items.published_at", periodEnd),
    auth.supabase.from("v_partner_track").select("partner_id,partner_name,track_id,track_name,n,median_reach,median_signal,sample_sufficient"),
  ]);

  const failed = [items.error, slots.error, overdue.error, waiting.error, partnerActivity.error, partnerPerformance.error].some(Boolean);
  if (failed) {
    return withCookies({ error: "تعذر تحميل بيانات الإحصائيات. حاول مرة أخرى.", code: "E_INSIGHTS_LOAD" }, 500, sessionResponse);
  }

  const activity = (partnerActivity.data ?? []).flatMap((row): PartnerActivity[] => {
    const partner = Array.isArray(row.partners) ? row.partners[0] : row.partners;
    const item = Array.isArray(row.items) ? row.items[0] : row.items;
    if (!partner || !item?.published_at) return [];
    return [{ partner_id: row.partner_id, partner_name: partner.name, item_id: row.item_id, track_id: item.track_id, published_at: item.published_at }];
  });
  const performance = (partnerPerformance.data ?? []).flatMap((row): PartnerPerformance[] => {
    if (row.partner_id === null || !row.partner_name || row.track_id === null || !row.track_name) return [];
    return [{
      partner_id: row.partner_id,
      partner_name: row.partner_name,
      track_id: row.track_id,
      track_name: row.track_name,
      n: row.n ?? 0,
      median_reach: row.median_reach,
      median_signal: row.median_signal,
      sample_sufficient: row.sample_sufficient === true,
    }];
  });
  const knownPartnerTracks = new Set(performance.map((row) => `${row.partner_id}:${row.track_id}`));
  for (const row of activity) {
    const key = `${row.partner_id}:${row.track_id ?? -1}`;
    if (!knownPartnerTracks.has(key)) {
      performance.push({ partner_id: row.partner_id, partner_name: row.partner_name, track_id: row.track_id ?? -1, track_name: "—", n: 0, median_reach: null, median_signal: null, sample_sufficient: false });
      knownPartnerTracks.add(key);
    }
  }

  const snapshot = buildInsightsSnapshot({
    range: validation.range,
    items: items.data ?? [],
    slots: (slots.data ?? []).flatMap((row) => row.slot_id && row.slot_at ? [{
      slot_id: row.slot_id, slot_at: row.slot_at, state: row.state, n_items: row.n_items ?? 0, n_ready: row.n_ready ?? 0,
    }] : []),
    overdueItemIds: (overdue.data ?? []).flatMap((row) => row.id ? [row.id] : []),
    blockedItemIds: (waiting.data ?? []).flatMap((row) => row.id ? [row.id] : []),
    partnerActivity: activity,
    partnerPerformance: performance,
  });
  return withCookies({ snapshot }, 200, sessionResponse);
}
