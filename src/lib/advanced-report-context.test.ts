import assert from "node:assert/strict";
import test from "node:test";
import { buildAdvancedReportContext, parseAdvancedReportContextRequest } from "./advanced-report-context.ts";
import { composeMonthlyReportInput } from "./report-context.ts";

const request = {
  checkpoint: 7,
  metrics: ["reach", "follow_rate"],
  cohorts: [
    { key: "A", label: "A", range: { start: "2026-01-01", end: "2026-01-31" }, track_ids: [], partner_ids: [], idea_type_ids: [], media_types: [], participants: [] },
    { key: "B", label: "B", range: { start: "2026-02-01", end: "2026-02-28" }, track_ids: [], partner_ids: [], idea_type_ids: [], media_types: [], participants: [] },
  ],
  evaluated_at: "2026-09-24T00:00:00.000Z",
} as const;

const result = {
  request,
  formula_version: "analytics-formulas-v2",
  checkpoint_policy_version: "recorded-age-earliest-v1",
  evaluated_at: request.evaluated_at,
  excluded_periods: [{ start: "2026-04-01", end_exclusive: "2026-06-01" }],
  overlap_n: 0,
  cohorts: [{ key: "A", label: "A", eligible_n: 2, linked_n: 2, mature_n: 2, checkpoint_n: 2 }, { key: "B", label: "B", eligible_n: 3, linked_n: 3, mature_n: 3, checkpoint_n: 3 }],
  metrics: [{ metric: "reach", cohort_a: 10, cohort_b: 20, difference: 10, relative_change: 100, a_measured_n: 2, b_measured_n: 2, a_eligible_n: 2, b_eligible_n: 3, a_missing: { unlinked: 0, unknown_publication_time: 0, not_mature: 0, no_checkpoint: 0, unverified_checkpoint: 0, missing_component: 0, reach_zero: 0 }, b_missing: { unlinked: 0, unknown_publication_time: 0, not_mature: 0, no_checkpoint: 1, unverified_checkpoint: 0, missing_component: 0, reach_zero: 0 } }],
  timeline: [], evidence: [], source_bounds: { first: null, last: "2026-09-23T00:00:00Z" }, result_hash: "a".repeat(64),
};

test("accepts only a stored normalized request and a sha256 result hash", () => {
  assert.equal(parseAdvancedReportContextRequest({ title: "مقارنة", request, resultHash: "a".repeat(64) }).ok, true);
  assert.equal(parseAdvancedReportContextRequest({ title: "مقارنة", request: { ...request, evaluated_at: "bad" }, resultHash: "a".repeat(64) }).ok, false);
  assert.equal(parseAdvancedReportContextRequest({ title: "مقارنة", request, resultHash: "not-a-hash" }).ok, false);
});

test("builds a server-owned immutable snapshot and refuses stale results", () => {
  const built = buildAdvancedReportContext({ title: " مقارنة A وB ", request, resultHash: "a".repeat(64) }, result, new Date("2026-09-24T01:00:00Z"));
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.value.title, "مقارنة A وB");
  assert.equal(built.value.formulaVersion, "analytics-formulas-v2");
  assert.deepEqual(built.value.snapshot.warnings.sort(), ["incomplete_measurement", "small_sample"]);
  assert.equal(built.value.snapshot.created_time, "2026-09-24T01:00:00.000Z");
  const stale = buildAdvancedReportContext({ title: "مقارنة", request, resultHash: "b".repeat(64) }, result);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.code, "E_COMPARISON_STALE");
});

test("rejects a snapshot instead of truncating it when it exceeds 64 KiB", () => {
  const oversized = { ...result, evidence: [{ note: "x".repeat(70000) }] };
  const built = buildAdvancedReportContext({ title: "مقارنة", request, resultHash: "a".repeat(64) }, oversized);
  assert.equal(built.ok, false);
  if (!built.ok) assert.equal(built.code, "E_BLOCK_SIZE");
});

test("monthly report input preserves cohorts, checkpoint policy, N and result hash", () => {
  const built = buildAdvancedReportContext({ title: "مقارنة", request, resultHash: "a".repeat(64) }, result, new Date("2026-09-24T01:00:00Z"));
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const markdown = composeMonthlyReportInput(
    { title: "سبتمبر", month: "2026-09-01", context_note: null },
    [{ title: built.value.title, block_type: built.value.blockType, input_snapshot: built.value.snapshot, formula_version: built.value.formulaVersion }],
  );
  assert.match(markdown, /recorded-age-earliest-v1/);
  assert.match(markdown, /N=2/);
  assert.match(markdown, new RegExp("a{64}"));
});
