import type { Enums, Tables } from "@/lib/database.types";

export type ItemStatus = Enums<"item_status">;
export type RoleName = Enums<"role_name">;
export type ParticipantPart = Enums<"participant_part">;

export type TrackOption = Pick<Tables<"tracks">, "id" | "name" | "color_hex">;
export type IdeaTypeOption = Pick<Tables<"idea_types">, "id" | "name">;
export type PartnerOption = Pick<Tables<"partners">, "id" | "name">;

export type DrawerPreview = {
  id: string;
  ref: string;
  title: string;
  status: ItemStatus;
  track_id: number | null;
  track_name: string | null;
  track_color: string | null;
  idea_type_id?: number | null;
  idea_type: string | null;
  slot_at?: string | null;
  caption?: string | null;
  production_file_url?: string | null;
  partners?: string | null;
};

export type BoardSlot = {
  slot_id: string;
  slot_at: string | null;
  state: Enums<"slot_state"> | null;
  n_items: number | null;
  n_ready: number | null;
};

export type BoardItem = {
  id: string;
  ref: string;
  title: string;
  status: ItemStatus;
  slot_id: string | null;
  track_id: number | null;
  idea_type_id: number | null;
  track_name: string | null;
  track_color: string | null;
  idea_type: string | null;
  waiting_on: string | null;
};

export type ReadyItem = {
  id: string;
  ref: string;
  title: string;
  caption: string | null;
  production_file_url: string | null;
  track_id: number | null;
  track_name: string | null;
  color_hex: string | null;
  idea_type: string | null;
  slot_id: string | null;
  slot_at: string | null;
  partners: string | null;
};

export type WaitingItem = {
  id: string;
  ref: string;
  title: string;
  status: ItemStatus;
  track_id: number | null;
  track_name: string | null;
  track_color: string | null;
  slot_at: string | null;
  waiting_on: string | null;
  people: string | null;
};

export type MyMaterial = {
  item_id: string;
  parts: ParticipantPart[];
  item: {
    id: string;
    ref: string;
    title: string;
    status: ItemStatus;
    track_id: number | null;
    idea_type_id: number | null;
    track_name: string | null;
    track_color: string | null;
    idea_type: string | null;
    slot_at: string | null;
  };
};

export function formatNumber(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("en-US");
}

export function formatPercent(value: number | string | null | undefined) {
  if (value == null) return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${numeric.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

export function formatHebronDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Hebron",
  }).format(new Date(value));
}

export function localDateKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Hebron",
  }).format(new Date(value));
}

export function arabicDayName(value: string) {
  const dayIndex = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "Asia/Hebron",
  }).format(new Date(value));
  const names: Record<string, string> = {
    Sun: "الأحد",
    Mon: "الاثنين",
    Tue: "الثلاثاء",
    Wed: "الأربعاء",
    Thu: "الخميس",
    Fri: "الجمعة",
    Sat: "السبت",
  };
  return names[dayIndex] ?? "—";
}

export function relativeDayLabel(value: string, now = new Date()) {
  const targetKey = localDateKey(value);
  const todayKey = localDateKey(now.toISOString());
  const target = new Date(`${targetKey}T00:00:00Z`);
  const today = new Date(`${todayKey}T00:00:00Z`);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "اليوم";
  if (diff === 1) return "غداً";
  if (diff > 1) return `بعد ${diff.toLocaleString("en-US")} أيام`;
  if (diff === -1) return "أمس";
  return `قبل ${Math.abs(diff).toLocaleString("en-US")} أيام`;
}

export function extractMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "تعذّر تنفيذ العملية.";
}

export function parseRuleMessage(message: string) {
  const marker = "RULE_VIOLATION:";
  const index = message.indexOf(marker);
  return index >= 0 ? message.slice(index + marker.length).trim() : message;
}

export function isReviewerRole(roles: RoleName[]) {
  return roles.includes("reviewer") || roles.includes("admin");
}

export function isAdminRole(roles: RoleName[]) {
  return roles.includes("admin");
}

export const statusLabels: Record<ItemStatus, string> = {
  idea: "كتابة الكابشن",
  writing: "اعتماد المحتوى",
  content_approved: "الإنتاج",
  in_production: "اعتماد التصميم",
  design_approved: "النشر",
  ready: "النشر",
  published: "النشر",
  cancelled: "ملغاة",
};
