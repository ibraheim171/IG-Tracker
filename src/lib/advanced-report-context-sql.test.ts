import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20260923130000_advanced_report_context_v2.sql", "utf8");

test("database validates advanced snapshots and preserves the v1 path", () => {
  assert.match(sql, /valid_advanced_report_context_snapshot/i);
  assert.match(sql, /analytics-formulas-v2/i);
  assert.match(sql, /recorded-age-earliest-v1/i);
  assert.match(sql, /extensions\.digest/i);
  assert.match(sql, /public\.valid_report_context_snapshot\(p_input_snapshot, p_formula_version\)/i);
  assert.match(sql, /public\.valid_advanced_report_context_snapshot\(p_input_snapshot, p_formula_version\)/i);
});

test("advanced validation helper is not browser-callable", () => {
  assert.match(sql, /revoke all on function public\.valid_advanced_report_context_snapshot\(jsonb, text\) from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.valid_advanced_report_context_snapshot/i);
});
