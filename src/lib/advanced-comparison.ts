export const advancedCheckpoints = [1, 7, 30] as const;
export const advancedMetrics = ["reach", "save_rate", "share_rate", "follow_rate", "visit_rate", "signal", "item_count"] as const;
export const advancedMediaTypes = ["IMAGE", "CAROUSEL_ALBUM", "VIDEO", "REELS"] as const;
export const advancedParticipantRoles = ["writer", "reviewer", "producer"] as const;

export type AdvancedCheckpoint = typeof advancedCheckpoints[number];
export type AdvancedMetric = typeof advancedMetrics[number];
export type AdvancedMediaType = typeof advancedMediaTypes[number];
export type AdvancedParticipantRole = typeof advancedParticipantRoles[number];
export type AdvancedCohortKey = "A" | "B";
export type AdvancedParticipant = { person_id: string; role: AdvancedParticipantRole | null };
export type AdvancedCohort = {
  key: AdvancedCohortKey;
  label: string;
  range: { start: string; end: string };
  track_ids: number[];
  partner_ids: number[];
  idea_type_ids: number[];
  media_types: AdvancedMediaType[];
  participants: AdvancedParticipant[];
};
export type AdvancedComparisonRequest = { checkpoint: AdvancedCheckpoint; metrics: AdvancedMetric[]; cohorts: [AdvancedCohort, AdvancedCohort]; evaluated_at: string };
export type AdvancedMissingReasons = { unlinked: number; unknown_publication_time: number; not_mature: number; no_checkpoint: number; unverified_checkpoint: number; missing_component: number; reach_zero: number };
export type AdvancedMetricResult = {
  metric: AdvancedMetric; cohort_a: number | null; cohort_b: number | null; difference: number | null; relative_change: number | null;
  a_measured_n: number; b_measured_n: number; a_eligible_n: number; b_eligible_n: number; a_missing: AdvancedMissingReasons; b_missing: AdvancedMissingReasons;
};
export type AdvancedEvidenceRow = {
  cohort: AdvancedCohortKey; item_id: string; ref: string | null; title: string | null; media_id: string | null; media_type: AdvancedMediaType | null;
  workflow_published_at: string | null; instagram_published_at: string | null; snapshot_date: string | null; snapshot_source_timestamp: string | null;
  recorded_age_days: number | null; metric_values: Partial<Record<AdvancedMetric, number | null>>;
  exclusion_reasons: Partial<Record<AdvancedMetric, keyof AdvancedMissingReasons | null>>;
  components: { reach: number | null; saved: number | null; shares: number | null; follows: number | null; profile_visits: number | null; comments: number | null; likes: number | null };
};
export type AdvancedTimelinePoint = { month: string; cohort: AdvancedCohortKey; metric: AdvancedMetric; value: number | null; eligible_n: number; measured_n: number };
export type AdvancedComparisonPayload = {
  request: AdvancedComparisonRequest;
  formula_version: string; checkpoint_policy_version: string; evaluated_at: string;
  excluded_periods: Array<{ start: string; end_exclusive: string }>;
  overlap_n: number;
  cohorts: Array<{ key: AdvancedCohortKey; label: string; eligible_n: number; linked_n: number; mature_n: number; checkpoint_n: number }>;
  metrics: AdvancedMetricResult[]; timeline: AdvancedTimelinePoint[]; evidence: AdvancedEvidenceRow[];
  source_bounds: { first: string | null; last: string | null }; result_hash: string;
};

