import { isSafeHttpsUrl } from "./item-permissions.ts";
import type { Json, Tables } from "./database.types.ts";
import type { ParticipantPart, RoleName } from "./ui-data.ts";

export type TeamMemberOption = {
  id: string;
  display_name: string;
  email: string;
  roles: RoleName[];
};

export type AdminCreateItemPayload = {
  title: string;
  track_id?: number;
  idea_type_id?: number;
  caption?: string;
  notes?: string;
  writer_delivery_url?: string;
  production_file_url?: string;
  partner_ids?: number[];
  new_partner_name?: string;
  slot_id?: string;
};

export type DraftCreateFormValues = {
  title: string;
  track_id: string;
  idea_type_id: string;
  caption: string;
  notes: string;
  writer_delivery_url: string;
  production_file_url: string;
  partner_ids: string[];
  new_partner_name: string;
  slot_id: string;
};

export type AdminCreateTrackPayload = {
  name: string;
  color_hex?: string;
  sort_order?: number | null;
};

export type AdminCreatedItem = Tables<"items">;
export type AdminCreatedTrack = Tables<"tracks">;
export type AssignableItemState = Pick<Tables<"items">, "status" | "is_archived">;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const colorPattern = /^#[0-9A-Fa-f]{6}$/;
const allowedItemKeys = new Set([
  "title",
  "track_id",
  "idea_type_id",
  "caption",
  "notes",
  "writer_delivery_url",
  "production_file_url",
  "partner_ids",
  "new_partner_name",
  "slot_id",
]);

export function hasRole(roles: RoleName[], role: ParticipantPart) {
  return roles.includes(role);
}

export function canEditItemAssignments(item: AssignableItemState | null | undefined) {
  if (!item || item.is_archived) return false;
  return item.status !== "published" && item.status !== "cancelled";
}

function optionalText(value: unknown) {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalNumber(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
}

function optionalUuid(value: unknown) {
  return typeof value === "string" && uuidPattern.test(value) ? value : undefined;
}

export function buildDraftCreateItemPayload(input: DraftCreateFormValues): AdminCreateItemPayload {
  const payload: AdminCreateItemPayload = { title: input.title };
  const trackId = input.track_id.trim();
  const ideaTypeId = input.idea_type_id.trim();
  const partnerIds = input.partner_ids.map((value) => Number(value));
  const fields: Array<[keyof Pick<AdminCreateItemPayload, "caption" | "notes" | "writer_delivery_url" | "production_file_url" | "new_partner_name" | "slot_id">, string]> = [
    ["caption", input.caption],
    ["notes", input.notes],
    ["writer_delivery_url", input.writer_delivery_url],
    ["production_file_url", input.production_file_url],
    ["new_partner_name", input.new_partner_name],
    ["slot_id", input.slot_id],
  ];

  if (trackId) payload.track_id = Number(trackId);
  if (ideaTypeId) payload.idea_type_id = Number(ideaTypeId);
  if (input.partner_ids.length > 0) payload.partner_ids = partnerIds;
  for (const [field, value] of fields) {
    const trimmed = value.trim();
    if (trimmed) payload[field] = trimmed;
  }
  return payload;
}

export function validateAdminCreateItemPayload(input: unknown): ValidationResult<AdminCreateItemPayload> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "E_INVALID_INPUT", message: "بيانات المادة غير صحيحة." };
  }

  const body = input as Record<string, unknown>;
  const forbidden = Object.keys(body).filter((key) => !allowedItemKeys.has(key));
  if (forbidden.length > 0) {
    return { ok: false, code: "E_FIELD_FORBIDDEN", message: "يحتوي الطلب على حقول غير مسموحة." };
  }

  const title = optionalText(body.title);
  if (!title) return { ok: false, code: "E_TITLE", message: "العنوان مطلوب." };

  const slotId = body.slot_id == null ? null : optionalUuid(body.slot_id);
  if (slotId === undefined) return { ok: false, code: "E_SLOT", message: "موعد النشر غير صحيح." };

  const trackId = optionalNumber(body.track_id);
  if (body.track_id != null && body.track_id !== "" && trackId == null) return { ok: false, code: "E_TRACK", message: "المسار غير صحيح." };

  const ideaTypeId = optionalNumber(body.idea_type_id);
  if (body.idea_type_id != null && body.idea_type_id !== "" && ideaTypeId == null) return { ok: false, code: "E_IDEA_TYPE", message: "نوع الفكرة غير صحيح." };

  const writerDeliveryUrl = optionalText(body.writer_delivery_url);
  const productionFileUrl = optionalText(body.production_file_url);
  if (!isSafeHttpsUrl(writerDeliveryUrl) || !isSafeHttpsUrl(productionFileUrl)) {
    return { ok: false, code: "E_INVALID_LINK", message: "روابط التسليم والإنتاج يجب أن تكون روابط HTTPS صالحة." };
  }

  if (body.partner_ids != null && !Array.isArray(body.partner_ids)) {
    return { ok: false, code: "E_PARTNERS", message: "الشركاء يجب أن يكونوا قائمة صحيحة." };
  }
  const rawPartnerIds = Array.isArray(body.partner_ids) ? body.partner_ids : [];
  if (rawPartnerIds.some((value) => typeof value !== "number" || !Number.isInteger(value))) {
    return { ok: false, code: "E_PARTNERS", message: "الشركاء يجب أن يكونوا قائمة صحيحة." };
  }
  const partnerIds = Array.from(new Set(rawPartnerIds));

  const value: AdminCreateItemPayload = { title };
  if (trackId != null) value.track_id = trackId;
  if (ideaTypeId != null) value.idea_type_id = ideaTypeId;
  const caption = optionalText(body.caption);
  const notes = optionalText(body.notes);
  const newPartnerName = optionalText(body.new_partner_name);
  if (caption) value.caption = caption;
  if (notes) value.notes = notes;
  if (writerDeliveryUrl) value.writer_delivery_url = writerDeliveryUrl;
  if (productionFileUrl) value.production_file_url = productionFileUrl;
  if (partnerIds.length > 0) value.partner_ids = partnerIds;
  if (newPartnerName) value.new_partner_name = newPartnerName;
  if (slotId) value.slot_id = slotId;
  return { ok: true, value };
}

