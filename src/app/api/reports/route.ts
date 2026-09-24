import { NextRequest } from "next/server";
import { publicWeeklyReport } from "@/lib/weekly-reports";
import { requireWeeklyReportReader, responseWithRouteCookies, weeklyReportError, weeklyReportStore } from "@/lib/weekly-reports-server";

export async function GET(request: NextRequest) {
  const auth = await requireWeeklyReportReader(request);
  if (!auth.ok) return auth.response;
  try {
    return responseWithRouteCookies({ reports: (await weeklyReportStore.list(true)).map(publicWeeklyReport) }, 200, auth.sessionResponse);
  } catch (caught) {
    const error = weeklyReportError(caught);
    return responseWithRouteCookies({ error: error.message, code: error.code }, error.status, auth.sessionResponse);
  }
}
