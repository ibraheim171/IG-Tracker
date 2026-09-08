import { createHash } from "node:crypto";
import type { ParticipantPart } from "./ui-data.ts";

type AssignmentRevisionParticipant = {
  user_id: string;
  part: ParticipantPart;
};

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
