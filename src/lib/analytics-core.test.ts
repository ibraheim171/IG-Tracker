import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  analyticsSyncMaxBytes,
  canAccessRawAnalytics,
  canonicalInstagramPermalink,
  computePerformance,
  exactCheckpoints,
  exactPermalinkLinkCandidates,
  guardedPartnerTrackMedian,
  isIncompleteReel,
  readBoundedAnalyticsBody,
  validateAnalyticsPayload,
  validateManualLink,
  verifyAnalyticsSignature,
} from "./analytics-core.ts";

const basePayload = {
  idempotency_key: "sheet-run-2026-09-08",
  source_timestamp: "2026-09-08T12:00:00Z",
  posts: [{ post_id: "media-1", published_at: "2026-09-07T18:00:00Z", media_type: "VIDEO", product_type: "REELS", permalink: "https://instagram.com/reel/Ab_C-1/?utm_source=x", caption: "وصف" }],
  post_daily: [{ snapshot_date: "2026-09-08", post_id: "media-1", age_days: 1, likes: 0, comments: 2, reach: 100, views: null, saved: 4, shares: 3, interactions: 9, profile_visits: null, follows: null, avg_watch_ms: 1200, missing_metrics: ["views", "profile_visits", "follows"] }],
  account_daily: [{ date: "2026-09-08", followers: 1000, media_count: 50, reach: 0, views: null, reach_followers: 0, reach_non_followers: null, follows: 0, unfollows: null, missing_metrics: ["views", "reach_non_followers", "unfollows"] }],
  demographics: [{ snapshot_date: "2026-09-08", dimension: "city", key: "القدس", value: 40 }],
  collabs: [{ date: "2026-09-08", partner: "شريك", type: "collab", notes: null, net_follows_before: null, net_follows_after: null, follows_lift: null, reach_before: 100, reach_after: 150, reach_lift_pct: 50, nonfollower_before: null, nonfollower_after: null, nonfollower_lift_pct: null, computed_at: "2026-09-08T12:00:00Z" }],
};

test("canonical linking accepts only exact HTTPS Instagram post paths", () => {
  for (const path of ["p/ABC", "reel/ABC_1", "tv/ABC-1"]) {
    assert.equal(canonicalInstagramPermalink(`https://instagram.com/${path}`), `https://www.instagram.com/${path}/`);
    assert.equal(canonicalInstagramPermalink(`https://www.instagram.com/${path}/?x=1`), `https://www.instagram.com/${path}/`);
  }
  for (const invalid of ["http://instagram.com/p/ABC", "https://example.com/p/ABC", "https://instagram.com/stories/ABC", "https://instagram.com/p/ABC/extra", "not a url"]) assert.equal(canonicalInstagramPermalink(invalid), null);
});

test("automatic matching uses only canonical permalink and never caption, title, or date", () => {
  const posts = [
    basePayload.posts[0],
    { ...basePayload.posts[0], post_id: "media-2", permalink: "https://instagram.com/p/DIFFERENT/", caption: "العنوان نفسه" },
  ];
  const links = exactPermalinkLinkCandidates(posts, [
    { id: "item-exact", ig_permalink: "https://www.instagram.com/p/Ab_C-1/" },
    { id: "item-similar", ig_permalink: "https://www.instagram.com/p/OTHER/" },
  ]);
  assert.deepEqual(links, [{ item_id: "item-exact", media_id: "media-1", source: "exact_permalink" }]);
});

test("ambiguous canonical matches create no guessed association", () => {
  assert.deepEqual(exactPermalinkLinkCandidates(basePayload.posts, [
    { id: "a", ig_permalink: basePayload.posts[0].permalink },
    { id: "b", ig_permalink: "https://www.instagram.com/reel/Ab_C-1/" },
  ]), []);
});

test("manual linking requires exact identifiers and a durable audit reason", () => {
  assert.equal(validateManualLink({ itemId: "a07c6a3a-4470-4e70-8877-0be18ed0dd11", mediaId: "m1", reason: "ربط يدوي موثق" }).ok, true);
  assert.deepEqual(validateManualLink({ itemId: "a07c6a3a-4470-4e70-8877-0be18ed0dd11", mediaId: "m1", reason: "x" }), { ok: false, code: "E_REASON" });
  assert.deepEqual(validateManualLink({ itemId: "------------------------------------", mediaId: "m1", reason: "ربط يدوي موثق" }), { ok: false, code: "E_ITEM" });
});

test("null remains unknown while numeric zero remains a real measurement", () => {
  const validated = validateAnalyticsPayload(basePayload);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(validated.value.post_daily[0].likes, 0);
  assert.equal(validated.value.post_daily[0].views, null);
  assert.equal(validated.value.account_daily[0].reach, 0);
  assert.equal(validated.value.account_daily[0].views, null);
  assert.equal(validateAnalyticsPayload({ ...basePayload, post_daily: [{ ...basePayload.post_daily[0], missing_metrics: [] }] }).ok, false);
  assert.equal(validateAnalyticsPayload({ ...basePayload, account_daily: [{ ...basePayload.account_daily[0], views: 0 }] }).ok, false);
});

test("rates and signal use the specified formula and never manufacture values without reach", () => {
  assert.deepEqual(computePerformance({ reach: 100, saved: 4, shares: 3, follows: 2, profile_visits: 5, comments: 2, likes: 10 }), { save_rate: 4, share_rate: 3, follow_rate: 2, profile_visit_rate: 5, engagement_rate: 19, signal_score: 580 });
  assert.deepEqual(computePerformance({ reach: 0, saved: 0, shares: 0, follows: 0, profile_visits: 0, comments: 0, likes: 0 }), { save_rate: null, share_rate: null, follow_rate: null, profile_visit_rate: null, engagement_rate: null, signal_score: null });
  assert.equal(computePerformance({ reach: 100, saved: 1, shares: 1, follows: null, profile_visits: null, comments: 1, likes: 1 }).signal_score, null);
});

