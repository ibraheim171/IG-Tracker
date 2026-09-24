import { currentWeekRange } from "./insights.ts";
import { localDateKey } from "./ui-data.ts";

export type AdminDashboardStatus = "idea" | "writing" | "content_approved" | "in_production" | "design_approved" | "ready" | "published" | "cancelled";

export type AdminDashboardItem = {
  id: string;
  ref: string;
  title: string;
  status: AdminDashboardStatus;
  is_archived: boolean;
  published_at: string | null;
  slot_id: string | null;
  slot_at: string | null;
  ig_media_id: string | null;
  updated_at: string;
  assignees: string[];
};

export type AdminDashboardSlot = {
  slot_id: string;
  slot_at: string;
  n_ready: number;
};

export type AdminSyncHealth = {
  source_timestamp: string;
  received_at: string;
  status: string;
} | null;

export type AdminTransition = { item_id: string; to_status: AdminDashboardStatus; created_at: string };
export type StageDurationRow = { status: AdminDashboardStatus; n: number; median_days: number };
export type PublicationDelayRow = { item_id: string; ref: string; title: string; planned_at: string; actual_at: string; delay_days: number };

export type AdminDecisionKind =
  | "content_approval"
  | "design_approval"
  | "ready_without_slot"
  | "slot_without_ready_item"
  | "overdue_unpublished"
  | "published_without_instagram_link";

export type AdminDecision = {
  key: string;
  kind: AdminDecisionKind;
  item_id: string | null;
  ref: string;
  title: string;
  status: AdminDashboardStatus | null;
  assignees: string[];
  due_at: string | null;
  waiting_days: number;
};

export type AdminDashboardInput = {
  now: string;
  items: AdminDashboardItem[];
  slots: AdminDashboardSlot[];
  linkedItemIds: string[];
  latestSync: AdminSyncHealth;
  transitions?: AdminTransition[];
};

export type AdminDashboardSnapshot = {
  generated_at: string;
  week: {
    published: number;
    available_slots: number;
    ready: number;
    uncovered_slots: number;
  };
  decisions: AdminDecision[];
  stage_durations: StageDurationRow[];
  publication_delays: PublicationDelayRow[];
  latest_sync: AdminSyncHealth;
};

const decisionPriority: Record<AdminDecisionKind, number> = {
  overdue_unpublished: 0,
  slot_without_ready_item: 1,
  published_without_instagram_link: 2,
  ready_without_slot: 3,
  content_approval: 4,
  design_approval: 5,
};

function waitingDays(since: string, now: string) {
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(since)) / 86_400_000));
}

function isDateInRange(value: string | null, start: string, end: string) {
  if (!value) return false;
  const date = localDateKey(value);
  return date >= start && date <= end;
}

function itemDecision(item: AdminDashboardItem, linkedItemIds: Set<string>, now: string, stageSince: string | null): AdminDecision | null {
  let kind: AdminDecisionKind | null = null;
  if (item.status !== "published" && item.status !== "cancelled" && item.slot_at && Date.parse(item.slot_at) < Date.parse(now)) {
    kind = "overdue_unpublished";
  } else if (item.status === "published" && !item.ig_media_id && !linkedItemIds.has(item.id)) {
    kind = "published_without_instagram_link";
  } else if (item.status === "ready" && !item.slot_id) {
    kind = "ready_without_slot";
  } else if (item.status === "writing") {
    kind = "content_approval";
  } else if (item.status === "in_production") {
    kind = "design_approval";
  }
  if (!kind) return null;
  return {
    key: `item:${item.id}`,
    kind,
    item_id: item.id,
    ref: item.ref,
    title: item.title,
    status: item.status,
    assignees: item.assignees,
    due_at: item.slot_at,
    waiting_days: waitingDays(stageSince ?? item.updated_at, now),
  };
}

function compareDecisions(left: AdminDecision, right: AdminDecision) {
  if (left.due_at && right.due_at) return left.due_at.localeCompare(right.due_at) || right.waiting_days - left.waiting_days || left.ref.localeCompare(right.ref);
  if (left.due_at) return -1;
  if (right.due_at) return 1;
  return right.waiting_days - left.waiting_days
    || decisionPriority[left.kind] - decisionPriority[right.kind]
    || left.ref.localeCompare(right.ref);
}

