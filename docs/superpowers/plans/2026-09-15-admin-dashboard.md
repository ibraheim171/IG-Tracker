# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only decision dashboard, make it the admin landing page, and move Instagram linking and sync health out of analytics without changing any existing link.

**Architecture:** Move the publishing schedule from `/` to `/schedule`, make `/` a role-aware redirect, and serve dashboard data from a focused admin route. Pure builders classify decision rows; UI components only render returned facts and reuse the existing item drawer and linking workflow.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase, Node test runner, CSS

**Spec:** `docs/superpowers/specs/2026-09-15-admin-dashboard-analytics-redesign-design.md`

## Global Constraints

- Existing `ig_item_links` rows and non-null `items.ig_media_id` values must never be deleted, overwritten, or bulk-reconciled.
- Missing metrics render as `—`, never `0`.
- User-facing copy is Arabic RTL; comments and identifiers are English; numbers are Latin.
- Admin authorization is enforced server-side.
- No performance verdicts or evaluative colors.
- Production is not changed; every completed task is verified on Preview first.

---

### Task 1: Role-aware landing and schedule route

**Files:**
- Create: `src/lib/home-routing.ts`
- Create: `src/lib/home-routing.test.ts`
- Create: `src/app/(protected)/schedule/page.tsx`
- Modify: `src/app/(protected)/page.tsx`
- Modify: `src/components/app-navigation.tsx`
- Modify: `package.json`

**Interfaces:**
- Produces: `homePathForRoles(roles: string[]): "/admin/dashboard" | "/schedule"`
- Consumes: `getCurrentProfile()` and the existing schedule page implementation.

- [ ] **Step 1: Write the failing routing test**

```ts
test("admins land on the decision dashboard and members land on the schedule", () => {
  assert.equal(homePathForRoles(["admin"]), "/admin/dashboard");
  assert.equal(homePathForRoles(["writer"]), "/schedule");
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test src/lib/home-routing.test.ts`

Expected: FAIL because `homePathForRoles` does not exist.

- [ ] **Step 3: Implement the routing function and move the schedule page**

```ts
export function homePathForRoles(roles: string[]) {
  return roles.includes("admin") ? "/admin/dashboard" as const : "/schedule" as const;
}
```

The new root page calls `redirect(homePathForRoles(profile.roles))`. Copy the current root schedule implementation unchanged into `/schedule/page.tsx`. Add separate navigation links for «لوحة الأدمن» and «خطة النشر»; only the former is admin-only.

- [ ] **Step 4: Verify routing and navigation**

Run: `node --test src/lib/home-routing.test.ts src/lib/navigation-layout.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the routing slice**

```bash
git add package.json src/lib/home-routing.ts src/lib/home-routing.test.ts 'src/app/(protected)/page.tsx' 'src/app/(protected)/schedule/page.tsx' src/components/app-navigation.tsx src/lib/navigation-layout.test.ts
git commit -m "feat: add role-aware admin landing"
```

### Task 2: Decision snapshot builder

**Files:**
- Create: `src/lib/admin-dashboard.ts`
- Create: `src/lib/admin-dashboard.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildAdminDashboardSnapshot(input: AdminDashboardInput): AdminDashboardSnapshot`
- Produces: `AdminDecision`, `AdminWeekSummary`, and `StageDurationRow` types.
- Consumes: literal item status, slot timestamps, waiting rows, transitions, and `Asia/Hebron` time.

- [ ] **Step 1: Write failing classification tests**

```ts
test("classifies only factual admin decisions", () => {
  const snapshot = buildAdminDashboardSnapshot(fixture);
  assert.deepEqual(snapshot.week, { published: 2, available_slots: 3, ready: 1, uncovered_slots: 1 });
  assert.deepEqual(snapshot.decisions.map((row) => row.kind), [
    "slot_without_ready_item", "overdue_unpublished", "published_without_instagram_link",
  ]);
});

test("never queues an already linked published item", () => {
  const snapshot = buildAdminDashboardSnapshot(linkedFixture);
  assert.equal(snapshot.decisions.some((row) => row.kind === "published_without_instagram_link"), false);
});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `node --test src/lib/admin-dashboard.test.ts`

Expected: FAIL because the builder does not exist.

- [ ] **Step 3: Implement deterministic classifications**

```ts
export type AdminDecisionKind =
  | "content_approval"
  | "design_approval"
  | "ready_without_slot"
  | "slot_without_ready_item"
  | "overdue_unpublished"
  | "published_without_instagram_link";

export function decisionSortKey(row: AdminDecision) {
  return `${row.due_at ?? "9999-12-31"}:${String(row.waiting_days).padStart(5, "0")}:${row.ref}`;
}
```

Classify from literal fields only. A link decision requires `status === "published"`, `is_archived === false`, and no link row/no `ig_media_id`. Do not infer completion from notes.

- [ ] **Step 4: Verify the builder**

Run: `node --test src/lib/admin-dashboard.test.ts`

Expected: PASS, including the already-linked regression.

- [ ] **Step 5: Commit the builder**

```bash
git add package.json src/lib/admin-dashboard.ts src/lib/admin-dashboard.test.ts
git commit -m "feat: classify admin dashboard decisions"
```

### Task 3: Admin dashboard API and page

