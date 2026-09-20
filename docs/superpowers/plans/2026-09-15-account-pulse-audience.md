# Account Pulse and Audience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the long mixed analytics page with a focused account pulse and a compact latest-audience view showing at most 10 countries and 10 cities.

**Architecture:** `InsightsShell` owns filters and section navigation, while account and audience sections load independently. Pure functions preserve missing points as gaps and select the latest demographic snapshot before ranking categories.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase, accessible SVG, Node test runner, CSS

**Spec:** `docs/superpowers/specs/2026-09-15-admin-dashboard-analytics-redesign-design.md`

## Global Constraints

- A missing value is `null` end to end and renders `—`; charts never turn it into zero or connect across it.
- Account range totals appear only when all expected days are measured.
- `reach_non_followers` is never divided by or subtracted from `reach`.
- Demographics use the latest available snapshot and are independent of the date-range filter.
- Numbers are Latin; UI is Arabic RTL; no evaluative copy or colors.
- No chart dependency is added; use a small accessible SVG component.

---

### Task 1: Date presets, chart gaps, and audience ranking

**Files:**
- Create: `src/lib/account-pulse.ts`
- Create: `src/lib/account-pulse.test.ts`
- Modify: `src/lib/insights.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `currentMonthRange(now)`, `previousMonthRange(now)`, `lineSegments(points)`, and `latestAudienceSnapshot(rows)`.
- Consumes: `AccountDailyInsight` and `DemographicInsight`.

- [ ] **Step 1: Write failing pure-function tests**

```ts
test("line segments stop at missing measurements", () => {
  assert.deepEqual(lineSegments([{ x: 1, y: 4 }, { x: 2, y: null }, { x: 3, y: 8 }]), [
    [{ x: 1, y: 4 }], [{ x: 3, y: 8 }],
  ]);
});

