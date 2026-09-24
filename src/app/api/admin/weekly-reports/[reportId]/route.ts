import { NextRequest } from "next/server";
import { publicWeeklyReport, validateWeeklyReportMetadata } from "@/lib/weekly-reports";
import { requireWeeklyReportAdmin, responseWithRouteCookies, weeklyReportError, weeklyReportStore } from "@/lib/weekly-reports-server";

export async function GET(request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  const auth = await requireWeeklyReportAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const { reportId } = await context.params;
    const report = await weeklyReportStore.get(reportId);
    if (!report) throw new Error("E_REPORT_NOT_FOUND");
    return responseWithRouteCookies({ report: publicWeeklyReport(report) }, 200, auth.sessionResponse);
  } catch (caught) {
    const error = weeklyReportError(caught);
    return responseWithRouteCookies({ error: error.message, code: error.code }, error.status, auth.sessionResponse);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  const auth = await requireWeeklyReportAdmin(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { reportId } = await context.params;
  try {
    if (body?.action === "publish" || body?.action === "unpublish") {
      const report = await weeklyReportStore.update(reportId, body.action === "publish"
        ? { published_at: new Date().toISOString(), published_by: auth.actorId }
        : { published_at: null, published_by: null });
      return responseWithRouteCookies({ report: publicWeeklyReport(report) }, 200, auth.sessionResponse);
    }
    const validated = validateWeeklyReportMetadata({ title: body?.title, periodStart: body?.period_start, periodEnd: body?.period_end });
    if (!validated.ok) return responseWithRouteCookies({ error: validated.message, code: validated.code }, 400, auth.sessionResponse);
    const report = await weeklyReportStore.update(reportId, { title: validated.value.title, period_start: validated.value.periodStart, period_end: validated.value.periodEnd });
    return responseWithRouteCookies({ report: publicWeeklyReport(report) }, 200, auth.sessionResponse);
  } catch (caught) {
    const error = weeklyReportError(caught);
    return responseWithRouteCookies({ error: error.message, code: error.code }, error.status, auth.sessionResponse);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  const auth = await requireWeeklyReportAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const { reportId } = await context.params;
    await weeklyReportStore.delete(reportId);
    return responseWithRouteCookies({ ok: true }, 200, auth.sessionResponse);
  } catch (caught) {
    const error = weeklyReportError(caught);
    return responseWithRouteCookies({ error: error.message, code: error.code }, error.status, auth.sessionResponse);
  }
}
