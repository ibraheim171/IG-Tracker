import { NextRequest, NextResponse } from "next/server";
import { isSameOriginAppRequest } from "@/lib/weekly-reports";
import { requireActiveRouteProfile } from "@/lib/route-auth";
import { readAiExport } from "@/lib/data-export-server";

function withSessionCookies(response: NextResponse, source: NextResponse) {
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

export async function GET(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  const sameOrigin = isSameOriginAppRequest({
    appOrigin: request.nextUrl.origin,
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    fetchSite: request.headers.get("sec-fetch-site"),
  });
  if (!sameOrigin) {
    return withSessionCookies(NextResponse.json({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, { status: 403 }), sessionResponse);
  }

  const auth = await requireActiveRouteProfile(request, sessionResponse);
  if (!auth.ok) {
    return withSessionCookies(NextResponse.json({ error: auth.error.message, code: auth.error.code }, { status: auth.error.status }), sessionResponse);
  }
  if (!auth.profile.roles.includes("admin")) {
    return withSessionCookies(NextResponse.json({ error: "غير مصرح لك بتنزيل تصدير البيانات.", code: "E_FORBIDDEN" }, { status: 403 }), sessionResponse);
  }

  try {
    const payload = await readAiExport();
    const date = new Date().toISOString().slice(0, 10);
    const response = new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="ig-tracker-ai-export-${date}.json"`,
        "Cache-Control": "no-store",
      },
    });
    return withSessionCookies(response, sessionResponse);
  } catch (caught) {
    const code = caught instanceof Error ? caught.message.split(":")[0] : "E_EXPORT";
    const message = code === "E_EXPORT_CONFIG" ? "تصدير البيانات غير مهيأ في هذه البيئة." : "تعذر تجهيز التصدير الآن. أعد المحاولة بعد قليل.";
    return withSessionCookies(NextResponse.json({ error: message, code }, { status: code === "E_EXPORT_CONFIG" ? 503 : 500 }), sessionResponse);
  }
}
