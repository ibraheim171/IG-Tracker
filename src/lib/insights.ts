import type { Enums } from "./database.types.ts";

export type InsightRange = { start: string; end: string };
export type InsightItem = {
  id: string;
  status: Enums<"item_status">;
  is_archived: boolean;
  published_at: string | null;
};
export type InsightSlot = { slot_id: string; slot_at: string; state: string | null; n_items: number; n_ready: number };
export type PartnerActivity = { partner_id: number; partner_name: string; item_id: string; track_id: number | null; published_at: string };
export type PartnerPerformance = {
  partner_id: number;
  partner_name: string;
  track_id: number;
  track_name: string;
  n: number;
  median_reach: number | null;
  median_signal: number | null;
  sample_sufficient: boolean;
};

export type PartnerInsightRow = PartnerPerformance & { published_in_period: number };
export type InsightsSnapshot = {
  range: InsightRange;
  total_active: number;
  by_status: Array<{ status: Enums<"item_status">; count: number }>;
  published_in_period: number;
  ready: number;
  overdue: number;
  blocked: number;
  upcoming_slots: InsightSlot[];
  partner_linked_materials: number;
  active_partners: number;
  partners: PartnerInsightRow[];
  performance?: PerformanceDetail[];
  aggregates?: PerformanceAggregate[];
  partner_track_matrix?: PerformanceAggregate[];
  account_daily?: AccountDailyInsight[];
  demographics?: DemographicInsight[];
  collabs?: CollabInsight[];
  sync_runs?: SyncRunInsight[];
};

export type PerformanceDetail = {
  id: string; ref: string; title: string; published_at: string; media_id: string; permalink: string;
  media_type: string | null; product_type: string | null; snapshot_date: string; age_days: number | null;
  source_timestamp: string | null; missing_metrics: string[]; signal_partial: boolean;
  reach: number | null; views: number | null; likes: number | null; comments: number | null; saved: number | null;
  shares: number | null; follows: number | null; profile_visits: number | null; interactions: number | null; avg_watch_ms: number | null;
  save_rate: number | null; share_rate: number | null; follow_rate: number | null; visit_rate: number | null;
  engagement_rate: number | null; signal: number | null; track_id: number | null; track_name: string | null;
  idea_type_id: number | null; idea_type: string | null; checkpoints: Record<string, PostCheckpoint | null>;
};
export type PostCheckpoint = { age_days: number | null; snapshot_date: string; reach: number | null; saved: number | null; shares: number | null; signal: number | null };
export type PerformanceAggregate = { dimension: "month" | "track" | "idea_type" | "partner" | "partner_track"; key: string; name: string; n: number; median_reach: number | null; median_save_rate: number | null; median_share_rate: number | null; median_signal: number | null; sample_sufficient: boolean };
export type AccountDailyInsight = { date: string; followers: number | null; media_count: number | null; reach: number | null; views: number | null; reach_followers: number | null; reach_non_followers: number | null; follows: number | null; unfollows: number | null; missing_metrics: string[] };
export type DemographicInsight = { snapshot_date: string; dimension: string; key: string; value: number | null };
export type CollabInsight = { collaboration_date: string; partner: string; collaboration_type: string | null; follows_lift: number | null; reach_lift_pct: number | null; nonfollower_lift_pct: number | null };
export type SyncRunInsight = { id: string; source_timestamp: string; received_at: string; status: string; row_counts: unknown; accepted_count: number; rejected_count: number };

type AggregateRow = Pick<PerformanceDetail, "id" | "published_at" | "track_id" | "track_name" | "idea_type_id" | "idea_type" | "reach" | "save_rate" | "share_rate" | "signal">;

export function buildPerformanceAggregates(rows: AggregateRow[], partnerLinks: Array<{ item_id: string; partner_id: number; partner_name: string }>) {
  const groups = new Map<string, { dimension: PerformanceAggregate["dimension"]; key: string; name: string; rows: AggregateRow[] }>();
  const add = (dimension: PerformanceAggregate["dimension"], key: string, name: string, row: AggregateRow) => {
    const mapKey = `${dimension}:${key}`;
    const group = groups.get(mapKey) ?? { dimension, key, name, rows: [] };
    group.rows.push(row);
    groups.set(mapKey, group);
  };
  for (const row of rows) {
    add("month", row.published_at.slice(0, 7), row.published_at.slice(0, 7), row);
    if (row.track_id !== null) add("track", String(row.track_id), row.track_name ?? "—", row);
    if (row.idea_type_id !== null) add("idea_type", String(row.idea_type_id), row.idea_type ?? "—", row);
    for (const partner of partnerLinks.filter((link) => link.item_id === row.id)) {
      add("partner", String(partner.partner_id), partner.partner_name, row);
      if (row.track_id !== null) add("partner_track", `${partner.partner_id}:${row.track_id}`, `${partner.partner_name} × ${row.track_name ?? "—"}`, row);
    }
  }
  return [...groups.values()].map((group) => {
    const n = group.rows.length;
    const guarded = group.dimension === "partner_track" && n < 5;
    return {
      dimension: group.dimension, key: group.key, name: group.name, n,
      median_reach: guarded ? null : medianValue(group.rows.map((row) => row.reach)),
      median_save_rate: guarded ? null : medianValue(group.rows.map((row) => row.save_rate)),
      median_share_rate: guarded ? null : medianValue(group.rows.map((row) => row.share_rate)),
      median_signal: guarded ? null : medianValue(group.rows.map((row) => row.signal)),
      sample_sufficient: group.dimension !== "partner_track" || n >= 5,
    };
  }).sort((a, b) => a.dimension.localeCompare(b.dimension) || b.n - a.n || a.name.localeCompare(b.name, "ar"));
}

