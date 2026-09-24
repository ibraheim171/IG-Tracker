import assert from "node:assert/strict";
import test from "node:test";
import { summarizeSyncHealth } from "./analytics-health-state.ts";

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
