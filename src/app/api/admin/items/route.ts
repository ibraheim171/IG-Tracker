import { NextResponse, type NextRequest } from "next/server";
import type { Json, Tables } from "@/lib/database.types";
import { safeRpcError, toRpcJson, validateAdminCreateItemPayload } from "@/lib/admin-create-item";
import { requireActiveRouteProfile } from "@/lib/route-auth";

type ItemRow = Tables<"items">;

type CreateItemRpc = (
  fn: "admin_create_item",
  args: { p_fields: Json },
) => PromiseLike<{ data: ItemRow | null; error: { message?: string } | null }>;

export const dynamic = "force-dynamic";

function jsonWithCookies(source: NextResponse, body: { item: ItemRow } | { error: string; code?: string }, init?: ResponseInit) {
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

export async function POST(request: NextRequest) {
  const cookieResponse = NextResponse.next();

  if (!isSameOriginMutation(request)) {
    return jsonWithCookies(cookieResponse, { error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, { status: 403 });
  }

  const auth = await requireActiveRouteProfile(request, cookieResponse);
  if (!auth.ok) return jsonWithCookies(cookieResponse, { error: auth.error.message, code: auth.error.code }, { status: auth.error.status });
  if (!auth.profile.roles.includes("admin")) {
    return jsonWithCookies(cookieResponse, { error: "غير مصرح لك بإنشاء المواد.", code: "E_FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const validation = validateAdminCreateItemPayload(body);
  if (!validation.ok) {
    return jsonWithCookies(cookieResponse, { error: validation.message, code: validation.code }, { status: 400 });
  }

  try {
    const rpc = auth.supabase.rpc.bind(auth.supabase) as unknown as CreateItemRpc;
    const { data, error } = await rpc("admin_create_item", { p_fields: toRpcJson(validation.value) });

    if (error || !data) {
      return jsonWithCookies(cookieResponse, {
        error: safeRpcError(error?.message, "تعذر إنشاء المادة. رمز التشخيص: ITEM_CREATE_RPC."),
        code: "E_ITEM_CREATE",
      }, { status: 400 });
    }

    return jsonWithCookies(cookieResponse, { item: data }, { status: 200 });
  } catch {
    return jsonWithCookies(cookieResponse, { error: "تعذر إنشاء المادة. رمز التشخيص: ITEM_CREATE_SERVER.", code: "E_SERVER" }, { status: 500 });
  }
}
