import { createHash } from "node:crypto";
import type { ParticipantPart } from "./ui-data.ts";

export type AssignmentRevisionParticipant = {
  user_id: string;
  part: ParticipantPart;
};

type AssignmentParticipantLoadResult = {
  data: AssignmentRevisionParticipant[] | null;
  error: unknown;
};

export const createdItemAssignmentLoadError = {
  code: "E_ITEM_CREATE_PARTICIPANTS",
  error: "تم إنشاء المادة، لكن تعذر التحقق من تعييناتها الحالية. افتح المادة وأعد المحاولة.",
} as const;

const partOrder: Record<ParticipantPart, number> = {
  writer: 1,
  producer: 2,
  reviewer: 3,
};

export function itemAssignmentRevision(participants: AssignmentRevisionParticipant[]) {
  const canonical = participants
    .map((participant) => ({ ...participant, user_id: participant.user_id.toLowerCase() }))
    .sort((left, right) => {
      const partComparison = partOrder[left.part] - partOrder[right.part];
      if (partComparison !== 0) return partComparison;
      return left.user_id < right.user_id ? -1 : left.user_id > right.user_id ? 1 : 0;
    })
    .map((participant) => `${participant.part}:${participant.user_id}`)
    .join("|");
  return createHash("md5").update(canonical).digest("hex");
}

export function resolveLoadedItemAssignmentRevision(result: AssignmentParticipantLoadResult) {
  if (result.error || result.data === null) {
    return { ok: false as const, error: createdItemAssignmentLoadError };
  }

  return {
    ok: true as const,
    assignmentRevision: itemAssignmentRevision(result.data),
  };
}
