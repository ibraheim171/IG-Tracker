import { NextRequest, NextResponse } from "next/server";
import { requireAnalyticsAdmin } from "@/lib/analytics-auth";
import { analyticsServiceClient } from "@/lib/analytics-server";
import { isUuid, validateMonthlyReportInput } from "@/lib/monthly-reports";

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
  try { return { ok: true as const, auth, service: analyticsServiceClient(), sessionResponse }; }
  catch { return { ok: false as const, response: withCookies({ error: "خدمة التقارير غير مهيأة في هذه البيئة.", code: "E_SERVER_CONFIG" }, 503, sessionResponse) }; }
}

export async function GET(request: NextRequest) {
  const access = await authorized(request);
  if (!access.ok) return access.response;
  const result = await access.service.from("reports").select("id,month,title,context_note,body_md,created_at,updated_at").order("month", { ascending: false }).order("created_at", { ascending: false });
  if (result.error) return withCookies({ error: "تعذر تحميل التقارير الشهرية.", code: "E_REPORTS_LOAD" }, 503, access.sessionResponse);
  return withCookies({ reports: result.data ?? [] }, 200, access.sessionResponse);
}

export async function POST(request: NextRequest) {
  const access = await authorized(request);
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => null);
  const validation = validateMonthlyReportInput({ month: body?.month, title: body?.title, contextNote: body?.contextNote });
  if (!validation.ok) return withCookies({ error: validation.message, code: validation.code }, 400, access.sessionResponse);
  const result = await access.service.from("reports").insert({ month: validation.value.month, title: validation.value.title, context_note: validation.value.contextNote, author_id: access.auth.user.id }).select("id,month,title,context_note,body_md,created_at,updated_at").single();
  if (result.error) return withCookies({ error: "تعذر إنشاء التقرير الشهري.", code: "E_REPORT_CREATE" }, 503, access.sessionResponse);
  return withCookies({ report: result.data }, 201, access.sessionResponse);
}

export async function PATCH(request: NextRequest) {
  const access = await authorized(request);
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => null);
  if (!isUuid(body?.reportId)) return withCookies({ error: "معرّف التقرير غير صحيح.", code: "E_REPORT" }, 400, access.sessionResponse);
  const validation = validateMonthlyReportInput({ month: body.month, title: body.title, contextNote: body.contextNote });
  if (!validation.ok) return withCookies({ error: validation.message, code: validation.code }, 400, access.sessionResponse);
  const result = await access.service.from("reports").update({ month: validation.value.month, title: validation.value.title, context_note: validation.value.contextNote, updated_at: new Date().toISOString() }).eq("id", body.reportId).select("id,month,title,context_note,body_md,created_at,updated_at").single();
  if (result.error) return withCookies({ error: "تعذر حفظ التقرير الشهري.", code: "E_REPORT_UPDATE" }, 503, access.sessionResponse);
  return withCookies({ report: result.data }, 200, access.sessionResponse);
}
