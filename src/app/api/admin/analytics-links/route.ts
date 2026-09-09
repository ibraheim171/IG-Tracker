import { NextRequest, NextResponse } from "next/server";
import { validateManualLink } from "@/lib/analytics-core";
import { requireAnalyticsAdmin } from "@/lib/analytics-auth";
import { analyticsServiceClient } from "@/lib/analytics-server";

function jsonWithCookies(body: object, status: number, source: NextResponse) {
  const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  try {
    if (origin) return new URL(origin).origin === request.nextUrl.origin;
    if (referer) return new URL(referer).origin === request.nextUrl.origin;
  } catch { return false; }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export async function GET(request: NextRequest) {
  const session = NextResponse.next();
  if (!sameOrigin(request)) return jsonWithCookies({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403, session);
  const auth = await requireAnalyticsAdmin(request, session);
  if (!auth.ok) return jsonWithCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, session);
  let service;
  try { service = analyticsServiceClient(); } catch { return jsonWithCookies({ error: "خدمة التحليلات غير مهيأة في هذه البيئة.", code: "E_SERVER_CONFIG" }, 503, session); }
  const [posts, items, links] = await Promise.all([
    service.from("ig_posts").select("media_id,published_at,media_type,product_type,permalink,caption").order("published_at", { ascending: false }).limit(200),
    service.from("items").select("id,ref,title,ig_permalink,ig_media_id,published_at").eq("status", "published").eq("is_archived", false).order("published_at", { ascending: false }).limit(300),
    service.from("ig_item_links").select("item_id,media_id,linked_at,linked_by,reason,previous_legacy_media_id,source"),
  ]);
  if (posts.error || items.error || links.error) return jsonWithCookies({ error: "تعذر تحميل مراجعة روابط إنستغرام. حاول مرة أخرى.", code: "E_LINK_LIST" }, 500, session);
  const linkedMedia = new Set((links.data ?? []).map((row) => row.media_id));
  const linkedItems = new Set((links.data ?? []).map((row) => row.item_id));
  return jsonWithCookies({
    posts: (posts.data ?? []).filter((row) => !linkedMedia.has(row.media_id)),
    items: (items.data ?? []).filter((row) => !linkedItems.has(row.id)),
    links: links.data ?? [],
  }, 200, session);
}

export async function POST(request: NextRequest) {
  const session = NextResponse.next();
  if (!sameOrigin(request)) return jsonWithCookies({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403, session);
  const auth = await requireAnalyticsAdmin(request, session);
  if (!auth.ok) return jsonWithCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, session);
  const validated = validateManualLink(await request.json().catch(() => null) ?? {});
  if (!validated.ok) return jsonWithCookies({ error: validated.code === "E_REASON" ? "سبب الربط مطلوب، بأربعة أحرف على الأقل." : "بيانات الربط غير صحيحة.", code: validated.code }, 400, session);
  const { data, error } = await auth.supabase.rpc("admin_link_instagram_post", {
    p_item_id: validated.value.itemId,
    p_media_id: validated.value.mediaId,
    p_reason: validated.value.reason,
  });
  if (error || !data) {
    const conflict = error?.message?.includes("LINK_CONFLICT");
    return jsonWithCookies({ error: conflict ? "تعذر الربط لأن المنشور أو المادة مرتبط بالفعل." : "تعذر حفظ الربط الآن.", code: conflict ? "E_LINK_CONFLICT" : "E_LINK_SAVE" }, conflict ? 409 : 400, session);
  }
  return jsonWithCookies({ link: data }, 201, session);
}
