# Account Stock Observations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immutable, observed-at Instagram account stock observations for followers and media count without backdating them into daily flow metrics.

**Architecture:** Extend the existing signed 500-row analytics batch and its guarded database implementation with an `account_stock` stream. Persist retryable observations in Apps Script before sending, expose stock separately from daily flow data, and freeze the new provenance in report-context snapshots.

**Tech Stack:** PostgreSQL/Supabase migrations, Google Apps Script, Next.js App Router, TypeScript, React, Node test runner.

**Spec:** Owner-approved implementation request dated 2026-09-30 in this task.

## Global Constraints

- Local changes only; no push, remote database write, deployment, or migration-history repair.
- Missing metrics stay `NULL` and render as `—`.
- Existing migrations remain byte-for-byte unchanged.
- The signed batch remains limited to 500 total rows and the public invoker wrapper keeps its authorization model.
- `ig_account_range_snapshots` is not reused.

## Review Focus

- A retry after sheet persistence must resend without calling Meta.
- A partial same-day stored observation must fail closed.
- A reused observation key with different semantics must roll back every stream in the request.
- Browser roles must not reach either ingestion function or raw stock table.
- Account Pulse must never join current stock values onto historical daily flow dates.

---

### Task 1: Contract and migration

**Files:**
- Create: `supabase/migrations/*_account_stock_observations.sql`
- Modify: `src/lib/analytics-core.ts`
- Modify: `src/lib/analytics-core.test.ts`
- Modify: `src/lib/database.types.ts`

- [ ] Add failing payload and SQL-contract tests.
- [ ] Create the migration with `supabase migration new account_stock_observations`.
- [ ] Add the table, checks, immutable trigger, RLS/grants, and replacement implementation function.
- [ ] Extend TypeScript payload validation, hashing, row counts, and types.
- [ ] Run focused tests to green.

### Task 2: Retry-safe Apps Script stock stream

**Files:**
- Modify: `apps-script/Code.gs`
- Modify: `apps-script/AnalyticsSync.gs`
- Modify: `apps-script/README.ar.md`
- Modify: `src/lib/apps-script-analytics.test.ts`

- [ ] Add failing behavioral tests for real observed timestamps, stored retry reuse, partial-row rejection, stream isolation, and the 500-row cap.
- [ ] Add the sheet, locked collection, validation, watermark, batching, and safe stream logs.
- [ ] Run the Apps Script tests to green.

### Task 3: Health and Account Pulse separation

**Files:**
- Modify: `src/lib/analytics-health-state.ts`
- Modify: `src/app/api/admin/analytics-health/route.ts`
- Modify: `src/components/analytics-health.tsx`
- Modify: `src/lib/account-pulse.ts`
- Modify: `src/app/api/insights/account/route.ts`
- Modify: `src/components/insights/account-pulse.tsx`
- Modify: related tests.

- [ ] Add failing freshness and stock-series tests.
- [ ] Read `MAX(observed_at)` independently in Health.
- [ ] Return stock observations separately and calculate only between measured observations.
- [ ] Keep daily flow summaries and charts on `ig_account_daily`.
- [ ] Run focused tests to green.

### Task 4: Reproducible report context and verification

**Files:**
- Modify: `src/lib/report-context.ts`
- Modify: `src/lib/report-context.test.ts`
- Modify: affected UI snapshot construction.

- [ ] Add failing v2 account snapshot validation/composition tests while retaining v1 readers.
- [ ] Add observation keys, observed timestamps, values, N, completeness, warnings, and source time.
- [ ] Run the complete Node suite, TypeScript, production build, diff check, and secret scan.
- [ ] Confirm existing migration hashes are unchanged, then create local commits only.
