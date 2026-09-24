import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const migration = readFileSync("supabase/migrations/20260923120000_advanced_analytics_comparison.sql", "utf8");
test("comparison keeps denominators before measurement joins and fixed 2026 exclusion", () => {
  assert.match(migration,/join public\.items i on true/); assert.match(migration,/left join public\.ig_item_links/); assert.match(migration,/left join lateral[\s\S]*ig_post_daily/);
  assert.match(migration,/date '2026-04-01'/); assert.match(migration,/date '2026-06-01'/); assert.doesNotMatch(migration,/extract\s*\(\s*month/i);
});
test("comparison uses one exact checkpoint and guarded execution", () => {
  assert.match(migration,/daily\.age_days = \(p_request ->> 'checkpoint'\)::integer/); assert.match(migration,/percentile_cont\(0\.5\)/);
  assert.match(migration,/not public\.is_active_user\(\) or not public\.is_admin\(\)/); assert.match(migration,/revoke all .* from anon/i); assert.match(migration,/grant execute .* to authenticated/i);
});

test("comparison does not use the reserved OVERLAPS keyword as an alias", () => {
  assert.doesNotMatch(migration, /\)\s+overlaps\s*\)/i);
});
