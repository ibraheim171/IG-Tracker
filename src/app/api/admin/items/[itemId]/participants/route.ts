import { NextResponse, type NextRequest } from "next/server";
import { safeRpcError } from "@/lib/admin-create-item";
import { requireActiveRouteProfile } from "@/lib/route-auth";
import type { Json, Tables } from "@/lib/database.types";

type ParticipantPart = Tables<"item_participants">["part"];
type Params = { params: Promise<{ itemId: string }> };

type AssignmentBody = {
  writer_id?: unknown;
  producer_id?: unknown;
  reviewer_id?: unknown;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function responseWithCookies(body: object, status: number, source: NextResponse) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function optionalUuid(value: unknown) {
  if (value == null || value === "") return null;
  return typeof value === "string" && uuidPattern.test(value) ? value : undefined;
}

function validateBody(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false as const, error: "بيانات التعيينات غير صحيحة." };
  }

  const body = input as AssignmentBody;
  const keys = Object.keys(body);
  const forbidden = keys.filter((key) => !["writer_id", "producer_id", "reviewer_id"].includes(key));
  if (forbidden.length > 0) return { ok: false as const, error: "يحتوي الطلب على حقول غير مسموحة." };

  const writer = optionalUuid(body.writer_id);
  if (!writer) return { ok: false as const, error: "اختر الكاتب المسؤول." };

  const producer = optionalUuid(body.producer_id);
  if (producer === undefined) return { ok: false as const, error: "المنتج المختار غير صحيح." };

  const reviewer = optionalUuid(body.reviewer_id);
  if (reviewer === undefined) return { ok: false as const, error: "المراجع المختار غير صحيح." };

  return { ok: true as const, value: { writer, producer, reviewer } };
}

function assignmentRows(value: Json): { user_id: string; part: ParticipantPart }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const record = row as Record<string, unknown>;
    const userId = typeof record.user_id === "string" ? record.user_id : null;
    const part = record.part === "writer" || record.part === "producer" || record.part === "reviewer" ? record.part : null;
    return userId && part ? [{ user_id: userId, part }] : [];
  });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const cookieResponse = NextResponse.next();
  if (!isSameOrigin(request)) {
    return responseWithCookies({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403, cookieResponse);
  }

  const auth = await requireActiveRouteProfile(request, cookieResponse);
  if (!auth.ok) return responseWithCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, cookieResponse);

  if (!auth.profile.roles.includes("admin")) {
    return responseWithCookies({ error: "تعديل تعيينات المادة متاح للأدمن فقط.", code: "E_ADMIN_REQUIRED" }, 403, cookieResponse);
  }

  const body = validateBody(await request.json().catch(() => null));
  if (!body.ok) return responseWithCookies({ error: body.error, code: "E_INVALID_PAYLOAD" }, 400, cookieResponse);

  const { itemId } = await params;
  const { data, error } = await auth.supabase.rpc("admin_save_item_assignments", {
    p_item: itemId,
    p_writer: body.value.writer,
    p_producer: body.value.producer,
    p_reviewer: body.value.reviewer,
  });

  if (error) {
    return responseWithCookies({
      error: safeRpcError(error.message, "تعذر حفظ تعيينات المادة. رمز التشخيص: ITEM_ASSIGNMENTS_SAVE."),
      code: "E_ASSIGNMENTS_SAVE",
    }, 400, cookieResponse);
  }

  return responseWithCookies({ participants: assignmentRows(data) }, 200, cookieResponse);
}
