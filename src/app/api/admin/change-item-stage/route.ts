import { NextResponse, type NextRequest } from "next/server";
import type { Database, Tables } from "@/lib/database.types";
import { createRouteClient } from "@/lib/supabase/route";

type ItemRow = Tables<"items">;
type ItemStatus = Database["public"]["Enums"]["item_status"];

type AdminStagePayload = {
  itemId: string;
  target: ItemStatus;
  reason: string;
  clearSlot: boolean;
};

type AdminStageRpc = (
  fn: "admin_change_item_stage",
  args: {
    p_item: string;
    p_to: ItemStatus;
    p_reason: string;
    p_clear_slot: boolean;
  },
) => PromiseLike<{ data: ItemRow | null; error: { message?: string } | null }>;

const allowedTargets = new Set<ItemStatus>([
  "idea",
  "writing",
  "content_approved",
  "in_production",
  "design_approved",
  "ready",
  "cancelled",
]);

const authError = "تعذر تغيير المرحلة. أعد تسجيل الدخول. رمز التشخيص: ADMIN_STAGE_AUTH";
const inputError = "تعذر تغيير المرحلة. تحقق من المدخلات. رمز التشخيص: ADMIN_STAGE_INPUT";
const rpcError = "تعذر تغيير المرحلة. حاول مجددًا. رمز التشخيص: ADMIN_STAGE_RPC";
const serverError = "تعذر تغيير المرحلة. حاول مجددًا. رمز التشخيص: ADMIN_STAGE_SERVER";

export const dynamic = "force-dynamic";

function jsonWithCookies(source: NextResponse, body: { item: ItemRow | null } | { error: string }, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  for (const cookie of source.cookies.getAll()) {
    const { name, value, ...options } = cookie;
    response.cookies.set(name, value, options);
  }
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

function isPayload(value: unknown): value is AdminStagePayload {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;
  return (
    typeof body.itemId === "string" &&
    body.itemId.length > 0 &&
    typeof body.target === "string" &&
    allowedTargets.has(body.target as ItemStatus) &&
    typeof body.reason === "string" &&
    typeof body.clearSlot === "boolean"
  );
}

export async function POST(request: NextRequest) {
  const cookieResponse = NextResponse.next();

  if (!isSameOrigin(request)) {
    return jsonWithCookies(cookieResponse, { error: authError }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonWithCookies(cookieResponse, { error: inputError }, { status: 400 });
  }

  if (!isPayload(body)) {
    return jsonWithCookies(cookieResponse, { error: inputError }, { status: 400 });
  }

  const supabase = createRouteClient(request, cookieResponse);
  const userResult = await supabase.auth.getUser();
  if (userResult.error || !userResult.data.user) {
    return jsonWithCookies(cookieResponse, { error: authError }, { status: 401 });
  }

  try {
    const rpc = supabase.rpc.bind(supabase) as unknown as AdminStageRpc;
    const { data, error } = await rpc("admin_change_item_stage", {
      p_item: body.itemId,
      p_to: body.target,
      p_reason: body.reason,
      p_clear_slot: body.clearSlot,
    });

    if (error) {
      return jsonWithCookies(cookieResponse, { error: rpcError }, { status: 400 });
    }

    return jsonWithCookies(cookieResponse, { item: data }, { status: 200 });
  } catch {
    return jsonWithCookies(cookieResponse, { error: serverError }, { status: 500 });
  }
}
