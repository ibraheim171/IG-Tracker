import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  analyticsIdempotencyHash,
  analyticsSyncMaxBytes,
  canAccessRawAnalytics,
  canonicalInstagramPermalink,
  computePerformance,
  exactCheckpoints,
  exactPermalinkLinkCandidates,
  guardedPartnerTrackMedian,
  isIncompleteReel,
  isTruthfulAcceptedIngestionResult,
  matchesAnalyticsMediaFilter,
  parseAnalyticsMediaFilter,
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
    { id: "item-similar", ig_permalink: "https://www.instagram.com/p/OTHER/", ig_media_id: "media-1" },
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

test("partner-track median requires five measured values and median never becomes a mean", () => {
  assert.equal(guardedPartnerTrackMedian([1, 2, 100]), null);
  assert.equal(guardedPartnerTrackMedian([1, 2, 3, 100, 200]), 3);
  assert.equal(guardedPartnerTrackMedian([1, null, 3, 5, 7, null]), null);
  assert.equal(guardedPartnerTrackMedian([1, null, 3, 5, 7, 9]), 5);
});

test("source-shaped Reels are filtered by product type and excluded from plain video", () => {
  const reel = { media_type: "VIDEO", product_type: "REELS" };
  const video = { media_type: "VIDEO", product_type: "FEED" };
  assert.equal(parseAnalyticsMediaFilter("REELS").value, "REELS");
  assert.equal(parseAnalyticsMediaFilter("STORY").ok, false);
  assert.equal(matchesAnalyticsMediaFilter(reel, "REELS"), true);
  assert.equal(matchesAnalyticsMediaFilter(reel, "VIDEO"), false);
  assert.equal(matchesAnalyticsMediaFilter(video, "VIDEO"), true);
  assert.equal(matchesAnalyticsMediaFilter(video, "REELS"), false);
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
  const verified = verifyAnalyticsSignature({ secret, timestamp, signature, rawBody, now: 1788870000000 });
  assert.equal(verified.ok, true);
  const retryTimestamp = "1788870001";
  const retrySignature = createHmac("sha256", secret).update(retryTimestamp).update(rawBody).digest("hex");
  const retry = verifyAnalyticsSignature({ secret, timestamp: retryTimestamp, signature: retrySignature, rawBody, now: 1788870001000 });
  assert.equal(retry.ok, true);
  assert.equal(verifyAnalyticsSignature({ secret, timestamp, signature: "0".repeat(64), rawBody, now: 1788870000000 }).code, "E_SIGNATURE_INVALID");
  assert.equal(verifyAnalyticsSignature({ secret, timestamp, signature, rawBody, now: 1788870400000 }).code, "E_SIGNATURE_EXPIRED");
  assert.equal(verifyAnalyticsSignature({ secret, timestamp: null, signature, rawBody }).code, "E_SIGNATURE_MISSING");
});

test("semantic idempotency ignores transport metadata and JSON ordering but detects metric changes", () => {
  const payload = {
    ...basePayload,
    posts: [
      ...basePayload.posts,
      { ...basePayload.posts[0], post_id: "media-2", permalink: "https://instagram.com/p/Second/" },
    ],
    post_daily: [
      ...basePayload.post_daily,
      { ...basePayload.post_daily[0], post_id: "media-2", reach: 250, missing_metrics: ["follows", "views"] },
    ],
  };
  const reverseJsonOrder = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reverseJsonOrder).reverse();
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .reverse()
          .map(([key, child]) => [key, reverseJsonOrder(child)]),
      );
    }
    return value;
  };
  const baselineHash = analyticsIdempotencyHash(payload);
  const reordered = JSON.parse(JSON.stringify(reverseJsonOrder(payload))) as typeof payload;

  assert.equal(analyticsIdempotencyHash(reordered), baselineHash);
  assert.equal(analyticsIdempotencyHash({ ...payload, idempotency_key: "different-run-key" }), baselineHash);
  assert.equal(analyticsIdempotencyHash({ ...payload, source_timestamp: "2026-09-09T09:30:00Z" }), baselineHash);
  assert.notEqual(
    analyticsIdempotencyHash({ ...payload, post_daily: [{ ...payload.post_daily[0], reach: 101 }, payload.post_daily[1]] }),
    baselineHash,
  );
});

