import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HISTORICAL_IMPORT_CONFIRMATION,
  HISTORICAL_IMPORT_CUTOFF,
  HISTORICAL_IMPORT_MAX_BYTES,
  HISTORICAL_IMPORT_MAX_ROWS,
  parseHistoricalCsv,
} from "./admin-historical-import.ts";

const migration = readFileSync("supabase/migrations/20260906000000_admin_historical_csv_import.sql", "utf8");
const route = readFileSync("src/app/api/admin/historical-import/route.ts", "utf8");
const slotsBoard = readFileSync("src/components/slots-board.tsx", "utf8");

test("parses BOM, CRLF, quoted commas and embedded newlines", () => {
  const parsed = parseHistoricalCsv('\uFEFFtitle,permalink,published_at,notes\r\n"عنوان، خاص",https://instagram.com/p/Ab_1/,2026-09-01T20:10:00+03:00,"سطر 1\nسطر 2"\r\n');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rows[0].title, "عنوان، خاص");
  assert.equal(parsed.rows[0].notes, "سطر 1\nسطر 2");
  assert.equal(parsed.rows[0].csv_line, 2);
});

test("requires exact headers and rejects malformed rows", () => {
  assert.equal(parseHistoricalCsv("title,permalink\na,b").ok, false);
  assert.equal(parseHistoricalCsv("title,title,permalink,published_at\na,a,b,c").ok, false);
  assert.equal(parseHistoricalCsv("title,permalink,published_at,unexpected\na,b,c,d").ok, false);
  assert.equal(parseHistoricalCsv("title,permalink,published_at\na,b,c,extra").ok, false);
  assert.equal(parseHistoricalCsv('title,permalink,published_at\n"a,b,c').ok, false);
});

test("preserves blank classifications and splits partners only on explicit pipes", () => {
  const parsed = parseHistoricalCsv("title,permalink,published_at,track,idea_type,partners\nA,https://instagram.com/p/a/,2026-09-01T20:00:00+03:00,,,نبض|مسرى");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rows[0].track, null);
  assert.equal(parsed.rows[0].idea_type, null);
  assert.deepEqual(parsed.rows[0].partners, ["نبض", "مسرى"]);
});

test("enforces the approved fixed limits", () => {
  assert.equal(HISTORICAL_IMPORT_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(HISTORICAL_IMPORT_MAX_ROWS, 200);
  assert.equal(HISTORICAL_IMPORT_CUTOFF, "2026-09-06T09:30:57+03:00");
  assert.equal(HISTORICAL_IMPORT_CONFIRMATION, "استيراد السجل التاريخي");
  const rows = Array.from({ length: 201 }, (_, index) => `T${index},https://instagram.com/p/S${index}/,2026-09-01T20:00:00+03:00`);
  assert.equal(parseHistoricalCsv(["title,permalink,published_at", ...rows].join("\n")).ok, false);
});

test("migration enforces auth, cutoff, preview, atomicity and audit shape", () => {
  assert.match(migration, /security definer\s+set search_path = public/i);
  assert.match(migration, /perform public\.assert_can_use_app\(\)/);
  assert.match(migration, /if not public\.is_admin\(\)/);
  assert.doesNotMatch(migration, /p_actor|p_user/);
  assert.match(migration, /2026-09-06T09:30:57\+03:00/);
  assert.match(migration, /published_text !~ '\^\\d\{4\}-\\d\{2\}-\\d\{2\}T/);
  assert.match(migration, /published_value >= timestamptz '2026-09-06T09:30:57\+03:00'/);
  assert.match(migration, /PREVIEW_REQUIRED/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('ig-tracker:historical-import:v1', 0\)\)/);
  assert.match(migration, /from_status,[\s\S]*?values \([\s\S]*?item_value\.id,[\s\S]*?null,[\s\S]*?'published'/);
  assert.match(migration, /'kind', 'historical_csv_import'[\s\S]*?'batch_id', batch_id[\s\S]*?'source_sha256', source_sha256[\s\S]*?'csv_line'/);
  assert.match(migration, /is_override,[\s\S]*?override_reason[\s\S]*?true,[\s\S]*?reason/);
  assert.match(migration, /if dry_run then[\s\S]*?return jsonb_build_object/);
  assert.doesNotMatch(migration.match(/if dry_run then[\s\S]*?end if;/)?.[0] ?? "", /insert into|update public|delete from/);
  assert.match(migration, /if invalid_rows > 0 then\s+raise exception 'VALIDATION_FAILED/);
  assert.match(migration, /on conflict \(slot_at\) do nothing/);
  assert.match(migration, /perform public\.refresh_slot_state\(slot_value\)/);
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/);
});

test("migration canonicalizes before checking in-file and stored duplicates", () => {
  assert.match(migration, /canonical_permalink := 'https:\/\/www\.instagram\.com\/' \|\| media_kind \|\| '\/' \|\| shortcode_value \|\| '\/'/);
  assert.match(migration, /shortcode_value = any\(seen_shortcodes\)/);
  assert.match(migration, /where ig_shortcode = shortcode_value\s+or ig_permalink = canonical_permalink/);
  assert.match(migration, /where name = track_name/);
  assert.match(migration, /where name = idea_type_name and active/);
  assert.match(migration, /name = partner_name or partner_name = any\(aliases\)/);
  assert.doesNotMatch(migration, /ilike|similarity|levenshtein/);
});

test("migration preserves direct-write blocks and normal workflow functions", () => {
  const hardened = readFileSync("supabase/migrations/20260903011558_role_field_permissions.sql", "utf8");
  assert.match(hardened, /create policy no_direct_item_insert[\s\S]*?with check \(false\)/);
  assert.match(hardened, /revoke insert, update, delete on table public\.items from public, anon, authenticated/);
  for (const functionName of ["admin_create_item", "assign_slot", "advance_item", "mark_published"]) {
    assert.doesNotMatch(migration, new RegExp(`create\\s+(?:or replace\\s+)?function public\\.${functionName}`));
  }
});

test("route independently requires same-origin admin access and matching checksum", () => {
  assert.match(route, /isSameOriginMutation/);
  assert.match(route, /requireActiveRouteProfile/);
  assert.match(route, /roles\.includes\("admin"\)/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /contentLength > HISTORICAL_IMPORT_MAX_BYTES/);
  assert.match(route, /Buffer\.byteLength\(rawBody, "utf8"\) > HISTORICAL_IMPORT_MAX_BYTES/);
  assert.match(route, /admin_import_historical_items/);
  assert.match(route, /HISTORICAL_IMPORT_CONFIRMATION/);
  assert.match(slotsBoard, /isAdmin \? <div className="actions-row">/);
});

test("UI exposes preview-first all-or-nothing apply with reason and confirmation", () => {
  const modal = readFileSync("src/components/admin-historical-import-modal.tsx", "utf8");
  assert.match(modal, /request\("preview"\)/);
  assert.match(modal, /preview\.invalid_rows === 0/);
  assert.match(modal, /reason\.trim\(\)\.length >= 5/);
  assert.match(modal, /confirmation === HISTORICAL_IMPORT_CONFIRMATION/);
  assert.match(modal, /تطبيق الدفعة كاملة/);
  assert.match(modal, /لا يوجد تطبيق جزئي/);
  assert.match(modal, /ليست دليلاً مستقلاً على الملف الأصلي/);
});
