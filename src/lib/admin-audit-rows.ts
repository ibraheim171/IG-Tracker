import { randomUUID } from "node:crypto";
import type { AdminActionErrorCode } from "./admin-users-core.ts";
import type { AdminAuditOperation, AdminAuditPhase, AuditValues } from "./admin-users.ts";

export type AdminAuditInput = {
  actorId: string;
  targetUserId: string;
  operation: AdminAuditOperation;
  actionId?: string;
  actionPhase?: AdminAuditPhase;
  diagnosticCode?: AdminActionErrorCode;
  reason?: string;
  beforeValues?: AuditValues;
  afterValues?: AuditValues;
};

export function toAdminAuditRows(inputs: AdminAuditInput[]) {
  return inputs.map((input) => ({
    actor_id: input.actorId,
    target_user_id: input.targetUserId,
    operation: input.operation,
    action_id: input.actionId ?? randomUUID(),
    action_phase: input.actionPhase ?? "succeeded",
    diagnostic_code: input.diagnosticCode ?? null,
    reason: input.reason ? input.reason.trim() : null,
    before_values: input.beforeValues ?? {},
    after_values: input.afterValues ?? {},
  }));
}
