# Analytics Comparisons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add factual, fully configurable comparisons, a partner-by-track matrix, a responsive post table, and an admin-only people view.

**Architecture:** A guarded database RPC performs all medians using exact checkpoints and returns measured `N`; TypeScript validates user selections and maps the result for focused UI components. No component computes a median or substitutes missing data.

**Tech Stack:** PostgreSQL/Supabase RPC, Next.js 15, React 19, TypeScript, Node test runner, accessible SVG/CSS

**Spec:** `docs/superpowers/specs/2026-09-15-admin-dashboard-analytics-redesign-design.md`

## Global Constraints

- Comparisons show facts only; no winner, verdict, or performance color.
- `N` means measured rows for the selected metric, not total linked materials.
- Reach comparisons use exact D1, D7, or D30 checkpoints; current reach is not comparable across ages.
- `N < 4` remains visible with «عيّنة صغيرة»; it is not hidden.
- Reels warnings remain visible for follows, profile visits, and signal.
- The database owns medians and archived-row exclusion.
- Empty cells are `—`, never `0`.

---

### Task 1: Comparison input validation

**Files:**
- Create: `src/lib/analytics-comparison.ts`
- Create: `src/lib/analytics-comparison.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `validateComparisonQuery(searchParams): ComparisonValidation`.
- Produces: `ComparisonDimension`, `ComparisonMetric`, and `ComparisonResult`.
- Consumes: media filters from `analytics-core.ts`.

- [ ] **Step 1: Write failing validation tests**

```ts
test("accepts two selected tracks and exact D7 reach", () => {
  const result = validateComparisonQuery(params("dimension=track&metric=reach_d7&keys=1,2&start=2026-09-01&end=2026-09-30"));
  assert.equal(result.ok, true);
});

test("rejects unsupported dimensions and more than 20 keys", () => {
  assert.equal(validateComparisonQuery(params("dimension=free_text&metric=signal&keys=1,2&start=2026-09-01&end=2026-09-30")).ok, false);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/analytics-comparison.test.ts`

Expected: FAIL because validation does not exist.

- [ ] **Step 3: Implement closed-list validation**

```ts
export const comparisonDimensions = ["track", "partner", "idea_type", "media_type", "person"] as const;
export const comparisonMetrics = ["reach_d1", "reach_d7", "reach_d30", "save_rate", "share_rate", "follow_rate", "signal", "item_count"] as const;
```

Require 2–20 unique keys, a valid range no longer than 366 days, and one known media filter or null.

- [ ] **Step 4: Verify validation**

Run: `node --test src/lib/analytics-comparison.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit validation**

```bash
git add package.json src/lib/analytics-comparison.ts src/lib/analytics-comparison.test.ts
git commit -m "feat: validate analytics comparison queries"
```

### Task 2: Exact-checkpoint comparison RPC

**Files:**
- Create: `supabase/migrations/20260915120000_admin_analytics_comparison.sql`
- Modify: `src/lib/database.types.ts`
- Create: `src/lib/analytics-comparison-sql.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `admin_analytics_comparison(p_start date, p_end date, p_dimension text, p_metric text, p_keys text[], p_media_type text default null)`.
- Returns: `dimension_key`, `dimension_name`, `participant_part`, `total_n`, `measured_n`, `median_value`, `is_thin`, `has_partial_reels`.

- [ ] **Step 1: Write failing SQL contract tests**

```ts
assert.match(sql, /age_days\s*=\s*case/);
assert.match(sql, /percentile_cont\(0\.5\)/);
assert.match(sql, /count\([^)]*metric_value[^)]*\).*measured_n/s);
assert.doesNotMatch(sql, /coalesce\([^,]+,\s*0\)/i);
assert.match(sql, /public\.is_admin\(\)/);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/analytics-comparison-sql.test.ts`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Implement the guarded RPC**

Build a `base` CTE joining non-archived published items, links, posts, exact `ig_post_daily` checkpoints, tracks, idea types, partners, and participants. Select metric values with a CASE expression; for non-checkpoint rates use the latest post view, and for reach use only `age_days = 1|7|30`.

```sql
if not public.is_active_user() or not public.is_admin() then
  raise exception 'FORBIDDEN';
end if;

select percentile_cont(0.5) within group (order by metric_value),
       count(metric_value)::integer,
       count(metric_value) < 4
from selected
group by dimension_key, dimension_name, participant_part;
```

For `person`, return separate writer/producer/reviewer rows. Revoke public execution and grant only `authenticated` after the internal admin check.

- [ ] **Step 4: Verify migration and types**

Run: `node --test src/lib/analytics-comparison-sql.test.ts && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit the RPC**

```bash
git add package.json supabase/migrations/20260915120000_admin_analytics_comparison.sql src/lib/database.types.ts src/lib/analytics-comparison-sql.test.ts
git commit -m "feat: add exact-checkpoint comparison RPC"
```

### Task 3: Comparison API and builder UI

**Files:**
- Create: `src/app/api/insights/compare/route.ts`
- Create: `src/components/insights/comparison-builder.tsx`
- Create: `src/components/insights/comparison-chart.tsx`
- Create: `src/components/insights/metric-definitions.tsx`
- Modify: `src/components/insights/insights-shell.tsx`

