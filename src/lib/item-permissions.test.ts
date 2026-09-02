import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getItemPermissions, validateItemFieldPatch } from "./item-permissions.ts";
import type { ParticipantPart, RoleName } from "./ui-data.ts";

const migration = readFileSync("supabase/migrations/20260902131635_role_field_permissions.sql", "utf8");
const appGuardMigration = readFileSync("supabase/migrations/20260901093257_must_change_password_app_guard.sql", "utf8");

function profile(roles: RoleName[], options: { active?: boolean; mustChangePassword?: boolean } = {}) {
  return {
    active: options.active ?? true,
    must_change_password: options.mustChangePassword ?? false,
    roles,
  };
}

function input(roles: RoleName[], participantParts: ParticipantPart[] = [], options: { active?: boolean; mustChangePassword?: boolean; archived?: boolean } = {}) {
  return {
    profile: profile(roles, options),
    item: { is_archived: options.archived ?? false },
    participantParts,
  };
}

function allowedFields(roles: RoleName[], participantParts: ParticipantPart[] = [], options = {}) {
  return new Set(getItemPermissions(input(roles, participantParts, options)).editableFields);
}

test("assigned writer can edit writing fields only", () => {
  const fields = allowedFields(["writer"], ["writer"]);
  assert.deepEqual([...fields].sort(), ["caption", "idea_type_id", "notes", "title", "track_id", "writer_delivery_url"].sort());
  assert.equal(fields.has("production_file_url"), false);
});

test("unassigned writer is rejected", () => {
  const result = validateItemFieldPatch(input(["writer"]), { title: "عنوان" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "E_FIELD_FORBIDDEN");
});

test("assigned producer can edit production URL only", () => {
  const fields = allowedFields(["producer"], ["producer"]);
  assert.deepEqual([...fields], ["production_file_url"]);
});

test("producer cannot edit caption or writer delivery URL", () => {
  const result = validateItemFieldPatch(input(["producer"], ["producer"]), {
    caption: "نص",
    writer_delivery_url: "https://example.com/writer",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "E_FIELD_FORBIDDEN");
  assert.deepEqual(result.fields?.sort(), ["caption", "writer_delivery_url"].sort());
});

test("writer cannot edit production URL", () => {
  const result = validateItemFieldPatch(input(["writer"], ["writer"]), { production_file_url: "https://example.com/production" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "E_FIELD_FORBIDDEN");
});

test("assigned reviewer can approve or reject only, without field edits", () => {
  const permissions = getItemPermissions(input(["reviewer"], ["reviewer"]));
  assert.equal(permissions.canReview, true);
  assert.deepEqual(permissions.editableFields, []);
  assert.equal(permissions.canManagePartners, false);
  assert.equal(permissions.canAssignSlot, false);
});

test("publisher can manage partners, slots, and publishing only", () => {
  const permissions = getItemPermissions(input(["publisher"]));
  assert.equal(permissions.canManagePartners, true);
  assert.equal(permissions.canAssignSlot, true);
  assert.equal(permissions.canMarkPublished, true);
  assert.equal(permissions.canAdminChangeStage, false);
  assert.deepEqual(permissions.editableFields, []);
});

test("publisher does not get admin user-management or admin stage powers", () => {
  assert.match(migration, /create or replace function public\.can_publish_items\(\)[\s\S]*public\.has_role_text\('publisher'\)/);
  assert.match(appGuardMigration, /create or replace function public\.admin_change_item_stage\([\s\S]*if not public\.is_admin\(\) then/);
  assert.doesNotMatch(appGuardMigration, /has_role_text\('publisher'\)/);
  assert.equal(getItemPermissions(input(["publisher"])).canAdminChangeStage, false);
});

test("writer plus producer receives the union of both field permissions", () => {
  const fields = allowedFields(["writer", "producer"], ["writer", "producer"]);
  assert.equal(fields.has("caption"), true);
  assert.equal(fields.has("writer_delivery_url"), true);
  assert.equal(fields.has("production_file_url"), true);
});

test("publisher plus producer receives the union of publishing and production permissions", () => {
  const permissions = getItemPermissions(input(["publisher", "producer"], ["producer"]));
  assert.deepEqual(permissions.editableFields, ["production_file_url"]);
  assert.equal(permissions.canManagePartners, true);
  assert.equal(permissions.canAssignSlot, true);
  assert.equal(permissions.canMarkPublished, true);
});

test("admin plus producer receives admin permissions", () => {
  const permissions = getItemPermissions(input(["admin", "producer"], ["producer"]));
  assert.equal(permissions.canAdminChangeStage, true);
  assert.equal(permissions.canManagePartners, true);
  assert.equal(permissions.editableFields.includes("caption"), true);
  assert.equal(permissions.editableFields.includes("production_file_url"), true);
});

test("disabled users and password-change users are rejected", () => {
  assert.deepEqual(getItemPermissions(input(["admin"], [], { active: false })).editableFields, []);
  assert.equal(getItemPermissions(input(["publisher"], [], { mustChangePassword: true })).canMarkPublished, false);
});

test("database migration enforces trusted RPC and publisher-admin boundaries", () => {
  assert.match(migration, /alter type public\.role_name add value if not exists 'publisher'/);
  assert.match(migration, /add column if not exists writer_delivery_url text/);
  assert.match(migration, /revoke update on table public\.items from anon, authenticated/);
  assert.match(migration, /revoke insert, update, delete on table public\.partners from anon, authenticated/);
  assert.match(migration, /revoke insert, update, delete on table public\.item_partners from anon, authenticated/);
  assert.match(migration, /create policy no_direct_item_update on public\.items[\s\S]*using \(false\)[\s\S]*with check \(false\)/);
  assert.match(migration, /create or replace function public\.save_item_fields/);
  assert.match(migration, /FIELD_FORBIDDEN/);
  assert.match(migration, /create or replace function public\.save_item_partners/);
  assert.match(migration, /create policy write_partners on public\.item_partners[\s\S]*public\.can_publish_items\(\)/);
  assert.match(migration, /create policy add_partner on public\.partners[\s\S]*public\.can_publish_items\(\)/);
  assert.match(migration, /create or replace function public\.assign_slot[\s\S]*public\.can_publish_items\(\)/);
  assert.match(migration, /create or replace function public\.mark_published[\s\S]*public\.can_publish_items\(\)/);
  assert.match(migration, /create or replace function public\.ensure_can_advance_item/);
  assert.match(migration, /public\.assert_can_use_app\(\)/);
});
