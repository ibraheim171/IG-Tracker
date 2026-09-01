import { NextResponse, type NextRequest } from "next/server";
import type { Tables } from "@/lib/database.types";
import { requireActiveRouteProfile } from "@/lib/route-auth";

type ItemRow = Tables<"items">;
type PerformanceRow = Tables<"v_item_performance">;
type ParticipantPart = Tables<"item_participants">["part"];
type CurrentSlot = Pick<Tables<"publishing_slots">, "id" | "slot_at" | "state">;

type ParticipantRecord = {
  user_id: string;
  part: ParticipantPart;
  profiles: { display_name: string } | { display_name: string }[] | null;
};

type PartnerRecord = {
  partner_id: number;
  partners: { name: string } | { name: string }[] | null;
};

type ApprovalRecord = Pick<Tables<"approvals">, "gate" | "result">;
type OpenSlot = Pick<Tables<"v_slot_board">, "slot_id" | "slot_at" | "state" | "n_items">;

type DrawerDetails = {
  item: ItemRow;
  participants: ParticipantRecord[];
  partners: PartnerRecord[];
  approvals: ApprovalRecord[];
  performance: PerformanceRow | null;
  openSlots: OpenSlot[];
  currentSlot: CurrentSlot | null;
};

export const dynamic = "force-dynamic";

function itemDetailsError(code: string) {
  return `تعذر تحميل تفاصيل المادة. حاول مرة أخرى. رمز التشخيص: ${code}.`;
}

function jsonWithCookies(source: NextResponse, body: { details: DrawerDetails } | { error: string; code?: string }, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  for (const cookie of source.cookies.getAll()) {
    const { name, value, ...options } = cookie;
    response.cookies.set(name, value, options);
  }
  return response;
}

export async function GET(request: NextRequest) {
  const cookieResponse = NextResponse.next();
  const itemId = request.nextUrl.searchParams.get("itemId");

  if (!itemId) {
    return jsonWithCookies(cookieResponse, { error: "معرّف المادة مطلوب." }, { status: 400 });
  }

  const auth = await requireActiveRouteProfile(request, cookieResponse);
  if (!auth.ok) return jsonWithCookies(cookieResponse, { error: auth.error.message, code: auth.error.code }, { status: auth.error.status });
  const { supabase } = auth;

  try {
    const [itemResult, participantsResult, partnersResult, approvalsResult] = await Promise.all([
      supabase.from("items").select("*").eq("id", itemId).abortSignal(request.signal).single(),
      supabase.from("item_participants").select("user_id, part, profiles:profiles!item_participants_user_id_fkey(display_name)").eq("item_id", itemId).abortSignal(request.signal),
      supabase.from("item_partners").select("partner_id, partners(name)").eq("item_id", itemId).abortSignal(request.signal),
      supabase.from("approvals").select("gate, result").eq("item_id", itemId).abortSignal(request.signal),
    ]);

    if (itemResult.error) {
      return jsonWithCookies(cookieResponse, { error: itemDetailsError("ITEM_DETAILS_ITEM") }, { status: itemResult.status === 406 ? 404 : itemResult.status });
    }

    const relationError = participantsResult.error ?? partnersResult.error ?? approvalsResult.error;
    if (relationError) {
      return jsonWithCookies(cookieResponse, { error: itemDetailsError("ITEM_DETAILS_RELATION") }, { status: 500 });
    }

    const item = itemResult.data;
    const currentSlotId = item.slot_id;
    const shouldLoadPerformance = item.status === "published";
    const shouldLoadOpenSlots = item.status !== "published" && !currentSlotId;

    const [performanceResult, slotsResult, currentSlotResult] = await Promise.all([
      shouldLoadPerformance
        ? supabase.from("v_item_performance").select("*").eq("id", itemId).abortSignal(request.signal).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      shouldLoadOpenSlots
        ? supabase.from("v_slot_board").select("slot_id, slot_at, state, n_items").gte("slot_at", new Date().toISOString()).order("slot_at", { ascending: true }).limit(24).abortSignal(request.signal)
        : Promise.resolve({ data: [], error: null }),
      currentSlotId
        ? supabase.from("publishing_slots").select("id, slot_at, state").eq("id", currentSlotId).abortSignal(request.signal).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (currentSlotId && (currentSlotResult.error || !currentSlotResult.data)) {
      return jsonWithCookies(cookieResponse, { error: "تعذر تحميل موعد النشر المرتبط. أعد المحاولة قبل تغيير المرحلة." }, { status: 500 });
    }

    const details: DrawerDetails = {
      item,
      participants: (participantsResult.data ?? []) as unknown as ParticipantRecord[],
      partners: (partnersResult.data ?? []) as unknown as PartnerRecord[],
      approvals: approvalsResult.data ?? [],
      performance: performanceResult.error ? null : performanceResult.data,
      openSlots: slotsResult.error ? [] : slotsResult.data ?? [],
      currentSlot: currentSlotResult.error ? null : currentSlotResult.data,
    };

    return jsonWithCookies(cookieResponse, { details });
  } catch {
    if (request.signal.aborted) {
      return jsonWithCookies(cookieResponse, { error: "توقف تحميل تفاصيل البطاقة." }, { status: 499 });
    }

    return jsonWithCookies(cookieResponse, { error: itemDetailsError("ITEM_DETAILS_SERVER") }, { status: 500 });
  }
}
