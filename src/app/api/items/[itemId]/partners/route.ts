import { NextResponse, type NextRequest } from "next/server";
import { getItemPermissions } from "@/lib/item-permissions";
import { requireActiveRouteProfile } from "@/lib/route-auth";

type Params = { params: Promise<{ itemId: string }> };

type PartnerRecord = {
  partner_id: number;
  partners: { name: string } | { name: string }[] | null;
};

function responseWithCookies(body: object, status: number, source: NextResponse) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

function sameOrigin(request: NextRequest) {
  return request.headers.get("origin") === request.nextUrl.origin;
}

function parsePartnerIds(value: unknown) {
  if (!Array.isArray(value)) return null;
  const ids = value.map((item) => Number(item));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0 || id > 32767)) return null;
  return Array.from(new Set(ids));
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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return responseWithCookies({ error: "البيانات المدخلة غير صحيحة.", code: "E_INVALID_INPUT" }, 400, cookieResponse);
  }

  const record = body as Record<string, unknown>;
  const partnerIds = parsePartnerIds(record.partnerIds);
  const newPartner = typeof record.newPartner === "string" ? record.newPartner : "";
  if (!partnerIds) {
    return responseWithCookies({ error: "اختر شركاء صحيحين.", code: "E_INVALID_PARTNERS" }, 400, cookieResponse);
  }

  const { data: item, error: itemError } = await auth.supabase
    .from("items")
    .select("id, is_archived")
    .eq("id", itemId)
    .single();

  if (itemError || !item) {
    return responseWithCookies({ error: "المادة غير موجودة.", code: "E_ITEM_NOT_FOUND" }, 404, cookieResponse);
  }

  const permissions = getItemPermissions({ profile: auth.profile, item, participantParts: [] });
  if (!permissions.canManagePartners) {
    return responseWithCookies({ error: "إدارة الشركاء تحتاج مسؤول النشر أو الأدمن.", code: "E_FORBIDDEN" }, 403, cookieResponse);
  }

  const { error } = await auth.supabase.rpc("save_item_partners", {
    p_item: itemId,
    p_partner_ids: partnerIds,
    p_new_partner_name: newPartner,
  });

  if (error) {
    return responseWithCookies({ error: "تعذر حفظ الشركاء.", code: "E_PARTNERS_SAVE" }, 400, cookieResponse);
  }

  const { data: partners, error: readError } = await auth.supabase
    .from("item_partners")
    .select("partner_id, partners(name)")
    .eq("item_id", itemId);

  if (readError) {
    return responseWithCookies({ error: "تم الحفظ وتعذر تحديث العرض.", code: "E_PARTNERS_READ" }, 200, cookieResponse);
  }

  return responseWithCookies({ partners: (partners ?? []) as unknown as PartnerRecord[] }, 200, cookieResponse);
}
