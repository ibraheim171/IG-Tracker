export const AI_EXPORT_VERSION = "ig-tracker-ai-v1";
export const EXCLUDED_LEGACY_SOURCE_TABS = ["جدول إنجاز شهر 4", "جدول الإنجاز شهر 5"] as const;

type ExportRow = Record<string, unknown>;

export type DataExportInput = {
  items: readonly ExportRow[];
  publishingSlots: readonly ExportRow[];
  itemParticipants: readonly ExportRow[];
  itemPartners: readonly ExportRow[];
  transitions: readonly ExportRow[];
  profiles: readonly ExportRow[];
  partners: readonly ExportRow[];
  tracks: readonly ExportRow[];
  igPosts: readonly ExportRow[];
  igItemLinks?: readonly ExportRow[];
  igPostDaily: readonly ExportRow[];
  igAccountDaily: readonly ExportRow[];
  igDemographics: readonly ExportRow[];
  igCollabs: readonly ExportRow[];
  workTrackerSourceRows?: readonly ExportRow[];
};

export type AiExport = {
  export_version: string;
  generated_at: string;
  scope: {
    source: "ig-tracker-site";
    excluded_legacy_source_tabs: readonly [string, string];
    note: string;
  };
  items: ExportRow[];
  publishing_slots: ExportRow[];
  item_participants: ExportRow[];
  item_partners: ExportRow[];
  transitions: ExportRow[];
  profiles: ExportRow[];
  partners: ExportRow[];
  tracks: ExportRow[];
  ig_posts: ExportRow[];
  ig_item_links: ExportRow[];
  ig_post_daily: ExportRow[];
  ig_account_daily: ExportRow[];
  ig_demographics: ExportRow[];
  ig_collabs: ExportRow[];
  work_tracker_source_rows: ExportRow[];
};

function stringValue(row: ExportRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function rowId(row: ExportRow): string {
  return stringValue(row, "id") ?? stringValue(row, "ref") ?? stringValue(row, "media_id") ?? "";
}

function isExplicitUatRecord(row: ExportRow): boolean {
  return ["title", "caption", "notes"].some((key) => /\bUAT\b/i.test(stringValue(row, key) ?? ""));
}

function sortRows(rows: readonly ExportRow[], keys: readonly string[]): ExportRow[] {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const a = String(left[key] ?? "");
      const b = String(right[key] ?? "");
      const comparison = a.localeCompare(b);
      if (comparison !== 0) return comparison;
    }
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
}

function normalizedSheetName(value: unknown) {
  return String(value ?? "")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ").trim();
}

function isExcludedLegacySourceRow(row: ExportRow) {
  const sourceSheet = normalizedSheetName(row.source_sheet);
  return EXCLUDED_LEGACY_SOURCE_TABS.some((tab) => normalizedSheetName(tab) === sourceSheet);
}

function isArchivedItem(row: ExportRow) {
  return row.is_archived === true;
}

function sanitizeProfiles(rows: readonly ExportRow[], allowedIds: ReadonlySet<string>): ExportRow[] {
  return sortRows(
    rows
      .filter((row) => {
        const id = stringValue(row, "id");
        return Boolean(id && allowedIds.has(id));
      })
      .map((row) => ({
        id: row.id,
        display_name: row.display_name,
        roles: Array.isArray(row.roles) ? row.roles : [],
      })),
    ["display_name", "id"],
  );
}

export function buildAiExport(input: DataExportInput, generatedAt = new Date().toISOString()): AiExport {
  const items = input.items.filter((item) => !isArchivedItem(item) && !isExplicitUatRecord(item));
  const itemIds = new Set(items.map((item) => stringValue(item, "id")).filter((id): id is string => Boolean(id)));
  const slotsWithActiveItems = new Set(items.map((item) => stringValue(item, "slot_id")).filter((id): id is string => Boolean(id)));
  const slotsWithArchivedItems = new Set(input.items.filter(isArchivedItem).map((item) => stringValue(item, "slot_id")).filter((id): id is string => Boolean(id)));
  const slots = input.publishingSlots.filter((slot) => {
    const slotId = stringValue(slot, "id");
    return !slotId || !slotsWithArchivedItems.has(slotId) || slotsWithActiveItems.has(slotId);
  });
  const mediaIds = new Set(input.igPosts.map((post) => stringValue(post, "media_id")).filter((id): id is string => Boolean(id)));
  const participants = input.itemParticipants.filter((row) => itemIds.has(stringValue(row, "item_id") ?? ""));
  const partners = input.itemPartners.filter((row) => itemIds.has(stringValue(row, "item_id") ?? ""));
  const transitions = input.transitions.filter((row) => itemIds.has(stringValue(row, "item_id") ?? ""));
  const workTrackerSourceRows = (input.workTrackerSourceRows ?? []).filter((row) => {
    const itemId = stringValue(row, "item_id");
    return !isExcludedLegacySourceRow(row) && (!itemId || itemIds.has(itemId));
  });

  const allowedProfileIds = new Set<string>();
  for (const item of items) {
    const createdBy = stringValue(item, "created_by");
    if (createdBy) allowedProfileIds.add(createdBy);
  }
  for (const row of [...participants, ...partners, ...transitions]) {
    for (const key of ["user_id", "added_by", "actor_id"]) {
      const id = stringValue(row, key);
      if (id) allowedProfileIds.add(id);
    }
  }

  const igPosts = [...input.igPosts];
  const igItemLinks = input.igItemLinks ?? [];
  const igPostDaily = input.igPostDaily.filter((row) => {
    const mediaId = stringValue(row, "media_id");
    return !mediaId || mediaIds.has(mediaId);
  });

  return {
    export_version: AI_EXPORT_VERSION,
    generated_at: generatedAt,
    scope: {
      source: "ig-tracker-site",
      excluded_legacy_source_tabs: EXCLUDED_LEGACY_SOURCE_TABS,
      note: "Operational export excludes archived legacy work-tracker source tabs and explicitly labeled UAT records; calendar months remain valid analytics data.",
    },
    items: sortRows(items, ["ref", "id"]),
    publishing_slots: sortRows(slots, ["slot_at", "id"]),
    item_participants: sortRows(participants, ["item_id", "part", "user_id"]),
    item_partners: sortRows(partners, ["item_id", "partner_id"]),
    transitions: sortRows(transitions, ["item_id", "created_at", "id"]),
    profiles: sanitizeProfiles(input.profiles, allowedProfileIds),
    partners: sortRows(input.partners, ["name", "id"]),
    tracks: sortRows(input.tracks, ["sort_order", "id"]),
    ig_posts: sortRows(igPosts, ["published_at", "media_id"]),
    ig_item_links: sortRows(igItemLinks.filter((row) => itemIds.has(stringValue(row, "item_id") ?? "") && mediaIds.has(stringValue(row, "media_id") ?? "")), ["item_id", "media_id"]),
    ig_post_daily: sortRows(igPostDaily, ["snapshot_date", "media_id"]),
    ig_account_daily: sortRows(input.igAccountDaily, ["date"]),
    ig_demographics: sortRows(input.igDemographics, ["snapshot_date", "dimension", "key"]),
    ig_collabs: sortRows(input.igCollabs, ["collaboration_date", "partner_id", "id"]),
    work_tracker_source_rows: sortRows(workTrackerSourceRows, ["source_sheet", "source_row", "id"]),
  };
}
