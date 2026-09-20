import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("context-block API validates snapshots and uses guarded RPC writes", () => {
  const source = readFileSync("src/app/api/reports/context-blocks/route.ts", "utf8");
  assert.match(source, /requireAnalyticsAdmin/);
  assert.match(source, /validateReportContextBlock/);
  assert.match(source, /admin_add_report_context_block/);
  assert.match(source, /admin_reorder_report_context_blocks/);
  assert.match(source, /admin_delete_report_context_block/);
  assert.doesNotMatch(source, /from\("ig_.*"\)\.delete/);
});

test("analytics add button previews facts and never invokes a model", () => {
  const button = readFileSync("src/components/insights/add-to-report-button.tsx", "utf8");
  const picker = readFileSync("src/components/reports/report-context-picker.tsx", "utf8");
  assert.match(button, /أضف للتقرير/);
  assert.match(picker, /معاينة المقطع/);
  assert.doesNotMatch(button + picker, /generate|model|OpenAI/i);
});

test("monthly draft preparation is explicit, unapproved, and does not publish", () => {
  const route = readFileSync("src/app/api/admin/monthly-report-drafts/route.ts", "utf8");
  const ui = readFileSync("src/components/reports/monthly-report-draft.tsx", "utf8");
  assert.match(route, /composeMonthlyReportInput/);
  assert.match(route, /buildMonthlyDraftRow/);
  assert.match(ui, /مسودة آلية — تحتاج اعتمادًا/);
  assert.match(ui, /onClick/);
  assert.doesNotMatch(route, /approved_at:\s*new Date|publish/i);
});
