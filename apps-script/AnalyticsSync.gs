/**
 * Sends independently collected analytics streams to the internal endpoint.
 * Depends on Code.gs for SHEETS, readSheet_, prop_, logRun_, and date helpers.
 */

var ANALYTICS_MAX_ROWS = 500;
var ANALYTICS_ACCOUNT_WATERMARK_PROPERTY = "ANALYTICS_ACCOUNT_SENT_THROUGH";

function analyticsEmptyBatch_() {
  return { posts: [], post_daily: [], account_daily: [], demographics: [], collabs: [] };
}

function analyticsSummary_() {
  return { batches: 0, received: 0, inserted: 0, updated: 0, identical: 0 };
}

function analyticsAddResult_(summary, result, fallbackReceived) {
  summary.batches += 1;
  summary.received += typeof result.received_count === "number" ? result.received_count : fallbackReceived;
  summary.inserted += Number(result.inserted_count) || 0;
  summary.updated += Number(result.updated_count) || 0;
  summary.identical += Number(result.already_present_identical_count) || 0;
}

function syncAnalyticsToTracker() {
  var now = new Date();
  var today = fmt_(now);
  var failures = [];
  ["posts", "account", "demographics", "collabs"].forEach(function (stream) {
    var date = stream === "account" ? analyticsClosedAccountDate_(now) : today;
    var outcome = analyticsRunStream_(stream, date, function () {
      return stream === "account"
        ? syncAccountAnalytics_(SpreadsheetApp.getActiveSpreadsheet(), now)
        : syncAnalyticsStream_(stream);
    });
    if (!outcome.ok) failures.push(stream);
  });
  if (failures.length) throw new Error("ANALYTICS_STREAM_FAILURE: " + failures.join(","));
}

function syncAnalyticsStream_(stream) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var batches;
  if (stream === "posts") {
    var posts = analyticsReadPosts_(spreadsheet);
    var daily = analyticsDedupeLatest_(analyticsReadPostDaily_(spreadsheet, posts.byId), function (row) {
      return row.snapshot_date + "|" + row.post_id;
    });
    batches = analyticsBuildPostBatches_(posts.list, daily);
  } else if (stream === "account") {
    var watermark = analyticsRequireAccountWatermark_();
    var closedThrough = analyticsClosedAccountDate_(new Date());
    var accountRows = analyticsDedupeLatest_(analyticsReadAccountDaily_(spreadsheet), function (row) { return row.date; });
    return analyticsSyncAccountRows_(analyticsSelectAccountRows_(accountRows, watermark, closedThrough));
  } else if (stream === "demographics") {
    var demographics = analyticsDedupeLatest_(analyticsReadDemographics_(spreadsheet), function (row) {
      return row.snapshot_date + "|" + row.dimension + "|" + row.key;
    });
    batches = analyticsChunk_(demographics, ANALYTICS_MAX_ROWS).map(function (rows) {
      var batch = analyticsEmptyBatch_();
      batch.demographics = rows;
      return batch;
    });
  } else if (stream === "collabs") {
    var collabs = analyticsDedupeLatest_(analyticsReadCollabs_(spreadsheet), function (row) {
      return row.date + "|" + row.partner + "|" + (row.type || "");
    });
    batches = analyticsChunk_(collabs, ANALYTICS_MAX_ROWS).map(function (rows) {
      var batch = analyticsEmptyBatch_();
      batch.collabs = rows;
      return batch;
    });
  } else {
    throw new Error("UNKNOWN_ANALYTICS_STREAM");
  }

  var summary = analyticsSummary_();
  batches.forEach(function (batch) {
    var result = analyticsSendBatch_(batch);
    analyticsAssertAccepted_(result);
    analyticsAddResult_(summary, result, analyticsBatchSize_(batch));
  });
  return summary;
}

