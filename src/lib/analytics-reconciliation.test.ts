import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/20260914190000_reconcile_exact_instagram_links.sql";
const correctionMigrationPath = "supabase/migrations/20260915002000_reconcile_links_for_all_calendar_dates.sql";
const routePath = "src/app/api/admin/analytics-links/route.ts";

test("the initial reconciliation migration is preserved as historical evidence", () => {
  assert.equal(existsSync(migrationPath), true);
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /canonical_instagram_permalink\(i\.ig_permalink\)[\s\S]+canonical_instagram_permalink\(p\.permalink\)/i);
  assert.match(sql, /'مطابقة تلقائية تامة للرابط الدائم'/);
  assert.match(sql, /extract\(month from p\.published_at at time zone 'Asia\/Hebron'\) not in \(4, 5\)/i);
});

test("the link review endpoint excludes archived items, not calendar months", () => {
  const route = readFileSync(routePath, "utf8");
  assert.match(route, /eq\("is_archived", false\)/);
  assert.doesNotMatch(route, /isOperationalAnalyticsDate|E_EXCLUDED_MONTH/);
});

test("the reconciliation correction accepts every calendar month", () => {
  assert.equal(existsSync(correctionMigrationPath), true);
  const sql = readFileSync(correctionMigrationPath, "utf8");
  assert.match(sql, /where not i\.is_archived\s+and i\.status = 'published'/i);
  assert.doesNotMatch(sql, /extract\(month|not in \(4, 5\)/i);
});