test("sync validation bounds every table and rejects malformed rows before a write", () => {
  assert.equal(validateAnalyticsPayload(basePayload).ok, true);
  assert.equal(validateAnalyticsPayload({ ...basePayload, posts: [{ ...basePayload.posts[0], permalink: "https://example.com/p/x" }] }).ok, false);
  assert.equal(validateAnalyticsPayload({ ...basePayload, post_daily: [{ ...basePayload.post_daily[0], reach: -1 }] }).ok, false);
  const oversized = validateAnalyticsPayload({ ...basePayload, posts: Array.from({ length: 501 }, () => basePayload.posts[0]) });
  assert.deepEqual(oversized, { ok: false, code: "E_BATCH_SIZE" });
  const combinedOversized = validateAnalyticsPayload({ ...basePayload, posts: Array.from({ length: 497 }, () => basePayload.posts[0]) });
  assert.deepEqual(combinedOversized, { ok: false, code: "E_BATCH_SIZE" });
});

test("normalized exact duplicate snapshots are idempotent but divergent duplicates reject the batch", () => {
  const identical = {
    ...basePayload,
    post_daily: [basePayload.post_daily[0], { ...basePayload.post_daily[0], missing_metrics: [...basePayload.post_daily[0].missing_metrics].reverse() }],
    account_daily: [basePayload.account_daily[0], { ...basePayload.account_daily[0], missing_metrics: [...basePayload.account_daily[0].missing_metrics].reverse() }],
    demographics: [basePayload.demographics[0], { ...basePayload.demographics[0], dimension: " city ", key: " القدس " }],
    collabs: [basePayload.collabs[0], { ...basePayload.collabs[0], partner: " شريك ", type: " collab " }],
  };
  assert.equal(validateAnalyticsPayload(identical).ok, true);
  assert.deepEqual(validateAnalyticsPayload({
    ...basePayload,
    post_daily: [basePayload.post_daily[0], { ...basePayload.post_daily[0], reach: 101 }],
  }), { ok: false, code: "E_DIVERGENT_DUPLICATE" });
  assert.equal(isTruthfulAcceptedIngestionResult({
    received_count: 5,
    inserted_count: 0,
    updated_count: 0,
    already_present_identical_count: 5,
    rejected_count: 0,
  }, 5), true);
  assert.equal(isTruthfulAcceptedIngestionResult({
    received_count: 5,
    inserted_count: 5,
    updated_count: 0,
    already_present_identical_count: 5,
    rejected_count: 0,
  }, 5), false);
});

test("sync stream cancels immediately after the bounded request limit", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(analyticsSyncMaxBytes)); controller.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedAnalyticsBody(stream), /E_PAYLOAD_TOO_LARGE/);
  assert.equal(cancelled, true);
});

