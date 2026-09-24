import assert from "node:assert/strict";
import test from "node:test";
import { parseAdvancedComparisonRequest } from "./advanced-comparison.ts";

const person = "11111111-1111-4111-8111-111111111111";
const cohort = (key: "A" | "B", start = "2026-06-01", end = "2026-06-30") => ({ key, label: key, range: { start, end }, track_ids: [2, 2], partner_ids: [], idea_type_ids: [], media_types: [], participants: [{ person_id: person, role: "writer" }] });

test("normalizes exactly two independent cohorts and keeps evaluation time server-owned", () => {
  const parsed = parseAdvancedComparisonRequest({ checkpoint: 7, metrics: ["reach", "reach", "signal"], cohorts: [cohort("A"), cohort("B", "2027-04-01", "2027-05-31")] }, new Date("2026-09-23T12:00:00Z"));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.metrics, ["reach", "signal"]);
  assert.deepEqual(parsed.value.cohorts[0].track_ids, [2]);
  assert.equal(parsed.value.cohorts[1].range.start, "2027-04-01");
  assert.equal(parsed.value.evaluated_at, "2026-09-23T12:00:00.000Z");
});

test("rejects unknown checkpoints, keys, media, role-less people and overlong ranges", () => {
  assert.equal(parseAdvancedComparisonRequest({ checkpoint: 2, metrics: ["reach"], cohorts: [cohort("A"), cohort("B")] }).ok, false);
  assert.equal(parseAdvancedComparisonRequest({ checkpoint: 7, metrics: ["reach"], cohorts: [{ ...cohort("A"), extra: true }, cohort("B")] }).ok, false);
  assert.equal(parseAdvancedComparisonRequest({ checkpoint: 7, metrics: ["reach"], cohorts: [{ ...cohort("A"), media_types: ["UNKNOWN"] }, cohort("B")] }).ok, false);
  assert.equal(parseAdvancedComparisonRequest({ checkpoint: 7, metrics: ["reach"], cohorts: [{ ...cohort("A"), participants: [{ role: "writer" }] }, cohort("B")] }).ok, false);
  assert.equal(parseAdvancedComparisonRequest({ checkpoint: 7, metrics: ["reach"], cohorts: [cohort("A", "2025-01-01", "2026-01-02"), cohort("B")] }).ok, false);
});
