import type { ParticipantPart, RoleName } from "@/lib/ui-data";

export const editableItemFields = [
  "title",
  "track_id",
  "idea_type_id",
  "caption",
  "notes",
  "writer_delivery_url",
  "production_file_url",
  "priority",
] as const;

export type EditableItemField = (typeof editableItemFields)[number];

type ProfileForPermissions = {
  active: boolean;
  must_change_password: boolean;
  roles: RoleName[];
};

type ItemForPermissions = {
  is_archived: boolean;
};

type PermissionInput = {
  profile: ProfileForPermissions;
  item?: ItemForPermissions | null;
  participantParts: ParticipantPart[];
};

export type ItemPermissions = {
  editableFields: EditableItemField[];
  canSubmitWriting: boolean;
  canStartProduction: boolean;
  canReview: boolean;
  canMoveReady: boolean;
  canManagePartners: boolean;
  canAssignSlot: boolean;
  canMarkPublished: boolean;
  canAdminChangeStage: boolean;
};

export type FieldPatchValidation =
  | { ok: true; fields: Partial<Record<EditableItemField, unknown>> }
  | { ok: false; code: "E_INVALID_PAYLOAD" | "E_FIELD_FORBIDDEN" | "E_INVALID_LINK"; fields?: string[] };

const writerFields: EditableItemField[] = ["caption", "notes", "writer_delivery_url"];
const producerFields: EditableItemField[] = ["production_file_url"];
const adminFields: EditableItemField[] = [...editableItemFields];

export function roleLabel(role: RoleName) {
  if (role === "writer") return "كاتب";
  if (role === "producer") return "منتج";
  if (role === "reviewer") return "مراجع";
  if (role === "publisher") return "مسؤول النشر";
  return "أدمن";
}

export function hasRole(roles: RoleName[], role: RoleName) {
  return roles.includes(role);
}

export function isPublisherRole(roles: RoleName[]) {
  return hasRole(roles, "publisher") || hasRole(roles, "admin");
}

export function isSafeHttpsUrl(value: string | null | undefined) {
  if (value == null || value.trim() === "") return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function safeHttpsHref(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const trimmed = value.trim();
  return isSafeHttpsUrl(trimmed) ? trimmed : null;
}

export function getItemPermissions(input: PermissionInput): ItemPermissions {
  const usable = input.profile.active && !input.profile.must_change_password && !input.item?.is_archived;
  const isAdmin = usable && hasRole(input.profile.roles, "admin");
  const isPublisher = usable && (isAdmin || hasRole(input.profile.roles, "publisher"));
  const isWriter = usable && hasRole(input.profile.roles, "writer") && input.participantParts.includes("writer");
  const isProducer = usable && hasRole(input.profile.roles, "producer") && input.participantParts.includes("producer");
  const isReviewer = usable && hasRole(input.profile.roles, "reviewer") && input.participantParts.includes("reviewer");

  const editableFields = new Set<EditableItemField>();
  if (isAdmin) {
    adminFields.forEach((field) => editableFields.add(field));
  } else {
    if (isWriter) writerFields.forEach((field) => editableFields.add(field));
    if (isProducer) producerFields.forEach((field) => editableFields.add(field));
  }

  return {
    editableFields: [...editableFields],
    canSubmitWriting: Boolean(isAdmin || isWriter),
    canStartProduction: Boolean(isAdmin || isProducer),
    canReview: Boolean(isAdmin || isReviewer),
    canMoveReady: Boolean(isAdmin || isPublisher),
    canManagePartners: Boolean(isPublisher),
    canAssignSlot: Boolean(isPublisher),
    canMarkPublished: Boolean(isPublisher),
    canAdminChangeStage: Boolean(isAdmin),
  };
}

export function validateItemFieldPatch(input: PermissionInput, fields: unknown): FieldPatchValidation {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return { ok: false, code: "E_INVALID_PAYLOAD" };

  const entries = Object.entries(fields as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, code: "E_INVALID_PAYLOAD" };

  const allowed = new Set(getItemPermissions(input).editableFields);
  const known = new Set<string>(editableItemFields);
  const forbidden = entries.map(([field]) => field).filter((field) => !known.has(field) || !allowed.has(field as EditableItemField));
  if (forbidden.length > 0) return { ok: false, code: "E_FIELD_FORBIDDEN", fields: forbidden };

  const invalidLinks = entries
    .filter(([field]) => field === "writer_delivery_url" || field === "production_file_url")
    .filter(([, value]) => value != null && (typeof value !== "string" || !isSafeHttpsUrl(value)))
    .map(([field]) => field);
  if (invalidLinks.length > 0) return { ok: false, code: "E_INVALID_LINK", fields: invalidLinks };

  return { ok: true, fields: Object.fromEntries(entries) as Partial<Record<EditableItemField, unknown>> };
}