**Interfaces:**
- Consumes: validated comparison query and RPC rows.
- Produces: `GET /api/insights/compare` and visual rows with measured `N`.

- [ ] **Step 1: Write failing UI/API contract assertions**

```ts
assert.match(routeSource, /validateComparisonQuery/);
assert.match(routeSource, /admin_analytics_comparison/);
assert.match(uiSource, /N=/);
assert.match(uiSource, /عيّنة صغيرة/);
assert.doesNotMatch(uiSource, /الأفضل|الأضعف|متفوق/);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/analytics-comparison.test.ts`

Expected: FAIL until source-contract assertions can read the new files.

- [ ] **Step 3: Implement the builder**

Use closed-list selectors, preserve the user's selection order, default the metric to D7 reach, and expose bar/line only when the selected data supports the chart. Render thin samples with a neutral dashed pattern and visible label.

```tsx
<span className="comparison-n num">N={row.measured_n.toLocaleString("en-US")}</span>
{row.measured_n < 4 ? <span className="metric-flag">عيّنة صغيرة</span> : null}
```

Display the Reels structural warning above affected results, not inside a tooltip.

- [ ] **Step 4: Verify API, UI, and types**

Run: `node --test src/lib/analytics-comparison.test.ts && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit comparison builder**

```bash
git add src/app/api/insights/compare/route.ts src/components/insights/comparison-builder.tsx src/components/insights/comparison-chart.tsx src/components/insights/metric-definitions.tsx src/components/insights/insights-shell.tsx src/lib/analytics-comparison.test.ts
git commit -m "feat: add factual analytics comparison builder"
```

### Task 4: Partner-track matrix and collaboration history

**Files:**
- Create: `src/app/api/insights/partner-track/route.ts`
- Create: `src/components/insights/partner-track-matrix.tsx`
- Create: `src/lib/partner-track-matrix.test.ts`

**Interfaces:**
- Produces: matrix cells `{ partner_id, track_id, value, measured_n, is_thin }` and selected-partner history.
- Consumes: comparison RPC with partner-track grouping and raw post detail view.

- [ ] **Step 1: Write failing matrix tests**

```ts
test("missing collaborations remain null", () => {
  assert.equal(buildMatrix(rows, partners, tracks).cells.get("2:4")?.value, null);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/partner-track-matrix.test.ts`

Expected: FAIL because the matrix builder is absent.

- [ ] **Step 3: Implement neutral heatmap and history**

Use intensity only to encode numeric magnitude; the legend states the selected metric, not quality. Empty cells are white with `—`. Selecting a row loads chronological collaborations and raw measurements without «تحسن» or «تراجع» wording.

- [ ] **Step 4: Verify matrix and types**

Run: `node --test src/lib/partner-track-matrix.test.ts && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit matrix**

```bash
git add src/app/api/insights/partner-track/route.ts src/components/insights/partner-track-matrix.tsx src/lib/partner-track-matrix.test.ts
git commit -m "feat: add partner track analytics matrix"
```

### Task 5: Responsive post table and people panel

**Files:**
- Create: `src/app/api/insights/posts/route.ts`
- Create: `src/components/insights/post-performance-table.tsx`
- Create: `src/components/admin-people-panel.tsx`
- Modify: `src/components/admin-dashboard.tsx`
- Modify: `src/components/insights/insights-shell.tsx`
- Modify: `src/app/globals.css`
- Create: `src/lib/analytics-table.test.ts`

**Interfaces:**
- Produces: paginated/filterable post rows and role-separated people facts.
- Consumes: `v_item_performance`, partners, exact checkpoints, and comparison RPC person rows.

- [ ] **Step 1: Write failing table contract tests**

```ts
assert.match(tableSource, /قياس ناقص/);
assert.match(tableSource, /عرض التفاصيل/);
assert.match(peopleSource, /الكتابة/);
assert.match(peopleSource, /الإنتاج/);
assert.doesNotMatch(peopleSource, /الأفضل|الأضعف/);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/analytics-table.test.ts`

Expected: FAIL before the components exist.

- [ ] **Step 3: Implement paginated details and role separation**

Validate server-side sort fields against a closed list. Return 25 rows per page and total count. Desktop uses a table; below 48rem each row becomes a compact card. Selecting either opens the existing item drawer. People rows remain admin-only and include participant role plus measured `N`.

- [ ] **Step 4: Run complete verification**

Run: `pnpm test && pnpm run lint && pnpm run build`

Expected: PASS.

- [ ] **Step 5: Commit and Preview/UAT**

```bash
git add src/app/api/insights/posts/route.ts src/components/insights/post-performance-table.tsx src/components/admin-people-panel.tsx src/components/admin-dashboard.tsx src/components/insights/insights-shell.tsx src/app/globals.css src/lib/analytics-table.test.ts
git commit -m "feat: add post details and admin people analytics"
```

On Preview, test D1/D7/D30 with known posts, compare groups with N=1, N=2–3, and N>=4, verify every value against the RPC, and confirm Reels never receives a fabricated signal.
