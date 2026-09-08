import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const analyticsSyncMaxBytes = 1024 * 1024;
export const analyticsSyncMaxRows = 500;
export const analyticsSignatureMaxAgeSeconds = 300;

export function canAccessRawAnalytics(profile: { active: boolean; roles: string[] } | null) {
  return Boolean(profile?.active && profile.roles.includes("admin"));
}

export type NullableMetric = number | null;
export type PostDailyInput = {
  snapshot_date: string;
  post_id: string;
  age_days: number;
  likes: NullableMetric;
  comments: NullableMetric;
  reach: NullableMetric;
  views: NullableMetric;
  saved: NullableMetric;
  shares: NullableMetric;
  interactions: NullableMetric;
  profile_visits: NullableMetric;
  follows: NullableMetric;
  avg_watch_ms: NullableMetric;
  missing_metrics: string[];
};

export type AnalyticsPost = {
  post_id: string;
  published_at: string;
  media_type: string | null;
  product_type: string | null;
  permalink: string;
  caption: string | null;
};

export type AnalyticsSyncPayload = {
  idempotency_key: string;
  source_timestamp: string;
  posts: AnalyticsPost[];
  post_daily: PostDailyInput[];
  account_daily: Record<string, unknown>[];
  demographics: Record<string, unknown>[];
  collabs: Record<string, unknown>[];
};

const permalinkPattern = /^https:\/\/(?:www\.)?instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const metricNames = ["likes", "comments", "reach", "views", "saved", "shares", "interactions", "profile_visits", "follows", "avg_watch_ms"] as const;

export function canonicalInstagramPermalink(value: string) {
  const match = value.trim().match(permalinkPattern);
  return match ? `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}/` : null;
}

export function instagramShortcode(value: string) {
  return canonicalInstagramPermalink(value)?.split("/")[4] ?? null;
}

export function exactPermalinkLinkCandidates(posts: AnalyticsPost[], items: Array<{ id: string; ig_permalink: string | null }>) {
  const itemByIdentity = new Map<string, string[]>();
  for (const item of items) {
    if (!item.ig_permalink) continue;
    const canonical = canonicalInstagramPermalink(item.ig_permalink);
    if (!canonical) continue;
    const key = instagramShortcode(canonical);
    if (key) itemByIdentity.set(key, [...(itemByIdentity.get(key) ?? []), item.id]);
  }
  return posts.flatMap((post) => {
    const canonical = canonicalInstagramPermalink(post.permalink);
    const key = canonical ? instagramShortcode(canonical) : null;
    const matches = key ? itemByIdentity.get(key) ?? [] : [];
    return matches.length === 1 ? [{ item_id: matches[0], media_id: post.post_id, source: "exact_permalink" as const }] : [];
  });
}

export function validateManualLink(input: { itemId?: unknown; mediaId?: unknown; reason?: unknown }) {
  if (typeof input.itemId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.itemId)) return { ok: false as const, code: "E_ITEM" };
  if (typeof input.mediaId !== "string" || input.mediaId.trim().length < 1 || input.mediaId.length > 128) return { ok: false as const, code: "E_POST" };
  if (typeof input.reason !== "string" || input.reason.trim().length < 4 || input.reason.trim().length > 500) return { ok: false as const, code: "E_REASON" };
  return { ok: true as const, value: { itemId: input.itemId, mediaId: input.mediaId.trim(), reason: input.reason.trim() } };
}

export function computePerformance(row: Pick<PostDailyInput, "reach" | "saved" | "shares" | "follows" | "profile_visits" | "comments" | "likes">) {
  const denominator = row.reach;
  const rate = (value: number | null) => denominator !== null && denominator > 0 && value !== null ? value / denominator * 100 : null;
  const completeSignal = [row.shares, row.saved, row.follows, row.profile_visits, row.comments, row.likes].every((value) => value !== null);
  const completeEngagement = [row.likes, row.comments, row.saved, row.shares].every((value) => value !== null);
  return {
    save_rate: rate(row.saved),
    share_rate: rate(row.shares),
    follow_rate: rate(row.follows),
    profile_visit_rate: rate(row.profile_visits),
    engagement_rate: denominator !== null && denominator > 0 && completeEngagement
      ? ((row.likes! + row.comments! + row.saved! + row.shares!) / denominator) * 100
      : null,
    signal_score: denominator !== null && denominator > 0 && completeSignal
      ? (row.shares! * 6 + row.saved! * 4 + row.follows! * 3 + row.profile_visits! * 2 + row.comments! * 1.5 + row.likes! * 0.5) / denominator * 1000
      : null,
  };
}

