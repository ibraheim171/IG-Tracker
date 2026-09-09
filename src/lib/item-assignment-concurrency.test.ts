import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  itemAssignmentRevision,
  resolveLoadedItemAssignmentRevision,
} from "./item-assignment-revision.ts";

const migration = readFileSync("supabase/migrations/20260908094853_assignment_optimistic_concurrency.sql", "utf8");
const saveRoute = readFileSync("src/app/api/admin/items/[itemId]/participants/route.ts", "utf8");
const createRoute = readFileSync("src/app/api/admin/items/route.ts", "utf8");
const createModal = readFileSync("src/components/admin-create-item-modal.tsx", "utf8");
const detailsRoute = readFileSync("src/app/api/item-details/route.ts", "utf8");
const drawer = readFileSync("src/components/item-drawer.tsx", "utf8");

const writerId = "22222222-2222-4222-8222-222222222222";
const producerId = "33333333-3333-4333-8333-333333333333";
const reviewerId = "44444444-4444-4444-8444-444444444444";

test("assignment revision covers the complete operational participant set deterministically", () => {
  const participants = [
    { user_id: writerId, part: "writer" as const },
    { user_id: producerId, part: "producer" as const },
    { user_id: reviewerId, part: "reviewer" as const },
  ];
  const current = itemAssignmentRevision(participants);

  assert.equal(current, "7090cfc706288511c85a169030ee7f5b");
  assert.equal(itemAssignmentRevision([...participants].reverse()), current);
  assert.notEqual(itemAssignmentRevision(participants.slice(0, 2)), current);
  assert.notEqual(itemAssignmentRevision([
    participants[0],
    participants[1],
    { user_id: "55555555-5555-4555-8555-555555555555", part: "reviewer" },
  ]), current);
});

test("RPC locks, compares the expected revision, and rejects before every participant write", () => {
  assert.match(migration, /drop function public\.admin_save_item_assignments\(uuid, uuid, uuid, uuid\)/);
  assert.match(migration, /p_expected_revision text/);
  assert.match(migration, /select \* into it from public\.items where id = p_item for update/);
  assert.match(migration, /from public\.item_participants[\s\S]*order by part, user_id[\s\S]*for update/);
  assert.match(migration, /md5\(coalesce\(string_agg\([\s\S]*participant\.part::text \|\| ':' \|\| participant\.user_id::text/);

  const staleGuard = migration.indexOf("if current_revision <> expected_revision then");
  const staleRaise = migration.indexOf("raise exception 'ASSIGNMENTS_STALE:", staleGuard);
  const multipleGuard = migration.indexOf("if exists (", staleRaise);
  const firstDelete = migration.indexOf("delete from public.item_participants");
  const firstInsert = migration.indexOf("insert into public.item_participants");
  assert.ok(staleGuard > 0 && staleRaise > staleGuard);
  assert.ok(multipleGuard > staleRaise);
  assert.ok(firstDelete > multipleGuard, "stale and multi-participant guards must run before deletion");
  assert.ok(firstInsert > firstDelete, "no insert can run before stale rejection");

  assert.match(migration, /perform public\.assert_can_use_app\(\)/);
  assert.match(migration, /if not public\.is_admin\(\) then/);
  assert.match(migration, /p_item is null or p_writer is null/);
  assert.match(migration, /active[\s\S]*not must_change_password[\s\S]*'writer' = any\(roles::text\[\]\)/);
  assert.match(migration, /having count\(\*\) > 1[\s\S]*MULTIPLE_ASSIGNMENTS:/);
  assert.match(migration, /revoke execute on function public\.admin_save_item_assignments\(uuid, uuid, text, uuid, uuid\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.admin_save_item_assignments\(uuid, uuid, text, uuid, uuid\)[\s\S]*to authenticated/);
});

test("item details and save response use the same complete revision helper", () => {
  assert.match(detailsRoute, /assignmentRevision: itemAssignmentRevision\(participants\)/);
  assert.match(saveRoute, /expected_revision/);
  assert.match(saveRoute, /p_expected_revision: body\.value\.expectedRevision/);
  assert.match(saveRoute, /assignmentRevision: itemAssignmentRevision\(participants\)/);
  assert.match(saveRoute, /ASSIGNMENTS_STALE:/);
  assert.match(saveRoute, /E_ASSIGNMENTS_CONFLICT/);
  assert.match(saveRoute, /assignmentConflict \|\| multipleAssignments \? 409 : 400/);
});

test("new-draft revision reflects the participants actually persisted by creation", () => {
  const actualParticipants = [{ user_id: writerId, part: "writer" as const }];
  const loaded = resolveLoadedItemAssignmentRevision({ data: actualParticipants, error: null });
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    const currentPersistedRevision = itemAssignmentRevision(actualParticipants);
    assert.equal(loaded.assignmentRevision, currentPersistedRevision, "an immediate save must compare the same current revision");
    assert.notEqual(loaded.assignmentRevision, itemAssignmentRevision([]));
  }

  const empty = resolveLoadedItemAssignmentRevision({ data: [], error: null });
  assert.deepEqual(empty, {
    ok: true,
    assignmentRevision: "d41d8cd98f00b204e9800998ecf8427e",
  });

  const failed = resolveLoadedItemAssignmentRevision({ data: null, error: new Error("read failed") });
  assert.deepEqual(failed, {
    ok: false,
    error: {
      code: "E_ITEM_CREATE_PARTICIPANTS",
      error: "تم إنشاء المادة، لكن تعذر التحقق من تعييناتها الحالية. افتح المادة وأعد المحاولة.",
    },
  });
  assert.equal("assignmentRevision" in failed, false);

  const failedEmpty = resolveLoadedItemAssignmentRevision({ data: [], error: new Error("read failed") });
  assert.equal(failedEmpty.ok, false, "a failed read must never be treated as a genuinely empty participant set");

  assert.match(createRoute, /from\("item_participants"\)[\s\S]*eq\("item_id", data\.id\)[\s\S]*resolveLoadedItemAssignmentRevision/);
  assert.match(createRoute, /if \(!revisionResult\.ok\)[\s\S]*status: 500/);
  assert.doesNotMatch(createRoute, /itemAssignmentRevision\(\[\]\)/);
  assert.match(createModal, /!result\.assignmentRevision/);
  assert.match(createModal, /expected_revision: result\.assignmentRevision/);
});

test("drawer preserves a dirty role through conflict refresh and blocks retry until refresh succeeds", () => {
  assert.match(drawer, /response\.status === 409[\s\S]*E_ASSIGNMENTS_CONFLICT[\s\S]*refreshAssignmentsAfterConflict/);
  assert.match(drawer, /hydrateItemAssignments\(current, targetItemId, payload\.details\.participants, payload\.details\.assignmentRevision\)/);
  assert.match(drawer, /revisionReady: assignmentConflict !== "error"/);
  assert.match(drawer, /تغيّرت تعيينات الفريق منذ فتح البطاقة/);
  assert.match(drawer, /مع الاحتفاظ بتعديلك المحلي/);
  assert.match(drawer, /إعادة محاولة حفظ التعيينات/);
  assert.match(drawer, /latestItemRef\.current\?\.id !== targetItemId/);
});
