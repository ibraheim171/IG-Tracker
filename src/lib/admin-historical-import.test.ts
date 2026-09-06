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
import {
  declaredBodyExceedsLimit,
  readUtf8RequestBodyWithLimit,
  RequestBodyTooLargeError,
} from "./read-limited-request-body.ts";

const migration = readFileSync("supabase/migrations/20260906000000_admin_historical_csv_import.sql", "utf8");
const coreMigration = readFileSync("migrations/0001_core.sql", "utf8");
const route = readFileSync("src/app/api/admin/historical-import/route.ts", "utf8");
const slotsBoard = readFileSync("src/components/slots-board.tsx", "utf8");

test("parses BOM, CRLF, quoted commas, escaped quotes and embedded newlines", () => {
  const parsed = parseHistoricalCsv('\uFEFFtitle,permalink,published_at,notes\r\n"عنوان، ""خاص""",https://instagram.com/p/Ab_1/,2026-09-01T20:10:00+03:00,"سطر 1\nسطر 2"\r\n');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rows[0].title, 'عنوان، "خاص"');
  assert.equal(parsed.rows[0].notes, "سطر 1\nسطر 2");
  assert.equal(parsed.rows[0].csv_line, 2);
});

test("requires exact headers and rejects malformed rows and quote suffixes", () => {
  assert.equal(parseHistoricalCsv("title,permalink\na,b").ok, false);
  assert.equal(parseHistoricalCsv("title,title,permalink,published_at\na,a,b,c").ok, false);
  assert.equal(parseHistoricalCsv("title,permalink,published_at,unexpected\na,b,c,d").ok, false);
  assert.equal(parseHistoricalCsv("title,permalink,published_at\na,b,c,extra").ok, false);
  assert.equal(parseHistoricalCsv('title,permalink,published_at\n"a,b,c').ok, false);
  assert.equal(parseHistoricalCsv('title,permalink,published_at\n"A"junk,b,c').ok, false);
  assert.equal(parseHistoricalCsv('title,permalink,published_at\n"A" ,b,c').ok, false);
});

test("preserves blank classifications and splits partners only on explicit pipes", () => {
  const parsed = parseHistoricalCsv("title,permalink,published_at,track,idea_type,partners\nA,https://instagram.com/p/a/,2026-09-01T20:00:00+03:00,,,نبض|مسرى");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rows[0].track, null);
  assert.equal(parsed.rows[0].idea_type, null);
  assert.deepEqual(parsed.rows[0].partners, ["نبض", "مسرى"]);
});

test("enforces fixed limits and instant cutoff semantics", () => {
  assert.equal(HISTORICAL_IMPORT_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(HISTORICAL_IMPORT_MAX_ROWS, 200);
  assert.equal(HISTORICAL_IMPORT_CUTOFF, "2026-09-06T09:30:57+03:00");
  assert.equal(HISTORICAL_IMPORT_CONFIRMATION, "استيراد السجل التاريخي");
  const cutoff = Date.parse(HISTORICAL_IMPORT_CUTOFF);
  assert.ok(Date.parse("2026-09-06T09:30:56.999+03:00") < cutoff);
  assert.equal(Date.parse("2026-09-06T06:30:57Z"), cutoff);
  assert.ok(Date.parse("2026-09-06T08:30:57+01:00") > cutoff);
  const rows = Array.from({ length: 201 }, (_, index) => `T${index},https://instagram.com/p/S${index}/,2026-09-01T20:00:00+03:00`);
  assert.equal(parseHistoricalCsv(["title,permalink,published_at", ...rows].join("\n")).ok, false);
});

test("streaming reader cancels on overflow and accepts the exact byte limit", async () => {
  assert.equal(declaredBodyExceedsLimit(null, 4), false);
  assert.equal(declaredBodyExceedsLimit("invalid", 4), false);
  assert.equal(declaredBodyExceedsLimit("4", 4), false);
  assert.equal(declaredBodyExceedsLimit("5", 4), true);
  let cancelled = false;
  const chunks = [new Uint8Array([65, 66]), new Uint8Array([67, 68]), new Uint8Array([69])];
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(readUtf8RequestBodyWithLimit({ body }, 4), (error) => error instanceof RequestBodyTooLargeError);
  assert.equal(cancelled, true);

  const exactBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("أب"));
      controller.close();
    },
  });
  assert.equal(await readUtf8RequestBodyWithLimit({ body: exactBody }, 4), "أب");
});