export function exactCheckpoints(rows: Array<PostDailyInput>, ages = [1, 7, 30]) {
  const byAge = new Map(rows.map((row) => [row.age_days, row]));
  return Object.fromEntries(ages.map((age) => [`D${age}`, byAge.get(age) ?? null]));
}

export function isIncompleteReel(productType: string | null, row: Pick<PostDailyInput, "profile_visits" | "follows" | "missing_metrics">) {
  return productType?.toUpperCase() === "REELS" && (row.profile_visits === null || row.follows === null || row.missing_metrics.length > 0);
}

export function median(values: Array<number | null>) {
  const measured = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (measured.length === 0) return null;
  const middle = Math.floor(measured.length / 2);
  return measured.length % 2 === 0 ? (measured[middle - 1] + measured[middle]) / 2 : measured[middle];
}

export function guardedPartnerTrackMedian(values: Array<number | null>, sampleSize: number) {
  return sampleSize >= 5 ? median(values) : null;
}

export function verifyAnalyticsSignature(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: Uint8Array;
  now?: number;
}) {
  if (!input.timestamp || !/^\d{10}$/.test(input.timestamp)) return { ok: false as const, code: "E_SIGNATURE_MISSING" };
  if (!input.signature || !/^[0-9a-f]{64}$/i.test(input.signature)) return { ok: false as const, code: "E_SIGNATURE_MISSING" };
  const now = input.now ?? Date.now();
  if (Math.abs(now - Number(input.timestamp) * 1000) > analyticsSignatureMaxAgeSeconds * 1000) return { ok: false as const, code: "E_SIGNATURE_EXPIRED" };
  const expected = createHmac("sha256", input.secret).update(input.timestamp).update(input.rawBody).digest();
  const actual = Buffer.from(input.signature, "hex");
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) return { ok: false as const, code: "E_SIGNATURE_INVALID" };
  return { ok: true as const, requestSha256: createHash("sha256").update(input.rawBody).digest("hex") };
}

