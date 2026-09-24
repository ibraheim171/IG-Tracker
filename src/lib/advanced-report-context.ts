import { parseStoredAdvancedComparisonRequest, type AdvancedComparisonPayload, type AdvancedComparisonRequest } from "./advanced-comparison.ts";

export const ADVANCED_ANALYTICS_FORMULA_VERSION = "analytics-formulas-v2";
export const ADVANCED_CHECKPOINT_POLICY_VERSION = "recorded-age-earliest-v1";
export const advancedReportWarningCodes = ["small_sample", "incomplete_measurement", "reels_structural_limits"] as const;
export type AdvancedReportWarning = typeof advancedReportWarningCodes[number];
export type AdvancedReportContextInput = { title: string; request: AdvancedComparisonRequest; resultHash: string };
export type AdvancedReportContextSnapshot = {
  kind: "advanced_comparison";
  request: AdvancedComparisonRequest;
  result: AdvancedComparisonPayload;
  warnings: AdvancedReportWarning[];
  created_time: string;
  source_time: string | null;
};
export type AdvancedReportDisplayRow = { label: string; cohortA: number | null; cohortB: number | null; aMeasuredN: number; bMeasuredN: number };

type Failure = { ok: false; code: string; message: string };
type Parsed = { ok: true; value: AdvancedReportContextInput } | Failure;
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

export function parseAdvancedReportContextRequest(input: unknown): Parsed {
  if (!isRecord(input) || Object.keys(input).some((key) => !["title", "request", "resultHash"].includes(key))) return { ok: false, code: "E_BLOCK", message: "بيانات مقطع المقارنة غير صحيحة." };
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 160 || typeof input.resultHash !== "string" || !/^[0-9a-f]{64}$/i.test(input.resultHash)) return { ok: false, code: "E_BLOCK", message: "بيانات مقطع المقارنة غير صحيحة." };
  const request = parseStoredAdvancedComparisonRequest(input.request);
  if (!request.ok) return { ok: false, code: request.code, message: request.message };
  return { ok: true, value: { title, request: request.value, resultHash: input.resultHash.toLowerCase() } };
}

function hasReelsStructuralLimit(payload: AdvancedComparisonPayload) {
  return payload.evidence.some((row) => row.media_type === "REELS" && (["follow_rate", "visit_rate", "signal"] as const).some((metric) => payload.request.metrics.includes(metric) && row.exclusion_reasons[metric] === "missing_component"));
}

export function buildAdvancedReportContext(input: unknown, rerun: unknown, now = new Date()): { ok: true; value: { blockType: "comparison"; title: string; snapshot: AdvancedReportContextSnapshot; formulaVersion: string } } | Failure {
  const parsed = parseAdvancedReportContextRequest(input);
  if (!parsed.ok) return parsed;
  if (!isRecord(rerun) || rerun.result_hash !== parsed.value.resultHash) return { ok: false, code: "E_COMPARISON_STALE", message: "تغيّرت نتيجة المقارنة؛ أعد حسابها قبل إضافتها للتقرير." };
  if (rerun.formula_version !== ADVANCED_ANALYTICS_FORMULA_VERSION || rerun.checkpoint_policy_version !== ADVANCED_CHECKPOINT_POLICY_VERSION || !Array.isArray(rerun.metrics) || !Array.isArray(rerun.evidence)) return { ok: false, code: "E_COMPARISON_RESULT", message: "نتيجة المقارنة لا تطابق سياسة القياس المعتمدة." };
  const payload = rerun as unknown as AdvancedComparisonPayload;
  const warnings: AdvancedReportWarning[] = [];
  if (payload.metrics.some((row) => [row.a_measured_n, row.b_measured_n].some((count) => count > 0 && count < 4))) warnings.push("small_sample");
  if (payload.metrics.some((row) => row.a_measured_n < row.a_eligible_n || row.b_measured_n < row.b_eligible_n)) warnings.push("incomplete_measurement");
  if (hasReelsStructuralLimit(payload)) warnings.push("reels_structural_limits");
  const snapshot: AdvancedReportContextSnapshot = { kind: "advanced_comparison", request: parsed.value.request, result: payload, warnings, created_time: now.toISOString(), source_time: payload.source_bounds?.last ?? null };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 65536) return { ok: false, code: "E_BLOCK_SIZE", message: "حجم المقطع أكبر من الحد المسموح؛ قلّل نطاق المقارنة أو المرشحات." };
  return { ok: true, value: { blockType: "comparison", title: parsed.value.title, snapshot, formulaVersion: ADVANCED_ANALYTICS_FORMULA_VERSION } };
}

export function validateStoredAdvancedReportContextSnapshot(input: unknown): input is AdvancedReportContextSnapshot {
  if (!isRecord(input) || input.kind !== "advanced_comparison" || !isRecord(input.result) || !Array.isArray(input.warnings)) return false;
  const request = parseStoredAdvancedComparisonRequest(input.request);
  if (!request.ok || input.result.formula_version !== ADVANCED_ANALYTICS_FORMULA_VERSION || input.result.checkpoint_policy_version !== ADVANCED_CHECKPOINT_POLICY_VERSION) return false;
  if (typeof input.result.result_hash !== "string" || !/^[0-9a-f]{64}$/.test(input.result.result_hash) || !Array.isArray(input.result.metrics) || !Array.isArray(input.result.timeline) || !Array.isArray(input.result.evidence) || !Array.isArray(input.result.cohorts)) return false;
  if (input.warnings.some((warning) => !advancedReportWarningCodes.includes(warning as AdvancedReportWarning))) return false;
  if (typeof input.created_time !== "string" || Number.isNaN(Date.parse(input.created_time)) || input.source_time !== null && (typeof input.source_time !== "string" || Number.isNaN(Date.parse(input.source_time)))) return false;
  return new TextEncoder().encode(JSON.stringify(input)).byteLength <= 65536;
}

export function advancedReportDisplayRows(snapshot: AdvancedReportContextSnapshot): AdvancedReportDisplayRow[] {
  return snapshot.result.metrics.map((row) => ({ label: row.metric, cohortA: row.cohort_a, cohortB: row.cohort_b, aMeasuredN: row.a_measured_n, bMeasuredN: row.b_measured_n }));
}
