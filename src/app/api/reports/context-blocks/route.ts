import { NextRequest, NextResponse } from "next/server";
import { requireAnalyticsAdmin } from "@/lib/analytics-auth";
import { analyticsServiceClient } from "@/lib/analytics-server";
import type { Json } from "@/lib/database.types";
import { isUuid } from "@/lib/monthly-reports";
import { ANALYTICS_FORMULA_VERSION, validateReportContextBlock } from "@/lib/report-context";

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

async function authorized(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  if (!isSameOriginRead(request)) return { ok: false as const, response: withCookies({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403, sessionResponse) };
  const auth = await requireAnalyticsAdmin(request, sessionResponse);
  if (!auth.ok) return { ok: false as const, response: withCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, sessionResponse) };
  return { ok: true as const, auth, sessionResponse };
}

export async function GET(request: NextRequest) {
  const access = await authorized(request);
  if (!access.ok) return access.response;
  const reportId = request.nextUrl.searchParams.get("report_id");
  if (!isUuid(reportId)) return withCookies({ error: "معرّف التقرير غير صحيح.", code: "E_REPORT" }, 400, access.sessionResponse);
  let service;
  try { service = analyticsServiceClient(); } catch { return withCookies({ error: "خدمة التقارير غير مهيأة.", code: "E_SERVER_CONFIG" }, 503, access.sessionResponse); }
  const result = await service.from("report_context_blocks").select("*").eq("report_id", reportId).order("position");
  if (result.error) return withCookies({ error: "تعذر تحميل مقاطع التقرير.", code: "E_BLOCKS_LOAD" }, 503, access.sessionResponse);
  return withCookies({ blocks: result.data ?? [] }, 200, access.sessionResponse);
}

export async function POST(request: NextRequest) {
  const access = await authorized(request);
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => null);
  if (!isUuid(body?.reportId)) return withCookies({ error: "معرّف التقرير غير صحيح.", code: "E_REPORT" }, 400, access.sessionResponse);
  const validation = validateReportContextBlock(body?.block);
  if (!validation.ok) return withCookies({ error: validation.message, code: validation.code }, 400, access.sessionResponse);
  const result = await access.auth.supabase.rpc("admin_add_report_context_block", {
    p_report_id: body.reportId,
    p_block_type: validation.value.blockType,
    p_title: validation.value.title,
    p_input_snapshot: validation.value.snapshot as unknown as Json,
    p_formula_version: ANALYTICS_FORMULA_VERSION,
  });
  if (result.error) return withCookies({ error: "تعذر إضافة المقطع للتقرير.", code: "E_BLOCK_ADD" }, 503, access.sessionResponse);
  return withCookies({ block: result.data }, 201, access.sessionResponse);
}

export async function PATCH(request: NextRequest) {
  const access = await authorized(request);
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => null);
  if (!isUuid(body?.reportId) || !Array.isArray(body?.order) || body.order.some((id: unknown) => !isUuid(id))) return withCookies({ error: "ترتيب المقاطع غير صحيح.", code: "E_BLOCK_ORDER" }, 400, access.sessionResponse);
  const result = await access.auth.supabase.rpc("admin_reorder_report_context_blocks", { p_report_id: body.reportId, p_order: body.order });
  if (result.error) return withCookies({ error: "تعذر ترتيب المقاطع.", code: "E_BLOCK_REORDER" }, 503, access.sessionResponse);
  return withCookies({ blocks: result.data ?? [] }, 200, access.sessionResponse);
}

export async function DELETE(request: NextRequest) {
  const access = await authorized(request);
  if (!access.ok) return access.response;
  const reportId = request.nextUrl.searchParams.get("report_id");
  const blockId = request.nextUrl.searchParams.get("block_id");
  if (!isUuid(reportId) || !isUuid(blockId)) return withCookies({ error: "معرّف المقطع غير صحيح.", code: "E_BLOCK" }, 400, access.sessionResponse);
  const result = await access.auth.supabase.rpc("admin_delete_report_context_block", { p_report_id: reportId, p_block_id: blockId });
  if (result.error) return withCookies({ error: "تعذر حذف المقطع.", code: "E_BLOCK_DELETE" }, 503, access.sessionResponse);
  return withCookies({ ok: true }, 200, access.sessionResponse);
}
