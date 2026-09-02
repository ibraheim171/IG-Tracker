import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compatibleOperationalParts,
  normalizeOperationalParts,
  operationalPartsForRoles,
  toReassignTasksResult,
} from "./admin-reassign-tasks.ts";
import type { Role } from "./admin-users.ts";

const migrationUrl = new URL("../../supabase/migrations/20260902134858_admin_reassign_tasks.sql", import.meta.url);
const routeUrl = new URL("../app/api/admin/reassign-tasks/route.ts", import.meta.url);
const usersManagerUrl = new URL("../app/(protected)/admin/users/users-manager.tsx", import.meta.url);

test("operational reassignment parts exclude publisher and admin", () => {
  assert.deepEqual(operationalPartsForRoles(["writer", "producer", "publisher", "admin"]), ["writer", "producer"]);
  assert.deepEqual(normalizeOperationalParts(["writer", "publisher", "admin"]), ["writer"]);
});

test("multi-role target receives the additive compatible role union", () => {
  const source: Role[] = ["writer", "producer", "reviewer"];
  assert.deepEqual(compatibleOperationalParts(source, ["writer", "producer"]), ["writer", "producer"]);
  assert.deepEqual(compatibleOperationalParts(["publisher", "producer"], ["publisher", "producer"]), ["producer"]);
});

test("route rejects non-admin, disabled admins, must-change admins, and cross-origin mutations", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /isSameOriginMutation\(request\)/);
  assert.match(route, /requireActiveRouteProfile\(request, cookieResponse\)/);
  assert.match(route, /!auth\.profile\.roles\.includes\("admin"\)/);
  assert.equal(/roles\.includes\("publisher"\)/.test(route), false);
});

test("route only calls the trusted RPC and does not write item participants directly", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /rpc\("admin_reassign_tasks"/);
  assert.equal(/from\("item_participants"\)\.(insert|update|delete|upsert)/.test(route), false);
  assert.equal(/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(route), false);
});

test("database RPC checks actor, source, target, active target, and role compatibility", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /perform public\.assert_can_use_app\(\)/);
  assert.match(migration, /if not public\.is_admin\(\) then/);
  assert.match(migration, /if p_source = p_target then/);
  assert.match(migration, /if not target_profile\.active then/);
  assert.match(migration, /TARGET_ROLE_REQUIRED/);
  assert.match(migration, /where not \(part::text = any\(target_profile\.roles::text\[\]\)\)/);
});

test("database RPC locks source and target profiles in a stable order before target checks", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const lockIndex = migration.indexOf("where id in (p_source, p_target)");
  const targetActiveIndex = migration.indexOf("if not target_profile.active then");
  const targetRoleIndex = migration.indexOf("where not (part::text = any(target_profile.roles::text[]))");
  assert.ok(lockIndex > 0);
  assert.match(migration, /order by id[\s\S]*for update/);
  assert.ok(lockIndex < targetActiveIndex);
  assert.ok(lockIndex < targetRoleIndex);
});

test("database RPC moves writer, producer, and reviewer assignments only", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /p_parts public\.participant_part\[\]/);
  assert.match(migration, /from public\.item_participants ip/);
  assert.match(migration, /ip\.part = any\(selected_parts\)/);
  assert.doesNotMatch(migration, /'publisher'::participant_part|'admin'::participant_part/);
});

test("database RPC avoids duplicates and skips published or archived items", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /on conflict \(item_id, user_id, part\) do nothing/);
  assert.match(migration, /and not i\.is_archived/);
  assert.match(migration, /i\.status not in \('published', 'cancelled'\)/);
});

test("database RPC preserves historical ownership, approvals, and transitions", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.equal(/update\s+public\.items[\s\S]*created_by/i.test(migration), false);
  assert.equal(/update\s+public\.approvals|delete\s+from\s+public\.approvals/i.test(migration), false);
  assert.equal(/update\s+public\.transitions|delete\s+from\s+public\.transitions/i.test(migration), false);
});

test("database RPC dry-run returns before audit or mutation", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const dryRunIndex = migration.indexOf("if p_dry_run then");
  const auditIndex = migration.indexOf("insert into public.admin_account_audit");
  const insertIndex = migration.indexOf("insert into public.item_participants");
  const deleteIndex = migration.indexOf("delete from public.item_participants");
  assert.ok(dryRunIndex > 0);
  assert.ok(dryRunIndex < auditIndex);
  assert.ok(dryRunIndex < insertIndex);
  assert.ok(dryRunIndex < deleteIndex);
});

test("database RPC serializes concurrent transfers and locks moved assignments", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('admin_reassign_tasks'\), hashtext\(p_source::text\)\)/);
  assert.match(migration, /for update of ip/);
});

test("audit records started, succeeded, and failed phases without sensitive values", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /'reassign_tasks'/);
  assert.match(migration, /'started'/);
  assert.match(migration, /'succeeded'/);
  assert.match(migration, /'failed'/);
  assert.match(migration, /diagnostic_code/);
  assert.equal(/temporaryPassword|password_hash|access_token|refresh_token|session|service_role_key|SUPABASE_SERVICE_ROLE_KEY/i.test(migration), false);
  assert.ok(migration.indexOf("'succeeded'") > migration.indexOf("delete from public.item_participants"));
});

test("database execute grants are limited to authenticated calls guarded inside the RPC", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /revoke execute on function public\.admin_reassign_tasks[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.admin_reassign_tasks[\s\S]*to authenticated/);
  assert.equal(/\bgrant execute[\s\S]*\bto anon\b/i.test(migration), false);
});

test("UI uses modal preview and final confirmation without window.confirm", async () => {
  const source = await readFile(usersManagerUrl, "utf8");
  assert.match(source, />نقل المهام</);
  assert.match(source, /<ReassignTasksModal/);
  assert.match(source, /setConfirm\(\{[\s\S]*title: "تأكيد نقل المهام"/);
  assert.equal(/window\.confirm/.test(source), false);
});

test("UI sends reassignment through the API only and prevents parallel requests", async () => {
  const source = await readFile(usersManagerUrl, "utf8");
  assert.match(source, /fetch\("\/api\/admin\/reassign-tasks"/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /disabled=\{saving \|\| !canPreview\}/);
  assert.match(source, /disabled=\{saving \|\| !canExecute\}/);
  assert.equal(/from\("item_participants"\)\.(insert|update|delete|upsert)/.test(source), false);
  assert.equal(/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(source), false);
});

test("response parser keeps safe summary fields only", () => {
  const parsed = toReassignTasksResult({
    ok: true,
    dry_run: true,
    parts: ["writer", "publisher"],
    total_items: 2,
    duplicate_items: 1,
    summary: [
      { part: "writer", status: "writing", n_items: 2 },
      { part: "publisher", status: "ready", n_items: 9 },
    ],
    token: "hidden",
  });
  assert.deepEqual(parsed, {
    ok: true,
    dry_run: true,
    parts: ["writer"],
    total_items: 2,
    duplicate_items: 1,
    inserted_assignments: undefined,
    removed_assignments: undefined,
    summary: [{ part: "writer", status: "writing", n_items: 2 }],
    source_user_id: undefined,
    target_user_id: undefined,
    action_id: undefined,
    error: undefined,
  });
});