test("checkpoints are exact and missing ages are never interpolated", () => {
  const row = basePayload.post_daily[0];
  const checkpoints = exactCheckpoints([{ ...row, age_days: 1 }, { ...row, age_days: 8 }]);
  assert.equal(checkpoints.D1?.age_days, 1);
  assert.equal(checkpoints.D7, null);
  assert.equal(checkpoints.D30, null);
});

test("Reels with unavailable follows or profile visits are visibly incomplete", () => {
  assert.equal(isIncompleteReel("REELS", basePayload.post_daily[0]), true);
  assert.equal(isIncompleteReel("IMAGE", basePayload.post_daily[0]), false);
});

test("partner-track median is hidden below N=5 and median never becomes a mean", () => {
  assert.equal(guardedPartnerTrackMedian([1, 2, 100], 3), null);
  assert.equal(guardedPartnerTrackMedian([1, 2, 3, 100, 200], 5), 3);
  assert.equal(guardedPartnerTrackMedian([1, null, 3, 5, 7], 5), 4);
});

test("only active admins can access raw analytics", () => {
  assert.equal(canAccessRawAnalytics({ active: true, roles: ["admin"] }), true);
  assert.equal(canAccessRawAnalytics({ active: true, roles: ["writer"] }), false);
  assert.equal(canAccessRawAnalytics({ active: false, roles: ["admin"] }), false);
  assert.equal(canAccessRawAnalytics(null), false);
});

test("signed sync rejects missing, invalid, expired signatures and accepts the exact raw body", () => {
  const rawBody = new TextEncoder().encode(JSON.stringify(basePayload));
  const timestamp = "1788870000";
  const secret = "a-local-test-secret-that-is-long-enough";
  const signature = createHmac("sha256", secret).update(timestamp).update(rawBody).digest("hex");
  assert.equal(verifyAnalyticsSignature({ secret, timestamp, signature, rawBody, now: 1788870000000 }).ok, true);
  assert.equal(verifyAnalyticsSignature({ secret, timestamp, signature: "0".repeat(64), rawBody, now: 1788870000000 }).code, "E_SIGNATURE_INVALID");
  assert.equal(verifyAnalyticsSignature({ secret, timestamp, signature, rawBody, now: 1788870400000 }).code, "E_SIGNATURE_EXPIRED");
  assert.equal(verifyAnalyticsSignature({ secret, timestamp: null, signature, rawBody }).code, "E_SIGNATURE_MISSING");
});

test("sync validation bounds every table and rejects malformed rows before a write", () => {
  assert.equal(validateAnalyticsPayload(basePayload).ok, true);
  assert.equal(validateAnalyticsPayload({ ...basePayload, posts: [{ ...basePayload.posts[0], permalink: "https://example.com/p/x" }] }).ok, false);
  assert.equal(validateAnalyticsPayload({ ...basePayload, post_daily: [{ ...basePayload.post_daily[0], reach: -1 }] }).ok, false);
  const oversized = validateAnalyticsPayload({ ...basePayload, posts: Array.from({ length: 501 }, () => basePayload.posts[0]) });
  assert.deepEqual(oversized, { ok: false, code: "E_BATCH_SIZE" });
});

test("sync stream cancels immediately after the bounded request limit", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(analyticsSyncMaxBytes)); controller.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedAnalyticsBody(stream), /E_PAYLOAD_TOO_LARGE/);
  assert.equal(cancelled, true);
});

test("migration makes ingestion atomic/idempotent and database linking one-to-one", () => {
  const sql = readFileSync("supabase/migrations/20260908164428_analytics_foundation.sql", "utf8");
  assert.match(sql, /unique \(item_id\)|item_id uuid primary key/i);
  assert.match(sql, /media_id text not null unique/i);
  assert.match(sql, /insert into public\.analytics_sync_runs[\s\S]+on conflict do nothing returning id into run_id/i);
  assert.match(sql, /if run_id is null then return jsonb_build_object\('replayed', true\)/i);
  assert.match(sql, /insert into public\.ig_item_links[\s\S]+canonical_instagram_permalink\(i\.ig_permalink\) = public\.canonical_instagram_permalink\(p\.permalink\)/i);
  assert.doesNotMatch(sql, /similarity|day_gap|join[^;]+caption|date proximity/i);
  assert.match(sql, /revoke all on table[\s\S]+public\.ig_post_daily[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /revoke all on table public\.v_post_latest[\s\S]+public\.v_conflict_orphan_posts[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /security definer[\s\S]+set search_path = pg_catalog, public/i);
  assert.match(sql, /function public\.admin_analytics_aggregates[\s\S]+is_active_user\(\)[\s\S]+is_admin\(\)[\s\S]+percentile_cont\(0\.5\)[\s\S]+count\(\*\) >= 5/i);
  assert.match(sql, /grant execute on function public\.admin_analytics_aggregates\(date, date, text\) to authenticated/i);
  assert.match(sql, /revoke all on function public\.ingest_analytics_batch[\s\S]+grant execute[\s\S]+to service_role/i);
  for (const clientPath of ["src/components/insights-dashboard.tsx", "src/components/analytics-link-review.tsx"]) {
    assert.doesNotMatch(readFileSync(clientPath, "utf8"), /SUPABASE_SERVICE_ROLE_KEY|createClient\s*\(/);
  }
});
