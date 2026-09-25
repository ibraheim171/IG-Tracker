import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAnalyticsFreshness, summarizeSyncHealth } from "./analytics-health-state.ts";

test("health keeps the last accepted run visible when the newest run failed", () => {
  const summary = summarizeSyncHealth([
    { id: "failed", status: "failed", source_timestamp: "2026-09-19T06:00:00Z", received_at: "2026-09-19T06:01:00Z" },
    { id: "accepted", status: "accepted", source_timestamp: "2026-09-18T06:00:00Z", received_at: "2026-09-18T06:01:00Z" },
  ], "2026-09-19T10:00:00Z");
  assert.equal(summary.latest?.id, "failed");
  assert.equal(summary.latestAccepted?.id, "accepted");
  assert.equal(summary.latestFailed, true);
  assert.equal(summary.stale, false);
});

test("accepted data older than 36 hours is stale", () => {
  const summary = summarizeSyncHealth([
    { id: "accepted", status: "accepted", source_timestamp: "2026-09-17T00:00:00Z", received_at: "2026-09-17T00:01:00Z" },
  ], "2026-09-19T10:00:00Z");
  assert.equal(summary.stale, true);
});

test("daily stream freshness uses the Hebron calendar and the two-day account lag", () => {
  const summary = summarizeAnalyticsFreshness({
    posts: "2026-09-25",
    account: "2026-09-23",
    audience: "2026-09-20",
  }, "2026-09-24T21:30:00Z");

  assert.deepEqual(summary.posts, { status: "fresh", latestDate: "2026-09-25", expectedDate: "2026-09-25" });
  assert.deepEqual(summary.account, { status: "fresh", latestDate: "2026-09-23", expectedDate: "2026-09-23" });
  assert.deepEqual(summary.audience, { status: "not_due", latestDate: "2026-09-20", expectedDate: "2026-09-27" });
});

test("missing and late streams are reported independently", () => {
  const summary = summarizeAnalyticsFreshness({
    posts: "2026-09-22",
    account: null,
    audience: "2026-09-13",
  }, "2026-09-25T12:00:00Z");

  assert.equal(summary.posts.status, "stale");
  assert.equal(summary.account.status, "never_collected");
  assert.equal(summary.audience.status, "stale");
});

test("weekly audience data is fresh on collection day and not due until the next Sunday", () => {
  const sunday = summarizeAnalyticsFreshness({ posts: null, account: null, audience: "2026-09-27" }, "2026-09-27T12:00:00Z");
  const monday = summarizeAnalyticsFreshness({ posts: null, account: null, audience: "2026-09-27" }, "2026-09-28T12:00:00Z");
  const nextSunday = summarizeAnalyticsFreshness({ posts: null, account: null, audience: "2026-09-27" }, "2026-10-04T12:00:00Z");

  assert.equal(sunday.audience.status, "fresh");
  assert.equal(monday.audience.status, "not_due");
  assert.equal(nextSunday.audience.status, "stale");
});
