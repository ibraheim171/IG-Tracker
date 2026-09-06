import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { Json } from "@/lib/database.types";
import {
  HISTORICAL_IMPORT_CONFIRMATION,
  HISTORICAL_IMPORT_MAX_BYTES,
  historicalRowsToJson,
  parseHistoricalCsv,
  safeHistoricalImportError,
} from "@/lib/admin-historical-import";
import { requireActiveRouteProfile } from "@/lib/route-auth";
import {
  declaredBodyExceedsLimit,
  readUtf8RequestBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/read-limited-request-body";

type ImportAction = "preview" | "apply";
type ImportRequestBody = {
  action?: unknown;
  csv_text?: unknown;
  source_filename?: unknown;
  source_sha256?: unknown;
  reason?: unknown;
  confirmation?: unknown;
  preview_token?: unknown;
};

type ImportRpc = (
  fn: "admin_import_historical_items",
  args: {
    p_rows: Json;
    p_source_filename: string;
    p_source_sha256: string;
    p_reason: string;
    p_dry_run: boolean;
    p_preview_token: string | null;
  },
) => PromiseLike<{ data: Json | null; error: { message?: string } | null }>;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function responseWithCookies(source: NextResponse, body: object, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  for (const cookie of source.cookies.getAll()) {
    const { name, value, ...options } = cookie;
    response.cookies.set(name, value, options);
  }
  return response;
}

function isSameOriginMutation(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function safeString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function checksumsMatch(provided: string, calculated: string) {
  if (!/^[0-9a-f]{64}$/.test(provided) || provided.length !== calculated.length) return false;
  return timingSafeEqual(Buffer.from(provided, "ascii"), Buffer.from(calculated, "ascii"));
}

export async function POST(request: NextRequest) {
  const cookieResponse = NextResponse.next();
  if (declaredBodyExceedsLimit(request.headers.get("content-length"), HISTORICAL_IMPORT_MAX_BYTES)) {
    return responseWithCookies(cookieResponse, { error: "حجم الطلب يتجاوز 2 MiB.", code: "E_PAYLOAD_TOO_LARGE" }, 413);
  }
  if (!isSameOriginMutation(request)) {
    return responseWithCookies(cookieResponse, { error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403);
  }

  const auth = await requireActiveRouteProfile(request, cookieResponse);
  if (!auth.ok) return responseWithCookies(cookieResponse, { error: auth.error.message, code: auth.error.code }, auth.error.status);
  if (!auth.profile.roles.includes("admin")) {
    return responseWithCookies(cookieResponse, { error: "الاستيراد التاريخي متاح للأدمن فقط.", code: "E_FORBIDDEN" }, 403);
  }

  let rawBody: string;
  try {
    rawBody = await readUtf8RequestBodyWithLimit(request, HISTORICAL_IMPORT_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return responseWithCookies(cookieResponse, { error: "حجم الطلب يتجاوز 2 MiB.", code: "E_PAYLOAD_TOO_LARGE" }, 413);
    }
    return responseWithCookies(cookieResponse, {
      error: "تعذر قراءة طلب الاستيراد. رمز التشخيص: HISTORICAL_IMPORT_BODY.",
      code: "E_SERVER",
    }, 500);
  }

  let body: ImportRequestBody;
  try {
    body = JSON.parse(rawBody) as ImportRequestBody;
  } catch {
    return responseWithCookies(cookieResponse, { error: "بيانات طلب الاستيراد غير صحيحة.", code: "E_INVALID_INPUT" }, 400);
  }

  const action = body.action === "preview" || body.action === "apply" ? body.action as ImportAction : null;
  const csvText = safeString(body.csv_text);
  const sourceFilename = safeString(body.source_filename)?.trim() ?? "";
  const providedChecksum = safeString(body.source_sha256)?.trim().toLowerCase() ?? "";
  const reason = safeString(body.reason)?.trim() ?? "";
  const confirmation = safeString(body.confirmation) ?? "";
  const previewToken = safeString(body.preview_token)?.trim() || null;

  if (!action || csvText == null || !sourceFilename) {
    return responseWithCookies(cookieResponse, { error: "بيانات طلب الاستيراد غير مكتملة.", code: "E_INVALID_INPUT" }, 400);
  }
  if (Buffer.byteLength(csvText, "utf8") > HISTORICAL_IMPORT_MAX_BYTES) {
    return responseWithCookies(cookieResponse, { error: "حجم ملف CSV يتجاوز 2 MiB.", code: "E_FILE_TOO_LARGE" }, 413);
  }

  const calculatedChecksum = createHash("sha256").update(csvText, "utf8").digest("hex");
  if (!checksumsMatch(providedChecksum, calculatedChecksum)) {
    return responseWithCookies(cookieResponse, { error: "بصمة الملف لا تطابق محتواه الحالي.", code: "E_CHECKSUM_MISMATCH" }, 400);
  }

  const parsed = parseHistoricalCsv(csvText);
  if (!parsed.ok) {
    return responseWithCookies(cookieResponse, { error: "تعذر قراءة ملف CSV.", code: "E_CSV", errors: parsed.errors }, 400);
  }

  if (action === "apply") {
    if (confirmation !== HISTORICAL_IMPORT_CONFIRMATION) {
      return responseWithCookies(cookieResponse, { error: "عبارة التأكيد غير مطابقة.", code: "E_CONFIRMATION" }, 400);
    }
    if (reason.length < 5 || reason.length > 500) {
      return responseWithCookies(cookieResponse, { error: "سبب الاستيراد يجب أن يكون بين 5 و500 محرف.", code: "E_REASON" }, 400);
    }
    if (!previewToken) {
      return responseWithCookies(cookieResponse, { error: "يجب إجراء معاينة مطابقة قبل التطبيق.", code: "E_PREVIEW_REQUIRED" }, 400);
    }
  }

  try {
    const rpc = auth.supabase.rpc.bind(auth.supabase) as unknown as ImportRpc;
    const { data, error } = await rpc("admin_import_historical_items", {
      p_rows: historicalRowsToJson(parsed.rows),
      p_source_filename: sourceFilename,
      p_source_sha256: calculatedChecksum,
      p_reason: reason,
      p_dry_run: action === "preview",
      p_preview_token: action === "apply" ? previewToken : null,
    });

    if (error || !data) {
      return responseWithCookies(cookieResponse, {
        error: safeHistoricalImportError(error?.message),
        code: "E_HISTORICAL_IMPORT",
      }, 400);
    }
    return responseWithCookies(cookieResponse, { result: data });
  } catch {
    return responseWithCookies(cookieResponse, {
      error: "تعذر تنفيذ طلب الاستيراد. رمز التشخيص: HISTORICAL_IMPORT_SERVER.",
      code: "E_SERVER",
    }, 500);
  }
}
