import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20260915120000_admin_analytics_comparison.sql", "utf8");

test("comparison RPC owns exact checkpoints, medians, and measured N", () => {
  assert.match(sql, /age_days\s*=\s*case/i);
  assert.match(sql, /percentile_cont\(0\.5\)/i);
  assert.match(sql, /count\(selected\.metric_value\)::integer\s+as\s+measured_n/i);
  assert.doesNotMatch(sql, /coalesce\([^,]+,\s*0\)/i);
});

test("comparison RPC is guarded and excludes archived materials", () => {
  assert.match(sql, /public\.is_active_user\(\)/);
  assert.match(sql, /public\.is_admin\(\)/);
  assert.match(sql, /not\s+i\.is_archived/i);
  assert.match(sql, /revoke all on function public\.admin_analytics_comparison/i);
});

test("person comparisons keep participant roles separate", () => {
  assert.match(sql, /item_participants/);
  assert.match(sql, /participant_part/);
  assert.match(sql, /group by selected\.dimension_key, selected\.dimension_name, selected\.participant_part/i);
});

test("comparison RPC qualifies names that collide with RETURNS TABLE variables", () => {
  assert.match(sql, /select\s+expanded\.\*[\s\S]*from\s+expanded\s+where\s+expanded\.dimension_key\s*=\s*any\(p_keys\)/i);
  assert.match(sql, /group by\s+selected\.dimension_key,\s*selected\.dimension_name,\s*selected\.participant_part/i);
  assert.match(sql, /array_position\(p_keys,\s*selected\.dimension_key\)/i);
});
