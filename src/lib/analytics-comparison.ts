import { parseAnalyticsMediaFilter, type AnalyticsMediaFilter } from "./analytics-media.ts";
import { validateInsightRange, type InsightRange } from "./insights.ts";

export const comparisonDimensions = ["track", "partner", "idea_type", "media_type", "person"] as const;
export const comparisonMetrics = ["reach_d1", "reach_d7", "reach_d30", "save_rate", "share_rate", "follow_rate", "signal", "item_count"] as const;

export type ComparisonDimension = typeof comparisonDimensions[number];
export type ComparisonMetric = typeof comparisonMetrics[number];
export type ComparisonResult = {
  dimension_key: string;
  dimension_name: string;
  participant_part: "writer" | "producer" | "reviewer" | null;
  total_n: number;
  measured_n: number;
  median_value: number | null;
  is_thin: boolean;
  has_partial_reels: boolean;
};
export type ComparisonQuery = {
  dimension: ComparisonDimension;
  metric: ComparisonMetric;
  keys: string[];
  range: InsightRange;
  mediaType: AnalyticsMediaFilter | null;
};

export type ComparisonTimelineBucket = { key: string; start: string; end: string };

export function comparisonMonthBuckets(range: InsightRange): ComparisonTimelineBucket[] {
  const rangeStart = new Date(`${range.start}T00:00:00.000Z`);
  const rangeEnd = new Date(`${range.end}T00:00:00.000Z`);
  const cursor = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1));
  const buckets: ComparisonTimelineBucket[] = [];
  while (cursor <= rangeEnd) {
    const monthStart = new Date(cursor);
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const start = monthStart < rangeStart ? rangeStart : monthStart;
    const end = monthEnd > rangeEnd ? rangeEnd : monthEnd;
    buckets.push({ key: monthStart.toISOString().slice(0, 7), start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return buckets;
}

export function hasReelsStructuralLimit(metric: ComparisonMetric, rows: Pick<ComparisonResult, "has_partial_reels">[]) {
  return ["follow_rate", "signal"].includes(metric) && rows.some((row) => row.has_partial_reels);
}

function isOneOf<T extends readonly string[]>(values: T, value: string | null): value is T[number] {
  return value !== null && values.includes(value as T[number]);
}

function validKey(dimension: ComparisonDimension, key: string) {
  if (dimension === "media_type") return ["IMAGE", "CAROUSEL_ALBUM", "VIDEO", "REELS"].includes(key);
  if (dimension === "person") return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);
  return /^\d{1,10}$/.test(key);
}

export function validateComparisonQuery(searchParams: URLSearchParams): { ok: true; value: ComparisonQuery } | { ok: false; message: string; code: string } {
  const dimension = searchParams.get("dimension");
  const metric = searchParams.get("metric");
  if (!isOneOf(comparisonDimensions, dimension)) return { ok: false, message: "محور المقارنة غير صحيح.", code: "E_DIMENSION" };
  if (!isOneOf(comparisonMetrics, metric)) return { ok: false, message: "مقياس المقارنة غير صحيح.", code: "E_METRIC" };
  const keys = [...new Set((searchParams.get("keys") ?? "").split(",").map((key) => key.trim()).filter(Boolean))];
  if (keys.length < 2 || keys.length > 20 || keys.some((key) => !validKey(dimension, key))) {
    return { ok: false, message: "اختر عنصرين إلى 20 عنصرًا صالحًا للمقارنة.", code: "E_KEYS" };
  }
  const range = validateInsightRange(searchParams.get("start"), searchParams.get("end"));
  if (!range.ok) return { ok: false, message: range.message, code: "E_DATE_RANGE" };
  const media = parseAnalyticsMediaFilter(searchParams.get("media_type"));
  if (!media.ok) return { ok: false, message: "نوع الوسائط غير صحيح.", code: media.code };
  return { ok: true, value: { dimension, metric, keys, range: range.range, mediaType: media.value } };
}
