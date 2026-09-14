import assert from "node:assert/strict";
import test from "node:test";
import { buildAiExport } from "./data-export.ts";

test("AI export excludes April and May and keeps linked operational records", () => {
  const result = buildAiExport({
    items: [
      { id: "june-item", ref: "AQ-0002", title: "June", slot_id: "june-slot", created_at: "2026-06-01T10:00:00Z" },
      { id: "may-item", ref: "AQ-0001", title: "May", slot_id: "may-slot", created_at: "2026-05-01T10:00:00Z" },
      { id: "may-slot-item-created-later", ref: "AQ-0004", title: "May slot", slot_id: "may-slot", created_at: "2026-06-01T10:00:00Z" },
      { id: "unscheduled", ref: "AQ-0003", title: "Unscheduled", slot_id: null, created_at: "2026-06-03T10:00:00Z" },
    ],
    publishingSlots: [
      { id: "june-slot", slot_at: "2026-06-10T18:00:00Z", state: "open" },
      { id: "may-slot", slot_at: "2026-05-10T18:00:00Z", state: "assigned" },
    ],
    itemParticipants: [
      { item_id: "june-item", user_id: "writer-1", part: "writer" },
      { item_id: "may-item", user_id: "writer-2", part: "writer" },
    ],
    itemPartners: [],
    transitions: [],
    profiles: [{ id: "writer-1", display_name: "Writer", roles: ["writer"], phone: "secret", must_change_password: true }],
    partners: [],
    tracks: [],
    igPosts: [
      { media_id: "june-media", published_at: "2026-06-11T10:00:00Z", permalink: "https://instagram.com/p/june" },
      { media_id: "april-media", published_at: "2026-04-11T10:00:00Z", permalink: "https://instagram.com/p/april" },
    ],
    igPostDaily: [
      { media_id: "june-media", snapshot_date: "2026-06-12", reach: 10 },
      { media_id: "april-media", snapshot_date: "2026-04-12", reach: 99 },
    ],
    igAccountDaily: [{ date: "2026-05-12", followers: 50 }, { date: "2026-06-12", followers: 60 }],
    igDemographics: [{ snapshot_date: "2026-05-12", dimension: "age", key: "18-24", value: 1 }],
    igCollabs: [{ id: "may-collab", collaboration_date: "2026-05-12", partner_id: 1 }, { id: "june-collab", collaboration_date: "2026-06-12", partner_id: 1 }],
    workTrackerSourceRows: [
      { id: "source-june", item_id: "june-item", source_sheet: "June", source_row: 2, publish_date: "2026-06-10", payload: { title: "June" } },
      { id: "source-may", item_id: "may-item", source_sheet: "May", source_row: 2, publish_date: "2026-05-10", payload: { title: "May" } },
    ],
  }, "2026-09-14T00:00:00.000Z");

  assert.deepEqual(result.items.map((row) => row.id), ["june-item", "unscheduled"]);
  assert.deepEqual(result.publishing_slots.map((row) => row.id), ["june-slot"]);
  assert.deepEqual(result.item_participants.map((row) => row.item_id), ["june-item"]);
  assert.deepEqual(result.ig_posts.map((row) => row.media_id), ["june-media"]);
  assert.deepEqual(result.ig_post_daily.map((row) => row.media_id), ["june-media"]);
  assert.deepEqual(result.ig_account_daily.map((row) => row.date), ["2026-06-12"]);
  assert.deepEqual(result.ig_collabs.map((row) => row.id), ["june-collab"]);
  assert.deepEqual(result.work_tracker_source_rows.map((row) => row.id), ["source-june"]);
  assert.deepEqual(result.profiles, [{ id: "writer-1", display_name: "Writer", roles: ["writer"] }]);
});

test("AI export is deterministic and carries a safe scope marker", () => {
  const result = buildAiExport({
    items: [{ id: "b", ref: "B", created_at: "2026-06-03T00:00:00Z" }, { id: "a", ref: "A", created_at: "2026-06-02T00:00:00Z" }],
    publishingSlots: [], itemParticipants: [], itemPartners: [], transitions: [], profiles: [], partners: [], tracks: [],
    igPosts: [], igPostDaily: [], igAccountDaily: [], igDemographics: [], igCollabs: [],
  }, "2026-09-14T00:00:00.000Z");

  assert.equal(result.export_version, "ig-tracker-ai-v1");
  assert.deepEqual(result.scope.excluded_months, [4, 5]);
  assert.equal(result.generated_at, "2026-09-14T00:00:00.000Z");
  assert.deepEqual(result.items.map((row) => row.id), ["a", "b"]);
});

test("AI export omits records explicitly marked as internal UAT", () => {
  const result = buildAiExport({
    items: [
      { id: "real", ref: "AQ-0011", title: "مادة حقيقية", created_at: "2026-06-03T00:00:00Z" },
      { id: "uat", ref: "AQ-0007", title: "UAT — مسودة عنوان فقط", notes: "سجل اختبار داخلي", created_at: "2026-06-03T00:00:00Z" },
    ],
    publishingSlots: [], itemParticipants: [{ item_id: "uat", user_id: "tester", part: "writer" }], itemPartners: [], transitions: [],
    profiles: [{ id: "tester", display_name: "Tester", roles: ["writer"] }], partners: [], tracks: [],
    igPosts: [], igPostDaily: [], igAccountDaily: [], igDemographics: [], igCollabs: [],
  }, "2026-09-14T00:00:00.000Z");

  assert.deepEqual(result.items.map((row) => row.id), ["real"]);
  assert.deepEqual(result.item_participants, []);
  assert.deepEqual(result.profiles, []);
});