export function validateAdminCreateTrackPayload(input: unknown): ValidationResult<AdminCreateTrackPayload> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "E_INVALID_INPUT", message: "بيانات المسار غير صحيحة." };
  }

  const body = input as Record<string, unknown>;
  const name = optionalText(body.name);
  if (!name) return { ok: false, code: "E_TRACK_NAME", message: "اسم المسار مطلوب." };

  const color = optionalText(body.color_hex) ?? "#1E8F8B";
  if (!colorPattern.test(color)) return { ok: false, code: "E_TRACK_COLOR", message: "لون المسار يجب أن يكون بصيغة #RRGGBB." };

  const sortOrder = optionalNumber(body.sort_order);
  if (body.sort_order != null && body.sort_order !== "" && sortOrder == null) {
    return { ok: false, code: "E_TRACK_SORT", message: "ترتيب العرض يجب أن يكون رقماً صحيحاً." };
  }

  return { ok: true, value: { name, color_hex: color, sort_order: sortOrder } };
}

export function safeRpcError(message: string | undefined, fallback: string) {
  if (!message) return fallback;
  for (const marker of [
    "ROLE_REQUIRED:",
    "INVALID_PAYLOAD:",
    "FIELD_FORBIDDEN:",
    "WRITER_REQUIRED:",
    "ASSIGNEE_ROLE_REQUIRED:",
    "INVALID_LINK:",
    "INVALID_TRACK:",
    "INVALID_IDEA_TYPE:",
    "INVALID_SLOT:",
    "INVALID_PARTNER:",
    "INVALID_COLOR:",
    "DUPLICATE_TRACK:",
    "INACTIVE_PARTNER:",
    "ARCHIVED_IMMUTABLE:",
    "PUBLISHED_IMMUTABLE:",
    "CANCELLED_IMMUTABLE:",
    "INVALID_DEFAULT:",
  ]) {
    const index = message.indexOf(marker);
    if (index >= 0) {
      const safe = message.slice(index + marker.length).trim();
      if (safe) return safe;
    }
  }
  return fallback;
}

export function toRpcJson(value: AdminCreateItemPayload | AdminCreateTrackPayload) {
  return value as unknown as Json;
}

