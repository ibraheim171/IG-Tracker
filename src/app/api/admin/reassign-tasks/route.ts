import { NextResponse, type NextRequest } from "next/server";
import type { Json } from "@/lib/database.types";
import { normalizeOperationalParts, toReassignTasksResult, type OperationalPart, type ReassignTasksResult } from "@/lib/admin-reassign-tasks";
import { requireActiveRouteProfile } from "@/lib/route-auth";

type ReassignPayload = {
  sourceUserId: string;
  targetUserId: string;
  parts: OperationalPart[];
  reason?: string;
  dryRun: boolean;
};

type ReassignRpc = (
  fn: "admin_reassign_tasks",
  args: {
    p_source: string;
    p_target: string;
    p_parts: OperationalPart[];
    p_reason: string | null;
    p_dry_run: boolean;
  },
) => PromiseLike<{ data: Json | null; error: { message?: string } | null }>;

const inputError = "تعذر تجهيز نقل المهام. تحقق من المدخلات.";
const forbiddenError = "غير مصرح لك بنقل المهام.";
const rpcError = "تعذر نقل المهام. حاول مجددًا.";

export const dynamic = "force-dynamic";

function jsonWithCookies(source: NextResponse, body: ReassignTasksResult | { error: string; code?: string }, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
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

function isPayload(value: unknown): value is ReassignPayload {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  const parts = normalizeOperationalParts(body.parts);
  return typeof body.sourceUserId === "string"
    && body.sourceUserId.length > 0
    && typeof body.targetUserId === "string"
    && body.targetUserId.length > 0
    && Array.isArray(body.parts)
    && parts.length === body.parts.length
    && parts.length > 0
    && typeof body.dryRun === "boolean"
    && (body.reason === undefined || typeof body.reason === "string");
}

function safeRpcMessage(message: string | undefined) {
  if (!message) return rpcError;
  for (const marker of ["ROLE_REQUIRED:", "INVALID_INPUT:", "SOURCE_NOT_FOUND:", "TARGET_NOT_FOUND:", "TARGET_INACTIVE:", "PARTS_REQUIRED:", "TARGET_ROLE_REQUIRED:", "REASON_REQUIRED:", "REASON_TOO_LONG:"]) {
    const index = message.indexOf(marker);
    if (index >= 0) {
      const safe = message.slice(index + marker.length).trim();
      if (safe) return safe;
    }
  }
  return rpcError;
}

export async function POST(request: NextRequest) {
  const cookieResponse = NextResponse.next();

  if (!isSameOriginMutation(request)) {
    return jsonWithCookies(cookieResponse, { error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonWithCookies(cookieResponse, { error: inputError, code: "E_INVALID_INPUT" }, { status: 400 });
  }

  if (!isPayload(body)) {
    return jsonWithCookies(cookieResponse, { error: inputError, code: "E_INVALID_INPUT" }, { status: 400 });
  }

  const auth = await requireActiveRouteProfile(request, cookieResponse);
  if (!auth.ok) return jsonWithCookies(cookieResponse, { error: auth.error.message, code: auth.error.code }, { status: auth.error.status });
  if (!auth.profile.roles.includes("admin")) {
    return jsonWithCookies(cookieResponse, { error: forbiddenError, code: "E_FORBIDDEN" }, { status: 403 });
  }

  const parts = normalizeOperationalParts(body.parts);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!body.dryRun && (reason.length < 5 || reason.length > 500)) {
    return jsonWithCookies(cookieResponse, { error: "سبب النقل يجب أن يكون بين 5 و500 حرف.", code: "E_REASON" }, { status: 400 });
  }

  try {
    const rpc = auth.supabase.rpc.bind(auth.supabase) as unknown as ReassignRpc;
    const { data, error } = await rpc("admin_reassign_tasks", {
      p_source: body.sourceUserId,
      p_target: body.targetUserId,
      p_parts: parts,
      p_reason: reason || null,
      p_dry_run: body.dryRun,
    });

    if (error) {
      return jsonWithCookies(cookieResponse, { error: safeRpcMessage(error.message), code: "E_RPC" }, { status: 400 });
    }

    const result = toReassignTasksResult(data);
    if (!result) {
      return jsonWithCookies(cookieResponse, { error: rpcError, code: "E_RPC_RESULT" }, { status: 400 });
    }
    if (!result.ok) {
      return jsonWithCookies(cookieResponse, { error: rpcError, code: result.error ?? "E_RPC" }, { status: 400 });
    }

    return jsonWithCookies(cookieResponse, result, { status: 200 });
  } catch {
    return jsonWithCookies(cookieResponse, { error: "تعذر نقل المهام. رمز التشخيص: REASSIGN_SERVER.", code: "E_SERVER" }, { status: 500 });
  }
}