export async function readBoundedAnalyticsBody(stream: ReadableStream<Uint8Array> | null, maxBytes = analyticsSyncMaxBytes) {
  if (!stream) throw new Error("E_PAYLOAD_EMPTY");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("E_PAYLOAD_TOO_LARGE");
        throw new Error("E_PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function validateAnalyticsPayload(value: unknown): { ok: true; value: AnalyticsSyncPayload } | { ok: false; code: string } {
  if (!isRecord(value)) return { ok: false, code: "E_PAYLOAD" };
  const allowed = new Set(["idempotency_key", "source_timestamp", "posts", "post_daily", "account_daily", "demographics", "collabs"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return { ok: false, code: "E_PAYLOAD" };
  if (typeof value.idempotency_key !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(value.idempotency_key)) return { ok: false, code: "E_IDEMPOTENCY" };
  if (!isTimestamp(value.source_timestamp)) return { ok: false, code: "E_SOURCE_TIMESTAMP" };
  const arrays = [value.posts, value.post_daily, value.account_daily, value.demographics, value.collabs];
  if (arrays.some((rows) => !Array.isArray(rows) || rows.length > analyticsSyncMaxRows)) return { ok: false, code: "E_BATCH_SIZE" };
  const [posts, postDaily, accountDaily, demographics, collabs] = arrays as unknown[][];
  if (!posts.every(isPost) || !postDaily.every(isPostDaily) || !accountDaily.every(isAccountDaily) || !demographics.every(isDemographic) || !collabs.every(isCollab)) return { ok: false, code: "E_ROW" };
  const postIds = new Set((posts as AnalyticsPost[]).map((row) => row.post_id));
  if ((postDaily as PostDailyInput[]).some((row) => !postIds.has(row.post_id))) return { ok: false, code: "E_POST_REFERENCE" };
  return { ok: true, value: value as unknown as AnalyticsSyncPayload };
}

function isPost(value: unknown): value is AnalyticsPost {
  if (!hasOnly(value, ["post_id", "published_at", "media_type", "product_type", "permalink", "caption"])) return false;
  return typeof value.post_id === "string" && value.post_id.length > 0 && value.post_id.length <= 128
    && isTimestamp(value.published_at) && canonicalInstagramPermalink(String(value.permalink)) !== null
    && nullableBoundedString(value.media_type, 64) && nullableBoundedString(value.product_type, 64)
    && nullableBoundedString(value.caption, 5000);
}

function isPostDaily(value: unknown): value is PostDailyInput {
  if (!hasOnly(value, ["snapshot_date", "post_id", "age_days", ...metricNames, "missing_metrics"])) return false;
  if (!Array.isArray(value.missing_metrics) || !value.missing_metrics.every((metric) => typeof metric === "string" && metricNames.includes(metric as typeof metricNames[number]))) return false;
  const missing = new Set(value.missing_metrics);
  return isDate(value.snapshot_date) && typeof value.post_id === "string" && Number.isInteger(value.age_days) && Number(value.age_days) >= 0
    && metricNames.every((name) => nullableNonNegativeInteger(value[name]))
    && metricNames.every((name) => (value[name] === null) === missing.has(name));
}

function isAccountDaily(value: unknown) {
  const fields = ["date", "followers", "media_count", "reach", "views", "reach_followers", "reach_non_followers", "follows", "unfollows", "missing_metrics"];
  if (!hasOnly(value, fields) || !isDate(value.date) || !Array.isArray(value.missing_metrics)) return false;
  if (!value.missing_metrics.every((entry) => typeof entry === "string" && fields.slice(1, -1).includes(entry))) return false;
  const missing = new Set(value.missing_metrics);
  return fields.slice(1, -1).every((name) => nullableNonNegativeInteger(value[name]) && (value[name] === null) === missing.has(name));
}

function isDemographic(value: unknown) {
  return hasOnly(value, ["snapshot_date", "dimension", "key", "value"])
    && isDate(value.snapshot_date) && boundedString(value.dimension, 80) && boundedString(value.key, 160) && nullableNonNegativeInteger(value.value);
}

function isCollab(value: unknown) {
  const fields = ["date", "partner", "type", "notes", "net_follows_before", "net_follows_after", "follows_lift", "reach_before", "reach_after", "reach_lift_pct", "nonfollower_before", "nonfollower_after", "nonfollower_lift_pct", "computed_at"];
  if (!hasOnly(value, fields) || !isDate(value.date) || !boundedString(value.partner, 160) || !nullableBoundedString(value.type, 80) || !nullableBoundedString(value.notes, 1000) || !(value.computed_at === null || isTimestamp(value.computed_at))) return false;
  const integers = ["net_follows_before", "net_follows_after", "follows_lift", "reach_before", "reach_after", "nonfollower_before", "nonfollower_after"];
  return integers.every((name) => nullableInteger(value[name]))
    && ["reach_lift_pct", "nonfollower_lift_pct"].every((name) => nullableFiniteNumber(value[name]));
}

function hasOnly(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isTimestamp(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)); }
function isDate(value: unknown): value is string { return typeof value === "string" && isoDatePattern.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function boundedString(value: unknown, max: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function nullableBoundedString(value: unknown, max: number) { return value === null || (typeof value === "string" && value.length <= max); }
function nullableInteger(value: unknown) { return value === null || (typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647); }
function nullableNonNegativeInteger(value: unknown) { return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2147483647); }
function nullableFiniteNumber(value: unknown) { return value === null || (typeof value === "number" && Number.isFinite(value)); }
