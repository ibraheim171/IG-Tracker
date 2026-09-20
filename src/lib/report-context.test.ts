import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYTICS_FORMULA_VERSION,
  buildMonthlyDraftRow,
  composeMonthlyReportInput,
  validateReportContextBlock,
} from "./report-context.ts";

const block = {
  title: "مقارنة المسارات",
  block_type: "comparison",
  formula_version: ANALYTICS_FORMULA_VERSION,
  input_snapshot: {
    period: { start: "2026-09-01", end: "2026-09-30" },
    filters: { metric: "signal", dimension: "track" },
    metric: "signal",
    formula: "قوة الإشارة = (6×المشاركات + 4×الحفظ + 3×المتابعات + 2×زيارات الملف + 1.5×التعليقات + 0.5×الإعجابات) ÷ الوصول × 1000",
    selection: [{ key: "track:7", label: "المسار أ" }],
    values: [{ label: "المسار أ", value: 12.5, measured_n: 2, total_n: 3 }],
    series: [],
    completeness: { measured_n: 2, expected_n: 3 },
    warnings: ["small_sample"],
    source_time: "2026-09-15T10:00:00Z",
  },
};

test("validates finite factual snapshots and rejects fabricated numeric shapes", () => {
  assert.equal(validateReportContextBlock({ blockType: block.block_type, title: block.title, snapshot: block.input_snapshot }).ok, true);
  assert.equal(validateReportContextBlock({ blockType: "comparison", title: "x", snapshot: { ...block.input_snapshot, values: [{ label: "x", value: Number.NaN, measured_n: 1 }] } }).ok, false);
  assert.equal(validateReportContextBlock({ blockType: "unknown", title: "x", snapshot: block.input_snapshot }).ok, false);
  assert.equal(validateReportContextBlock({ blockType: "comparison", title: "x", snapshot: { ...block.input_snapshot, metric: "not_a_metric" } }).ok, false);
  assert.equal(validateReportContextBlock({ blockType: "comparison", title: "x", snapshot: { ...block.input_snapshot, values: [{ label: "x", value: 1, measured_n: 0 }] } }).ok, false);
});

test("composer includes values, measured N, warnings, and formula version", () => {
  const markdown = composeMonthlyReportInput({ title: "سبتمبر", month: "2026-09-01", context_note: "سياق بشري" }, [block]);
  assert.match(markdown, /N=2/);
  assert.match(markdown, /عيّنة صغيرة/);
  assert.match(markdown, /analytics-formulas-v1/);
  assert.match(markdown, /سياق بشري/);
  assert.match(markdown, /track:7/);
  assert.match(markdown, /قوة الإشارة/);
});

test("missing values remain an em dash", () => {
  const missingBlock = { ...block, input_snapshot: { ...block.input_snapshot, values: [{ label: "غير مقاس", value: null, measured_n: 0 }] } };
  assert.match(composeMonthlyReportInput({ title: "سبتمبر", month: "2026-09-01", context_note: null }, [missingBlock]), /\| غير مقاس \| — \|/);
});

test("draft request records an unapproved monthly report snapshot", () => {
  const row = buildMonthlyDraftRow("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "# input");
  assert.equal(row.kind, "monthly_report");
  assert.equal(row.approved_at, null);
  assert.equal(row.approved_by, null);
  assert.equal(row.model, null);
});

test("composer rejects malformed stored snapshots instead of crashing", () => {
  assert.throws(
    () => composeMonthlyReportInput({ title: "سبتمبر", month: "2026-09-01", context_note: null }, [{ ...block, input_snapshot: {} }]),
    /INVALID_STORED_REPORT_CONTEXT/,
  );
});
