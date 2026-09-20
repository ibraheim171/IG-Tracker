import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminDashboardSnapshot } from "./admin-dashboard.ts";

const now = "2026-09-15T10:00:00.000Z";

test("builds weekly facts and one factual decision per material", () => {
  const snapshot = buildAdminDashboardSnapshot({
    now,
    items: [
      { id: "published-1", ref: "AQ-101", title: "منشور أول", status: "published", is_archived: false, published_at: "2026-09-14T18:00:00Z", slot_id: "slot-1", slot_at: "2026-09-14T18:00:00Z", ig_media_id: "media-1", updated_at: "2026-09-14T18:00:00Z", assignees: [] },
      { id: "published-2", ref: "AQ-102", title: "منشور ثان", status: "published", is_archived: false, published_at: "2026-09-15T18:00:00Z", slot_id: "slot-2", slot_at: "2026-09-15T18:00:00Z", ig_media_id: "media-2", updated_at: "2026-09-15T18:00:00Z", assignees: [] },
      { id: "ready-1", ref: "AQ-103", title: "جاهزة", status: "ready", is_archived: false, published_at: null, slot_id: null, slot_at: null, ig_media_id: null, updated_at: "2026-09-12T10:00:00Z", assignees: ["سارة"] },
      { id: "late-1", ref: "AQ-104", title: "متأخرة", status: "in_production", is_archived: false, published_at: null, slot_id: "slot-old", slot_at: "2026-09-13T18:00:00Z", ig_media_id: null, updated_at: "2026-09-10T10:00:00Z", assignees: ["أحمد"] },
      { id: "unlinked-1", ref: "AQ-105", title: "بلا ربط", status: "published", is_archived: false, published_at: "2026-09-12T18:00:00Z", slot_id: null, slot_at: null, ig_media_id: null, updated_at: "2026-09-12T18:00:00Z", assignees: [] },
    ],
    slots: [
      { slot_id: "slot-1", slot_at: "2026-09-14T18:00:00Z", n_ready: 1 },
      { slot_id: "slot-2", slot_at: "2026-09-15T18:00:00Z", n_ready: 1 },
      { slot_id: "slot-3", slot_at: "2026-09-19T18:00:00Z", n_ready: 0 },
    ],
    linkedItemIds: ["published-1", "published-2"],
    latestSync: null,
  });

  assert.deepEqual(snapshot.week, { published: 2, available_slots: 3, ready: 1, uncovered_slots: 1 });
  assert.deepEqual(snapshot.decisions.map((row) => row.kind), [
    "overdue_unpublished",
    "slot_without_ready_item",
    "ready_without_slot",
    "published_without_instagram_link",
  ]);
});

test("never queues archived or already linked published materials", () => {
  const snapshot = buildAdminDashboardSnapshot({
    now,
    items: [
      { id: "linked", ref: "AQ-201", title: "مرتبطة", status: "published", is_archived: false, published_at: "2026-09-10T18:00:00Z", slot_id: null, slot_at: null, ig_media_id: "media-linked", updated_at: "2026-09-10T18:00:00Z", assignees: [] },
      { id: "audit-linked", ref: "AQ-202", title: "مرتبطة بالسجل", status: "published", is_archived: false, published_at: "2026-09-10T18:00:00Z", slot_id: null, slot_at: null, ig_media_id: null, updated_at: "2026-09-10T18:00:00Z", assignees: [] },
      { id: "archived", ref: "AQ-203", title: "مؤرشفة", status: "published", is_archived: true, published_at: "2026-09-10T18:00:00Z", slot_id: null, slot_at: null, ig_media_id: null, updated_at: "2026-09-10T18:00:00Z", assignees: [] },
    ],
    slots: [],
    linkedItemIds: ["audit-linked"],
    latestSync: null,
  });

  assert.equal(snapshot.decisions.length, 0);
});

test("uses literal workflow states for approval decisions", () => {
  const snapshot = buildAdminDashboardSnapshot({
    now,
    items: [
      { id: "content", ref: "AQ-301", title: "اعتماد محتوى", status: "writing", is_archived: false, published_at: null, slot_id: null, slot_at: null, ig_media_id: null, updated_at: "2026-09-11T10:00:00Z", assignees: ["مريم"] },
      { id: "design", ref: "AQ-302", title: "اعتماد تصميم", status: "in_production", is_archived: false, published_at: null, slot_id: null, slot_at: null, ig_media_id: null, updated_at: "2026-09-12T10:00:00Z", assignees: ["خالد"] },
    ],
    slots: [],
    linkedItemIds: [],
    latestSync: null,
  });

  assert.deepEqual(snapshot.decisions.map((row) => row.kind), ["content_approval", "design_approval"]);
  assert.equal(snapshot.decisions[0].waiting_days, 4);
});

test("uses transitions for waiting time, stage medians, and planned-versus-actual delay", () => {
  const snapshot = buildAdminDashboardSnapshot({
    now,
    items: [
      { id: "current", ref: "AQ-401", title: "قيد الإنتاج", status: "in_production", is_archived: false, published_at: null, slot_id: null, slot_at: null, ig_media_id: null, updated_at: "2026-09-15T09:00:00Z", assignees: [] },
      { id: "published", ref: "AQ-402", title: "نُشرت متأخرة", status: "published", is_archived: false, published_at: "2026-09-14T18:00:00Z", slot_id: "slot", slot_at: "2026-09-12T18:00:00Z", ig_media_id: "m", updated_at: "2026-09-14T18:00:00Z", assignees: [] },
    ],
    slots: [],
    linkedItemIds: ["published"],
    latestSync: null,
    transitions: [
      { item_id: "current", to_status: "in_production", created_at: "2026-09-10T10:00:00Z" },
      { item_id: "published", to_status: "ready", created_at: "2026-09-10T18:00:00Z" },
      { item_id: "published", to_status: "published", created_at: "2026-09-14T18:00:00Z" },
    ],
  });

  assert.equal(snapshot.decisions[0].waiting_days, 5);
  assert.deepEqual(snapshot.publication_delays.map((row) => ({ ref: row.ref, delay_days: row.delay_days })), [{ ref: "AQ-402", delay_days: 2 }]);
  assert.deepEqual(snapshot.stage_durations.map((row) => ({ status: row.status, n: row.n, median_days: row.median_days })), [
    { status: "in_production", n: 1, median_days: 5 },
    { status: "ready", n: 1, median_days: 4 },
  ]);
});

test("decisions with the same deadline sort by actual waiting duration", () => {
  const snapshot = buildAdminDashboardSnapshot({
    now,
    items: [
      { id: "short", ref: "AQ-501", title: "أقصر", status: "writing", is_archived: false, published_at: null, slot_id: "slot-a", slot_at: "2026-09-20T18:00:00Z", ig_media_id: null, updated_at: now, assignees: [] },
      { id: "long", ref: "AQ-502", title: "أطول", status: "writing", is_archived: false, published_at: null, slot_id: "slot-b", slot_at: "2026-09-20T18:00:00Z", ig_media_id: null, updated_at: now, assignees: [] },
    ],
    slots: [], linkedItemIds: [], latestSync: null,
    transitions: [
      { item_id: "short", to_status: "writing", created_at: "2026-09-14T10:00:00Z" },
      { item_id: "long", to_status: "writing", created_at: "2026-09-10T10:00:00Z" },
    ],
  });
  assert.deepEqual(snapshot.decisions.map((row) => row.item_id), ["long", "short"]);
});
