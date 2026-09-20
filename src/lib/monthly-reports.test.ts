import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateMonthlyReportInput } from "./monthly-reports.ts";

test("month must be the first calendar day", () => {
  assert.equal(validateMonthlyReportInput({ month: "2026-09-15", title: "سبتمبر", contextNote: "" }).ok, false);
  assert.equal(validateMonthlyReportInput({ month: "2026-09-01", title: "سبتمبر", contextNote: "" }).ok, true);
});

test("monthly report text fields are bounded", () => {
  assert.equal(validateMonthlyReportInput({ month: "2026-09-01", title: "", contextNote: "" }).ok, false);
  assert.equal(validateMonthlyReportInput({ month: "2026-09-01", title: "x".repeat(161), contextNote: "" }).ok, false);
  assert.equal(validateMonthlyReportInput({ month: "2026-09-01", title: "سبتمبر", contextNote: "x".repeat(4001) }).ok, false);
});

test("monthly workspace is separate from existing weekly HTML reports", () => {
  const route = readFileSync("src/app/api/admin/monthly-reports/route.ts", "utf8");
  const nav = readFileSync("src/components/app-navigation.tsx", "utf8");
  assert.match(route, /requireAnalyticsAdmin/);
  assert.match(route, /validateMonthlyReportInput/);
  assert.doesNotMatch(route, /weekly_reports/);
  assert.match(nav, /التقرير الشهري/);
});

test("each selected report owns a fresh draft workspace", () => {
  const workspace = readFileSync("src/components/reports/monthly-report-workspace.tsx", "utf8");
  assert.match(workspace, /<MonthlyReportDraft\s+key=\{selected\.id\}\s+reportId=\{selected\.id\}/);
});
