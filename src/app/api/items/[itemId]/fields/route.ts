import { NextResponse, type NextRequest } from "next/server";
import { getItemPermissions, validateItemFieldPatch } from "@/lib/item-permissions";
import { requireActiveRouteProfile } from "@/lib/route-auth";
import type { Json, Tables } from "@/lib/database.types";

type ItemRow = Tables<"items">;
type ParticipantRow = Pick<Tables<"item_participants">, "part">;
type Params = { params: Promise<{ itemId: string }> };

function responseWithCookies(body: object, status: number, source: NextResponse) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

function sameOrigin(request: NextRequest) {
  return request.headers.get("origin") === request.nextUrl.origin;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const cookieResponse = NextResponse.next();
  if (!sameOrigin(request)) {
    return responseWithCookies({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403, cookieResponse);
  }

  const auth = await requireActiveRouteProfile(request, cookieResponse);
  if (!auth.ok) return responseWithCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, cookieResponse);

  const { itemId } = await params;
  const body: unknown = await request.json().catch(() => null);

  const [itemResult, participantResult] = await Promise.all([
    auth.supabase.from("items").select("id, is_archived").eq("id", itemId).single(),
    auth.supabase.from("item_participants").select("part").eq("item_id", itemId).eq("user_id", auth.user.id),
  ]);

  if (itemResult.error || !itemResult.data) {
    return responseWithCookies({ error: "المادة غير موجودة.", code: "E_ITEM_NOT_FOUND" }, 404, cookieResponse);
  }
  if (participantResult.error) {
    return responseWithCookies({ error: "تعذر التحقق من صلاحيات المادة.", code: "E_PERMISSION_CHECK" }, 500, cookieResponse);
  }

  const participantParts = ((participantResult.data ?? []) as ParticipantRow[]).map((row) => row.part);
  const validation = validateItemFieldPatch({
    profile: auth.profile,
    item: itemResult.data,
    participantParts,
  }, body);

  if (!validation.ok) {
    return responseWithCookies({
      error: validation.code === "E_FIELD_FORBIDDEN" ? "لا تملك صلاحية تعديل واحد أو أكثر من هذه الحقول." : "البيانات المدخلة غير صحيحة.",
      code: validation.code,
      fields: validation.fields,
    }, validation.code === "E_FIELD_FORBIDDEN" ? 403 : 400, cookieResponse);
  }

  const permissions = getItemPermissions({ profile: auth.profile, item: itemResult.data, participantParts });
  if (permissions.editableFields.length === 0) {
    return responseWithCookies({ error: "لا تملك صلاحية تعديل حقول هذه المادة.", code: "E_FORBIDDEN" }, 403, cookieResponse);
  }

  const { data, error } = await auth.supabase.rpc("save_item_fields", {
    p_item: itemId,
    p_fields: validation.fields as Record<string, Json>,
  });

  if (error || !data) {
    return responseWithCookies({ error: "تعذر حفظ التعديلات.", code: "E_ITEM_SAVE" }, 400, cookieResponse);
  }

  return responseWithCookies({ item: data as ItemRow }, 200, cookieResponse);
}
