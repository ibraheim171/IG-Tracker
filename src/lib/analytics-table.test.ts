import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizePostSearch, parseInsightSection } from "./analytics-table.ts";

test("post search accepts useful Arabic and Latin terms but rejects filter syntax", () => {
  assert.deepEqual(normalizePostSearch("  القدس 2026-09  "), { ok: true, value: "القدس 2026-09" });
  assert.deepEqual(normalizePostSearch("AQ-104"), { ok: true, value: "AQ-104" });
  assert.deepEqual(normalizePostSearch("title,ref"), { ok: false, code: "E_SEARCH" });
  assert.deepEqual(normalizePostSearch("%admin%"), { ok: false, code: "E_SEARCH" });
});

test("insights deep links only accept known sections", () => {
  assert.equal(parseInsightSection("posts"), "posts");
  assert.equal(parseInsightSection("audience"), "audience");
  assert.equal(parseInsightSection("unknown"), "pulse");
  assert.equal(parseInsightSection(null), "pulse");
});

test("post route uses bounded pagination and closed sort fields", () => {
  const source = readFileSync("src/app/api/insights/posts/route.ts", "utf8");
  const helperSource = readFileSync("src/lib/analytics-table.ts", "utf8");
  assert.match(source, /pageSize\s*=\s*25/);
  assert.match(source, /import\s*\{[^}]*postSortFields/);
  assert.doesNotMatch(source, /export\s+const\s+postSortFields/);
  assert.match(helperSource, /export\s+const\s+postSortFields/);
  assert.match(source, /validateInsightRange/);
  assert.match(source, /requireAnalyticsAdmin/);
  assert.match(source, /normalizePostSearch/);
});

test("post details remain factual and open the existing material drawer", () => {
  const source = readFileSync("src/components/insights/post-performance-table.tsx", "utf8");
  assert.match(source, /قياس ناقص/);
  assert.match(source, /عرض التفاصيل/);
  assert.match(source, /ItemDrawer/);
  assert.match(source, /المسار|الشريك/);
  assert.match(source, /نوع الفكرة/);
  assert.match(source, /المشاهدات/);
  assert.match(source, /direction/);
  assert.doesNotMatch(source, /الأفضل|الأضعف/);
});

test("people panel separates participation roles and avoids judgments", () => {
  const source = readFileSync("src/components/admin-people-panel.tsx", "utf8");
  assert.match(source, /الكتابة/);
  assert.match(source, /الإنتاج/);
  assert.match(source, /المراجعة/);
  assert.match(source, /N=/);
  assert.doesNotMatch(source, /الأفضل|الأضعف/);
});
