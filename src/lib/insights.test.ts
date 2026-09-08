import assert from "node:assert/strict";
import test from "node:test";
import { buildInsightsSnapshot, buildPerformanceAggregates, currentWeekRange, insightUtcBounds, validateInsightRange } from "./insights.ts";

test("current week uses Monday through Sunday in the application time zone", () => {
  assert.deepEqual(currentWeekRange(new Date("2026-09-09T10:00:00Z")), { start: "2026-09-07", end: "2026-09-13" });
});

test("date range accepts real dates and rejects reversed, malformed, and overlong ranges", () => {
  assert.deepEqual(validateInsightRange("2026-09-01", "2026-09-08"), { ok: true, range: { start: "2026-09-01", end: "2026-09-08" } });
  assert.equal(validateInsightRange("2026-09-08", "2026-09-01").ok, false);
  assert.equal(validateInsightRange("2026-02-30", "2026-03-01").ok, false);
  assert.equal(validateInsightRange("2025-01-01", "2026-09-01").ok, false);
});

test("date filters use Asia/Hebron day boundaries instead of UTC midnight", () => {
  assert.deepEqual(insightUtcBounds({ start: "2026-09-07", end: "2026-09-13" }), {
    start: "2026-09-06T21:00:00.000Z",
    endExclusive: "2026-09-13T21:00:00.000Z",
  });
  assert.deepEqual(insightUtcBounds({ start: "2026-01-05", end: "2026-01-05" }), {
    start: "2026-01-04T22:00:00.000Z",
    endExclusive: "2026-01-05T22:00:00.000Z",
  });
});

test("aggregation counts operational state and partner activity from deterministic rows", () => {
  const snapshot = buildInsightsSnapshot({
    range: { start: "2026-09-07", end: "2026-09-13" },
    items: [
      { id: "idea", status: "idea", is_archived: false, published_at: null },
      { id: "ready", status: "ready", is_archived: false, published_at: null },
      { id: "published", status: "published", is_archived: false, published_at: "2026-09-09T18:00:00Z" },
      { id: "local-midnight", status: "published", is_archived: false, published_at: "2026-09-06T22:00:00Z" },
      { id: "old", status: "published", is_archived: false, published_at: "2026-08-01T18:00:00Z" },
      { id: "archived", status: "ready", is_archived: true, published_at: null },
      { id: "cancelled", status: "cancelled", is_archived: false, published_at: null },
    ],
    slots: [{ slot_id: "slot", slot_at: "2026-09-12T18:00:00Z", state: "open", n_items: 1, n_ready: 1 }],
    overdueItemIds: ["ready", "ready"],
    blockedItemIds: ["idea"],
    partnerActivity: [
      { partner_id: 4, partner_name: "شريك", item_id: "published", track_id: 2, published_at: "2026-09-09T18:00:00Z" },
      { partner_id: 4, partner_name: "شريك", item_id: "published", track_id: 2, published_at: "2026-09-09T18:00:00Z" },
    ],
    partnerPerformance: [
      { partner_id: 4, partner_name: "شريك", track_id: 2, track_name: "نبض المسرى", n: 3, median_reach: null, median_signal: null, sample_sufficient: false },
      { partner_id: 4, partner_name: "شريك", track_id: 3, track_name: "بوصلة الوعي", n: 5, median_reach: 1200, median_signal: 15, sample_sufficient: true },
    ],
  });
  assert.equal(snapshot.total_active, 2);
  assert.equal(snapshot.published_in_period, 2);
  assert.equal(snapshot.ready, 1);
  assert.equal(snapshot.overdue, 1);
  assert.equal(snapshot.blocked, 1);
  assert.equal(snapshot.partner_linked_materials, 1);
  assert.equal(snapshot.active_partners, 1);
  assert.equal(snapshot.partners[0].published_in_period, 2);
  assert.equal(snapshot.partners[0].median_reach, null);
  assert.equal(snapshot.partners[0].sample_sufficient, false);
  assert.equal(snapshot.partners.find((row) => row.track_id === 3)?.published_in_period, 0);
});

test("empty analytics remains an explicit empty snapshot", () => {
  const snapshot = buildInsightsSnapshot({ range: { start: "2026-09-07", end: "2026-09-13" }, items: [], slots: [], overdueItemIds: [], blockedItemIds: [], partnerActivity: [], partnerPerformance: [] });
  assert.equal(snapshot.total_active, 0);
  assert.deepEqual(snapshot.partners, []);
  assert.deepEqual(snapshot.upcoming_slots, []);
});

test("period aggregates use medians, give every linked partner full credit, and guard partner-track N below 5", () => {
  const rows = [1, 2, 3, 100, 200].map((reach, index) => ({
    id: `item-${index}`, published_at: "2026-09-08T18:00:00Z", track_id: 2, track_name: "نبض المسرى", idea_type_id: 1, idea_type: "منشور", reach,
    save_rate: reach / 10, share_rate: reach / 20, signal: reach / 5,
  }));
  const links = rows.flatMap((row) => [
    { item_id: row.id, partner_id: 1, partner_name: "الشريك الأول" },
    { item_id: row.id, partner_id: 2, partner_name: "الشريك الثاني" },
  ]);
  const aggregates = buildPerformanceAggregates(rows, links);
  assert.equal(aggregates.find((row) => row.dimension === "month")?.median_reach, 3);
  assert.equal(aggregates.find((row) => row.dimension === "partner" && row.key === "1")?.n, 5);
  assert.equal(aggregates.find((row) => row.dimension === "partner" && row.key === "2")?.n, 5);
  assert.equal(aggregates.find((row) => row.dimension === "partner_track" && row.key === "1:2")?.median_reach, 3);
  const thin = buildPerformanceAggregates(rows.slice(0, 4), links.filter((link) => Number(link.item_id.at(-1)) < 4));
  assert.equal(thin.find((row) => row.dimension === "partner_track")?.median_reach, null);
  assert.equal(thin.find((row) => row.dimension === "partner_track")?.sample_sufficient, false);
});
