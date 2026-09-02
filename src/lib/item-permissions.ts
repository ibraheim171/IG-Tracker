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
  | { ok: false; code: "E_INVALID_PAYLOAD" | "E_FIELD_FORBIDDEN"; fields?: string[] };

const writerFields: EditableItemField[] = ["title", "track_id", "idea_type_id", "caption", "notes", "writer_delivery_url"];
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

export function getItemPermissions(input: PermissionInput): ItemPermissions {
  const usable = input.profile.active && !input.profile.must_change_password && !input.item?.is_archived;
  const isAdmin = usable && hasRole(input.profile.roles, "admin");
  const isPublisher = usable && (isAdmin || hasRole(input.profile.roles, "publisher"));
  const isWriter = usable && input.participantParts.includes("writer");
  const isProducer = usable && input.participantParts.includes("producer");
  const isReviewer = usable && input.participantParts.includes("reviewer");

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

  return { ok: true, fields: Object.fromEntries(entries) as Partial<Record<EditableItemField, unknown>> };
}
