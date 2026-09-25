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

test("analytics health reads the latest stored date for each stream instead of inferring coverage from sync runs", () => {
  const route = readFileSync(new URL("../app/api/admin/analytics-health/route.ts", import.meta.url), "utf8");
  const health = readFileSync(new URL("../components/analytics-health.tsx", import.meta.url), "utf8");

  assert.match(route, /from\("ig_post_daily"\)[\s\S]+order\("snapshot_date"/);
  assert.match(route, /from\("ig_account_daily"\)[\s\S]+order\("date"/);
  assert.match(route, /from\("ig_demographics"\)[\s\S]+order\("snapshot_date"/);
  assert.match(route, /streams/);
  assert.match(health, /summarizeAnalyticsFreshness/);
  for (const label of ["المنشورات", "الحساب", "الجمهور", "حديثة", "متأخرة", "لم تُجمع", "غير مستحقة بعد"]) {
    assert.match(health, new RegExp(label));
  }
  assert.match(health, /مقاييس الحساب اليومية/);
  assert.match(health, /رصيد المتابعين وعدد المواد غير متاحين ضمن هذا القياس/);
});