function roundedDays(start: string, end: string) {
  return Math.round(Math.max(0, Date.parse(end) - Date.parse(start)) / 8_640_000) / 10;
}

function median(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : Math.round(((ordered[middle - 1] + ordered[middle]) / 2) * 10) / 10;
}

export function buildAdminDashboardSnapshot(input: AdminDashboardInput): AdminDashboardSnapshot {
  const now = new Date(input.now);
  const week = currentWeekRange(now);
  const activeItems = input.items.filter((item) => !item.is_archived && item.status !== "cancelled");
  const itemById = new Map(activeItems.map((item) => [item.id, item]));
  const transitionsByItem = new Map<string, AdminTransition[]>();
  for (const transition of input.transitions ?? []) {
    if (!itemById.has(transition.item_id)) continue;
    transitionsByItem.set(transition.item_id, [...(transitionsByItem.get(transition.item_id) ?? []), transition]);
  }
  for (const rows of transitionsByItem.values()) rows.sort((left, right) => left.created_at.localeCompare(right.created_at));
  const currentStageSince = new Map<string, string>();
  const stageDurations = new Map<AdminDashboardStatus, number[]>();
  for (const [itemId, rows] of transitionsByItem) {
    const item = itemById.get(itemId)!;
    rows.forEach((transition, index) => {
      const next = rows[index + 1];
      const end = next?.created_at ?? (item.status === transition.to_status && !["published", "cancelled"].includes(item.status) ? input.now : null);
      if (end && !["published", "cancelled"].includes(transition.to_status)) stageDurations.set(transition.to_status, [...(stageDurations.get(transition.to_status) ?? []), roundedDays(transition.created_at, end)]);
    });
    const latest = rows.at(-1);
    if (latest?.to_status === item.status) currentStageSince.set(itemId, latest.created_at);
  }
  const weekSlots = input.slots.filter((slot) => isDateInRange(slot.slot_at, week.start, week.end));
  const linkedItemIds = new Set(input.linkedItemIds);
  const decisions = activeItems.flatMap((item) => {
    const decision = itemDecision(item, linkedItemIds, input.now, currentStageSince.get(item.id) ?? null);
    return decision ? [decision] : [];
  });
  for (const slot of weekSlots) {
    if (slot.n_ready > 0 || Date.parse(slot.slot_at) < now.getTime()) continue;
    decisions.push({
      key: `slot:${slot.slot_id}`,
      kind: "slot_without_ready_item",
      item_id: null,
      ref: "—",
      title: "موعد نشر بلا مادة جاهزة",
      status: null,
      assignees: [],
      due_at: slot.slot_at,
      waiting_days: 0,
    });
  }
  decisions.sort(compareDecisions);
  const publicationDelays = activeItems.flatMap((item): PublicationDelayRow[] => item.status === "published" && item.slot_at && item.published_at && Date.parse(item.published_at) > Date.parse(item.slot_at) ? [{
    item_id: item.id, ref: item.ref, title: item.title, planned_at: item.slot_at, actual_at: item.published_at, delay_days: roundedDays(item.slot_at, item.published_at),
  }] : []).sort((left, right) => right.delay_days - left.delay_days || left.ref.localeCompare(right.ref));
  return {
    generated_at: input.now,
    week: {
      published: activeItems.filter((item) => item.status === "published" && isDateInRange(item.published_at, week.start, week.end)).length,
      available_slots: weekSlots.length,
      ready: activeItems.filter((item) => item.status === "ready").length,
      uncovered_slots: weekSlots.filter((slot) => slot.n_ready === 0 && Date.parse(slot.slot_at) >= now.getTime()).length,
    },
    decisions,
    stage_durations: [...stageDurations.entries()].map(([status, values]) => ({ status, n: values.length, median_days: median(values) })).sort((left, right) => left.status.localeCompare(right.status)),
    publication_delays: publicationDelays,
    latest_sync: input.latestSync,
  };
}
