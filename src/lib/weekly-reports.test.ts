import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canManageWeeklyReports,
  immutableWeeklyReportPath,
  isSameOriginAppRequest,
  publicWeeklyReport,
  readBoundedStream,
  sha256Hex,
  validateSafeHtml,
  validateWeeklyReportInput,
  weeklyReportDownloadHeaders,
  weeklyReportMaxBytes,
  weeklyReportPreviewHeaders,
} from "./weekly-reports.ts";

test("only an active admin passes the report authorization decision", () => {
  assert.equal(canManageWeeklyReports({ active: true, roles: ["admin"] }), true);
  assert.equal(canManageWeeklyReports({ active: true, roles: ["writer"] }), false);
  assert.equal(canManageWeeklyReports({ active: false, roles: ["admin"] }), false);
  assert.equal(canManageWeeklyReports(null), false);
});

test("same-origin enforcement validates Origin, Referer, or browser fetch metadata", () => {
  const appOrigin = "https://tracker.example";
  assert.equal(isSameOriginAppRequest({ appOrigin, origin: appOrigin }), true);
  assert.equal(isSameOriginAppRequest({ appOrigin, referer: `${appOrigin}/admin/weekly-reports` }), true);
  assert.equal(isSameOriginAppRequest({ appOrigin, fetchSite: "same-origin" }), true);
  assert.equal(isSameOriginAppRequest({ appOrigin, origin: "https://evil.example", referer: `${appOrigin}/` }), false);
  assert.equal(isSameOriginAppRequest({ appOrigin }), false);
});

test("metadata validation requires a real period and HTML extension", () => {
  assert.equal(validateWeeklyReportInput({ title: " تقرير الأسبوع ", periodStart: "2026-09-01", periodEnd: "2026-09-07", filename: "week.HTM" }).ok, true);
  assert.equal(validateWeeklyReportInput({ title: "تقرير", periodStart: "2026-09-08", periodEnd: "2026-09-07", filename: "week.html" }).ok, false);
  assert.equal(validateWeeklyReportInput({ title: "تقرير", periodStart: "2026-09-01", periodEnd: "2026-09-07", filename: "week.html.exe" }).ok, false);
  assert.equal(validateWeeklyReportInput({ title: "تقرير", periodStart: "2026-02-30", periodEnd: "2026-03-01", filename: "week.html" }).ok, false);
});

test("stream reader accepts the exact limit and cancels on the first byte above it", async () => {
  const exact = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(weeklyReportMaxBytes)); controller.close(); } });
  assert.equal((await readBoundedStream(exact)).byteLength, weeklyReportMaxBytes);
  let cancelled = false;
  const over = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(weeklyReportMaxBytes)); controller.enqueue(new Uint8Array([1])); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readBoundedStream(over), /E_FILE_TOO_LARGE/);
  assert.equal(cancelled, true);
});

test("HTML validation preserves useful markup and rejects active or network-capable input", () => {
  assert.equal(validateSafeHtml("<!doctype html><style>td{color:#231e1c}</style><table><tr><td>بيانات</td></tr></table>").ok, true);
  for (const html of [
    "<script>alert(1)</script>", "<iframe></iframe>", "<object></object>", "<embed>", "<base href='/'>", "<form></form>", "<meta http-equiv='refresh' content='0;url=https://evil.example'>", "<link rel='stylesheet' href='/x.css'>", "<a href='/api/private'>x</a>", "<img src='data:image/png;base64,AA=='>",
    "<img onerror=alert(1)>", "<div srcdoc='<p>x</p>'>", "<a href='javascript:alert(1)'>x</a>",
    "<img src='https://evil.example/a.png'>", "<style>@import 'https://evil.example/a.css'</style>", "<p style=\"background:url(/private)\">x</p>",
  ]) assert.equal(validateSafeHtml(html).ok, false, html);
});

test("checksum and immutable path are deterministic where expected and collision-resistant by token", async () => {
  const checksum = await sha256Hex(new TextEncoder().encode("abc"));
  assert.equal(checksum, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(immutableWeeklyReportPath("report-id", checksum, "unique-token"), "report-id/unique-token-ba7816bf8f01cfea.html");
  assert.notEqual(immutableWeeklyReportPath("report-id", checksum, "a"), immutableWeeklyReportPath("report-id", checksum, "b"));
});

test("public metadata never includes the private object path or uploader id", () => {
  const report = publicWeeklyReport({ id: "r", title: "تقرير", storage_path: "private/path.html", uploaded_by: "admin" });
  assert.deepEqual(report, { id: "r", title: "تقرير" });
});

test("preview and download headers enforce a non-executable private response", () => {
  assert.match(weeklyReportPreviewHeaders["Content-Security-Policy"], /script-src 'none'/);
  assert.match(weeklyReportPreviewHeaders["Content-Security-Policy"], /connect-src 'none'/);
  assert.match(weeklyReportPreviewHeaders["Content-Security-Policy"], /form-action 'none'/);
  assert.match(weeklyReportPreviewHeaders["Content-Security-Policy"], /sandbox/);
  assert.equal(weeklyReportPreviewHeaders["X-Content-Type-Options"], "nosniff");
  assert.match(weeklyReportDownloadHeaders("تقرير.html")["Content-Disposition"], /^attachment;/);
});

test("migration, route, and iframe wiring retain the tested server-only security contract", () => {
  const migration = readFileSync("supabase/migrations/20260908152245_weekly_reports.sql", "utf8");
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /create index weekly_reports_created_at_idx/i);
  assert.match(migration, /create index weekly_reports_uploaded_by_idx/i);
  assert.match(migration, /revoke all on table public\.weekly_reports from public, anon, authenticated/i);
  assert.match(migration, /revoke all on table public\.weekly_reports from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant select, insert on table public\.weekly_reports to service_role/i);
  assert.match(migration, /'weekly-reports', 'weekly-reports', false, 2097152/i);
  assert.match(migration, /as restrictive[\s\S]+bucket_id <> 'weekly-reports'/i);
  for (const route of [
    "src/app/api/admin/weekly-reports/route.ts",
    "src/app/api/admin/weekly-reports/[reportId]/route.ts",
    "src/app/api/admin/weekly-reports/[reportId]/preview/route.ts",
    "src/app/api/admin/weekly-reports/[reportId]/download/route.ts",
  ]) assert.match(readFileSync(route, "utf8"), /requireWeeklyReportAdmin/);
  const client = readFileSync("src/components/weekly-reports-manager.tsx", "utf8");
  assert.match(client, /sandbox=""/);
  assert.doesNotMatch(client, /dangerouslySetInnerHTML|SUPABASE_SERVICE_ROLE_KEY/);
});
