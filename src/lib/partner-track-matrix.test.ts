import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPartnerTrackMatrix } from "./partner-track-matrix.ts";

test("missing collaborations remain null instead of becoming zero", () => {
  const result = buildPartnerTrackMatrix(
    [{ partner_id: "1", name: "شريك 1" }, { partner_id: "2", name: "شريك 2" }],
    [{ track_id: "3", name: "مسار 3" }, { track_id: "4", name: "مسار 4" }],
    [{ dimension_key: "1:3", dimension_name: "شريك 1 × مسار 3", participant_part: null, total_n: 2, measured_n: 2, median_value: 8, is_thin: true, has_partial_reels: false }],
  );

  assert.equal(result.cells.get("1:3")?.value, 8);
  assert.equal(result.cells.get("2:4")?.value, null);
  assert.equal(result.cells.get("2:4")?.measured_n, 0);
});

test("matrix maximum ignores empty cells", () => {
  const result = buildPartnerTrackMatrix(
    [{ partner_id: "1", name: "شريك" }],
    [{ track_id: "3", name: "أ" }, { track_id: "4", name: "ب" }],
    [{ dimension_key: "1:3", dimension_name: "قيمة", participant_part: null, total_n: 5, measured_n: 5, median_value: 12, is_thin: false, has_partial_reels: false }],
  );
  assert.equal(result.maximum, 12);
});

test("matrix UI shows null cells, N, and chronological collaboration history", () => {
  const route = readFileSync("src/app/api/insights/partner-track/route.ts", "utf8");
  const ui = readFileSync("src/components/insights/partner-track-matrix.tsx", "utf8");
  assert.match(route, /admin_analytics_comparison/);
  assert.match(route, /history/);
  assert.match(ui, /N=/);
  assert.match(ui, /—/);
  assert.match(ui, /سجل التعاون/);
  assert.doesNotMatch(ui, /الأفضل|الأضعف|تحسن|تراجع/);
});