function medianValue(values: Array<number | null>) {
  const measured = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!measured.length) return null;
  const middle = Math.floor(measured.length / 2);
  return measured.length % 2 ? measured[middle] : (measured[middle - 1] + measured[middle]) / 2;
}

const statuses: Enums<"item_status">[] = ["idea", "writing", "content_approved", "in_production", "design_approved", "ready"];

export function currentWeekRange(now = new Date()): InsightRange {
  const local = new Date(`${dateInTimeZone(now, "Asia/Hebron")}T00:00:00Z`);
  const mondayOffset = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - mondayOffset);
  const start = local.toISOString().slice(0, 10);
  local.setUTCDate(local.getUTCDate() + 6);
  return { start, end: local.toISOString().slice(0, 10) };
}

function dateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function insightUtcBounds(range: InsightRange) {
  const nextDay = new Date(`${range.end}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return {
    start: zonedMidnightUtc(range.start, "Asia/Hebron"),
    endExclusive: zonedMidnightUtc(nextDay.toISOString().slice(0, 10), "Asia/Hebron"),
  };
}

function zonedMidnightUtc(date: string, timeZone: string) {
  const localAsUtc = Date.parse(`${date}T00:00:00Z`);
  let candidate = localAsUtc - timeZoneOffset(localAsUtc, timeZone);
  candidate = localAsUtc - timeZoneOffset(candidate, timeZone);
  return new Date(candidate).toISOString();
}

function timeZoneOffset(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const displayedAsUtc = Date.UTC(
    Number(value.year),
    Number(value.month) - 1,
    Number(value.day),
    Number(value.hour),
    Number(value.minute),
    Number(value.second),
  );
  return displayedAsUtc - timestamp;
}

export function validateInsightRange(start: string | null, end: string | null): { ok: true; range: InsightRange } | { ok: false; message: string } {
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) return { ok: false, message: "نطاق التاريخ غير صحيح." };
  const days = Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  if (days > 366) return { ok: false, message: "يجب ألا يتجاوز نطاق التقرير 366 يومًا." };
  return { ok: true, range: { start, end } };
}

function isIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function buildInsightsSnapshot(input: {
  range: InsightRange;
  items: InsightItem[];
  slots: InsightSlot[];
  overdueItemIds: string[];
  blockedItemIds: string[];
  partnerActivity: PartnerActivity[];
  partnerPerformance: PartnerPerformance[];
}): InsightsSnapshot {
  const rangeBounds = insightUtcBounds(input.range);
  const activeItems = input.items.filter((item) => !item.is_archived && item.status !== "published" && item.status !== "cancelled");
  const publishedItems = input.items.filter((item) => !item.is_archived && item.status === "published" && inRange(item.published_at, rangeBounds));
  const uniquePartnerMaterials = new Set(input.partnerActivity.map((row) => row.item_id));
  const uniquePartners = new Set(input.partnerActivity.map((row) => row.partner_id));
  const publishedByPartnerTrack = new Map<string, number>();
  for (const row of input.partnerActivity) {
    const key = `${row.partner_id}:${row.track_id ?? -1}`;
    publishedByPartnerTrack.set(key, (publishedByPartnerTrack.get(key) ?? 0) + 1);
  }
  const partners = input.partnerPerformance.map((row) => ({ ...row, published_in_period: publishedByPartnerTrack.get(`${row.partner_id}:${row.track_id}`) ?? 0 }));
  partners.sort((a, b) => b.published_in_period - a.published_in_period || b.n - a.n || a.partner_name.localeCompare(b.partner_name, "ar"));
  return {
    range: input.range,
    total_active: activeItems.length,
    by_status: statuses.map((status) => ({ status, count: activeItems.filter((item) => item.status === status).length })),
    published_in_period: publishedItems.length,
    ready: activeItems.filter((item) => item.status === "ready").length,
    overdue: new Set(input.overdueItemIds).size,
    blocked: new Set(input.blockedItemIds).size,
    upcoming_slots: [...input.slots].sort((a, b) => a.slot_at.localeCompare(b.slot_at)),
    partner_linked_materials: uniquePartnerMaterials.size,
    active_partners: uniquePartners.size,
    partners,
  };
}

function inRange(value: string | null, bounds: { start: string; endExclusive: string }) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return timestamp >= Date.parse(bounds.start) && timestamp < Date.parse(bounds.endExclusive);
}