function analyticsRequireAccountWatermark_() {
  var value = PropertiesService.getScriptProperties().getProperty(ANALYTICS_ACCOUNT_WATERMARK_PROPERTY);
  if (!value || !analyticsValidDate_(value)) {
    throw new Error("Missing or invalid Script Property: ANALYTICS_ACCOUNT_SENT_THROUGH");
  }
  return value;
}

function analyticsSelectAccountRows_(rows, watermark, closedThrough) {
  return rows.filter(function (row) {
    return row.date > watermark && row.date <= closedThrough;
  }).sort(function (left, right) { return left.date.localeCompare(right.date); });
}

function syncAccountAnalytics_(spreadsheet, now) {
  var watermark = analyticsRequireAccountWatermark_();
  var closedThrough = analyticsClosedAccountDate_(now);
  for (var date = analyticsShiftDate_(watermark, 1); date <= closedThrough; date = analyticsShiftDate_(date, 1)) {
    pullAccountDay_(spreadsheet, date);
  }
  var rows = analyticsDedupeLatest_(analyticsReadAccountDaily_(spreadsheet), function (row) { return row.date; });
  return analyticsSyncAccountRows_(analyticsSelectAccountRows_(rows, watermark, closedThrough));
}

function analyticsSyncAccountRows_(rows) {
  var summary = analyticsSummary_();
  analyticsChunk_(rows, ANALYTICS_MAX_ROWS).forEach(function (chunk) {
    var batch = analyticsEmptyBatch_();
    batch.account_daily = chunk;
    var result = analyticsSendBatch_(batch);
    analyticsAssertAccepted_(result);
    PropertiesService.getScriptProperties().setProperty(
      ANALYTICS_ACCOUNT_WATERMARK_PROPERTY,
      chunk[chunk.length - 1].date
    );
    analyticsAddResult_(summary, result, chunk.length);
  });
  return summary;
}

function analyticsAssertAccepted_(result) {
  if (!result || result.ok !== true || Number(result.rejected_count) > 0) {
    throw new Error("ANALYTICS_BATCH_REJECTED");
  }
}

function analyticsBatchSize_(batch) {
  return batch.posts.length + batch.post_daily.length + batch.account_daily.length + batch.demographics.length + batch.collabs.length;
}

function analyticsReadPosts_(spreadsheet) {
  var byId = {};
  readSheet_(spreadsheet.getSheetByName(SHEETS.posts)).forEach(function (row) {
    var postId = String(row.post_id || "").trim();
    var permalink = String(row.permalink || "").trim();
    var publishedAt = analyticsIsoTimestamp_(row.published_at);
    if (!postId || !publishedAt || !analyticsValidPermalink_(permalink)) return;
    byId[postId] = {
      post_id: postId,
      published_at: publishedAt,
      media_type: analyticsNullableText_(row.media_type, 64),
      product_type: analyticsNullableText_(row.product_type, 64),
      permalink: permalink,
      caption: analyticsNullableText_(row.caption, 500)
    };
  });
  var list = Object.keys(byId).map(function (id) { return byId[id]; });
  list.sort(function (left, right) { return left.post_id.localeCompare(right.post_id); });
  return { byId: byId, list: list };
}

function analyticsReadPostDaily_(spreadsheet, postsById) {
  var metrics = ["likes", "comments", "reach", "views", "saved", "shares", "interactions", "profile_visits", "follows", "avg_watch_ms"];
  var rows = [];
  readSheet_(spreadsheet.getSheetByName(SHEETS.daily)).forEach(function (row) {
    var postId = String(row.post_id || "").trim();
    var snapshotDate = analyticsDate_(row.snapshot_date);
    if (!postId || !snapshotDate || !postsById[postId]) return;
    var item = { snapshot_date: snapshotDate, post_id: postId, age_days: analyticsNonNegativeInteger_(row.age_days), missing_metrics: [] };
    metrics.forEach(function (name) {
      item[name] = analyticsNonNegativeInteger_(row[name]);
      if (item[name] === null) item.missing_metrics.push(name);
    });
    rows.push(item);
  });
  rows.sort(function (left, right) {
    return (left.snapshot_date + "|" + left.post_id).localeCompare(right.snapshot_date + "|" + right.post_id);
  });
  return rows;
}

