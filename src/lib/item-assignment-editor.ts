import { canEditItemAssignments, type AssignableItemState } from "./admin-create-item.ts";
import type { ParticipantPart } from "./ui-data.ts";

export type ItemAssignmentState = {
  writer_id: string;
  producer_id: string;
  reviewer_id: string;
};

export type ItemAssignmentField = keyof ItemAssignmentState;

export type ItemAssignmentParticipant = {
  user_id: string;
  part: ParticipantPart;
};

export type ItemAssignmentEditorState = {
  itemId: string | null;
  draft: ItemAssignmentState;
  persisted: ItemAssignmentState | null;
  revision: string | null;
  dirtyFields: ItemAssignmentField[];
};

export type ItemAssignmentPayload = {
  writer_id: string;
  producer_id: string | null;
  reviewer_id: string | null;
  expected_revision: string;
};

export type ItemAssignmentControlState = {
  hydrated: boolean;
  itemReady: boolean;
  teamReady: boolean;
  singularAssignments: boolean;
  revisionReady: boolean;
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
    revision: null,
    dirtyFields: [],
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
  revision: string,
): ItemAssignmentEditorState {
  if (state.itemId !== itemId) return state;
  const persisted = assignmentStateFromParticipants(participants);
  const draft = copyAssignments(persisted);
  for (const field of state.dirtyFields) draft[field] = state.draft[field];
  const dirtyFields = state.dirtyFields.filter((field) => draft[field] !== persisted[field]);
  return {
    itemId,
    draft,
    persisted,
    revision,
    dirtyFields,
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
  const draft = { ...state.draft, [field]: value };
  const dirtyFields = value === state.persisted[field]
    ? state.dirtyFields.filter((candidate) => candidate !== field)
    : state.dirtyFields.includes(field) ? state.dirtyFields : [...state.dirtyFields, field];
  return { ...state, draft, dirtyFields };
}

export function itemAssignmentsChanged(state: ItemAssignmentEditorState, itemId: string) {
  return state.itemId === itemId
    && state.persisted !== null
    && state.revision !== null
    && state.dirtyFields.length > 0
    && !assignmentsEqual(state.draft, state.persisted);
}

export function itemAssignmentControlsDisabled(control: ItemAssignmentControlState) {
  return !control.hydrated || !control.itemReady || !control.teamReady || !control.singularAssignments || !control.revisionReady || control.busy;
}

export function multipleAssignmentParts(participants: ItemAssignmentParticipant[]) {
  const counts = new Map<ParticipantPart, number>();
  for (const participant of participants) {
    counts.set(participant.part, (counts.get(participant.part) ?? 0) + 1);
  }
  return (["writer", "producer", "reviewer"] as const).filter((part) => (counts.get(part) ?? 0) > 1);
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
  control: ItemAssignmentControlState,
): ItemAssignmentPayload | null {
  if (!itemAssignmentSaveEnabled(state, itemId, authorized, control) || state.revision === null) return null;
  return {
    writer_id: state.draft.writer_id,
    producer_id: state.draft.producer_id || null,
    reviewer_id: state.draft.reviewer_id || null,
    expected_revision: state.revision,
  };
}

export async function executeItemAssignmentSave<T>(
  state: ItemAssignmentEditorState,
  itemId: string,
  authorized: boolean,
  control: ItemAssignmentControlState,
  submit: (payload: ItemAssignmentPayload) => Promise<T>,
): Promise<{ started: false } | { started: true; value: T }> {
  const payload = itemAssignmentPayload(state, itemId, authorized, control);
  if (!payload) return { started: false };
  return { started: true, value: await submit(payload) };
}

export function commitItemAssignments(
  state: ItemAssignmentEditorState,
  itemId: string,
  participants: ItemAssignmentParticipant[],
  revision: string,
): ItemAssignmentEditorState {
  if (state.itemId !== itemId) return state;
  const persisted = assignmentStateFromParticipants(participants);
  return { itemId, draft: copyAssignments(persisted), persisted, revision, dirtyFields: [] };
}
