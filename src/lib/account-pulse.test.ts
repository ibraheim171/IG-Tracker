import assert from "node:assert/strict";
import test from "node:test";
import {
  completeAccountDailyRange,
  currentMonthRange,
  followerDailyChanges,
  latestAudienceSnapshot,
  lineSegments,
  previousMonthRange,
} from "./account-pulse.ts";

test("month presets use calendar months in the account timezone", () => {
  const now = new Date("2026-09-15T10:00:00Z");
  assert.deepEqual(currentMonthRange(now), { start: "2026-09-01", end: "2026-09-15" });
  assert.deepEqual(previousMonthRange(now), { start: "2026-08-01", end: "2026-08-31" });
});

test("daily follower change stays null across missing account days", () => {
  assert.deepEqual(followerDailyChanges([
    { date: "2026-09-01", followers: 100 },
    { date: "2026-09-02", followers: 104 },
    { date: "2026-09-03", followers: null },
    { date: "2026-09-04", followers: 109 },
  ]), [
    { x: "2026-09-01", y: null },
    { x: "2026-09-02", y: 4 },
    { x: "2026-09-03", y: null },
    { x: "2026-09-04", y: null },
  ]);
});

test("line segments stop at missing measurements", () => {
  assert.deepEqual(lineSegments([{ x: 1, y: 4 }, { x: 2, y: null }, { x: 3, y: 8 }]), [
    [{ x: 1, y: 4 }],
    [{ x: 3, y: 8 }],
  ]);
});

test("consecutive missing measurements do not create empty segments", () => {
  assert.deepEqual(lineSegments([{ x: "a", y: null }, { x: "b", y: null }, { x: "c", y: 2 }]), [
    [{ x: "c", y: 2 }],
  ]);
});

test("a completely absent account day becomes a null chart gap", () => {
  const complete = completeAccountDailyRange(
    { start: "2026-09-01", end: "2026-09-03" },
    [{
      date: "2026-09-01", followers: 10, media_count: 2, reach: 3, views: 4,
      reach_followers: null, reach_non_followers: null, follows: null, unfollows: null, missing_metrics: [],
    }, {
      date: "2026-09-03", followers: 12, media_count: 2, reach: 5, views: 8,
      reach_followers: null, reach_non_followers: null, follows: null, unfollows: null, missing_metrics: [],
    }],
  );

  assert.equal(complete.length, 3);
  assert.equal(complete[1].date, "2026-09-02");
  assert.equal(complete[1].followers, null);
  assert.equal(complete[1].reach, null);
  assert.ok(complete[1].missing_metrics.includes("day"));
});

test("audience keeps only the latest snapshot and ten largest locations", () => {
  const old = [{ snapshot_date: "2026-08-01", dimension: "city", key: "Old", value: 999 }];
  const cities = Array.from({ length: 12 }, (_, index) => ({
    snapshot_date: "2026-09-01",
    dimension: "city",
    key: `City ${index + 1}`,
    value: index + 1,
  }));
  const result = latestAudienceSnapshot([
    ...old,
    ...cities,
    { snapshot_date: "2026-09-01", dimension: "country", key: "PS", value: 30 },
    { snapshot_date: "2026-09-01", dimension: "country", key: "JO", value: 20 },
    { snapshot_date: "2026-09-01", dimension: "age", key: "25-34", value: 14 },
    { snapshot_date: "2026-09-01", dimension: "gender", key: "F", value: null },
  ]);

  assert.equal(result.snapshot_date, "2026-09-01");
  assert.equal(result.cities.length, 10);
  assert.deepEqual(result.cities.map((row) => row.value), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.deepEqual(result.countries.map((row) => row.key), ["PS", "JO"]);
  assert.equal(result.ages[0]?.key, "25-34");
  assert.equal(result.genders[0]?.value, null);
});

test("audience returns an empty dated shape when Meta has no snapshot", () => {
  assert.deepEqual(latestAudienceSnapshot([]), {
    snapshot_date: null,
    source_time: null,
    countries: [],
    cities: [],
    ages: [],
    genders: [],
  });
});