function analyticsReadAccountDaily_(spreadsheet) {
  var fields = ["followers", "media_count", "reach", "views", "reach_followers", "reach_non_followers", "follows", "unfollows"];
  var rows = [];
  readSheet_(spreadsheet.getSheetByName(SHEETS.account)).forEach(function (row) {
    var date = analyticsDate_(row.date);
    if (!date) return;
    var item = { date: date, missing_metrics: [] };
    fields.forEach(function (name) {
      item[name] = analyticsNonNegativeInteger_(row[name]);
      if (item[name] === null) item.missing_metrics.push(name);
    });
    rows.push(item);
  });
  rows.sort(function (left, right) { return left.date.localeCompare(right.date); });
  return rows;
}

function analyticsReadDemographics_(spreadsheet) {
  var rows = [];
  readSheet_(spreadsheet.getSheetByName(SHEETS.demo)).forEach(function (row) {
    var date = analyticsDate_(row.snapshot_date);
    var dimension = String(row.dimension || "").trim();
    var key = String(row.key || "").trim();
    if (!date || !dimension || !key) return;
    rows.push({ snapshot_date: date, dimension: dimension, key: key, value: analyticsNonNegativeInteger_(row.value) });
  });
  rows.sort(function (left, right) {
    return (left.snapshot_date + "|" + left.dimension + "|" + left.key)
      .localeCompare(right.snapshot_date + "|" + right.dimension + "|" + right.key);
  });
  return rows;
}

function analyticsReadCollabs_(spreadsheet) {
  var rows = [];
  readSheet_(spreadsheet.getSheetByName(SHEETS.collabs)).forEach(function (row) {
    var date = analyticsDate_(row.date);
    var partner = String(row.partner || "").trim();
    if (!date || !partner) return;
    rows.push({
      date: date,
      partner: partner,
      type: analyticsNullableText_(row.type, 80),
      notes: analyticsNullableText_(row.notes, 1000),
      net_follows_before: analyticsInteger_(row.net_follows_before),
      net_follows_after: analyticsInteger_(row.net_follows_after),
      follows_lift: analyticsInteger_(row.follows_lift),
      reach_before: analyticsInteger_(row.reach_before),
      reach_after: analyticsInteger_(row.reach_after),
      reach_lift_pct: analyticsNumber_(row.reach_lift_pct),
      nonfollower_before: analyticsInteger_(row.nonfollower_before),
      nonfollower_after: analyticsInteger_(row.nonfollower_after),
      nonfollower_lift_pct: analyticsNumber_(row.nonfollower_lift_pct),
      computed_at: analyticsIsoTimestamp_(row.computed_at)
    });
  });
  rows.sort(function (left, right) {
    return (left.date + "|" + left.partner + "|" + (left.type || ""))
      .localeCompare(right.date + "|" + right.partner + "|" + (right.type || ""));
  });
  return rows;
}

function analyticsBuildPostBatches_(posts, daily) {
  var batches = [];
  var postById = {};
  var used = {};
  posts.forEach(function (post) { postById[post.post_id] = post; });
  var current = analyticsEmptyBatch_();
  var currentIds = {};
  daily.forEach(function (snapshot) {
    var extraPost = currentIds[snapshot.post_id] ? 0 : 1;
    if (analyticsBatchSize_(current) + extraPost + 1 > ANALYTICS_MAX_ROWS) {
      batches.push(current);
      current = analyticsEmptyBatch_();
      currentIds = {};
    }
    if (!currentIds[snapshot.post_id]) {
      current.posts.push(postById[snapshot.post_id]);
      currentIds[snapshot.post_id] = true;
    }
    current.post_daily.push(snapshot);
    used[snapshot.post_id] = true;
  });
  if (analyticsBatchSize_(current)) batches.push(current);
  var remaining = posts.filter(function (post) { return !used[post.post_id]; });
  analyticsChunk_(remaining, ANALYTICS_MAX_ROWS).forEach(function (rows) {
    var batch = analyticsEmptyBatch_();
    batch.posts = rows;
    batches.push(batch);
  });
  return batches;
}

