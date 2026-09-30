import assert from "node:assert/strict";
import test from "node:test";
import {
  completeAccountDailyRange,
  currentMonthRange,
  accountStockChanges,
  latestAudienceSnapshot,
  lineSegments,
  previousMonthRange,
} from "./account-pulse.ts";

test("month presets use calendar months in the account timezone", () => {
  const now = new Date("2026-09-15T10:00:00Z");
  assert.deepEqual(currentMonthRange(now), { start: "2026-09-01", end: "2026-09-15" });
  assert.deepEqual(previousMonthRange(now), { start: "2026-08-01", end: "2026-08-31" });
});

test("stock change is calculated only between measured observations and keeps gaps explicit", () => {
  assert.deepEqual(accountStockChanges([
    { observation_key: "o1", observed_at: "2026-09-01T03:00:00Z", source: "instagram_profile", followers_count: 100, media_count: 20, missing_metrics: [], source_timestamp: "2026-09-01T03:01:00Z" },
    { observation_key: "o2", observed_at: "2026-09-04T03:00:00Z", source: "instagram_profile", followers_count: 109, media_count: null, missing_metrics: ["media_count"], source_timestamp: "2026-09-04T03:01:00Z" },
    { observation_key: "o3", observed_at: "2026-09-08T03:00:00Z", source: "instagram_profile", followers_count: null, media_count: 23, missing_metrics: ["followers_count"], source_timestamp: "2026-09-08T03:01:00Z" },
  ]), [
    { observation_key: "o1", observed_at: "2026-09-01T03:00:00Z", followers_count: 100, media_count: 20, follower_change: null, media_count_change: null },
    { observation_key: "o2", observed_at: "2026-09-04T03:00:00Z", followers_count: 109, media_count: null, follower_change: 9, media_count_change: null },
    { observation_key: "o3", observed_at: "2026-09-08T03:00:00Z", followers_count: null, media_count: 23, follower_change: null, media_count_change: 3 },
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
      date: "2026-09-01", reach: 3, views: 4,
      reach_followers: null, reach_non_followers: null, follows: null, unfollows: null, missing_metrics: [],
    }, {
      date: "2026-09-03", reach: 5, views: 8,
      reach_followers: null, reach_non_followers: null, follows: null, unfollows: null, missing_metrics: [],
    }],
  );

  assert.equal(complete.length, 3);
  assert.equal(complete[1].date, "2026-09-02");
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