**Files:**
- Create: `src/app/api/admin/dashboard/route.ts`
- Create: `src/app/(protected)/admin/dashboard/page.tsx`
- Create: `src/components/admin-dashboard.tsx`
- Create: `src/lib/admin-dashboard-route.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `buildAdminDashboardSnapshot`, `requireAnalyticsAdmin`, `analyticsServiceClient`.
- Produces: `GET /api/admin/dashboard` returning `{ snapshot }` with `Cache-Control: no-store`.

- [ ] **Step 1: Write failing route-source and builder-contract tests**

```ts
test("dashboard route requires admin authorization", () => {
  const source = readFileSync("src/app/api/admin/dashboard/route.ts", "utf8");
  assert.match(source, /requireAnalyticsAdmin/);
  assert.match(source, /Cache-Control.*no-store/s);
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `node --test src/lib/admin-dashboard-route.test.ts`

Expected: FAIL because the route file is absent.

- [ ] **Step 3: Implement the route and client page**

Query active items, `v_slot_board`, `v_waiting`, participants, transitions, link identities, and the latest sync run. Return only the fields required by `AdminDashboardInput`.

```ts
const auth = await requireAnalyticsAdmin(request, sessionResponse);
if (!auth.ok) return jsonWithCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, sessionResponse);
```

Render the four weekly facts and one ordered decision list. Use buttons with a minimum 44px target; selecting an item opens the existing `ItemDrawer` with its item ID.

- [ ] **Step 4: Verify route protection and build**

Run: `node --test src/lib/admin-dashboard-route.test.ts src/lib/admin-dashboard.test.ts && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit the dashboard page**

```bash
git add package.json src/app/api/admin/dashboard/route.ts 'src/app/(protected)/admin/dashboard/page.tsx' src/components/admin-dashboard.tsx src/lib/admin-dashboard-route.test.ts
git commit -m "feat: add admin decision dashboard"
```

### Task 4: Move linking and sync health out of analytics

**Files:**
- Create: `src/components/analytics-health.tsx`
- Create: `src/app/api/admin/analytics-health/route.ts`
- Modify: `src/components/admin-dashboard.tsx`
- Modify: `src/components/insights-dashboard.tsx`
- Modify: `src/lib/analytics-core.test.ts`

**Interfaces:**
- Consumes: existing `AnalyticsLinkReview`, `/api/admin/analytics-links`, and latest `analytics_sync_runs` rows.
- Produces: admin-only health section; no new link mutation path.

- [ ] **Step 1: Add the link-preservation regression**

```ts
test("link review excludes linked items even when their item media id is present", () => {
  const result = buildLinkReviewQueue(posts, items, [{ item_id: items[0].id, media_id: posts[0].media_id }]);
  assert.equal(result.items.some((row) => row.id === items[0].id), false);
});
```

- [ ] **Step 2: Run the regression**

Run: `node --test src/lib/analytics-core.test.ts`

Expected: PASS before and after the move; it is a preservation test.

- [ ] **Step 3: Implement the health section**

Move the `AnalyticsLinkReview` render from `InsightsDashboard` into `AnalyticsHealth`. Add a read-only health route returning last success, last received time, counts, and the last 20 runs. Keep the existing POST RPC unchanged.

```tsx
<section aria-labelledby="analytics-health-title">
  <h2 id="analytics-health-title">سلامة البيانات والربط</h2>
  <SyncHealthSummary health={health} />
  <AnalyticsLinkReview />
</section>
```

- [ ] **Step 4: Verify no link mutation was added**

Run: `rg -n "delete\(|ig_media_id.*null|from\(\"ig_item_links\"\).*delete" src/app/api/admin src/components` and inspect every match.

Expected: no deletion or nulling path.

Run: `pnpm test && pnpm run build`

Expected: PASS.

- [ ] **Step 5: Commit the move**

```bash
git add src/components/analytics-health.tsx src/app/api/admin/analytics-health/route.ts src/components/admin-dashboard.tsx src/components/insights-dashboard.tsx src/lib/analytics-core.test.ts
git commit -m "feat: move analytics health to admin dashboard"
```

### Task 5: Responsive dashboard acceptance

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/lib/navigation-layout.test.ts`

**Interfaces:**
- Consumes: dashboard class names from Tasks 1–4.
- Produces: 390px, 1024px, and 1440px layouts without page-level horizontal scrolling.

- [ ] **Step 1: Add failing CSS contract tests**

```ts
assert.match(css, /\.admin-decision-list/);
assert.match(css, /min-inline-size:\s*44px/);
assert.doesNotMatch(css, /\.admin-dashboard[^}]*overflow-x:\s*auto/);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/navigation-layout.test.ts`

Expected: FAIL until dashboard CSS exists.

- [ ] **Step 3: Add mobile-first dashboard styles**

Use one column below 48rem, two columns for summary cards above 48rem, and four above 75rem. Decision metadata wraps; the action remains a 44px button.

- [ ] **Step 4: Run complete verification**

Run: `pnpm test && pnpm run lint && pnpm run build`

Expected: PASS.

- [ ] **Step 5: Commit and deploy Preview**

```bash
git add src/app/globals.css src/lib/navigation-layout.test.ts
git commit -m "style: finish responsive admin dashboard"
```

Deploy the branch to Preview, authenticate as admin and non-admin, confirm their landing destinations, inspect the link count before and after, and record that the set of existing `(item_id, media_id)` pairs is unchanged.
