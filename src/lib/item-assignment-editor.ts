import { canEditItemAssignments, type AssignableItemState } from "./admin-create-item.ts";
import type { ParticipantPart } from "./ui-data.ts";

export type ItemAssignmentState = {
  writer_id: string;
  producer_id: string;
  reviewer_id: string;
};

export type ItemAssignmentParticipant = {
  user_id: string;
  part: ParticipantPart;
};

export type ItemAssignmentEditorState = {
  itemId: string | null;
  draft: ItemAssignmentState;
  persisted: ItemAssignmentState | null;
};

export type ItemAssignmentPayload = {
  writer_id: string;
  producer_id: string | null;
  reviewer_id: string | null;
};

export type ItemAssignmentControlState = {
  hydrated: boolean;
  itemReady: boolean;
  teamReady: boolean;
  busy: boolean;
};

const emptyAssignments: ItemAssignmentState = {
  writer_id: "",
  producer_id: "",
  reviewer_id: "",
};

function copyAssignments(assignments: ItemAssignmentState): ItemAssignmentState {
  return { ...assignments };
}

function assignmentStateFromParticipants(participants: ItemAssignmentParticipant[]): ItemAssignmentState {
  return {
    writer_id: participants.find((row) => row.part === "writer")?.user_id ?? "",
    producer_id: participants.find((row) => row.part === "producer")?.user_id ?? "",
    reviewer_id: participants.find((row) => row.part === "reviewer")?.user_id ?? "",
  };
}

function assignmentsEqual(left: ItemAssignmentState, right: ItemAssignmentState) {
  return left.writer_id === right.writer_id
    && left.producer_id === right.producer_id
    && left.reviewer_id === right.reviewer_id;
}

export function createItemAssignmentEditorState(itemId: string | null = null): ItemAssignmentEditorState {
  return {
    itemId,
    draft: copyAssignments(emptyAssignments),
    persisted: null,
  };
}

export function canShowItemAssignmentEditor(isAdmin: boolean, item: AssignableItemState | null | undefined) {
  return isAdmin && canEditItemAssignments(item);
}

export function beginItemAssignmentLoad(state: ItemAssignmentEditorState, itemId: string | null): ItemAssignmentEditorState {
  if (state.itemId === itemId) return state;
  return createItemAssignmentEditorState(itemId);
}

export function hydrateItemAssignments(
  state: ItemAssignmentEditorState,
  itemId: string,
  participants: ItemAssignmentParticipant[],
): ItemAssignmentEditorState {
  if (state.itemId !== itemId) return state;
  const persisted = assignmentStateFromParticipants(participants);
  const preserveDraft = state.persisted !== null && !assignmentsEqual(state.draft, state.persisted);
  return {
    itemId,
    draft: preserveDraft ? state.draft : copyAssignments(persisted),
    persisted,
  };
}

export function updateItemAssignment(
  state: ItemAssignmentEditorState,
  itemId: string,
  field: keyof ItemAssignmentState,
  value: string,
  authorized: boolean,
): ItemAssignmentEditorState {
  if (!authorized || state.itemId !== itemId || state.persisted === null) return state;
  return { ...state, draft: { ...state.draft, [field]: value } };
}

export function itemAssignmentsChanged(state: ItemAssignmentEditorState, itemId: string) {
  return state.itemId === itemId
    && state.persisted !== null
    && !assignmentsEqual(state.draft, state.persisted);
}

export function itemAssignmentControlsDisabled(control: ItemAssignmentControlState) {
  return !control.hydrated || !control.itemReady || !control.teamReady || control.busy;
}

export function itemAssignmentSaveEnabled(
  state: ItemAssignmentEditorState,
  itemId: string,
  authorized: boolean,
  control: ItemAssignmentControlState,
) {
  return authorized
    && !itemAssignmentControlsDisabled(control)
    && Boolean(state.draft.writer_id)
    && itemAssignmentsChanged(state, itemId);
}

export function itemAssignmentPayload(
  state: ItemAssignmentEditorState,
  itemId: string,
  authorized: boolean,
  ready: boolean,
): ItemAssignmentPayload | null {
  if (!authorized || !ready || !itemAssignmentsChanged(state, itemId) || !state.draft.writer_id) return null;
  return {
    writer_id: state.draft.writer_id,
    producer_id: state.draft.producer_id || null,
    reviewer_id: state.draft.reviewer_id || null,
  };
}

export async function executeItemAssignmentSave<T>(
  state: ItemAssignmentEditorState,
  itemId: string,
  authorized: boolean,
  ready: boolean,
  submit: (payload: ItemAssignmentPayload) => Promise<T>,
): Promise<{ started: false } | { started: true; value: T }> {
  const payload = itemAssignmentPayload(state, itemId, authorized, ready);
  if (!payload) return { started: false };
  return { started: true, value: await submit(payload) };
}

export function commitItemAssignments(
  state: ItemAssignmentEditorState,
  itemId: string,
  participants: ItemAssignmentParticipant[],
): ItemAssignmentEditorState {
  if (state.itemId !== itemId) return state;
  const persisted = assignmentStateFromParticipants(participants);
  return { itemId, draft: copyAssignments(persisted), persisted };
}
