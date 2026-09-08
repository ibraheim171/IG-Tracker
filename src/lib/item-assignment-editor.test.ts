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
  multipleAssignmentParts,
  updateItemAssignment,
} from "./item-assignment-editor.ts";

const itemId = "11111111-1111-4111-8111-111111111111";
const writerId = "22222222-2222-4222-8222-222222222222";
const producerId = "33333333-3333-4333-8333-333333333333";
const reviewerId = "44444444-4444-4444-8444-444444444444";

const writerOnly = [{ user_id: writerId, part: "writer" as const }];
const readyControl = { hydrated: true, itemReady: true, teamReady: true, singularAssignments: true, busy: false };

test("producer-only edit preserves the existing writer and reviewer in the submitted payload", async () => {
  let state = createItemAssignmentEditorState(itemId);
  state = hydrateItemAssignments(state, itemId, [...writerOnly, { user_id: reviewerId, part: "reviewer" }]);
  state = updateItemAssignment(state, itemId, "producer_id", producerId, true);

  assert.equal(itemAssignmentsChanged(state, itemId), true);
  assert.deepEqual(state.dirtyFields, ["producer_id"]);
  let submittedPayload: unknown = null;
  const result = await executeItemAssignmentSave(state, itemId, true, readyControl, async (payload) => {
    submittedPayload = payload;
    return "saved";
  });
  assert.deepEqual(result, { started: true, value: "saved" });
  assert.deepEqual(submittedPayload, {
    writer_id: writerId,
    producer_id: producerId,
    reviewer_id: reviewerId,
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
  assert.equal(itemAssignmentPayload(state, itemId, true, readyControl), null);

  state = beginItemAssignmentLoad(state, itemId);
  state = hydrateItemAssignments(state, itemId, savedParticipants);
  assert.equal(state.draft.producer_id, producerId);
  assert.equal(state.persisted?.producer_id, producerId);
});

test("unchanged assignments do not create a save payload or false success path", async () => {
  const state = hydrateItemAssignments(createItemAssignmentEditorState(itemId), itemId, writerOnly);
  let submissions = 0;
  assert.equal(itemAssignmentsChanged(state, itemId), false);
  assert.equal(itemAssignmentPayload(state, itemId, true, readyControl), null);
  assert.deepEqual(await executeItemAssignmentSave(state, itemId, true, readyControl, async () => {
    submissions += 1;
  }), { started: false });
  assert.equal(submissions, 0);
});

test("unauthorized assignment changes cannot alter state or produce a request", async () => {
  const hydrated = hydrateItemAssignments(createItemAssignmentEditorState(itemId), itemId, writerOnly);
  const attempted = updateItemAssignment(hydrated, itemId, "producer_id", producerId, false);
  let submissions = 0;

  assert.strictEqual(attempted, hydrated);
  assert.equal(itemAssignmentPayload(attempted, itemId, false, readyControl), null);
  assert.deepEqual(await executeItemAssignmentSave(attempted, itemId, false, readyControl, async () => {
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
  assert.equal(itemAssignmentPayload(refreshed, itemId, true, readyControl)?.producer_id, producerId);
});

test("same-item refresh merges untouched server assignments while retaining only the edited field", async () => {
  const refreshedWriterId = "66666666-6666-4666-8666-666666666666";
  const refreshedReviewerId = "77777777-7777-4777-8777-777777777777";
  let state = hydrateItemAssignments(createItemAssignmentEditorState(itemId), itemId, [
    ...writerOnly,
    { user_id: reviewerId, part: "reviewer" },
  ]);
  state = updateItemAssignment(state, itemId, "producer_id", producerId, true);
  state = hydrateItemAssignments(state, itemId, [
    { user_id: refreshedWriterId, part: "writer" },
    { user_id: refreshedReviewerId, part: "reviewer" },
  ]);

  assert.deepEqual(state.dirtyFields, ["producer_id"]);
  assert.deepEqual(state.draft, {
    writer_id: refreshedWriterId,
    producer_id: producerId,
    reviewer_id: refreshedReviewerId,
  });
  let submittedPayload: unknown = null;
  await executeItemAssignmentSave(state, itemId, true, readyControl, async (payload) => {
    submittedPayload = payload;
  });
  assert.deepEqual(submittedPayload, {
    writer_id: refreshedWriterId,
    producer_id: producerId,
    reviewer_id: refreshedReviewerId,
  });
  assert.notEqual((submittedPayload as { writer_id: string }).writer_id, writerId);
});

test("multiple persisted participants in any singular role block controls and submission", async () => {
  const secondWriterId = "88888888-8888-4888-8888-888888888888";
  const participants = [...writerOnly, { user_id: secondWriterId, part: "writer" as const }];
  assert.deepEqual(multipleAssignmentParts(participants), ["writer"]);

  let state = hydrateItemAssignments(createItemAssignmentEditorState(itemId), itemId, participants);
  state = updateItemAssignment(state, itemId, "producer_id", producerId, true);
  const blockedControl = { ...readyControl, singularAssignments: false };
  let submissions = 0;

  assert.equal(itemAssignmentControlsDisabled(blockedControl), true);
  assert.equal(itemAssignmentSaveEnabled(state, itemId, true, blockedControl), false);
  assert.equal(itemAssignmentPayload(state, itemId, true, blockedControl), null);
  assert.deepEqual(await executeItemAssignmentSave(state, itemId, true, blockedControl, async () => {
    submissions += 1;
  }), { started: false });
  assert.equal(submissions, 0);
});

test("same-item reload blocks submission until current details are ready", async () => {
  let state = hydrateItemAssignments(createItemAssignmentEditorState(itemId), itemId, writerOnly);
  state = updateItemAssignment(state, itemId, "producer_id", producerId, true);
  state = beginItemAssignmentLoad(state, itemId);
  let submissions = 0;
  const loadingControl = { ...readyControl, itemReady: false };

  assert.equal(itemAssignmentControlsDisabled(loadingControl), true);
  assert.equal(itemAssignmentSaveEnabled(state, itemId, true, loadingControl), false);
  assert.deepEqual(await executeItemAssignmentSave(state, itemId, true, loadingControl, async () => {
    submissions += 1;
  }), { started: false });
  assert.equal(submissions, 0);

  const reenabledControl = { ...loadingControl, itemReady: true };
  assert.equal(itemAssignmentControlsDisabled(reenabledControl), false);
  assert.equal(itemAssignmentSaveEnabled(state, itemId, true, reenabledControl), true);
  assert.deepEqual(await executeItemAssignmentSave(state, itemId, true, reenabledControl, async (payload) => {
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
    dirtyFields: [],
  });
});
