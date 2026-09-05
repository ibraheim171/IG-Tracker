import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getItemPermissions, isSafeHttpsUrl, safeHttpsHref, validateItemFieldPatch } from "./item-permissions.ts";
import type { ParticipantPart, RoleName } from "./ui-data.ts";

const migration = readFileSync("supabase/migrations/20260902131635_role_field_permissions.sql", "utf8");
const restrictedFieldsMigration = readFileSync("supabase/migrations/20260905040223_restrict_writer_item_fields.sql", "utf8");
const appGuardMigration = readFileSync("supabase/migrations/20260901093257_must_change_password_app_guard.sql", "utf8");
const fieldsRoute = readFileSync("src/app/api/items/[itemId]/fields/route.ts", "utf8");
const itemDrawer = readFileSync("src/components/item-drawer.tsx", "utf8");
const readyList = readFileSync("src/components/ready-list.tsx", "utf8");

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
  assert.deepEqual([...fields].sort(), ["caption", "notes", "writer_delivery_url"].sort());
  assert.equal(fields.has("production_file_url"), false);
});

test("assigned writer cannot edit title, track, or idea type", () => {
  for (const fields of [{ title: "عنوان" }, { track_id: 1 }, { idea_type_id: 1 }]) {
    const result = validateItemFieldPatch(input(["writer"], ["writer"]), fields);
    assert.equal(result.ok, false);
    assert.equal(result.code, "E_FIELD_FORBIDDEN");
  }
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

test("item delivery links accept only valid https URLs or blank values", () => {
  for (const value of [null, "", "   ", "https://example.com/file", " https://docs.google.com/document/d/abc?usp=sharing "]) {
    assert.equal(isSafeHttpsUrl(value), true);
  }
  for (const value of ["javascript:alert(1)", "data:text/html,hi", "file:///tmp/a", "http://example.com/file", "plain text"]) {
    assert.equal(isSafeHttpsUrl(value), false);
  }
});

test("blank delivery links can be cleared by allowed roles", () => {
  const writerResult = validateItemFieldPatch(input(["writer"], ["writer"]), { writer_delivery_url: null });
  assert.deepEqual(writerResult, { ok: true, fields: { writer_delivery_url: null } });
  const producerResult = validateItemFieldPatch(input(["producer"], ["producer"]), { production_file_url: "" });
  assert.deepEqual(producerResult, { ok: true, fields: { production_file_url: "" } });
});

test("invalid delivery link rejects the whole item field payload", () => {
  const result = validateItemFieldPatch(input(["writer"], ["writer"]), {
    caption: "نص صالح",
    writer_delivery_url: "javascript:alert(1)",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "E_INVALID_LINK");
  assert.deepEqual(result.fields, ["writer_delivery_url"]);
});

test("safe href helper never returns unsafe legacy values", () => {
  assert.equal(safeHttpsHref("https://example.com/file"), "https://example.com/file");
  assert.equal(safeHttpsHref("javascript:alert(1)"), null);
  assert.equal(safeHttpsHref("data:text/html,hi"), null);
  assert.equal(safeHttpsHref("http://example.com/file"), null);
  assert.equal(safeHttpsHref("plain text"), null);
});

test("assigned reviewer can approve or reject only, without field edits", () => {
  const permissions = getItemPermissions(input(["reviewer"], ["reviewer"]));
  assert.equal(permissions.canReview, true);
  assert.deepEqual(permissions.editableFields, []);
  assert.equal(permissions.canManagePartners, false);
  assert.equal(permissions.canAssignSlot, false);
});

test("participant row without the matching profile role grants no field or review power", () => {
  const reviewerRowOnly = getItemPermissions(input(["writer"], ["reviewer"]));
  assert.equal(reviewerRowOnly.canReview, false);
  assert.deepEqual(reviewerRowOnly.editableFields, []);

  const producerRowOnly = getItemPermissions(input(["writer"], ["producer"]));
  assert.equal(producerRowOnly.editableFields.includes("production_file_url"), false);
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
  assert.deepEqual([...fields].sort(), ["caption", "notes", "production_file_url", "writer_delivery_url"].sort());
  for (const field of ["title", "track_id", "idea_type_id"] as const) assert.equal(fields.has(field), false);

  const reversed = allowedFields(["producer", "writer"], ["producer", "writer"]);
  assert.deepEqual([...reversed].sort(), [...fields].sort());
});

test("admin keeps title, track, and idea type field access", () => {
  const fields = allowedFields(["admin"]);
  for (const field of ["title", "track_id", "idea_type_id"] as const) assert.equal(fields.has(field), true);
});

test("mixed writer payloads reject atomically instead of filtering read-only fields", () => {
  const captionAndTrack = validateItemFieldPatch(input(["writer"], ["writer"]), { caption: "نص", track_id: 1 });
  assert.deepEqual(captionAndTrack, { ok: false, code: "E_FIELD_FORBIDDEN", fields: ["track_id"] });

  const deliveryAndTitle = validateItemFieldPatch(input(["writer"], ["writer"]), {
    writer_delivery_url: "https://example.com/writer",
    title: "عنوان",
  });
  assert.deepEqual(deliveryAndTitle, { ok: false, code: "E_FIELD_FORBIDDEN", fields: ["title"] });
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
  assert.deepEqual(getItemPermissions(input(["writer"], ["writer"], { active: false })).editableFields, []);
  assert.deepEqual(getItemPermissions(input(["producer"], ["producer"], { mustChangePassword: true })).editableFields, []);
});

test("API validation and drawer payload construction use the restricted field matrix", () => {
  for (const field of ["title", "track_id", "idea_type_id"] as const) {
    const result = validateItemFieldPatch(input(["writer"], ["writer"]), { [field]: field === "title" ? "عنوان" : 1 });
    assert.equal(result.ok, false);
    assert.equal(result.code, "E_FIELD_FORBIDDEN");
  }
  assert.match(fieldsRoute, /validateItemFieldPatch/);
  assert.match(itemDrawer, /const saveFieldKeys = drawerEditableFields\(permissions\.editableFields\)/);
  assert.match(itemDrawer, /const allowedSaveFields = saveFieldsFor\(currentItem\)/);
  assert.match(itemDrawer, /buildItemPayload\(currentEditable, allowedSaveFields\)/);
  assert.match(itemDrawer, /canEditField\("title"\)[\s\S]*readOnlyField\("العنوان", item\.title\)/);
  assert.match(itemDrawer, /canEditField\("track_id"\)[\s\S]*readOnlyField\("المسار", trackName\)/);
  assert.match(itemDrawer, /canEditField\("idea_type_id"\)[\s\S]*readOnlyField\("نوع الفكرة", ideaTypeName\)/);
});

test("latest migration narrows the live save_item_fields RPC without weakening database guards", () => {
  const saveBlock = restrictedFieldsMigration.match(/create or replace function public\.save_item_fields\([\s\S]*?\r?\nend\r?\n\$\$;/)?.[0] ?? "";
  assert.match(saveBlock, /perform public\.assert_can_use_app\(\)/);
  assert.match(saveBlock, /if public\.is_admin\(\) then[\s\S]*array\['title', 'track_id', 'idea_type_id', 'caption', 'notes', 'writer_delivery_url', 'production_file_url', 'priority'\]/);
  assert.match(saveBlock, /is_item_participant_part\(p_item, 'writer'\)[\s\S]*array\['caption', 'notes', 'writer_delivery_url'\]/);
  assert.match(saveBlock, /is_item_participant_part\(p_item, 'producer'\)[\s\S]*array\['production_file_url'\]/);
  const writerBlock = saveBlock.match(/if public\.is_item_participant_part\(p_item, 'writer'\)[\s\S]*?end if;/)?.[0] ?? "";
  assert.doesNotMatch(writerBlock, /title|track_id|idea_type_id|production_file_url/);
  assert.ok(saveBlock.indexOf("FIELD_FORBIDDEN") < saveBlock.indexOf("update public.items"));
  assert.ok(saveBlock.indexOf("INVALID_LINK") < saveBlock.indexOf("update public.items"));
  assert.match(restrictedFieldsMigration, /revoke execute on function public\.save_item_fields\(uuid, jsonb\) from public, anon, authenticated/);
  assert.match(restrictedFieldsMigration, /grant execute on function public\.save_item_fields\(uuid, jsonb\) to authenticated/);
  assert.match(restrictedFieldsMigration, /revoke insert, update, delete on table public\.items from public, anon, authenticated/);
  assert.match(restrictedFieldsMigration, /revoke truncate on table[\s\S]*public\.publishing_slots[\s\S]*from public, anon, authenticated/);
});

test("database migration enforces trusted RPC and publisher-admin boundaries", () => {
  assert.match(migration, /alter type public\.role_name add value if not exists 'publisher'/);
  assert.match(migration, /add column if not exists writer_delivery_url text/);
  assert.match(migration, /revoke insert, update, delete on table public\.items from public, anon, authenticated/);
  assert.match(migration, /revoke insert, update, delete on table public\.item_participants from public, anon, authenticated/);
  assert.match(migration, /revoke insert, update, delete on table public\.partners from anon, authenticated/);
  assert.match(migration, /revoke insert, update, delete on table public\.item_partners from anon, authenticated/);
  assert.match(migration, /drop policy if exists write_participants on public\.item_participants/);
  assert.match(migration, /create policy no_direct_item_update on public\.items[\s\S]*using \(false\)[\s\S]*with check \(false\)/);
  assert.match(migration, /create policy no_direct_item_insert on public\.items[\s\S]*with check \(false\)/);
  assert.match(migration, /create policy no_direct_item_participant_insert on public\.item_participants[\s\S]*with check \(false\)/);
  assert.match(migration, /create policy no_direct_item_participant_update on public\.item_participants[\s\S]*using \(false\)[\s\S]*with check \(false\)/);
  assert.match(migration, /create policy no_direct_item_participant_delete on public\.item_participants[\s\S]*using \(false\)/);
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

test("database migration revokes truncate from browser roles on writable operational tables", () => {
  assert.match(migration, /revoke truncate on table[\s\S]*public\.items[\s\S]*public\.item_participants[\s\S]*public\.partners[\s\S]*public\.item_partners[\s\S]*public\.publishing_slots[\s\S]*from public, anon, authenticated/);
});

test("assigned writer cannot self-promote through item_participants Data API writes", () => {
  assert.match(migration, /drop policy if exists write_participants on public\.item_participants/);
  assert.match(migration, /create policy no_direct_item_participant_insert on public\.item_participants[\s\S]*with check \(false\)/);
  assert.match(migration, /create policy no_direct_item_participant_update on public\.item_participants[\s\S]*using \(false\)[\s\S]*with check \(false\)/);
  assert.match(migration, /create policy no_direct_item_participant_delete on public\.item_participants[\s\S]*using \(false\)/);
  assert.match(migration, /revoke insert, update, delete on table public\.item_participants from public, anon, authenticated/);
});

test("database participant role checks require both assignment row and matching active profile role", () => {
  assert.match(migration, /create or replace function public\.is_item_participant_part[\s\S]*profile\.active[\s\S]*not profile\.must_change_password/);
  assert.match(migration, /p_part::text = any\(profile\.roles::text\[\]\)/);
  assert.match(migration, /participant\.item_id = p_item[\s\S]*participant\.part = p_part/);
  assert.match(migration, /join public\.profiles profile on profile\.id = participant\.user_id[\s\S]*'producer' = any\(profile\.roles::text\[\]\)/);
});

test("database create item path blocks sensitive insert fields and starts from idea", () => {
  assert.match(migration, /create or replace function public\.create_item\(\s*p_fields jsonb\s*\)/);
  assert.match(migration, /not \(public\.has_role_text\('writer'\) or public\.is_admin\(\)\)/);
  assert.match(migration, /where not \(field = any\(array\['title', 'track_id', 'idea_type_id', 'caption', 'notes', 'writer_delivery_url'\]\)\)/);
  const allowedBlock = migration.match(/where not \(field = any\(array\[[\s\S]*?\]\)\)/)?.[0] ?? "";
  for (const field of ["status", "slot_id", "published_at", "ig_permalink", "ig_media_id", "production_file_url", "is_archived"]) {
    assert.doesNotMatch(allowedBlock, new RegExp(field));
  }
  const insertBlock = migration.match(/insert into public\.items \([\s\S]*?\)\s*values/)?.[0] ?? "";
  assert.doesNotMatch(insertBlock, /status|slot_id|published_at|ig_permalink|ig_media_id|production_file_url|is_archived/);
  assert.match(migration, /if it\.status <> 'idea' then/);
});

test("database create and save paths reject unsafe delivery links before mutation", () => {
  assert.match(migration, /create or replace function public\.is_safe_https_url\(p_value text\)/);
  assert.match(migration, /\^https:\/\/\(\[a-z0-9\]/);
  const saveBlock = migration.match(/create or replace function public\.save_item_fields\([\s\S]*?\r?\nend\r?\n\$\$;/)?.[0] ?? "";
  const createBlock = migration.match(/create or replace function public\.create_item\([\s\S]*?\r?\nend\r?\n\$\$;/)?.[0] ?? "";
  assert.match(saveBlock, /p_fields \? 'writer_delivery_url' and not public\.is_safe_https_url/);
  assert.match(saveBlock, /p_fields \? 'production_file_url' and not public\.is_safe_https_url/);
  assert.ok(saveBlock.indexOf("INVALID_LINK") < saveBlock.indexOf("update public.items"));
  assert.match(createBlock, /p_fields \? 'writer_delivery_url' and not public\.is_safe_https_url/);
  assert.ok(createBlock.indexOf("INVALID_LINK") < createBlock.indexOf("insert into public.items"));
});

test("field route and UI block unsafe delivery links before href rendering", () => {
  assert.match(fieldsRoute, /E_INVALID_LINK/);
  assert.match(fieldsRoute, /روابط التسليم والإنتاج يجب أن تكون روابط HTTPS صالحة/);
  assert.match(itemDrawer, /safeHttpsHref/);
  assert.match(readyList, /safeHttpsHref/);
  assert.doesNotMatch(itemDrawer, /href=\{writerDeliveryUrl\}|href=\{productionFileUrl\}/);
  assert.doesNotMatch(readyList, /href=\{item\.production_file_url\}/);
  assert.match(itemDrawer, /رابط غير صالح/);
  assert.match(readyList, /رابط غير صالح/);
  assert.match(itemDrawer, /target="_blank" rel="noopener noreferrer"/);
  assert.match(readyList, /target="_blank" rel="noopener noreferrer"/);
});

test("reject item is limited to the matching review gate and stage", () => {
  const rejectBlock = migration.match(/create or replace function public\.reject_item\([\s\S]*?\n\$\$;/)?.[0] ?? "";
  assert.match(rejectBlock, /if p_gate = 'content' and it\.status <> 'writing' then[\s\S]*INVALID_REJECT_STAGE/);
  assert.match(rejectBlock, /if p_gate = 'design' and it\.status <> 'in_production' then[\s\S]*INVALID_REJECT_STAGE/);
  assert.ok(rejectBlock.indexOf("INVALID_REJECT_STAGE") < rejectBlock.indexOf("insert into public.approvals (item_id, gate, result, actor_id, note)"));
});
