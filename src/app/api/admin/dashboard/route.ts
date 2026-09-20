import { NextRequest, NextResponse } from "next/server";
import { requireAnalyticsAdmin } from "@/lib/analytics-auth";
import { analyticsServiceClient } from "@/lib/analytics-server";
import { buildAdminDashboardSnapshot, type AdminDashboardItem, type AdminDashboardStatus, type AdminTransition } from "@/lib/admin-dashboard";
import { currentWeekRange, insightUtcBounds } from "@/lib/insights";
import { currentOwnerParts } from "@/lib/workflow-ui";

function withCookies(body: object, status: number, source: NextResponse) {
  const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

function isSameOriginRead(request: NextRequest) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  try {
    if (origin) return new URL(origin).origin === request.nextUrl.origin;
    if (referer) return new URL(referer).origin === request.nextUrl.origin;
  } catch { return false; }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

type ParticipantRow = {
  part: "writer" | "producer" | "reviewer";
  profiles: { display_name: string } | { display_name: string }[] | null;
};

type ItemRow = {
  id: string;
  ref: string;
  title: string;
  status: AdminDashboardStatus;
  is_archived: boolean;
  published_at: string | null;
  slot_id: string | null;
  ig_media_id: string | null;
  updated_at: string;
  item_participants: ParticipantRow[];
};

function participantName(value: ParticipantRow["profiles"]) {
  return Array.isArray(value) ? value[0]?.display_name ?? null : value?.display_name ?? null;
}

type ServiceClient = ReturnType<typeof analyticsServiceClient>;
const pageSize = 500;

async function loadAllDashboardItems(service: ServiceClient) {
  const rows: ItemRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await service.from("items")
      .select("id,ref,title,status,is_archived,published_at,slot_id,ig_media_id,updated_at,item_participants(part,profiles:profiles!item_participants_user_id_fkey(display_name))")
      .eq("is_archived", false).neq("status", "cancelled").order("id").range(from, from + pageSize - 1);
    if (result.error) return { data: [] as ItemRow[], error: result.error };
    const page = result.data as unknown as ItemRow[];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

async function loadTransitions(service: ServiceClient, itemIds: string[]) {
  const rows: AdminTransition[] = [];
  for (const batch of chunks(itemIds, 100)) {
    for (let from = 0; ; from += 1000) {
      const result = await service.from("transitions").select("id,item_id,to_status,created_at").in("item_id", batch).order("id").range(from, from + 999);
      if (result.error) return { data: [] as AdminTransition[], error: result.error };
      const page = (result.data ?? []).map((row) => ({ item_id: row.item_id, to_status: row.to_status, created_at: row.created_at }));
      rows.push(...page);
      if (page.length < 1000) break;
    }
  }
  return { data: rows, error: null };
}

export async function GET(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  if (!isSameOriginRead(request)) return withCookies({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403, sessionResponse);
  const auth = await requireAnalyticsAdmin(request, sessionResponse);
  if (!auth.ok) return withCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, sessionResponse);
  let service;
  try { service = analyticsServiceClient(); } catch { return withCookies({ error: "خدمة لوحة الأدمن غير مهيأة في هذه البيئة.", code: "E_SERVER_CONFIG" }, 503, sessionResponse); }
  const now = new Date().toISOString();
  const itemsResult = await loadAllDashboardItems(service);
  if (itemsResult.error) return withCookies({ error: "تعذر تحميل لوحة الأدمن. حاول مرة أخرى.", code: "E_ADMIN_DASHBOARD_LOAD" }, 503, sessionResponse);
  const itemRows = itemsResult.data;
  const itemIds = itemRows.map((item) => item.id);
  const slotIds = [...new Set(itemRows.flatMap((item) => item.slot_id ? [item.slot_id] : []))];
  const weekBounds = insightUtcBounds(currentWeekRange(new Date(now)));
  const [slotsResult, transitionsResult, syncResult, slotResults, linkResults] = await Promise.all([
    service.from("v_slot_board").select("slot_id,slot_at,n_ready").gte("slot_at", weekBounds.start).lt("slot_at", weekBounds.endExclusive).order("slot_at", { ascending: true }),
    loadTransitions(service, itemIds),
    service.from("analytics_sync_runs").select("source_timestamp,received_at,status").order("received_at", { ascending: false }).limit(1).maybeSingle(),
    Promise.all(chunks(slotIds, 100).map((batch) => service.from("publishing_slots").select("id,slot_at").in("id", batch))),
    Promise.all(chunks(itemIds, 100).map((batch) => service.from("ig_item_links").select("item_id").in("item_id", batch))),
  ]);
  if (slotsResult.error || transitionsResult.error || syncResult.error || slotResults.some((result) => result.error) || linkResults.some((result) => result.error)) {
    return withCookies({ error: "تعذر تحميل لوحة الأدمن. حاول مرة أخرى.", code: "E_ADMIN_DASHBOARD_LOAD" }, 503, sessionResponse);
  }
  const slotRows = slotResults.flatMap((result) => result.data ?? []);
  const linkRows = linkResults.flatMap((result) => result.data ?? []);
  const slotAtById = new Map(slotRows.map((slot) => [slot.id, slot.slot_at]));
  const items = itemRows.map((item): AdminDashboardItem => {
    const ownerParts = currentOwnerParts(item.status);
    return {
      id: item.id,
      ref: item.ref,
      title: item.title,
      status: item.status,
      is_archived: item.is_archived,
      published_at: item.published_at,
      slot_id: item.slot_id,
      slot_at: item.slot_id ? slotAtById.get(item.slot_id) ?? null : null,
      ig_media_id: item.ig_media_id,
      updated_at: item.updated_at,
      assignees: item.item_participants
        .filter((participant) => ownerParts.includes(participant.part))
        .flatMap((participant) => participantName(participant.profiles) ?? []),
    };
  });
  const slots = (slotsResult.data ?? []).flatMap((slot) => slot.slot_id && slot.slot_at ? [{
    slot_id: slot.slot_id,
    slot_at: slot.slot_at,
    n_ready: slot.n_ready ?? 0,
  }] : []);
  const snapshot = buildAdminDashboardSnapshot({
    now,
    items,
    slots,
    linkedItemIds: linkRows.map((row) => row.item_id),
    latestSync: syncResult.data ?? null,
    transitions: transitionsResult.data,
  });
  return withCookies({ snapshot }, 200, sessionResponse);
}
