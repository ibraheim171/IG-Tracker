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
  formula_version: "analytics-formulas-v1",
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

test("account stock v2 snapshots preserve observation provenance while v1 blocks remain readable", () => {
  assert.equal(ANALYTICS_FORMULA_VERSION, "analytics-formulas-v2");
  const accountBlock = {
    title: "نبض الحساب",
    block_type: "account",
    formula_version: ANALYTICS_FORMULA_VERSION,
    input_snapshot: {
      ...block.input_snapshot,
      metric: "account_overview",
      formula: "تدفقات الحساب يومية؛ رصيد المتابعين والمواد لقطات مستقلة بوقت رصد حقيقي؛ التغير محسوب بين رصدين مقاسين فقط",
      values: [
        { label: "المتابعون في آخر رصد", value: 105, measured_n: 2 },
        { label: "التغير بين الرصدين", value: 5, measured_n: 2 },
      ],
      completeness: { measured_n: 2, expected_n: 2 },
      warnings: [],
      source_time: "2026-09-04T03:01:00Z",
      stock_observations: [
        { observation_key: "stock-1", observed_at: "2026-09-01T03:00:00Z", followers_count: 100, media_count: 20, missing_metrics: [], source_time: "2026-09-01T03:01:00Z" },
        { observation_key: "stock-2", observed_at: "2026-09-04T03:00:00Z", followers_count: 105, media_count: null, missing_metrics: ["media_count"], source_time: "2026-09-04T03:01:00Z" },
      ],
    },
  };
  assert.equal(validateReportContextBlock({ blockType: accountBlock.block_type, title: accountBlock.title, snapshot: accountBlock.input_snapshot }).ok, true);
  const markdown = composeMonthlyReportInput({ title: "سبتمبر", month: "2026-09-01", context_note: null }, [accountBlock]);
  assert.match(markdown, /stock-1/);
  assert.match(markdown, /2026-09-04T03:00:00Z/);
  assert.match(markdown, /N=2/);
  assert.match(markdown, /analytics-formulas-v2/);

  assert.doesNotThrow(() => composeMonthlyReportInput({ title: "قديم", month: "2026-08-01", context_note: null }, [block]));
});