test("audience keeps the latest snapshot and ten largest cities", () => {
  const result = latestAudienceSnapshot(demographicFixture);
  assert.equal(result.snapshot_date, "2026-09-01");
  assert.equal(result.cities.length, 10);
  assert.ok(result.cities[0].value >= result.cities[9].value);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/account-pulse.test.ts`

Expected: FAIL because the functions are absent.

- [ ] **Step 3: Implement the pure functions**

```ts
export function lineSegments(points: ChartPoint[]) {
  return points.reduce<MeasuredChartPoint[][]>((segments, point) => {
    if (point.y === null) return segments.at(-1)?.length ? [...segments, []] : segments;
    if (!segments.length) segments.push([]);
    segments.at(-1)!.push(point as MeasuredChartPoint);
    return segments;
  }, []).filter((segment) => segment.length);
}
```

Select `max(snapshot_date)`, group by normalized dimension (`country`, `city`, `age`, `gender`), sort descending by value and Arabic label on ties, and slice only countries/cities to 10.

- [ ] **Step 4: Verify date boundaries and gaps**

Run: `node --test src/lib/account-pulse.test.ts src/lib/insights.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the data rules**

```bash
git add package.json src/lib/account-pulse.ts src/lib/account-pulse.test.ts src/lib/insights.ts src/lib/insights.test.ts
git commit -m "feat: define account pulse and audience rules"
```

### Task 2: Split account and audience APIs

**Files:**
- Create: `src/app/api/insights/account/route.ts`
- Create: `src/app/api/insights/audience/route.ts`
- Create: `src/lib/insights-routes.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `GET /api/insights/account?start=YYYY-MM-DD&end=YYYY-MM-DD`.
- Produces: `GET /api/insights/audience` returning one normalized latest snapshot.
- Consumes: `requireAnalyticsAdmin`, `analyticsServiceClient`, `validateInsightRange`, `summarizeAccountRange`, and `latestAudienceSnapshot`.

- [ ] **Step 1: Write failing route contract tests**

```ts
for (const file of ["account/route.ts", "audience/route.ts"]) {
  const source = readFileSync(`src/app/api/insights/${file}`, "utf8");
  assert.match(source, /requireAnalyticsAdmin/);
  assert.match(source, /no-store/);
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/insights-routes.test.ts`

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement bounded independent queries**

The account route selects only rows inside the validated range and returns normalized daily rows plus the complete-range summary. The audience route first obtains the latest `snapshot_date`, then selects that date only and returns the ranked structure.

```ts
const latest = await service.from("ig_demographics").select("snapshot_date").order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
```

- [ ] **Step 4: Verify contracts and types**

Run: `node --test src/lib/insights-routes.test.ts && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit API split**

```bash
git add package.json src/app/api/insights/account/route.ts src/app/api/insights/audience/route.ts src/lib/insights-routes.test.ts
git commit -m "feat: split account and audience analytics APIs"
```

### Task 3: Analytics shell and account pulse UI

**Files:**
- Create: `src/components/insights/insights-shell.tsx`
- Create: `src/components/insights/account-pulse.tsx`
- Create: `src/components/insights/metric-line-chart.tsx`
- Create: `src/components/insights/data-coverage.tsx`
- Modify: `src/app/(protected)/insights/page.tsx`
- Modify: `src/components/insights-dashboard.tsx`

**Interfaces:**
- Consumes: account API and pure line segments.
- Produces: tabbed shell with `pulse`, `compare`, `matrix`, `posts`, and `audience` section keys.

- [ ] **Step 1: Add a failing UI source contract**

```ts
assert.match(shellSource, /نبض الحساب/);
assert.match(shellSource, /الشركاء × المسارات/);
assert.doesNotMatch(shellSource, /مراجعة ربط المواد المنشورة/);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/insights-routes.test.ts`

Expected: FAIL until the shell exists.

- [ ] **Step 3: Implement the shell and accessible chart**

Render four cards, one publication cadence line, follower chart, and reach/non-follower reach chart. The SVG receives already-split measured segments; each series has a text legend and an accessible data summary.

```tsx
<MetricLineChart points={daily.map((row) => ({ x: row.date, y: row.followers }))} label="المتابعون" />
```

Label follower difference «التغير في عدد المتابعين». Render `unfollows` only in the definitions/details copy as «غير متاح من Meta».

- [ ] **Step 4: Verify the focused UI**

Run: `node --test src/lib/insights-routes.test.ts src/lib/account-pulse.test.ts && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit account pulse UI**

```bash
git add 'src/app/(protected)/insights/page.tsx' src/components/insights src/components/insights-dashboard.tsx src/lib/insights-routes.test.ts
git commit -m "feat: add focused account pulse analytics"
```

### Task 4: Compact audience UI

**Files:**
- Create: `src/components/insights/audience-snapshot.tsx`
- Modify: `src/components/insights/insights-shell.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/lib/navigation-layout.test.ts`

**Interfaces:**
- Consumes: latest audience API response.
- Produces: top-10 country and city lists plus age and gender distributions.

- [ ] **Step 1: Add failing audience source assertions**

```ts
assert.match(audienceSource, /أعلى 10 دول/);
assert.match(audienceSource, /أعلى 10 مدن/);
assert.match(audienceSource, /لقطة تراكمية/);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/navigation-layout.test.ts`

Expected: FAIL until the component exists.

- [ ] **Step 3: Render neutral ranked lists**

Each row renders label, Latin number, and a neutral proportional bar. Do not render historical rows or more than 10 locations. Show the snapshot date and the under-100 Meta warning permanently.

- [ ] **Step 4: Complete responsive verification**

Run: `pnpm test && pnpm run lint && pnpm run build`

Expected: PASS with no page-level horizontal overflow at 390px.

- [ ] **Step 5: Commit and deploy Preview**

```bash
git add src/components/insights/audience-snapshot.tsx src/components/insights/insights-shell.tsx src/app/globals.css src/lib/navigation-layout.test.ts
git commit -m "feat: simplify latest audience demographics"
```

On Preview, confirm missing account days create visible gaps, top locations never exceed 10, the snapshot date is visible, and no raw daily/demographic table appears by default.
