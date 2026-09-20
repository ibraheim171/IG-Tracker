import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("dashboard route is same-origin, admin-only, and never cached", () => {
  const source = readFileSync(new URL("../app/api/admin/dashboard/route.ts", import.meta.url), "utf8");
  assert.match(source, /requireAnalyticsAdmin/);
  assert.match(source, /isSameOriginRead/);
  assert.match(source, /Cache-Control[^\n]*no-store/);
  assert.match(source, /buildAdminDashboardSnapshot/);
  assert.match(source, /loadAllDashboardItems/);
  assert.match(source, /currentWeekRange/);
  assert.doesNotMatch(source, /\.limit\(500\)/);
});

test("dashboard UI reuses the existing item drawer", () => {
  const source = readFileSync(new URL("../components/admin-dashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /ItemDrawer/);
  assert.match(source, /قائمة القرارات/);
});
