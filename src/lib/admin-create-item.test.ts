import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canEditItemAssignments, validateAdminCreateItemPayload, validateAdminCreateTrackPayload } from "./admin-create-item.ts";
import { buildMyMaterials, type ParticipantItemRow } from "./my-materials-data.ts";

const creationMigration = readFileSync("supabase/migrations/20260903053534_admin_create_items_tracks.sql", "utf8");
const roleMigration = readFileSync("supabase/migrations/20260902131635_role_field_permissions.sql", "utf8");
const createItemRoute = readFileSync("src/app/api/admin/items/route.ts", "utf8");
const createTrackRoute = readFileSync("src/app/api/admin/tracks/route.ts", "utf8");
const assignmentsRoute = readFileSync("src/app/api/admin/items/[itemId]/participants/route.ts", "utf8");
const slotsBoard = readFileSync("src/components/slots-board.tsx", "utf8");
const createModal = readFileSync("src/components/admin-create-item-modal.tsx", "utf8");
const itemDrawer = readFileSync("src/components/item-drawer.tsx", "utf8");

const uuidA = "11111111-1111-4111-8111-111111111111";
const uuidB = "22222222-2222-4222-8222-222222222222";
const uuidC = "33333333-3333-4333-8333-333333333333";

test("admin create item validator allows safe payload and rejects forbidden or unsafe fields atomically", () => {
  const ok = validateAdminCreateItemPayload({
    title: "عنوان",
    writer_id: uuidA,
    producer_id: uuidB,
    reviewer_id: uuidC,
    track_id: 1,
    idea_type_id: 2,
    caption: "نص",
    notes: "ملاحظة",
    writer_delivery_url: "https://example.com/writer",
    production_file_url: "https://example.com/production",
    partner_ids: [1, 1, 2],
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.value.partner_ids, [1, 2]);

  for (const value of ["http://example.com", "javascript:alert(1)", "data:text/html,hi", "plain text"]) {
    const result = validateAdminCreateItemPayload({ title: "عنوان", writer_id: uuidA, writer_delivery_url: value });
    assert.equal(result.ok, false);
    assert.equal(result.code, "E_INVALID_LINK");
  }

  assert.equal(validateAdminCreateItemPayload({ title: "عنوان", writer_id: uuidA, status: "published" }).ok, false);
  assert.equal(validateAdminCreateItemPayload({ title: "عنوان", writer_id: uuidA, partner_ids: [1, "bad"] }).ok, false);
});

test("track validator accepts unique-looking valid input and rejects duplicate-class bad input shapes", () => {
  assert.deepEqual(validateAdminCreateTrackPayload({ name: "مسار جديد", color_hex: "#AABBCC", sort_order: 30 }), {
    ok: true,
    value: { name: "مسار جديد", color_hex: "#AABBCC", sort_order: 30 },
  });
  assert.equal(validateAdminCreateTrackPayload({ name: "", color_hex: "#AABBCC" }).ok, false);
  assert.equal(validateAdminCreateTrackPayload({ name: "مسار", color_hex: "red" }).ok, false);
  assert.equal(validateAdminCreateTrackPayload({ name: "مسار", color_hex: "#ABCDEG" }).ok, false);
  assert.equal(validateAdminCreateTrackPayload({ name: "مسار", sort_order: 1.5 }).ok, false);
});

test("admin item creation RPC validates admin, assignees, roles, links, and allowed fields before inserts", () => {
  assert.match(creationMigration, /create or replace function public\.admin_create_item\(\s*p_fields jsonb\s*\)/);
  assert.match(creationMigration, /perform public\.assert_can_use_app\(\)/);
  assert.match(creationMigration, /if not public\.is_admin\(\) then/);
  assert.match(creationMigration, /where not \(field = any\(array\[[\s\S]*writer_id[\s\S]*reviewer_id[\s\S]*slot_id[\s\S]*\]\)\)/);
  for (const field of ["status", "published_at", "ig_permalink", "ig_media_id", "is_archived"]) {
    assert.doesNotMatch(creationMigration.match(/where not \(field = any\(array\[[\s\S]*?\]\)\)/)?.[0] ?? "", new RegExp(field));
  }
  assert.match(creationMigration, /p_fields \? 'writer_delivery_url' and not public\.is_safe_https_url/);
  assert.match(creationMigration, /p_fields \? 'production_file_url' and not public\.is_safe_https_url/);
  assert.match(creationMigration, /where id in \(writer_id, producer_id, reviewer_id\)[\s\S]*order by id[\s\S]*for update/);
  assert.match(creationMigration, /'writer' = any\(roles::text\[\]\)/);
  assert.match(creationMigration, /'producer' = any\(roles::text\[\]\)/);
  assert.match(creationMigration, /'reviewer' = any\(roles::text\[\]\)/);
  assert.match(creationMigration, /active[\s\S]*not must_change_password/);
});

test("admin item creation starts from idea and atomically creates participants, partners, and optional slot", () => {
  assert.match(creationMigration, /insert into public\.items \([\s\S]*created_by[\s\S]*\)\s*values/);
  const insertBlock = creationMigration.match(/insert into public\.items \([\s\S]*?\)\s*values/)?.[0] ?? "";
  assert.doesNotMatch(insertBlock, /status|published_at|ig_permalink|ig_media_id|is_archived/);
  assert.match(creationMigration, /if it\.status <> 'idea' then/);
  assert.match(creationMigration, /insert into public\.item_participants \(item_id, user_id, part, added_by\)[\s\S]*writer_id, 'writer'/);
  assert.match(creationMigration, /producer_id, 'producer'[\s\S]*on conflict \(item_id, user_id, part\) do nothing/);
  assert.match(creationMigration, /reviewer_id, 'reviewer'[\s\S]*on conflict \(item_id, user_id, part\) do nothing/);
  assert.match(creationMigration, /insert into public\.item_partners[\s\S]*on conflict \(item_id, partner_id\) do nothing/);
  assert.match(creationMigration, /perform public\.refresh_slot_state\(slot_id\)/);
  assert.equal(/exception\s+when\s+others/i.test(creationMigration), false);
});

test("admin assignment edit RPC replaces operational assignments through trusted DB code only", () => {
  assert.match(creationMigration, /create or replace function public\.admin_save_item_assignments/);
  assert.match(creationMigration, /if not public\.is_admin\(\) then/);
  assert.match(creationMigration, /select \* into it from public\.items where id = p_item for update/);
  assert.match(creationMigration, /if it\.is_archived then raise exception 'ARCHIVED_IMMUTABLE:/);
  assert.match(creationMigration, /if it\.status = 'published' then raise exception 'PUBLISHED_IMMUTABLE:/);
  assert.match(creationMigration, /if it\.status = 'cancelled' then raise exception 'CANCELLED_IMMUTABLE:/);
  assert.match(creationMigration, /where id in \(p_writer, p_producer, p_reviewer\)[\s\S]*order by id[\s\S]*for update/);
  assert.match(creationMigration, /from public\.item_participants[\s\S]*for update/);
  assert.match(creationMigration, /delete from public\.item_participants[\s\S]*part in \('writer', 'producer', 'reviewer'\)/);
  assert.match(creationMigration, /on conflict \(item_id, user_id, part\) do nothing/);
});

test("shared assignment edit logic and UI hide editor for historical item states", () => {
  assert.equal(canEditItemAssignments({ status: "idea", is_archived: false }), true);
  assert.equal(canEditItemAssignments({ status: "ready", is_archived: false }), true);
  assert.equal(canEditItemAssignments({ status: "published", is_archived: false }), false);
  assert.equal(canEditItemAssignments({ status: "cancelled", is_archived: false }), false);
  assert.equal(canEditItemAssignments({ status: "idea", is_archived: true }), false);
  assert.match(itemDrawer, /canEditItemAssignments\(item\)/);
  assert.match(itemDrawer, /item && canEditAssignments/);
});

test("create and assignment routes are same-origin admin-only RPC wrappers without service role or direct writes", () => {
  for (const source of [createItemRoute, createTrackRoute, assignmentsRoute]) {
    assert.match(source, /isSameOrigin/);
    assert.match(source, /requireActiveRouteProfile\(request, cookieResponse\)/);
    assert.match(source, /roles\.includes\("admin"\)/);
    assert.equal(/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(source), false);
    assert.equal(/from\("(items|item_participants|tracks)"\)\.(insert|update|delete|upsert)/.test(source), false);
  }
  assert.match(createItemRoute, /rpc\("admin_create_item"/);
  assert.match(createTrackRoute, /rpc\("admin_create_track"/);
  assert.match(assignmentsRoute, /rpc\("admin_save_item_assignments"/);
  assert.match(assignmentsRoute, /PUBLISHED_IMMUTABLE|safeRpcError/);
});

test("track creation RPC is admin-only, server-generates slug, validates color, and closes direct browser writes", () => {
  assert.match(creationMigration, /create or replace function public\.admin_create_track/);
  assert.match(creationMigration, /if not public\.is_admin\(\) then/);
  assert.match(creationMigration, /normalized_color !~ '\^#\[0-9A-F\]\{6\}\$'/);
  assert.match(creationMigration, /DUPLICATE_TRACK/);
  assert.match(creationMigration, /base_slug := lower\(regexp_replace\(trimmed_name/);
  assert.doesNotMatch(creationMigration, /p_slug/);
  assert.match(creationMigration, /create policy no_direct_track_insert on public\.tracks[\s\S]*with check \(false\)/);
  assert.match(creationMigration, /create policy no_direct_track_update on public\.tracks[\s\S]*using \(false\)[\s\S]*with check \(false\)/);
  assert.match(creationMigration, /create policy no_direct_track_delete on public\.tracks[\s\S]*using \(false\)/);
  assert.match(creationMigration, /revoke insert, update, delete, truncate on table public\.tracks from public, anon, authenticated/);
});

test("UI exposes admin creation and track creation without window.confirm or storage", () => {
  assert.match(slotsBoard, />إضافة مادة</);
  assert.match(slotsBoard, /isAdminRole\(roles\)/);
  assert.match(slotsBoard, /<AdminCreateItemModal/);
  assert.match(createModal, />إضافة مسار جديد</);
  assert.match(createModal, /memberLabel\(member\)/);
  assert.match(createModal, /member\.roles\.includes\(role\)/);
  assert.match(createModal, /credentials: "same-origin"/);
  assert.match(createModal, /fetch\("\/api\/admin\/items"/);
  assert.match(createModal, /fetch\("\/api\/admin\/tracks"/);
  assert.match(itemDrawer, />تعيينات الفريق</);
  assert.match(itemDrawer, /fetch\(`\/api\/admin\/items\/\$\{encodeURIComponent\(item\.id\)\}\/participants`/);
  for (const source of [slotsBoard, createModal, itemDrawer]) {
    assert.equal(/window\.confirm|localStorage|sessionStorage/.test(source), false);
  }
});

test("admin item creation resolves new partners case-insensitively and rejects inactive duplicates", () => {
  const createItemBlock = creationMigration.match(/create or replace function public\.admin_create_item\([\s\S]*?create or replace function public\.admin_save_item_assignments/)?.[0] ?? "";
  assert.match(createItemBlock, /lock table public\.partners in share row exclusive mode/);
  assert.match(createItemBlock, /where lower\(name\) = lower\(trimmed_new_partner\)/);
  assert.match(createItemBlock, /for update/);
  assert.match(createItemBlock, /if not matched_partner\.active then[\s\S]*INACTIVE_PARTNER/);
  assert.match(createItemBlock, /created_partner_id := matched_partner\.id/);
  assert.match(createItemBlock, /insert into public\.partners \(name, aliases, created_by\)/);
  assert.doesNotMatch(createItemBlock, /on conflict \(name\) do update/);
});

test("save item partners is redefined with the same safe partner resolution", () => {
  const savePartnersBlock = creationMigration.match(/create or replace function public\.save_item_partners\([\s\S]*?drop policy if exists no_direct_track_insert/)?.[0] ?? "";
  assert.match(savePartnersBlock, /perform public\.assert_can_use_app\(\)/);
  assert.match(savePartnersBlock, /public\.can_publish_items\(\)/);
  assert.match(savePartnersBlock, /lock table public\.partners in share row exclusive mode/);
  assert.match(savePartnersBlock, /where lower\(name\) = lower\(trimmed_name\)/);
  assert.match(savePartnersBlock, /for update/);
  assert.match(savePartnersBlock, /if not matched_partner\.active then[\s\S]*INACTIVE_PARTNER/);
  assert.match(savePartnersBlock, /created_partner_id := matched_partner\.id/);
  assert.match(savePartnersBlock, /insert into public\.partners \(name, aliases, created_by\)/);
  assert.match(savePartnersBlock, /delete from public\.item_partners where item_id = p_item/);
  assert.doesNotMatch(savePartnersBlock, /on conflict \(name\) do update/);
});

test("assigned users appear in my materials only through item_participants rows", () => {
  const rows: ParticipantItemRow[] = [
    {
      item_id: "item-1",
      part: "writer",
      items: {
        id: "item-1",
        ref: "AQ-0001",
        title: "مادة",
        status: "idea",
        track_id: 1,
        idea_type_id: 1,
        tracks: { name: "مسار", color_hex: "#1E8F8B" },
        idea_types: { name: "نوع" },
        publishing_slots: null,
      },
    },
    {
      item_id: "item-1",
      part: "producer",
      items: {
        id: "item-1",
        ref: "AQ-0001",
        title: "مادة",
        status: "idea",
        track_id: 1,
        idea_type_id: 1,
        tracks: { name: "مسار", color_hex: "#1E8F8B" },
        idea_types: { name: "نوع" },
        publishing_slots: null,
      },
    },
  ];
  assert.deepEqual(buildMyMaterials(rows)[0]?.parts.sort(), ["producer", "writer"]);
  assert.deepEqual(buildMyMaterials([]), []);
});

test("direct browser writes remain closed on items, item_participants, and tracks, with truncate revoked", () => {
  assert.match(roleMigration, /revoke insert, update, delete on table public\.items from public, anon, authenticated/);
  assert.match(roleMigration, /revoke insert, update, delete on table public\.item_participants from public, anon, authenticated/);
  assert.match(creationMigration, /revoke insert, update, delete, truncate on table public\.tracks from public, anon, authenticated/);
  assert.match(roleMigration, /revoke truncate on table[\s\S]*public\.items[\s\S]*public\.item_participants[\s\S]*public\.partners[\s\S]*public\.item_partners[\s\S]*public\.publishing_slots[\s\S]*from public, anon, authenticated/);
});

test("publisher is not treated as admin for user management, reassignment, or track creation", () => {
  assert.equal(/roles\.includes\("publisher"\)[\s\S]*admin_create_track/.test(createTrackRoute), false);
  assert.equal(/roles\.includes\("publisher"\)[\s\S]*admin_save_item_assignments/.test(assignmentsRoute), false);
  assert.equal(/roles\.includes\("publisher"\)[\s\S]*admin_create_item/.test(createItemRoute), false);
  assert.match(creationMigration, /if not public\.is_admin\(\) then/);
});
