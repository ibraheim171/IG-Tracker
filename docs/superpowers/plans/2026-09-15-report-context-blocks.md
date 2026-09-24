# Report Context Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin select factual analytics views for a monthly report, preserve their formulas and warnings, and feed the approved selection into `ai_drafts` without automatic judgement or publication.

**Architecture:** Context blocks store snapshot-immutable analytics content against a monthly `reports` row while allowing explicit reorder and removal. A deterministic composer produces Markdown input; a separate explicit draft action writes an `ai_drafts.monthly_report` row and never runs automatically.

**Tech Stack:** PostgreSQL/Supabase, Next.js 15, React 19, TypeScript, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-15-admin-dashboard-analytics-redesign-design.md`

## Global Constraints

- «أضف للتقرير» stores numbers and context only; it does not generate conclusions.
- Every saved block includes period, filters, values, measured `N`, data warnings, source time, and formula version.
- AI output is always «مسودة آلية — تحتاج اعتمادًا» and is never auto-published.
- Only an active admin can create, reorder, or remove blocks and request a monthly draft.
- Existing weekly HTML reports remain unchanged.
- No model/provider call is added until an explicit configured provider exists; this plan prepares and records the exact AI input snapshot.

---

### Task 1: Context-block schema and permissions

**Files:**
- Create: `supabase/migrations/20260915130000_report_context_blocks.sql`
- Modify: `src/lib/database.types.ts`
- Create: `src/lib/report-context-sql.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `report_context_blocks(id, report_id, block_type, title, input_snapshot, formula_version, position, created_by, created_at)`.
- Produces: `admin_add_report_context_block`, `admin_reorder_report_context_blocks`, and `admin_delete_report_context_block` RPCs.
- Produces: a trigger that rejects changes to snapshot content while allowing position-only changes through the reorder RPC.

- [ ] **Step 1: Write failing migration contract tests**

```ts
assert.match(sql, /input_snapshot\s+jsonb\s+not null/i);
assert.match(sql, /formula_version\s+text\s+not null/i);
assert.match(sql, /public\.is_admin\(\)/);
assert.match(sql, /revoke all .* report_context_blocks/is);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/report-context-sql.test.ts`

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Implement append-only snapshot storage**

```sql
create table public.report_context_blocks (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  block_type text not null check (block_type in ('account', 'comparison', 'partner_track', 'posts', 'audience')),
  title text not null,
  input_snapshot jsonb not null,
  formula_version text not null,
  position integer not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
```

RPCs validate admin status and ownership. Delete affects only a selected report block, never analytics source rows or `ai_drafts`.

- [ ] **Step 4: Verify SQL contracts and generated types**

Run: `node --test src/lib/report-context-sql.test.ts && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit schema**

```bash
git add package.json supabase/migrations/20260915130000_report_context_blocks.sql src/lib/database.types.ts src/lib/report-context-sql.test.ts
git commit -m "feat: add immutable report context blocks"
```

### Task 2: Snapshot validation and Markdown composer

**Files:**
- Create: `src/lib/report-context.ts`
- Create: `src/lib/report-context.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `validateReportContextBlock(input)`.
- Produces: `composeMonthlyReportInput(report, blocks): string`.
- Produces: constant `ANALYTICS_FORMULA_VERSION = "analytics-formulas-v1"`.

- [ ] **Step 1: Write failing validation/composition tests**

