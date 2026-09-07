import assert from "node:assert/strict";
import test from "node:test";
import {
  beginItemAssignmentLoad,
  canShowItemAssignmentEditor,
  commitItemAssignments,
  createItemAssignmentEditorState,
  executeItemAssignmentSave,
  hydrateItemAssignments,
  itemAssignmentControlsDisabled,
  itemAssignmentPayload,
  itemAssignmentSaveEnabled,
  itemAssignmentsChanged,
  updateItemAssignment,
} from "./item-assignment-editor.ts";

const itemId = "11111111-1111-4111-8111-111111111111";
const writerId = "22222222-2222-4222-8222-222222222222";
const producerId = "33333333-3333-4333-8333-333333333333";
const reviewerId = "44444444-4444-4444-8444-444444444444";

const writerOnly = [{ user_id: writerId, part: "writer" as const }];

test("admin producer change remains submittable and sends the complete assignment payload", async () => {
  let state = createItemAssignmentEditorState(itemId);
  state = hydrateItemAssignments(state, itemId, writerOnly);
  state = updateItemAssignment(state, itemId, "producer_id", producerId, true);

  assert.equal(itemAssignmentsChanged(state, itemId), true);
  let submittedPayload: unknown = null;
  const result = await executeItemAssignmentSave(state, itemId, true, true, async (payload) => {
    submittedPayload = payload;
    return "saved";
  });
  assert.deepEqual(result, { started: true, value: "saved" });
  assert.deepEqual(submittedPayload, {
    writer_id: writerId,
    producer_id: producerId,
    reviewer_id: null,
  });
});

test("successful save becomes persisted state and a refresh keeps the saved producer", () => {
  const savedParticipants = [
    ...writerOnly,
    { user_id: producerId, part: "producer" as const },
    { user_id: reviewerId, part: "reviewer" as const },
  ];
  let state = hydrateItemAssignments(createItemAssignmentEditorState(itemId), itemId, writerOnly);
  state = updateItemAssignment(state, itemId, "producer_id", producerId, true);
  state = updateItemAssignment(state, itemId, "reviewer_id", reviewerId, true);
  state = commitItemAssignments(state, itemId, savedParticipants);

  assert.equal(state.draft.producer_id, producerId);
  assert.equal(itemAssignmentsChanged(state, itemId), false);
  assert.equal(itemAssignmentPayload(state, itemId, true, true), null);

  state = beginItemAssignmentLoad(state, itemId);
  state = hydrateItemAssignments(state, itemId, savedParticipants);
  assert.equal(state.draft.producer_id, producerId);
  assert.equal(state.persisted?.producer_id, producerId);
});

test("unchanged assignments do not create a save payload or false success path", async () => {
  const state = hydrateItemAssignments(createItemAssignmentEditorState(itemId), itemId, writerOnly);
  let submissions = 0;
  assert.equal(itemAssignmentsChanged(state, itemId), false);
  assert.equal(itemAssignmentPayload(state, itemId, true, true), null);
  assert.deepEqual(await executeItemAssignmentSave(state, itemId, true, true, async () => {
    submissions += 1;
  }), { started: false });
  assert.equal(submissions, 0);
});

test("unauthorized assignment changes cannot alter state or produce a request", async () => {
  const hydrated = hydrateItemAssignments(createItemAssignmentEditorState(itemId), itemId, writerOnly);
  const attempted = updateItemAssignment(hydrated, itemId, "producer_id", producerId, false);
  let submissions = 0;

  assert.strictEqual(attempted, hydrated);
  assert.equal(itemAssignmentPayload(attempted, itemId, false, true), null);
  assert.deepEqual(await executeItemAssignmentSave(attempted, itemId, false, true, async () => {
    submissions += 1;
  }), { started: false });
  assert.equal(submissions, 0);
  assert.equal(canShowItemAssignmentEditor(false, { status: "content_approved", is_archived: false }), false);
});

test("same-item loading and hydration keep the editor and unsaved draft stable", () => {
  const preview = { status: "content_approved" as const, is_archived: false };
  let state = hydrateItemAssignments(createItemAssignmentEditorState(itemId), itemId, writerOnly);
  state = updateItemAssignment(state, itemId, "producer_id", producerId, true);

  assert.equal(canShowItemAssignmentEditor(true, preview), true);
  const loadingState = beginItemAssignmentLoad(state, itemId);
  assert.strictEqual(loadingState, state);
  assert.equal(loadingState.draft.producer_id, producerId);

  const refreshed = hydrateItemAssignments(loadingState, itemId, writerOnly);
  assert.equal(refreshed.draft.producer_id, producerId);
  assert.equal(itemAssignmentPayload(refreshed, itemId, true, true)?.producer_id, producerId);
});

test("same-item reload blocks submission until current details are ready", async () => {
  let state = hydrateItemAssignments(createItemAssignmentEditorState(itemId), itemId, writerOnly);
  state = updateItemAssignment(state, itemId, "producer_id", producerId, true);
  state = beginItemAssignmentLoad(state, itemId);
  let submissions = 0;
  const loadingControl = { hydrated: true, itemReady: false, teamReady: true, busy: false };

  assert.equal(itemAssignmentControlsDisabled(loadingControl), true);
  assert.equal(itemAssignmentSaveEnabled(state, itemId, true, loadingControl), false);
  assert.deepEqual(await executeItemAssignmentSave(state, itemId, true, false, async () => {
    submissions += 1;
  }), { started: false });
  assert.equal(submissions, 0);

  const readyControl = { ...loadingControl, itemReady: true };
  assert.equal(itemAssignmentControlsDisabled(readyControl), false);
  assert.equal(itemAssignmentSaveEnabled(state, itemId, true, readyControl), true);
  assert.deepEqual(await executeItemAssignmentSave(state, itemId, true, true, async (payload) => {
    submissions += 1;
    return payload.producer_id;
  }), { started: true, value: producerId });
  assert.equal(submissions, 1);
});

test("opening another item resets assignment hydration and draft", () => {
  const otherItemId = "55555555-5555-4555-8555-555555555555";
  let state = hydrateItemAssignments(createItemAssignmentEditorState(itemId), itemId, writerOnly);
  state = updateItemAssignment(state, itemId, "producer_id", producerId, true);
  state = beginItemAssignmentLoad(state, otherItemId);

  assert.deepEqual(state, {
    itemId: otherItemId,
    draft: { writer_id: "", producer_id: "", reviewer_id: "" },
    persisted: null,
  });
});
