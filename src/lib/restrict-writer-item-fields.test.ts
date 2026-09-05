import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260905040223_restrict_writer_item_fields.sql", "utf8");
const roleMigration = readFileSync("supabase/migrations/20260902131635_role_field_permissions.sql", "utf8");
const saveBlock = migration.match(/create or replace function public\.save_item_fields\([\s\S]*?\r?\nend\r?\n\$\$;/)?.[0] ?? "";

test("save_item_fields has explicit admin, writer, and producer allowlists", () => {
  assert.match(saveBlock, /if public\.is_admin\(\) then[\s\S]*array\['title', 'track_id', 'idea_type_id', 'caption', 'notes', 'writer_delivery_url', 'production_file_url', 'priority'\]/);
  assert.match(saveBlock, /is_item_participant_part\(p_item, 'writer'\)[\s\S]*array\['caption', 'notes', 'writer_delivery_url'\]/);
  assert.match(saveBlock, /is_item_participant_part\(p_item, 'producer'\)[\s\S]*array\['production_file_url'\]/);
});

test("writer and producer permissions form an order-independent union", () => {
  const writerCheck = saveBlock.indexOf("is_item_participant_part(p_item, 'writer')");
  const producerCheck = saveBlock.indexOf("is_item_participant_part(p_item, 'producer')");
  assert.ok(writerCheck > 0 && producerCheck > writerCheck);
  assert.doesNotMatch(saveBlock.slice(writerCheck, producerCheck), /elsif|else\s+if/);
  assert.match(roleMigration, /p_part::text = any\(profile\.roles::text\[\]\)/);
});

test("participant checks require assignment, matching role, active account, and cleared password flag", () => {
  const participantBlock = roleMigration.match(/create or replace function public\.is_item_participant_part\([\s\S]*?\n\$\$;/)?.[0] ?? "";
  assert.match(participantBlock, /participant\.item_id = p_item/);
  assert.match(participantBlock, /participant\.part = p_part/);
  assert.match(participantBlock, /p_part::text = any\(profile\.roles::text\[\]\)/);
  assert.match(participantBlock, /profile\.active/);
  assert.match(participantBlock, /not profile\.must_change_password/);
  assert.match(saveBlock, /perform public\.assert_can_use_app\(\)/);
});

test("forbidden and unsafe payloads fail before the single update", () => {
  assert.match(saveBlock, /where not \(field = any\(allowed\)\)/);
  assert.match(saveBlock, /FIELD_FORBIDDEN/);
  assert.match(saveBlock, /p_fields \? 'writer_delivery_url' and not public\.is_safe_https_url/);
  assert.match(saveBlock, /p_fields \? 'production_file_url' and not public\.is_safe_https_url/);
  assert.ok(saveBlock.indexOf("FIELD_FORBIDDEN") < saveBlock.indexOf("update public.items"));
  assert.ok(saveBlock.indexOf("INVALID_LINK") < saveBlock.indexOf("update public.items"));
  assert.equal((saveBlock.match(/update public\.items/g) ?? []).length, 1);
});

test("RPC and direct table privileges stay closed", () => {
  assert.match(migration, /revoke execute on function public\.save_item_fields\(uuid, jsonb\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.save_item_fields\(uuid, jsonb\) to authenticated/);
  assert.match(migration, /revoke insert, update, delete on table public\.items from public, anon, authenticated/);
  assert.match(migration, /revoke truncate on table[\s\S]*public\.items[\s\S]*public\.item_participants[\s\S]*public\.partners[\s\S]*public\.item_partners[\s\S]*public\.publishing_slots[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|truncate)/i);
});
