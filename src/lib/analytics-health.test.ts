import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("analytics health is admin-only and lives on the admin dashboard", () => {
  const route = readFileSync(new URL("../app/api/admin/analytics-health/route.ts", import.meta.url), "utf8");
  const health = readFileSync(new URL("../components/analytics-health.tsx", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../components/admin-dashboard.tsx", import.meta.url), "utf8");
  const insights = readFileSync(new URL("../components/insights-dashboard.tsx", import.meta.url), "utf8");
  assert.match(route, /requireAnalyticsAdmin/);
  assert.match(route, /Cache-Control[^\n]*no-store/);
  assert.match(health, /AnalyticsLinkReview/);
  assert.match(dashboard, /AnalyticsHealth/);
  assert.doesNotMatch(insights, /AnalyticsLinkReview/);
});

test("analytics health has no link deletion or media-id clearing path", () => {
  const route = readFileSync(new URL("../app/api/admin/analytics-health/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /\.delete\s*\(/);
  assert.doesNotMatch(route, /ig_media_id\s*:\s*null/);
});
