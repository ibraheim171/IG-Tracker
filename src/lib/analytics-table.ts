export const postSortFields = [
  "published_at",
  "reach",
  "save_rate",
  "share_rate",
  "follow_rate",
  "signal",
] as const;

export type PostSortField = (typeof postSortFields)[number];

export type InsightSection = "pulse" | "compare" | "matrix" | "posts" | "audience";

const insightSections = new Set<InsightSection>(["pulse", "compare", "matrix", "posts", "audience"]);

export function parseInsightSection(value: string | null): InsightSection {
  return value && insightSections.has(value as InsightSection) ? value as InsightSection : "pulse";
}

export function normalizePostSearch(value: string | null): { ok: true; value: string } | { ok: false; code: "E_SEARCH" } {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return { ok: true, value: "" };
  if (normalized.length > 80 || !/^[\p{L}\p{N}\s-]+$/u.test(normalized)) return { ok: false, code: "E_SEARCH" };
  return { ok: true, value: normalized };
}