test("SECURITY DEFINER functions use trusted resolution and verified pgcrypto layout", () => {
  assert.match(migration, /create extension if not exists pgcrypto with schema extensions/);
  assert.match(migration, /extension_schema is distinct from 'extensions'/);
  assert.match(migration, /to_regprocedure\('extensions\.digest\(bytea,text\)'\)/);
  assert.match(migration, /to_regprocedure\('extensions\.gen_random_bytes\(integer\)'\)/);
  assert.match(migration, /extensions\.digest\(/);
  assert.match(migration, /extensions\.gen_random_bytes\(/);
  assert.doesNotMatch(migration, /set search_path = public/i);
  assert.match(migration, /security definer\s+set search_path = pg_catalog/gi);
  assert.doesNotMatch(migration, /^\s*digest\(/m);
  assert.doesNotMatch(migration, /^\s*gen_random_bytes\(/m);
  assert.match(migration, /perform public\.assert_can_use_app\(\)/);
  assert.match(migration, /if not public\.is_admin\(\)/);
  assert.doesNotMatch(migration, /p_actor|p_user/);
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/);
});

test("one canonical database helper is used by import and normal publication", () => {
  assert.match(migration, /create or replace function public\.parse_instagram_permalink\(p_permalink text\)/);
  assert.match(migration, /instagram\\\.com\/\(p\|reel\|tv\)\/\(\[A-Za-z0-9_-\]\+\)/);
  assert.match(migration, /'permalink', 'https:\/\/www\.instagram\.com\/' \|\| media_kind \|\| '\/' \|\| shortcode \|\| '\/'/);
  const calls = migration.match(/public\.parse_instagram_permalink\(/g) ?? [];
  assert.ok(calls.length >= 6);
  assert.match(migration, /create or replace function public\.mark_published[\s\S]*parsed_permalink := public\.parse_instagram_permalink\(p_permalink\)/);
  assert.match(migration, /update public\.items[\s\S]*ig_permalink = canonical_permalink/);
  assert.match(migration, /existing\.ig_shortcode is null[\s\S]*parse_instagram_permalink\(existing\.ig_permalink\)/);
  assert.match(coreMigration, /ig_shortcode\s+text generated always as/);
  assert.match(coreMigration, /create unique index ux_items_shortcode on items \(ig_shortcode\) where ig_shortcode is not null/);
  assert.match(migration, /SHORTCODE_UNIQUE_INDEX_MISSING/);
  assert.match(migration, /EXISTING_INSTAGRAM_DUPLICATE/);
});

test("preview control is random, actor/input-bound, expiring, single-use and one-shot", () => {
  assert.match(migration, /create table public\.historical_import_control/);
  assert.match(migration, /preview_token_hash\s+bytea/);
  assert.match(migration, /raw_preview_token := pg_catalog\.encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/);
  assert.match(migration, /preview_actor_id is distinct from actor_id/);
  assert.match(migration, /preview_payload_hash is distinct from payload_hash/);
  assert.match(migration, /preview_expires_at <= pg_catalog\.clock_timestamp\(\)/);
  assert.match(migration, /preview_used_at is not null/);
  assert.match(migration, /control_record\.applied_at is not null/);
  assert.match(migration, /set applied_at = pg_catalog\.clock_timestamp\(\)/);
  assert.match(migration, /published_value >= timestamptz '2026-09-06T09:30:57\+03:00'/);

  const previewBranch = migration.match(/if dry_run then[\s\S]*?return jsonb_build_object\([\s\S]*?end if;/)?.[0] ?? "";
  assert.match(previewBranch, /update public\.historical_import_control/);
  assert.doesNotMatch(previewBranch, /public\.(?:items|publishing_slots|item_partners|transitions)/);
  assert.match(migration, /set preview_used_at = pg_catalog\.clock_timestamp\(\)[\s\S]*?insert into public\.publishing_slots/);
  assert.match(migration, /insert into public\.transitions[\s\S]*?set applied_at = pg_catalog\.clock_timestamp\(\)/);
});

test("migration keeps all-or-nothing writes, audit shape, and normal workflow protections", () => {
  const hardened = readFileSync("supabase/migrations/20260903011558_role_field_permissions.sql", "utf8");
  assert.match(migration, /if invalid_rows > 0 then\s+raise exception 'VALIDATION_FAILED/);
  assert.match(migration, /on conflict \(slot_at\) do nothing/);
  assert.match(migration, /perform public\.refresh_slot_state\(slot_value\)/);
  assert.match(migration, /'kind', 'historical_csv_import'[\s\S]*?'batch_id', batch_id[\s\S]*?'source_sha256', source_sha256_value[\s\S]*?'csv_line'/);
  assert.match(migration, /is_override,[\s\S]*?override_reason[\s\S]*?true,[\s\S]*?reason/);
  assert.match(hardened, /create policy no_direct_item_insert[\s\S]*?with check \(false\)/);
  assert.match(hardened, /revoke insert, update, delete on table public\.items from public, anon, authenticated/);
  for (const functionName of ["admin_create_item", "assign_slot", "advance_item"]) {
    assert.doesNotMatch(migration, new RegExp(`create\\s+(?:or replace\\s+)?function public\\.${functionName}`));
  }
  assert.match(migration, /create or replace function public\.mark_published[\s\S]*item_record\.status <> 'ready'/);
  assert.match(migration, /create or replace function public\.mark_published[\s\S]*public\.can_publish_items\(\)/);
});

test("route independently requires same-origin admin access and streams the size limit", () => {
  assert.match(route, /isSameOriginMutation/);
  assert.match(route, /requireActiveRouteProfile/);
  assert.match(route, /roles\.includes\("admin"\)/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /declaredBodyExceedsLimit\(request\.headers\.get\("content-length"\), HISTORICAL_IMPORT_MAX_BYTES\)/);
  assert.match(route, /readUtf8RequestBodyWithLimit\(request, HISTORICAL_IMPORT_MAX_BYTES\)/);
  assert.doesNotMatch(route, /request\.(?:text|json|arrayBuffer)\(\)/);
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
});