type ParseResult = { ok: true; value: AdvancedComparisonRequest } | { ok: false; code: string; message: string };
const rootKeys = new Set(["checkpoint", "metrics", "cohorts"]);
const cohortKeys = new Set(["key", "label", "range", "track_ids", "partner_ids", "idea_type_ids", "media_types", "participants"]);
const rangeKeys = new Set(["start", "end"]);
const participantKeys = new Set(["person_id", "role"]);

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function hasOnly(value: Record<string, unknown>, allowed: Set<string>) { return Object.keys(value).every((key) => allowed.has(key)); }
function isoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function uuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function oneOf<T extends readonly string[] | readonly number[]>(values: T, value: unknown): value is T[number] { return (values as readonly unknown[]).includes(value); }
function numericIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > 20 || value.some((entry) => !Number.isSafeInteger(entry) || Number(entry) <= 0)) return null;
  return [...new Set(value as number[])];
}
function parseParticipants(value: unknown): AdvancedParticipant[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const parsed: AdvancedParticipant[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || !hasOnly(entry, participantKeys) || !uuid(entry.person_id)) return null;
    const role = entry.role === null || entry.role === undefined ? null : entry.role;
    if (role !== null && !oneOf(advancedParticipantRoles, role)) return null;
    const key = `${entry.person_id}:${role ?? "all"}`;
    if (!seen.has(key)) parsed.push({ person_id: entry.person_id, role });
    seen.add(key);
  }
  return parsed;
}
function parseCohort(input: unknown, expectedKey: AdvancedCohortKey): { ok: true; cohort: AdvancedCohort } | { ok: false; code: string; message: string } {
  if (!isRecord(input) || !hasOnly(input, cohortKeys) || input.key !== expectedKey) return { ok: false, code: "E_COHORT", message: "تعريف مجموعة المقارنة غير صحيح." };
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label || label.length > 80) return { ok: false, code: "E_COHORT", message: "اسم مجموعة المقارنة غير صحيح." };
  if (!isRecord(input.range) || !hasOnly(input.range, rangeKeys) || !isoDate(input.range.start) || !isoDate(input.range.end) || input.range.start > input.range.end) return { ok: false, code: "E_DATE_RANGE", message: "فترة المقارنة غير صحيحة." };
  const days = Math.floor((Date.parse(`${input.range.end}T00:00:00.000Z`) - Date.parse(`${input.range.start}T00:00:00.000Z`)) / 86400000) + 1;
  if (days > 366) return { ok: false, code: "E_DATE_RANGE", message: "فترة المقارنة يجب ألا تتجاوز 366 يومًا." };
  const trackIds = numericIds(input.track_ids); const partnerIds = numericIds(input.partner_ids); const ideaTypeIds = numericIds(input.idea_type_ids);
  if (!trackIds || !partnerIds || !ideaTypeIds) return { ok: false, code: "E_SELECTION_LIMIT", message: "كل مرشح يسمح بما يصل إلى 20 اختيارًا صالحًا." };
  if (!Array.isArray(input.media_types) || input.media_types.length > 20 || input.media_types.some((entry) => !oneOf(advancedMediaTypes, entry))) return { ok: false, code: "E_MEDIA_TYPE", message: "نوع المحتوى غير صحيح." };
  const participants = parseParticipants(input.participants);
  if (!participants) return { ok: false, code: "E_PARTICIPANT", message: "اختيار الشخص والدور غير صحيح." };
  return { ok: true, cohort: { key: expectedKey, label, range: { start: input.range.start, end: input.range.end }, track_ids: trackIds, partner_ids: partnerIds, idea_type_ids: ideaTypeIds, media_types: [...new Set(input.media_types)] as AdvancedMediaType[], participants } };
}

export function parseAdvancedComparisonRequest(input: unknown, now = new Date()): ParseResult {
  let serialized: string;
  try { serialized = JSON.stringify(input); } catch { return { ok: false, code: "E_REQUEST", message: "طلب المقارنة غير صحيح." }; }
  if (new TextEncoder().encode(serialized).byteLength > 32768) return { ok: false, code: "E_PAYLOAD_SIZE", message: "حجم طلب المقارنة أكبر من الحد المسموح." };
  if (!isRecord(input) || !hasOnly(input, rootKeys) || !oneOf(advancedCheckpoints, input.checkpoint)) return { ok: false, code: "E_REQUEST", message: "طلب المقارنة غير صحيح." };
  if (!Array.isArray(input.metrics) || input.metrics.length < 1 || input.metrics.length > advancedMetrics.length || input.metrics.some((metric) => !oneOf(advancedMetrics, metric))) return { ok: false, code: "E_METRIC", message: "مقاييس المقارنة غير صحيحة." };
  if (!Array.isArray(input.cohorts) || input.cohorts.length !== 2) return { ok: false, code: "E_COHORT", message: "يجب تحديد مجموعتين للمقارنة." };
  const cohortA = parseCohort(input.cohorts[0], "A"); if (!cohortA.ok) return cohortA;
  const cohortB = parseCohort(input.cohorts[1], "B"); if (!cohortB.ok) return cohortB;
  if (Number.isNaN(now.valueOf())) return { ok: false, code: "E_EVALUATION_TIME", message: "وقت حساب المقارنة غير صحيح." };
  return { ok: true, value: { checkpoint: input.checkpoint, metrics: [...new Set(input.metrics)] as AdvancedMetric[], cohorts: [cohortA.cohort, cohortB.cohort], evaluated_at: now.toISOString() } };
}

export function parseStoredAdvancedComparisonRequest(input: unknown): ParseResult {
  if (!isRecord(input) || Object.keys(input).some((key) => !rootKeys.has(key) && key !== "evaluated_at")) return { ok: false, code: "E_REQUEST", message: "طلب المقارنة المحفوظ غير صحيح." };
  if (typeof input.evaluated_at !== "string") return { ok: false, code: "E_EVALUATION_TIME", message: "وقت حساب المقارنة غير صحيح." };
  const evaluatedAt = new Date(input.evaluated_at);
  if (Number.isNaN(evaluatedAt.valueOf()) || evaluatedAt.toISOString() !== input.evaluated_at) return { ok: false, code: "E_EVALUATION_TIME", message: "وقت حساب المقارنة غير صحيح." };
  return parseAdvancedComparisonRequest({ checkpoint: input.checkpoint, metrics: input.metrics, cohorts: input.cohorts }, evaluatedAt);
}
