import { NextRequest, NextResponse } from "next/server";
import { requireAnalyticsAdmin } from "@/lib/analytics-auth";
import { analyticsServiceClient } from "@/lib/analytics-server";
import { isUuid } from "@/lib/monthly-reports";
import { buildMonthlyDraftRow, composeMonthlyReportInput } from "@/lib/report-context";

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

export async function POST(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  if (!isSameOriginRead(request)) return withCookies({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403, sessionResponse);
  const auth = await requireAnalyticsAdmin(request, sessionResponse);
  if (!auth.ok) return withCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, sessionResponse);
  const body = await request.json().catch(() => null);
  if (!isUuid(body?.reportId)) return withCookies({ error: "معرّف التقرير غير صحيح.", code: "E_REPORT" }, 400, sessionResponse);
  let service;
  try { service = analyticsServiceClient(); } catch { return withCookies({ error: "خدمة التقارير غير مهيأة.", code: "E_SERVER_CONFIG" }, 503, sessionResponse); }
  const [reportResult, blocksResult] = await Promise.all([
    service.from("reports").select("id,title,month,context_note").eq("id", body.reportId).maybeSingle(),
    service.from("report_context_blocks").select("title,block_type,input_snapshot,formula_version,position").eq("report_id", body.reportId).order("position"),
  ]);
  if (reportResult.error || blocksResult.error || !reportResult.data) return withCookies({ error: "تعذر تحميل سياق التقرير.", code: "E_DRAFT_CONTEXT" }, 503, sessionResponse);
  if (!blocksResult.data?.length) return withCookies({ error: "أضف مقطعًا واحدًا على الأقل قبل تجهيز المسودة.", code: "E_DRAFT_EMPTY" }, 400, sessionResponse);
  let input: string;
  try { input = composeMonthlyReportInput(reportResult.data, blocksResult.data); }
  catch { return withCookies({ error: "أحد مقاطع التقرير لا يطابق تعريف القياس المحفوظ.", code: "E_DRAFT_INVALID_CONTEXT" }, 422, sessionResponse); }
  const row = buildMonthlyDraftRow(auth.user.id, body.reportId, input);
  const insertResult = await service.from("ai_drafts").insert(row).select("id,output,created_at,approved_at,approved_by,model").single();
  if (insertResult.error) return withCookies({ error: "تعذر تسجيل مسودة التقرير.", code: "E_DRAFT_CREATE" }, 503, sessionResponse);
  return withCookies({ draft: insertResult.data }, 201, sessionResponse);
}
