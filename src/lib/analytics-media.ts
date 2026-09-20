export const analyticsMediaFilters = ["IMAGE", "CAROUSEL_ALBUM", "VIDEO", "REELS"] as const;
export type AnalyticsMediaFilter = typeof analyticsMediaFilters[number];

export function parseAnalyticsMediaFilter(value: string | null) {
  if (!value) return { ok: true as const, value: null };
  return analyticsMediaFilters.includes(value as AnalyticsMediaFilter)
    ? { ok: true as const, value: value as AnalyticsMediaFilter }
    : { ok: false as const, code: "E_MEDIA_TYPE" };
}
