import { NextRequest, NextResponse } from "next/server";
import { parseAnalyticsMediaFilter } from "@/lib/analytics-core";
import { requireAnalyticsAdmin } from "@/lib/analytics-auth";
import { analyticsServiceClient } from "@/lib/analytics-server";
import { normalizePostSearch, postSortFields, type PostSortField } from "@/lib/analytics-table";
import { insightUtcBounds, validateInsightRange } from "@/lib/insights";

const pageSize = 25;

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
  const range = validateInsightRange(request.nextUrl.searchParams.get("start"), request.nextUrl.searchParams.get("end"));
  if (!range.ok) return withCookies({ error: range.message, code: "E_DATE_RANGE" }, 400, sessionResponse);
  const media = parseAnalyticsMediaFilter(request.nextUrl.searchParams.get("media_type"));
  if (!media.ok) return withCookies({ error: "نوع المحتوى غير صحيح.", code: media.code }, 400, sessionResponse);
  const sortValue = request.nextUrl.searchParams.get("sort") ?? "published_at";
  if (!postSortFields.includes(sortValue as PostSortField)) return withCookies({ error: "حقل الفرز غير صحيح.", code: "E_SORT" }, 400, sessionResponse);
  const direction = request.nextUrl.searchParams.get("direction") === "asc" ? "asc" : "desc";
  const search = normalizePostSearch(request.nextUrl.searchParams.get("search"));
  if (!search.ok) return withCookies({ error: "نص البحث غير صحيح. استخدم حروفًا أو أرقامًا أو شرطة فقط.", code: search.code }, 400, sessionResponse);
  const page = Math.max(1, Math.min(10000, Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1));
  const trackId = request.nextUrl.searchParams.get("track_id");
  const partnerId = request.nextUrl.searchParams.get("partner_id");
  if (trackId && !/^\d{1,10}$/.test(trackId) || partnerId && !/^\d{1,10}$/.test(partnerId)) return withCookies({ error: "قيمة المرشح غير صحيحة.", code: "E_FILTER" }, 400, sessionResponse);

  let service;
  try { service = analyticsServiceClient(); } catch {
    return withCookies({ error: "خدمة الإحصائيات غير مهيأة في هذه البيئة.", code: "E_SERVER_CONFIG" }, 503, sessionResponse);
  }
  let partnerItemIds: string[] | null = null;
  if (partnerId) {
    const links = await service.from("item_partners").select("item_id").eq("partner_id", Number(partnerId));
    if (links.error) return withCookies({ error: "تعذر تطبيق مرشح الشريك.", code: "E_PARTNER_FILTER" }, 503, sessionResponse);
    partnerItemIds = (links.data ?? []).map((row) => row.item_id);
    if (!partnerItemIds.length) return withCookies({ rows: [], total: 0, page, page_size: pageSize }, 200, sessionResponse);
  }

  const bounds = insightUtcBounds(range.range);
  let query = service
    .from("v_item_performance")
    .select("id,ref,title,published_at,track_id,track_name,idea_type_id,idea_type,media_id,permalink,media_type,product_type,snapshot_date,age_days,reach,views,save_rate,share_rate,follow_rate,signal,missing_metrics,signal_partial", { count: "exact" })
    .gte("published_at", bounds.start)
    .lt("published_at", bounds.endExclusive);
  if (trackId) query = query.eq("track_id", Number(trackId));
  if (search.value) query = query.or(`ref.ilike.%${search.value}%,title.ilike.%${search.value}%`);
  if (partnerItemIds) query = query.in("id", partnerItemIds);
  if (media.value === "REELS") query = query.eq("product_type", "REELS");
  else if (media.value === "VIDEO") query = query.eq("media_type", "VIDEO").or("product_type.neq.REELS,product_type.is.null");
  else if (media.value) query = query.eq("media_type", media.value);
  const from = (page - 1) * pageSize;
  const result = await query.order(sortValue as PostSortField, { ascending: direction === "asc", nullsFirst: false }).range(from, from + pageSize - 1);
  if (result.error) return withCookies({ error: "تعذر تحميل جدول المنشورات.", code: "E_POSTS_LOAD" }, 503, sessionResponse);

  const ids = (result.data ?? []).flatMap((row) => row.id ? [row.id] : []);
  const partnerResult = ids.length
    ? await service.from("item_partners").select("item_id,partners!inner(id,name)").in("item_id", ids)
    : { data: [], error: null };
  if (partnerResult.error) return withCookies({ error: "تعذر تحميل شركاء المنشورات.", code: "E_POST_PARTNERS" }, 503, sessionResponse);
  const partnersByItem = new Map<string, string[]>();
  for (const link of partnerResult.data ?? []) {
    const partner = Array.isArray(link.partners) ? link.partners[0] : link.partners;
    if (!partner) continue;
    partnersByItem.set(link.item_id, [...(partnersByItem.get(link.item_id) ?? []), partner.name]);
  }
  const rows = (result.data ?? []).map((row) => ({ ...row, partners: row.id ? partnersByItem.get(row.id) ?? [] : [] }));
  return withCookies({ rows, total: result.count ?? null, page, page_size: pageSize }, 200, sessionResponse);
}