test("migration contract makes ingestion atomic/idempotent and database linking one-to-one", () => {
  const sql = readFileSync("supabase/migrations/20260909082927_analytics_foundation.sql", "utf8");
  assert.match(sql, /unique \(item_id\)|item_id uuid primary key/i);
  assert.match(sql, /media_id text not null unique/i);
  assert.match(sql, /constraint analytics_sync_runs_idempotency_key_unique unique \(idempotency_key\)/i);
  assert.doesNotMatch(sql, /unique \(signature_timestamp, request_sha256\)|request_sha256 text not null unique/i);
  const ingestionFunction = sql.slice(sql.indexOf("create or replace function public.ingest_analytics_batch"));
  assert.match(ingestionFunction, /select \* into existing_run\s+from public\.analytics_sync_runs\s+where idempotency_key = p_idempotency_key\s+for update/i);
  assert.match(ingestionFunction, /existing_run\.request_sha256 is distinct from p_request_sha256[\s\S]+IDEMPOTENCY_KEY_REUSED/i);
  assert.match(ingestionFunction, /existing_run\.status = 'accepted'[\s\S]+'replayed', true[\s\S]+'run_id', existing_run\.id[\s\S]+'received_count', existing_run\.received_count[\s\S]+'row_counts', existing_run\.row_counts/i);
  assert.ok(ingestionFunction.indexOf("raise exception 'IDEMPOTENCY_KEY_REUSED'") < ingestionFunction.indexOf("insert into public.analytics_sync_runs"));
  assert.doesNotMatch(ingestionFunction, /on conflict do nothing returning id into run_id|signature_timestamp\s*=\s*p_signature_timestamp/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('analytics-ingestion-v1'\)\)[\s\S]+lock table public\.ig_posts[\s\S]+DIVERGENT_POST_DAILY_SNAPSHOT/i);
  assert.ok(sql.indexOf("DIVERGENT_POST_DAILY_SNAPSHOT") < sql.indexOf("insert into public.ig_posts (media_id"));
  assert.match(sql, /jsonb_array_length[\s\S]+> 500[\s\S]+BATCH_TOO_LARGE/i);
  assert.match(sql, /received_count[\s\S]+inserted_count[\s\S]+already_present_identical_count[\s\S]+rejected_count/i);
  assert.doesNotMatch(sql, /insert into public\.ig_post_daily[\s\S]{0,1500}on conflict[^;]+do nothing/i);
  assert.match(sql, /insert into public\.ig_item_links[\s\S]+canonical_instagram_permalink\(i\.ig_permalink\) is not null[\s\S]+canonical_instagram_permalink\(p\.permalink\) is not null/i);
  assert.match(sql, /i\.ig_media_id is null or i\.ig_media_id = p\.media_id/i);
  assert.doesNotMatch(sql, /i\.ig_shortcode\s*=\s*p\.shortcode/i);
  assert.doesNotMatch(sql, /join[^;]+caption|date proximity/i);
  assert.match(sql, /insert into public\.ig_item_links[\s\S]+join public\.ig_posts p on p\.media_id = i\.ig_media_id[\s\S]+canonical_instagram_permalink\(i\.ig_permalink\)[\s\S]+canonical_instagram_permalink\(p\.permalink\)/i);
  assert.match(sql, /v_item_performance[\s\S]+join public\.ig_item_links l on l\.item_id = i\.id/i);
  assert.match(sql, /previous_legacy_media_id[\s\S]+case when target_item\.ig_media_id is distinct from p_media_id then target_item\.ig_media_id end/i);
  const linkFunction = sql.slice(
    sql.indexOf("create or replace function public.admin_link_instagram_post"),
    sql.indexOf("create or replace function public.ingest_analytics_batch"),
  );
  assert.ok(linkFunction.indexOf("pg_advisory_xact_lock(hashtext('analytics-ingestion-v1'))") < linkFunction.indexOf("pg_advisory_xact_lock(hashtext('ig-item-link:'"));
  assert.ok(linkFunction.indexOf("pg_advisory_xact_lock(hashtext('ig-item-link:'") < linkFunction.indexOf("select * into target_item"));
  assert.match(sql, /guard_item_analytics_identity[\s\S]+AUTHORITATIVE_ANALYTICS_LINK_REQUIRED[\s\S]+items_analytics_identity_guard/i);
  assert.match(sql, /revoke all on table[\s\S]+public\.ig_post_daily[\s\S]+from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant select on table public\.ig_posts, public\.ig_post_daily[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete)[^;]+public\.ig_post_daily[^;]+to service_role/i);
  assert.match(sql, /revoke all on table public\.v_post_latest[\s\S]+public\.v_conflict_orphan_posts[\s\S]+from public, anon, authenticated, service_role/i);
  assert.match(sql, /security definer[\s\S]+set search_path = pg_catalog, public/i);
  assert.match(sql, /function public\.admin_analytics_aggregates[\s\S]+is_active_user\(\)[\s\S]+is_admin\(\)[\s\S]+percentile_cont\(0\.5\)[\s\S]+count\(v\.signal\) >= 5/i);
  assert.match(sql, /grant execute on function public\.admin_analytics_aggregates\(date, date, text\) to authenticated/i);
  assert.match(sql, /revoke all on function public\.ingest_analytics_batch[\s\S]+grant execute[\s\S]+to service_role/i);
  const immutablePreflight = ingestionFunction.slice(
    ingestionFunction.indexOf("select 1 from pg_temp.analytics_incoming_post_daily"),
    ingestionFunction.indexOf("select count(*) into posts_received"),
  );
  assert.doesNotMatch(immutablePreflight, /e\.source_timestamp|t\.source_timestamp/);
  const trackMonthView = sql.slice(sql.indexOf("create or replace view public.v_track_month"), sql.indexOf("create or replace view public.v_partner_month"));
  const partnerMonthView = sql.slice(sql.indexOf("create or replace view public.v_partner_month"), sql.indexOf("create or replace view public.v_partner_track"));
  const partnerTrackView = sql.slice(sql.indexOf("create or replace view public.v_partner_track"), sql.indexOf("create or replace view public.v_conflict_link_unresolved"));
  for (const viewSql of [trackMonthView, partnerMonthView]) {
    assert.match(viewSql, /case when count\([^)]*reach\) > 0 then percentile_cont\(0\.5\)[\s\S]+median_reach/i);
    assert.match(viewSql, /case when count\([^)]*save_rate\) > 0 then percentile_cont\(0\.5\)[\s\S]+median_save_rate/i);
    assert.match(viewSql, /case when count\([^)]*share_rate\) > 0 then percentile_cont\(0\.5\)[\s\S]+median_share_rate/i);
    assert.match(viewSql, /case when count\([^)]*signal\) > 0 then percentile_cont\(0\.5\)[\s\S]+median_signal/i);
    assert.match(viewSql, /median_signal[\s\S]+measured_reach_n[\s\S]+measured_save_rate_n[\s\S]+measured_share_rate_n[\s\S]+measured_signal_n/i);
  }
  assert.match(partnerTrackView, /count\(v\.signal\) >= 5 as sample_sufficient/i);
  assert.match(partnerTrackView, /case when count\(v\.signal\) >= 5 then percentile_cont\(0\.5\)[\s\S]+median_signal/i);
  assert.match(partnerTrackView, /case when count\(v\.reach\) >= 5 then percentile_cont\(0\.5\)[\s\S]+median_reach/i);
  assert.match(partnerTrackView, /last_collab_at[\s\S]+measured_reach_n[\s\S]+measured_save_rate_n[\s\S]+measured_share_rate_n[\s\S]+measured_signal_n/i);
  assert.doesNotMatch(sql, /set views = null[\s\S]+where date </i);
  assert.match(sql, /perform public\.assert_can_use_app\(\)[\s\S]+public\.can_publish_items\(\)[\s\S]+ARCHIVED_IMMUTABLE[\s\S]+set_config\('app\.rpc'[\s\S]+insert into public\.transitions[\s\S]+refresh_slot_state/i);
  const insightsRoute = readFileSync("src/app/api/insights/route.ts", "utf8");
  assert.match(insightsRoute, /mediaType === "REELS"[\s\S]+eq\("product_type", "REELS"\)/);
  assert.match(insightsRoute, /mediaType === "VIDEO"[\s\S]+eq\("media_type", "VIDEO"\)[\s\S]+product_type\.neq\.REELS/);
  const syncRoute = readFileSync("src/app/api/internal/analytics-sync/route.ts", "utf8");
  assert.match(syncRoute, /p_request_sha256: analyticsIdempotencyHash\(validated\.value\)/);
  assert.match(syncRoute, /replayed: data\.replayed === true/);
  assert.doesNotMatch(syncRoute, /E_REPLAY|safeError\([^\n]+409/);
  const linkReviewRoute = readFileSync("src/app/api/admin/analytics-links/route.ts", "utf8");
  assert.doesNotMatch(linkReviewRoute, /!row\.ig_media_id/);
  for (const clientPath of ["src/components/insights-dashboard.tsx", "src/components/analytics-link-review.tsx"]) {
    assert.doesNotMatch(readFileSync(clientPath, "utf8"), /SUPABASE_SERVICE_ROLE_KEY|createClient\s*\(/);
  }
});