```ts
test("composer includes values, measured N, warnings, and formula version", () => {
  const markdown = composeMonthlyReportInput(report, [block]);
  assert.match(markdown, /N=2/);
  assert.match(markdown, /عيّنة صغيرة/);
  assert.match(markdown, /analytics-formulas-v1/);
});

test("missing values remain an em dash", () => {
  assert.match(composeMonthlyReportInput(report, [missingBlock]), /—/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/report-context.test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement strict snapshot validation**

Allow only known block types and metrics, ISO dates, finite numeric values or null, non-negative integer `N`, known warnings, and a maximum serialized snapshot size of 64 KiB.

```ts
export const ANALYTICS_FORMULA_VERSION = "analytics-formulas-v1";
export function displaySnapshotValue(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
```

- [ ] **Step 4: Verify deterministic output**

Run: `node --test src/lib/report-context.test.ts`

Expected: PASS with stable Markdown ordering.

- [ ] **Step 5: Commit core logic**

```bash
git add package.json src/lib/report-context.ts src/lib/report-context.test.ts
git commit -m "feat: validate and compose report analytics context"
```

### Task 3: Monthly report workspace

**Files:**
- Create: `src/app/api/admin/monthly-reports/route.ts`
- Create: `src/app/(protected)/admin/monthly-reports/page.tsx`
- Create: `src/components/reports/monthly-report-workspace.tsx`
- Create: `src/lib/monthly-reports.ts`
- Create: `src/lib/monthly-reports.test.ts`
- Modify: `src/components/app-navigation.tsx`
- Modify: `package.json`

**Interfaces:**
- Produces: `GET` and `POST /api/admin/monthly-reports` for listing and creating rows in `reports`.
- Produces: `validateMonthlyReportInput({ month, title, contextNote })`.
- Consumes: existing `reports` table and server-side admin authorization.

- [ ] **Step 1: Write failing monthly-report tests**

```ts
test("month must be the first calendar day", () => {
  assert.equal(validateMonthlyReportInput({ month: "2026-09-15", title: "سبتمبر", contextNote: "" }).ok, false);
  assert.equal(validateMonthlyReportInput({ month: "2026-09-01", title: "سبتمبر", contextNote: "" }).ok, true);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/monthly-reports.test.ts`

Expected: FAIL because the validator is absent.

- [ ] **Step 3: Implement the admin-only workspace**

Validate title length 1–160, first-day ISO month, and context note length up to 4,000 characters. The workspace lists monthly reports, creates a report, edits the human context note, and opens its ordered block list. It does not change `weekly_reports` or their HTML upload UI.

```ts
if (!/^\d{4}-\d{2}-01$/.test(input.month)) {
  return { ok: false as const, code: "E_MONTH", message: "يجب اختيار شهر صحيح." };
}
```

- [ ] **Step 4: Verify authorization, validation, and types**

Run: `node --test src/lib/monthly-reports.test.ts && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit the workspace**

```bash
git add package.json src/app/api/admin/monthly-reports/route.ts 'src/app/(protected)/admin/monthly-reports/page.tsx' src/components/reports/monthly-report-workspace.tsx src/lib/monthly-reports.ts src/lib/monthly-reports.test.ts src/components/app-navigation.tsx
git commit -m "feat: add monthly report workspace"
```

### Task 4: Context-block API and analytics buttons

**Files:**
- Create: `src/app/api/reports/context-blocks/route.ts`
- Create: `src/components/insights/add-to-report-button.tsx`
- Create: `src/components/reports/report-context-picker.tsx`
- Modify: `src/components/insights/account-pulse.tsx`
- Modify: `src/components/insights/comparison-builder.tsx`
- Modify: `src/components/insights/partner-track-matrix.tsx`
- Create: `src/lib/report-context-route.test.ts`

**Interfaces:**
- Produces: `GET`, `POST`, `PATCH`, and `DELETE /api/reports/context-blocks` using guarded RPCs.
- Consumes: normalized snapshot validation and existing monthly `reports` rows.

- [ ] **Step 1: Write failing route protection tests**

```ts
assert.match(routeSource, /requireAnalyticsAdmin/);
assert.match(routeSource, /validateReportContextBlock/);
assert.match(routeSource, /admin_add_report_context_block/);
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/report-context-route.test.ts`

Expected: FAIL because the route is absent.

- [ ] **Step 3: Implement explicit add/reorder/remove flows**

The button opens a report selector and preview of exactly what will be stored. POST sends `{ reportId, block }`; it never invokes a model. The picker lists saved blocks in position order and exposes reorder/remove actions.

```tsx
<button className="button button-secondary" type="button" onClick={openPicker}>أضف للتقرير</button>
```

- [ ] **Step 4: Verify API and UI types**

Run: `node --test src/lib/report-context-route.test.ts src/lib/report-context.test.ts && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit selection flow**

```bash
git add src/app/api/reports/context-blocks/route.ts src/components/insights/add-to-report-button.tsx src/components/reports/report-context-picker.tsx src/components/insights/account-pulse.tsx src/components/insights/comparison-builder.tsx src/components/insights/partner-track-matrix.tsx src/lib/report-context-route.test.ts
git commit -m "feat: add analytics blocks to monthly reports"
```

### Task 5: Prepare and record the monthly AI draft input

**Files:**
- Create: `src/app/api/admin/monthly-report-drafts/route.ts`
- Create: `src/components/reports/monthly-report-draft.tsx`
- Modify: `src/lib/report-context.ts`
- Modify: `src/lib/report-context.test.ts`
- Modify: `src/lib/database.types.ts`

**Interfaces:**
- Produces: `POST /api/admin/monthly-report-drafts` that composes and stores an `ai_drafts` input snapshot.
- Consumes: ordered context blocks and `reports.context_note`.

- [ ] **Step 1: Write the failing AI-draft safety test**

```ts
test("draft request records an unapproved monthly report snapshot", () => {
  const row = buildMonthlyDraftRow(actorId, reportId, inputSnapshot);
  assert.equal(row.kind, "monthly_report");
  assert.equal(row.approved_at, null);
  assert.equal(row.approved_by, null);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test src/lib/report-context.test.ts`

Expected: FAIL until `buildMonthlyDraftRow` exists.

- [ ] **Step 3: Implement explicit draft preparation**

Compose the ordered Markdown and insert one `ai_drafts` row with `kind="monthly_report"`, complete `input_snapshot`, `created_by`, null approval fields, and `output` containing the deterministic source draft when no configured model provider exists. Label it «مسودة آلية — تحتاج اعتمادًا» in the UI. Do not pretend that deterministic composition came from a model: keep `model = null`.

- [ ] **Step 4: Verify no automatic execution or publication**

Run: `rg -n "monthly-report-drafts" src | sort`

Expected: one explicit button call and the route; no effect or scheduled job.

Run: `pnpm test && pnpm run lint && pnpm run build`

Expected: PASS.

- [ ] **Step 5: Commit and Preview/UAT**

```bash
git add src/app/api/admin/monthly-report-drafts/route.ts src/components/reports/monthly-report-draft.tsx src/lib/report-context.ts src/lib/report-context.test.ts src/lib/database.types.ts
git commit -m "feat: prepare auditable monthly report drafts"
```

On Preview, create a disposable report, add one complete and one thin-sample block, reorder them, prepare a draft, confirm the saved input matches the displayed values, and delete only the disposable report after recording the result.
