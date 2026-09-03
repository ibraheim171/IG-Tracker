import { NextResponse, type NextRequest } from "next/server";
import type { Tables } from "@/lib/database.types";
import { safeRpcError, validateAdminCreateTrackPayload } from "@/lib/admin-create-item";
import { requireActiveRouteProfile } from "@/lib/route-auth";

type TrackRow = Tables<"tracks">;

type CreateTrackRpc = (
  fn: "admin_create_track",
  args: { p_name: string; p_color_hex: string; p_sort_order: number | null },
) => PromiseLike<{ data: TrackRow | null; error: { message?: string } | null }>;

export const dynamic = "force-dynamic";

function jsonWithCookies(source: NextResponse, body: { track: TrackRow } | { error: string; code?: string }, init?: ResponseInit) {
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
    return jsonWithCookies(cookieResponse, { error: "غير مصرح لك بإنشاء المسارات.", code: "E_FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const validation = validateAdminCreateTrackPayload(body);
  if (!validation.ok) {
    return jsonWithCookies(cookieResponse, { error: validation.message, code: validation.code }, { status: 400 });
  }

  try {
    const rpc = auth.supabase.rpc.bind(auth.supabase) as unknown as CreateTrackRpc;
    const { data, error } = await rpc("admin_create_track", {
      p_name: validation.value.name,
      p_color_hex: validation.value.color_hex ?? "#1E8F8B",
      p_sort_order: validation.value.sort_order ?? null,
    });

    if (error || !data) {
      return jsonWithCookies(cookieResponse, {
        error: safeRpcError(error?.message, "تعذر إنشاء المسار. رمز التشخيص: TRACK_CREATE_RPC."),
        code: "E_TRACK_CREATE",
      }, { status: 400 });
    }

    return jsonWithCookies(cookieResponse, { track: data }, { status: 200 });
  } catch {
    return jsonWithCookies(cookieResponse, { error: "تعذر إنشاء المسار. رمز التشخيص: TRACK_CREATE_SERVER.", code: "E_SERVER" }, { status: 500 });
  }
}
