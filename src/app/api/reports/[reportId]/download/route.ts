import { NextRequest } from "next/server";
import { weeklyReportDownloadHeaders } from "@/lib/weekly-reports";
import { assertWeeklyReportReadable, bytesWithRouteCookies, requireWeeklyReportReader, responseWithRouteCookies, weeklyReportError, weeklyReportStore } from "@/lib/weekly-reports-server";

export async function GET(request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  const auth = await requireWeeklyReportReader(request);
  if (!auth.ok) return auth.response;
  try {
    const report = await weeklyReportStore.get((await context.params).reportId);
    if (!report) throw new Error("E_REPORT_NOT_FOUND");
    assertWeeklyReportReadable(auth.profile, report);
    return bytesWithRouteCookies(await weeklyReportStore.download(report.storage_path), weeklyReportDownloadHeaders(report.original_filename), auth.sessionResponse);
  } catch (caught) {
    const error = weeklyReportError(caught);
    return responseWithRouteCookies({ error: error.message, code: error.code }, error.status, auth.sessionResponse);
  }
}
