import type { Role } from "@/lib/admin-users";
import type { Database, Json } from "@/lib/database.types";

export type OperationalPart = Database["public"]["Enums"]["participant_part"];

export const operationalParts: OperationalPart[] = ["writer", "producer", "reviewer"];

export const operationalPartLabels: Record<OperationalPart, string> = {
  writer: "كاتب",
  producer: "منتج",
  reviewer: "مراجع",
};

export type ReassignSummaryRow = {
  part: OperationalPart;
  status: Database["public"]["Enums"]["item_status"];
  n_items: number;
};

export type ReassignTasksResult = {
  ok: boolean;
  dry_run: boolean;
  source_user_id?: string;
  target_user_id?: string;
  parts?: OperationalPart[];
  total_items?: number;
  duplicate_items?: number;
  inserted_assignments?: number;
  removed_assignments?: number;
  summary?: ReassignSummaryRow[];
  action_id?: string;
  error?: string;
};

export function isOperationalPart(value: unknown): value is OperationalPart {
  return typeof value === "string" && operationalParts.includes(value as OperationalPart);
}

export function normalizeOperationalParts(value: unknown): OperationalPart[] {
  if (!Array.isArray(value)) return [];
  return operationalParts.filter((part) => value.includes(part));
}

export function operationalPartsForRoles(roles: Role[]) {
  return operationalParts.filter((part) => roles.includes(part));
}

export function compatibleOperationalParts(sourceRoles: Role[], targetRoles: Role[]) {
  const target = new Set(targetRoles);
  return operationalPartsForRoles(sourceRoles).filter((part) => target.has(part));
}

export function toReassignTasksResult(value: Json | ReassignTasksResult | null): ReassignTasksResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const summary = Array.isArray(raw.summary)
    ? raw.summary.filter(isReassignSummaryRow)
    : [];
  const parts = normalizeOperationalParts(raw.parts);
  return {
    ok: raw.ok === true,
    dry_run: raw.dry_run === true,
    source_user_id: typeof raw.source_user_id === "string" ? raw.source_user_id : undefined,
    target_user_id: typeof raw.target_user_id === "string" ? raw.target_user_id : undefined,
    parts,
    total_items: toNumber(raw.total_items),
    duplicate_items: toNumber(raw.duplicate_items),
    inserted_assignments: toNumber(raw.inserted_assignments),
    removed_assignments: toNumber(raw.removed_assignments),
    summary,
    action_id: typeof raw.action_id === "string" ? raw.action_id : undefined,
    error: typeof raw.error === "string" ? raw.error : undefined,
  };
}

function isReassignSummaryRow(value: unknown): value is ReassignSummaryRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return isOperationalPart(row.part)
    && typeof row.status === "string"
    && typeof row.n_items === "number"
    && Number.isFinite(row.n_items);
}

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
