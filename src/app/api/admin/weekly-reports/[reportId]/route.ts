import { NextRequest } from "next/server";
import { publicWeeklyReport } from "@/lib/weekly-reports";
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
