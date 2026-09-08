import { NextRequest } from "next/server";
import { weeklyReportPreviewHeaders } from "@/lib/weekly-reports";
import { bytesWithRouteCookies, requireWeeklyReportAdmin, responseWithRouteCookies, weeklyReportError, weeklyReportStore } from "@/lib/weekly-reports-server";

export async function GET(request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  const auth = await requireWeeklyReportAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const { reportId } = await context.params;
    const report = await weeklyReportStore.get(reportId);
    if (!report) throw new Error("E_REPORT_NOT_FOUND");
    const bytes = await weeklyReportStore.download(report.storage_path);
    return bytesWithRouteCookies(bytes, { ...weeklyReportPreviewHeaders, "Content-Type": "text/html; charset=utf-8" }, auth.sessionResponse);
  } catch (caught) {
    const error = weeklyReportError(caught);
    const response = responseWithRouteCookies({ error: error.message, code: error.code }, error.status, auth.sessionResponse);
    Object.entries(weeklyReportPreviewHeaders).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  }
}
