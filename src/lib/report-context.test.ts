import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYTICS_FORMULA_VERSION,
  buildMonthlyDraftRow,
  composeMonthlyReportInput,
  reportMetricFormulas,
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
        { observation_key: "stock-001", observed_at: "2026-09-01T03:00:00Z", followers_count: 100, media_count: 20, missing_metrics: [], source_time: "2026-09-01T03:01:00Z" },
        { observation_key: "stock-002", observed_at: "2026-09-04T03:00:00Z", followers_count: 105, media_count: null, missing_metrics: ["media_count"], source_time: "2026-09-04T03:01:00Z" },
      ],
    },
  };
  assert.equal(validateReportContextBlock({ blockType: accountBlock.block_type, title: accountBlock.title, snapshot: accountBlock.input_snapshot }).ok, true);
  const markdown = composeMonthlyReportInput({ title: "سبتمبر", month: "2026-09-01", context_note: null }, [accountBlock]);
  assert.match(markdown, /stock-001/);
  assert.match(markdown, /2026-09-04T03:00:00Z/);
  assert.match(markdown, /N=2/);
  assert.match(markdown, /analytics-formulas-v2/);

  assert.doesNotThrow(() => composeMonthlyReportInput({ title: "قديم", month: "2026-08-01", context_note: null }, [block]));
  const legacyAccountBlock = {
    ...accountBlock, formula_version: "analytics-formulas-v1",
    input_snapshot: { ...accountBlock.input_snapshot,
      formula: "المتابعون: آخر قياس؛ التغير: آخر قياس ناقص أول قياس؛ إجماليات الوصول والمشاهدات تظهر فقط عند اكتمال أيام الفترة",
      source_time: "2026-09-04", stock_observations: undefined },
  };
  assert.doesNotThrow(() => composeMonthlyReportInput({ title: "قديم", month: "2026-08-01", context_note: null }, [legacyAccountBlock]));
});

function accountSnapshot(days = 1) {
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10));
  return {
    period: { start: dates[0], end: dates.at(-1)! }, filters: {}, metric: "account_overview",
    formula: reportMetricFormulas.account_overview,
    selection: [{ key: "instagram:aqsana2026", label: "حساب أقصانا" }],
    values: Array.from({ length: 8 }, () => ({ label: "المتابعون في آخر رصد", value: 2147483647, measured_n: days })),
    series: ["reach", "reach_non_followers"].map(key => ({ key, label: "الوصول", points: dates.map(date => ({ date, value: 2147483647 })) })),
    completeness: { measured_n: days, expected_n: days }, warnings: [], source_time: dates.at(-1)! + "T03:01:00.000Z",
    stock_observations: dates.map((date, i) => ({
      observation_key: "gas.account_stock." + String(i).padStart(64, "0"),
      observed_at: date + "T03:00:00.000Z", followers_count: 2147483647,
      media_count: null as number | null, missing_metrics: ["media_count"], source_time: date + "T03:01:00.000Z",
    })),
  };
}

test("account v2 rejects invalid keys, timestamps, integers and noncanonical completeness", () => {
  const snapshot = accountSnapshot();
  const observation = snapshot.stock_observations[0];
  const validate = (row: object) => validateReportContextBlock({ blockType: "account", title: "رصيد الحساب", snapshot: { ...snapshot, stock_observations: [row] } });
  const invalid = [
    { observation_key: "short" }, { observation_key: "bad key!" }, { observation_key: "a".repeat(129) }, { observation_key: "stock-001\n" },
    { observed_at: "2026-09-30T03:00:00" }, { source_time: "2026-09-30" },
    { observed_at: "2026-02-30T03:00:00Z" }, { observed_at: "2026-09-30T24:00:00Z" },
    { observed_at: "2026-09-30T03:00:00+15:00" }, { observed_at: "2026-09-30T03:00:00Z" },
    { followers_count: -1 }, { followers_count: 1.5 }, { followers_count: 2147483648 },
    { missing_metrics: [] }, { missing_metrics: ["media_count", "media_count"] },
    { missing_metrics: ["unknown"] }, { followers_count: null, missing_metrics: ["media_count", "followers_count"] },
  ];
  for (const change of invalid) assert.equal(validate({ ...observation, ...change }).ok, false, JSON.stringify(change));
  for (const offset of ["+02:00", "+03:00"]) {
    assert.equal(validate({ ...observation, observed_at: "2026-09-30T03:00:00" + offset, source_time: "2026-09-30T00:01:00Z" }).ok, offset === "+03:00");
  }
  assert.equal(validate({ ...observation, followers_count: 0 }).ok, true);
  assert.equal(validate({ ...observation, observation_key: "a".repeat(8) }).ok, true);
  assert.equal(validate({ ...observation, observation_key: "a".repeat(128) }).ok, true);
  assert.equal(validate({ ...observation, observed_at: "2025-01-01T03:00:00.000001Z", source_time: "2025-01-01T03:00:00.000000Z" }).ok, false);
  assert.equal(validate({ ...observation, observed_at: "2025-01-01T03:00:00.000000Z", source_time: "2025-01-01T03:00:00.000001Z" }).ok, true);
  assert.equal(validateReportContextBlock({ blockType: "account", title: "رصيد الحساب", snapshot: { ...snapshot, source_time: "2025-01-01" } }).ok, false);
});

test("full 366-day account snapshots fit a bounded account-only size allowance without truncation", () => {
  // Measured compact UTF-8 sizes: 30d=11852, 90d=32912, 366d=129798.
  // JSONB separator estimate: 137203 bytes; actual DB measurement is in the SQL test.
  const snapshot = accountSnapshot(366);
  assert.equal(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength, 129798);
  const result = validateReportContextBlock({ blockType: "account", title: "رصيد الحساب", snapshot });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.snapshot.stock_observations, snapshot.stock_observations);
  const oversized = { ...snapshot, filters: { padding: "x".repeat(262144) } };
  assert.equal(validateReportContextBlock({ blockType: "account", title: "رصيد الحساب", snapshot: oversized }).ok, false);
  assert.equal(validateReportContextBlock({ blockType: "comparison", title: "x", snapshot: { ...block.input_snapshot, filters: { padding: "x".repeat(65536) } } }).ok, false);
});
