import { NextRequest, NextResponse } from "next/server";
import {
  immutableWeeklyReportPath,
  publicWeeklyReport,
  readBoundedStream,
  sha256Hex,
  validateSafeHtml,
  validateWeeklyReportInput,
  weeklyReportMaxBytes,
} from "@/lib/weekly-reports";
import {
  requireWeeklyReportAdmin,
  responseWithRouteCookies,
  weeklyReportError,
  weeklyReportStore,
} from "@/lib/weekly-reports-server";

export async function GET(request: NextRequest) {
  const auth = await requireWeeklyReportAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    return responseWithRouteCookies({ reports: (await weeklyReportStore.list()).map(publicWeeklyReport) }, 200, auth.sessionResponse);
  } catch (caught) {
    const error = weeklyReportError(caught);
    return responseWithRouteCookies({ error: error.message, code: error.code }, error.status, auth.sessionResponse);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireWeeklyReportAdmin(request);
  if (!auth.ok) return auth.response;
  const validation = validateWeeklyReportInput({
    title: request.nextUrl.searchParams.get("title") ?? "",
    periodStart: request.nextUrl.searchParams.get("period_start") ?? "",
    periodEnd: request.nextUrl.searchParams.get("period_end") ?? "",
    filename: request.nextUrl.searchParams.get("filename") ?? "",
  });
  if (!validation.ok) {
    return responseWithRouteCookies({ error: validation.message, code: validation.code }, 400, auth.sessionResponse);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > weeklyReportMaxBytes) {
    return responseWithRouteCookies({ error: "يتجاوز الملف الحد الأقصى المسموح وهو 2 MiB.", code: "E_FILE_TOO_LARGE" }, 413, auth.sessionResponse);
  }

  let uploadedPath: string | null = null;
  try {
    const bytes = await readBoundedStream(request.body);
    let html: string;
    try {
      html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("E_UTF8");
    }
    const safeHtml = validateSafeHtml(html);
    if (!safeHtml.ok) return responseWithRouteCookies({ error: safeHtml.message, code: safeHtml.code }, 400, auth.sessionResponse);
    const checksum = await sha256Hex(bytes);
    const id = crypto.randomUUID();
    uploadedPath = immutableWeeklyReportPath(id, checksum);
    await weeklyReportStore.upload(uploadedPath, bytes);
    const report = await weeklyReportStore.insert({
      id,
      title: validation.value.title,
      period_start: validation.value.periodStart,
      period_end: validation.value.periodEnd,
      storage_path: uploadedPath,
      original_filename: validation.value.filename,
      content_sha256: checksum,
      byte_size: bytes.byteLength,
      uploaded_by: auth.actorId,
    });
    return responseWithRouteCookies({ report: publicWeeklyReport(report) }, 201, auth.sessionResponse);
  } catch (caught) {
    if (uploadedPath) await weeklyReportStore.remove(uploadedPath);
    const error = weeklyReportError(caught);
    return responseWithRouteCookies({ error: error.message, code: error.code }, error.status, auth.sessionResponse);
  }
}
