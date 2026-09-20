import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20260915130000_report_context_blocks.sql", "utf8");

test("report blocks store immutable snapshots with formula versions", () => {
  assert.match(sql, /input_snapshot\s+jsonb\s+not null/i);
  assert.match(sql, /formula_version\s+text\s+not null/i);
  assert.match(sql, /IMMUTABLE_REPORT_CONTEXT/i);
});

test("report block writes are admin-only RPC operations", () => {
  assert.match(sql, /public\.is_active_user\(\)/);
  assert.match(sql, /public\.is_admin\(\)/);
  assert.match(sql, /revoke all on table public\.report_context_blocks/i);
  assert.match(sql, /admin_add_report_context_block/);
  assert.match(sql, /admin_reorder_report_context_blocks/);
  assert.match(sql, /admin_delete_report_context_block/);
});

test("database validates the complete snapshot contract and formula version", () => {
  assert.match(sql, /create or replace function public\.valid_report_context_snapshot/i);
  assert.match(sql, /p_formula_version\s*=\s*'analytics-formulas-v1'/i);
  assert.match(sql, /jsonb_typeof\(p_snapshot->'values'\)\s*=\s*'array'/i);
  assert.match(sql, /p_snapshot->>'metric'[\s\S]*reach_d1[\s\S]*signal/i);
  assert.match(sql, /not public\.valid_report_context_snapshot\(p_input_snapshot, p_formula_version\)/i);
});

test("deleting a context block cannot delete source analytics or AI drafts", () => {
  const deleteFunction = sql.slice(sql.indexOf("admin_delete_report_context_block"));
  assert.doesNotMatch(deleteFunction, /delete from public\.(?:ig_|items|ai_drafts)/i);
});
