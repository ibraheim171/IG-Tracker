import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("account and audience routes are same-origin, admin-only, and never cached", () => {
  for (const path of ["../app/api/insights/account/route.ts", "../app/api/insights/audience/route.ts"]) {
    const source = read(path);
    assert.match(source, /requireAnalyticsAdmin/);
    assert.match(source, /isSameOriginRead/);
    assert.match(source, /["']Cache-Control["']\s*:\s*["']no-store/);
  }
});

test("account route preserves missing measurements and complete-range summaries", () => {
  const source = read("../app/api/insights/account/route.ts");
  assert.match(source, /completeAccountDailyRange/);
  assert.match(source, /summarizeAccountFlows/);
  assert.match(source, /validateInsightRange/);
  assert.doesNotMatch(source, /reach_non_followers\s*\/\s*reach/);
  assert.match(source, /from\("ig_account_stock_observations"\)/);
  assert.match(source, /stock/);
  assert.doesNotMatch(source, /select\("date,followers,media_count/);
});

test("audience route selects one latest snapshot before ranking it", () => {
  const source = read("../app/api/insights/audience/route.ts");
  assert.match(source, /order\("snapshot_date", \{ ascending: false \}\)/);
  assert.match(source, /eq\("snapshot_date", latest\.snapshot_date\)/);
  assert.match(source, /latestAudienceSnapshot/);
});

test("analytics shell is factual and excludes operational link review", () => {
  const source = read("../components/insights/insights-shell.tsx");
  assert.match(source, /نبض الحساب/);
  assert.match(source, /الشركاء × المسارات/);
  assert.match(source, /الجمهور/);
  assert.doesNotMatch(source, /مراجعة ربط المواد المنشورة/);
  assert.doesNotMatch(source, /الأفضل|الأضعف/);
});

test("account pulse exposes coverage and Meta limitations beside the charts", () => {
  const pulse = read("../components/insights/account-pulse.tsx");
  const chart = read("../components/insights/metric-line-chart.tsx");
  assert.match(pulse, /التغير بين الرصدين/);
  assert.match(pulse, /وصول غير المتابعين/);
  assert.match(pulse, /Meta لا يزوّدنا حاليًا بعدد إلغاءات المتابعة/);
  assert.match(chart, /lineSegments/);
  assert.match(chart, /role="img"/);
});