function analyticsChunk_(rows, size) {
  var chunks = [];
  for (var index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

function analyticsSendBatch_(batch) {
  if (analyticsBatchSize_(batch) > ANALYTICS_MAX_ROWS) throw new Error("ANALYTICS_BATCH_TOO_LARGE");
  var semantic = JSON.stringify(batch);
  var payload = {
    idempotency_key: "gas.analytics." + analyticsSha256_(semantic),
    source_timestamp: new Date().toISOString(),
    posts: batch.posts,
    post_daily: batch.post_daily,
    account_daily: batch.account_daily,
    demographics: batch.demographics,
    collabs: batch.collabs
  };
  var body = JSON.stringify(payload);
  var timestamp = String(Math.floor(Date.now() / 1000));
  var signature = analyticsHmacHex_(timestamp + "." + payload.idempotency_key, prop_("ANALYTICS_SYNC_SECRET"));
  var response = UrlFetchApp.fetch(prop_("ANALYTICS_SYNC_URL"), {
    method: "post",
    contentType: "application/json",
    payload: body,
    headers: {
      "X-Analytics-Timestamp": timestamp,
      "X-Analytics-Idempotency-Key": payload.idempotency_key,
      "X-Analytics-Signature": signature
    },
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  var result;
  try { result = JSON.parse(response.getContentText()); }
  catch (error) { throw new Error("ANALYTICS_HTTP_" + status); }
  if (status !== 202 || !result.ok) throw new Error("ANALYTICS_HTTP_" + status + "_" + String(result.code || "unknown"));
  return result;
}

function analyticsValidPermalink_(value) {
  return /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?(?:[?#].*)?$/i.test(value);
}

function analyticsValidDate_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}

function analyticsDate_(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && analyticsValidDate_(value)) return value;
  var parsed = value instanceof Date ? value : new Date(value);
  return isNaN(parsed.getTime()) ? null : Utilities.formatDate(parsed, ANALYTICS_TIME_ZONE, "yyyy-MM-dd");
}

function analyticsIsoTimestamp_(value) {
  if (value === null || value === undefined || value === "") return null;
  var parsed = value instanceof Date ? value : new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function analyticsNullableText_(value, maxLength) {
  var text = String(value === null || value === undefined ? "" : value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function analyticsNonNegativeInteger_(value) {
  if (value === null || value === undefined || value === "") return null;
  var number = Number(value);
  if (!isFinite(number) || number < 0 || Math.floor(number) !== number) throw new Error("INVALID_NON_NEGATIVE_INTEGER");
  return number;
}

function analyticsInteger_(value) {
  if (value === null || value === undefined || value === "") return null;
  var number = Number(value);
  if (!isFinite(number) || Math.floor(number) !== number) throw new Error("INVALID_INTEGER");
  return number;
}

function analyticsNumber_(value) {
  if (value === null || value === undefined || value === "") return null;
  var number = Number(value);
  if (!isFinite(number)) throw new Error("INVALID_NUMBER");
  return number;
}

function analyticsSha256_(value) {
  return analyticsHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8));
}

function analyticsHmacHex_(value, secret) {
  return analyticsHex_(Utilities.computeHmacSha256Signature(value, secret));
}

function analyticsHex_(bytes) {
  return bytes.map(function (byte) {
    var hex = (byte & 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");
}

function analyticsDedupeLatest_(rows, keyFn) {
  var latest = {};
  rows.forEach(function (row) { latest[keyFn(row)] = row; });
  return Object.keys(latest).sort().map(function (key) { return latest[key]; });
}
