import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { comparisonMonthBuckets, hasReelsStructuralLimit, validateComparisonQuery, type ComparisonResult } from "./analytics-comparison.ts";

const params = (value: string) => new URLSearchParams(value);

test("accepts two selected tracks and exact D7 reach", () => {
  const result = validateComparisonQuery(params("dimension=track&metric=reach_d7&keys=1,2&start=2026-09-01&end=2026-09-30"));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.keys, ["1", "2"]);
});

test("rejects unsupported dimensions and more than 20 keys", () => {
  assert.equal(validateComparisonQuery(params("dimension=free_text&metric=signal&keys=1,2&start=2026-09-01&end=2026-09-30")).ok, false);
  const keys = Array.from({ length: 21 }, (_, index) => index + 1).join(",");
  assert.equal(validateComparisonQuery(params(`dimension=track&metric=signal&keys=${keys}&start=2026-09-01&end=2026-09-30`)).ok, false);
});

test("requires two unique keys and a bounded date range", () => {
  assert.equal(validateComparisonQuery(params("dimension=partner&metric=signal&keys=1,1&start=2026-09-01&end=2026-09-30")).ok, false);
  assert.equal(validateComparisonQuery(params("dimension=partner&metric=signal&keys=1,2&start=2026-09-30&end=2026-09-01")).ok, false);
});

test("accepts only known media filters", () => {
  assert.equal(validateComparisonQuery(params("dimension=media_type&metric=item_count&keys=IMAGE,REELS&start=2026-09-01&end=2026-09-30&media_type=REELS")).ok, true);
  assert.equal(validateComparisonQuery(params("dimension=track&metric=signal&keys=1,2&start=2026-09-01&end=2026-09-30&media_type=STORY")).ok, false);
});

test("shows the structural Reels warning only for affected measured metrics", () => {
  const rows = [{ has_partial_reels: true }] as ComparisonResult[];
  assert.equal(hasReelsStructuralLimit("signal", rows), true);
  assert.equal(hasReelsStructuralLimit("follow_rate", rows), true);
  assert.equal(hasReelsStructuralLimit("save_rate", rows), false);
  assert.equal(hasReelsStructuralLimit("signal", [{ has_partial_reels: false }] as ComparisonResult[]), false);
});

test("timeline comparison splits the selected period into bounded calendar months", () => {
  assert.deepEqual(comparisonMonthBuckets({ start: "2026-01-20", end: "2026-03-04" }), [
    { key: "2026-01", start: "2026-01-20", end: "2026-01-31" },
    { key: "2026-02", start: "2026-02-01", end: "2026-02-28" },
    { key: "2026-03", start: "2026-03-01", end: "2026-03-04" },
  ]);
});

test("comparison route and UI keep N and thin samples visible without judgments", () => {
  const route = readFileSync("src/app/api/insights/compare/route.ts", "utf8");
  const ui = readFileSync("src/components/insights/comparison-builder.tsx", "utf8")
    + readFileSync("src/components/insights/comparison-chart.tsx", "utf8");
  assert.match(route, /validateComparisonQuery/);
  assert.match(route, /admin_analytics_comparison/);
  assert.match(ui, /N=/);
  assert.match(ui, /عيّنة صغيرة/);
  assert.match(ui, /خط زمني/);
  assert.doesNotMatch(ui, /الأفضل|الأضعف|متفوق/);
});
