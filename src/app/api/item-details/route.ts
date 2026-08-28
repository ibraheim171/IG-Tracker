import { NextResponse, type NextRequest } from "next/server";
import type { Tables } from "@/lib/database.types";
import { createRouteClient } from "@/lib/supabase/route";
import { extractMessage } from "@/lib/ui-data";

type ItemRow = Tables<"items">;
type PerformanceRow = Tables<"v_item_performance">;
type ParticipantPart = Tables<"item_participants">["part"];

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
};

export const dynamic = "force-dynamic";

function jsonWithCookies(source: NextResponse, body: { details: DrawerDetails } | { error: string }, init?: ResponseInit) {
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
  const supabase = createRouteClient(request, cookieResponse);
  const itemId = request.nextUrl.searchParams.get("itemId");

  if (!itemId) {
    return jsonWithCookies(cookieResponse, { error: "معرّف المادة مطلوب." }, { status: 400 });
  }

  const userResult = await supabase.auth.getUser();
  if (userResult.error || !userResult.data.user) {
    return jsonWithCookies(cookieResponse, { error: "انتهت الجلسة. سجّل الدخول مرة أخرى." }, { status: 401 });
  }

  try {
    const [itemResult, participantsResult, partnersResult, approvalsResult] = await Promise.all([
      supabase.from("items").select("*").eq("id", itemId).abortSignal(request.signal).single(),
      supabase.from("item_participants").select("user_id, part, profiles(display_name)").eq("item_id", itemId).abortSignal(request.signal),
      supabase.from("item_partners").select("partner_id, partners(name)").eq("item_id", itemId).abortSignal(request.signal),
      supabase.from("approvals").select("gate, result").eq("item_id", itemId).abortSignal(request.signal),
    ]);

    if (itemResult.error) {
      return jsonWithCookies(cookieResponse, { error: extractMessage(itemResult.error) }, { status: itemResult.status === 406 ? 404 : itemResult.status });
    }

    const relationError = participantsResult.error ?? partnersResult.error ?? approvalsResult.error;
    if (relationError) {
      return jsonWithCookies(cookieResponse, { error: extractMessage(relationError) }, { status: 500 });
    }

    const item = itemResult.data;
    const shouldLoadPerformance = item.status === "published";
    const shouldLoadOpenSlots = item.status !== "published" && !item.slot_id;

    const [performanceResult, slotsResult] = await Promise.all([
      shouldLoadPerformance
        ? supabase.from("v_item_performance").select("*").eq("id", itemId).abortSignal(request.signal).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      shouldLoadOpenSlots
        ? supabase.from("v_slot_board").select("slot_id, slot_at, state, n_items").gte("slot_at", new Date().toISOString()).order("slot_at", { ascending: true }).limit(24).abortSignal(request.signal)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const details: DrawerDetails = {
      item,
      participants: (participantsResult.data ?? []) as unknown as ParticipantRecord[],
      partners: (partnersResult.data ?? []) as unknown as PartnerRecord[],
      approvals: approvalsResult.data ?? [],
      performance: performanceResult.error ? null : performanceResult.data,
      openSlots: slotsResult.error ? [] : slotsResult.data ?? [],
    };

    return jsonWithCookies(cookieResponse, { details });
  } catch (error) {
    if (request.signal.aborted) {
      return jsonWithCookies(cookieResponse, { error: "توقف تحميل تفاصيل البطاقة." }, { status: 499 });
    }

    return jsonWithCookies(cookieResponse, { error: extractMessage(error) }, { status: 500 });
  }
}
