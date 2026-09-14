export const AI_EXPORT_VERSION = "ig-tracker-ai-v1";
export const EXCLUDED_MONTHS = [4, 5] as const;

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
    excluded_months: readonly number[];
    excluded_month_names: readonly [string, string];
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

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isExcludedMonth(value: unknown): boolean {
  const parsed = parseDate(value);
  if (!parsed) return false;
  const month = parsed.getUTCMonth() + 1;
  return (EXCLUDED_MONTHS as readonly number[]).includes(month);
}

function rowDate(row: ExportRow, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = stringValue(row, key);
    if (value) return value;
  }
  return null;
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

function filterByDate(rows: readonly ExportRow[], keys: readonly string[]): ExportRow[] {
  return rows.filter((row) => !isExcludedMonth(rowDate(row, keys)));
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
  const slots = filterByDate(input.publishingSlots, ["slot_at"]);
  const slotById = new Map(input.publishingSlots.map((slot) => [stringValue(slot, "id"), slot]));
  const items = input.items.filter((item) => {
    if (isExplicitUatRecord(item)) return false;
    const slotId = stringValue(item, "slot_id");
    const slot = slotId ? slotById.get(slotId) : undefined;
    const relevantDate = slot ? stringValue(slot, "slot_at") : rowDate(item, ["published_at", "scheduled_at", "created_at"]);
    return !isExcludedMonth(relevantDate);
  });
  const itemIds = new Set(items.map((item) => stringValue(item, "id")).filter((id): id is string => Boolean(id)));
  const mediaIds = new Set(
    input.igPosts
      .filter((post) => !isExcludedMonth(rowDate(post, ["published_at"])))
      .map((post) => stringValue(post, "media_id"))
      .filter((id): id is string => Boolean(id)),
  );
  const participants = filterByDate(input.itemParticipants.filter((row) => itemIds.has(stringValue(row, "item_id") ?? "")), ["added_at"]);
  const partners = filterByDate(input.itemPartners.filter((row) => itemIds.has(stringValue(row, "item_id") ?? "")), ["added_at"]);
  const transitions = filterByDate(input.transitions.filter((row) => itemIds.has(stringValue(row, "item_id") ?? "")), ["created_at"]);
  const workTrackerSourceRows = filterByDate(
    (input.workTrackerSourceRows ?? []).filter((row) => {
      const itemId = stringValue(row, "item_id");
      return !itemId || itemIds.has(itemId);
    }),
    ["publish_date"],
  );

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

  const igPosts = filterByDate(input.igPosts, ["published_at"]);
  const igItemLinks = input.igItemLinks ?? [];
  const igPostDaily = filterByDate(
    input.igPostDaily.filter((row) => {
      const mediaId = stringValue(row, "media_id");
      return !mediaId || mediaIds.has(mediaId);
    }),
    ["snapshot_date"],
  );

  return {
    export_version: AI_EXPORT_VERSION,
    generated_at: generatedAt,
    scope: {
      source: "ig-tracker-site",
      excluded_months: EXCLUDED_MONTHS,
      excluded_month_names: ["April", "May"],
      note: "Operational export only. April and May plus explicitly labeled UAT records are excluded; no source data is deleted.",
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
    ig_account_daily: sortRows(filterByDate(input.igAccountDaily, ["date"]), ["date"]),
    ig_demographics: sortRows(filterByDate(input.igDemographics, ["snapshot_date"]), ["snapshot_date", "dimension", "key"]),
    ig_collabs: sortRows(filterByDate(input.igCollabs, ["collaboration_date"]), ["collaboration_date", "partner_id", "id"]),
    work_tracker_source_rows: sortRows(workTrackerSourceRows, ["source_sheet", "source_row", "id"]),
  };
}
