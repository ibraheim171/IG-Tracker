/**
 * Instagram collector for the external Google Apps Script project.
 *
 * Required Script Properties:
 *   IG_TOKEN
 *   ANALYTICS_SYNC_URL
 *   ANALYTICS_SYNC_SECRET
 *   ANALYTICS_ACCOUNT_SENT_THROUGH
 *
 * AnalyticsSync.gs owns transport and watermarks. This file owns collection.
 */

var API = "https://graph.instagram.com";
var VER = "v23.0";
var ANALYTICS_TIME_ZONE = "Asia/Hebron";
var ACCOUNT_FINALIZATION_LAG_DAYS = 2;
var WINDOW_DAYS = 35;
var MIN_POSTS = 12;
var BATCH_CAP = 110;
var COLLAB_WIN = 7;
var DEMOGRAPHIC_DIMENSIONS = ["country", "city", "age", "gender"];

var M_REEL = ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions",
              "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"];
var M_POST = ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions",
              "profile_visits", "follows"];

var SHEETS = {
  account: "account_daily",
  posts: "posts",
  daily: "post_daily",
  collabs: "collabs",
  demo: "demographics",
  log: "log"
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile("Dashboard")
    .setTitle("غرفة العمليات")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function prop_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error("Missing Script Property: " + key);
  return value;
}

function fmt_(date) {
  return Utilities.formatDate(date, ANALYTICS_TIME_ZONE, "yyyy-MM-dd");
}

function logRun_(level, message) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.log);
  if (sheet) sheet.appendRow([new Date(), level, message]);
}

function readSheet_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values.shift();
  return values.map(function (row) {
    var item = {};
    headers.forEach(function (key, index) {
      item[key] = row[index] instanceof Date ? fmt_(row[index]) : row[index];
    });
    return item;
  });
}

function setup() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  mkSheet_(spreadsheet, SHEETS.account, ["date", "followers", "media_count", "reach", "views",
    "reach_followers", "reach_non_followers", "follows", "unfollows"]);
  mkSheet_(spreadsheet, SHEETS.posts, ["post_id", "published_at", "media_type", "product_type", "permalink", "caption"]);
  mkSheet_(spreadsheet, SHEETS.daily, ["snapshot_date", "post_id", "age_days", "likes", "comments", "reach", "views",
    "saved", "shares", "interactions", "profile_visits", "follows", "avg_watch_ms"]);
  mkSheet_(spreadsheet, SHEETS.collabs, ["date", "partner", "type", "notes", "net_follows_before",
    "net_follows_after", "follows_lift", "reach_before", "reach_after", "reach_lift_pct",
    "nonfollower_before", "nonfollower_after", "nonfollower_lift_pct", "computed_at"]);
  mkSheet_(spreadsheet, SHEETS.demo, ["snapshot_date", "dimension", "key", "value"]);
  mkSheet_(spreadsheet, SHEETS.log, ["timestamp", "level", "message"]);
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    var handler = trigger.getHandlerFunction();
    if (["dailyPull", "refreshToken", "pullDemographics", "collabImpact"].indexOf(handler) > -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger("dailyPull").timeBased().atHour(3).everyDays(1).create();
  ScriptApp.newTrigger("refreshToken").timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(4).create();
  ScriptApp.newTrigger("pullDemographics").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(5).create();
  ScriptApp.newTrigger("collabImpact").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(6).create();
}

function mkSheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function analyticsShiftDate_(date, days) {
  var value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function analyticsClosedAccountDate_(now) {
  return analyticsShiftDate_(fmt_(now), -ACCOUNT_FINALIZATION_LAG_DAYS);
}

function analyticsOffsetMinutes_(date) {
  var text = Utilities.formatDate(date, ANALYTICS_TIME_ZONE, "Z");
  var sign = text.charAt(0) === "-" ? -1 : 1;
  return sign * (Number(text.slice(1, 3)) * 60 + Number(text.slice(3, 5)));
}

function analyticsHebronMidnightSeconds_(date) {
  var utcMidnight = Date.parse(date + "T00:00:00Z");
  var first = new Date(utcMidnight);
  var candidate = utcMidnight - analyticsOffsetMinutes_(first) * 60000;
  candidate = utcMidnight - analyticsOffsetMinutes_(new Date(candidate)) * 60000;
  return Math.floor(candidate / 1000);
}

function analyticsAccountDayBounds_(date) {
  return {
    since: analyticsHebronMidnightSeconds_(date),
    until: analyticsHebronMidnightSeconds_(analyticsShiftDate_(date, 1))
  };
}

function analyticsStreamCount_(result) {
  if (!result) return 0;
  if (typeof result.received === "number") return result.received;
  if (typeof result.count === "number") return result.count;
  return 0;
}

function analyticsFailureStatus_(error) {
  var message = error && error.message ? String(error.message) : "";
  if (message.indexOf("ANALYTICS_ACCOUNT_SENT_THROUGH") > -1) return "failed_missing_watermark";
  return "failed";
}

function analyticsRunStream_(stream, date, work) {
  try {
    var result = work();
    logRun_("INFO", "stream=" + stream + " status=accepted count=" + analyticsStreamCount_(result) + " date=" + date);
    return { ok: true, result: result };
  } catch (error) {
    logRun_("ERROR", "stream=" + stream + " status=" + analyticsFailureStatus_(error) + " count=0 date=" + date);
    return { ok: false };
  }
}

function analyticsWithScriptLock_(work) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return work(); }
  finally { lock.releaseLock(); }
}

function analyticsPostSnapshotKeys_(sheet) {
  var keys = {};
  readSheet_(sheet).forEach(function (row) {
    var date = String(row.snapshot_date || "").slice(0, 10);
    var postId = String(row.post_id || "").trim();
    if (date && postId) keys[date + "|" + postId] = true;
  });
  return keys;
}

function dailyPull() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var now = new Date();
  var today = fmt_(now);
  var closedAccountDate = analyticsClosedAccountDate_(now);
  var failures = [];

  var posts = analyticsRunStream_("posts", today, function () {
    pullPosts_(spreadsheet, today);
    return syncAnalyticsStream_("posts");
  });
  if (!posts.ok) failures.push("posts");

  var account = analyticsRunStream_("account", closedAccountDate, function () {
    return syncAccountAnalytics_(spreadsheet, now);
  });
  if (!account.ok) failures.push("account");

  var collabs = analyticsRunStream_("collabs", today, function () {
    return syncAnalyticsStream_("collabs");
  });
  if (!collabs.ok) failures.push("collabs");

  CacheService.getScriptCache().remove("portal");
  if (failures.length) throw new Error("ANALYTICS_STREAM_FAILURE: " + failures.join(","));
}

function pullAccountDay_(spreadsheet, date) {
  var sheet = spreadsheet.getSheetByName(SHEETS.account);
  if (dateIndex_(sheet)[date]) return { status: "already_present", date: date };

  var bounds = analyticsAccountDayBounds_(date);
  var reach = insights_("/me", ["reach"], { period: "day", since: bounds.since, until: bounds.until });
  var views = accountViews_(bounds);
  var split = reachSplit_(bounds);
  var follow = followsUnfollows_(bounds);
  var row = [date, "", "", metricValue_(reach.reach), metricValue_(views),
    metricValue_(split.followers), metricValue_(split.non_followers),
    metricValue_(follow.follows), metricValue_(follow.unfollows)];
  if (row.slice(3).every(function (value) { return value === ""; })) throw new Error("ACCOUNT_DAY_EMPTY");
  sheet.appendRow(row);
  return { status: "inserted", date: date };
}

function backfillAccount() {
  return syncAccountAnalytics_(SpreadsheetApp.getActiveSpreadsheet(), new Date());
}

function accountViews_(bounds) {
  var response = igGet_("/me/insights", {
    metric: "views", period: "day", metric_type: "total_value",
    since: bounds.since, until: bounds.until
  });
  if (!response.error && response.data && response.data[0]) {
    var metric = response.data[0];
    if (metric.total_value && typeof metric.total_value.value === "number") return metric.total_value.value;
    if (metric.values && metric.values[0] && typeof metric.values[0].value === "number") return metric.values[0].value;
  }
  return "";
}

function pullPosts_(spreadsheet, today) {
  return analyticsWithScriptLock_(function () {
    var postsSheet = spreadsheet.getSheetByName(SHEETS.posts);
    var dailySheet = spreadsheet.getSheetByName(SHEETS.daily);
    var media = igGet_("/me/media", { fields: mediaFields_(), limit: 50 });
    if (media.error) throw new Error("POST_COLLECTION_FAILED");
    var known = {};
    colValues_(postsSheet, 1).forEach(function (value) { known[String(value)] = true; });
    var snapshotKeys = analyticsPostSnapshotKeys_(dailySheet);
    var now = new Date();
    var newRows = [];
    var snapshots = [];
    (media.data || []).forEach(function (item, index) {
      var postId = String(item.id);
      var age = Math.floor((now - new Date(item.timestamp)) / 86400000);
      if (age > WINDOW_DAYS && index >= MIN_POSTS) return;
      if (!known[postId]) {
        newRows.push(postRow_(item));
        known[postId] = true;
      }
      var snapshotKey = today + "|" + postId;
      if (snapshotKeys[snapshotKey]) return;
      snapshots.push(snapRow_(item, today, age));
      snapshotKeys[snapshotKey] = true;
      Utilities.sleep(120);
    });
    if (newRows.length) postsSheet.getRange(postsSheet.getLastRow() + 1, 1, newRows.length, 6).setValues(newRows);
    if (snapshots.length) dailySheet.getRange(dailySheet.getLastRow() + 1, 1, snapshots.length, 13).setValues(snapshots);
    return { posts: newRows.length, snapshots: snapshots.length };
  });
}

function backfillPosts() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var postsSheet = spreadsheet.getSheetByName(SHEETS.posts);
  var dailySheet = spreadsheet.getSheetByName(SHEETS.daily);
  var properties = PropertiesService.getScriptProperties();
  var cursor = properties.getProperty("BACKFILL_CURSOR") || "";
  var known = colValues_(postsSheet, 1).map(String);
  var today = fmt_(new Date());
  var now = new Date();
  var processed = 0;
  var newRows = [];
  var snapshots = [];
  while (processed < BATCH_CAP) {
    var params = { fields: mediaFields_(), limit: 50 };
    if (cursor) params.after = cursor;
    var response = igGet_("/me/media", params);
    if (response.error) throw new Error("POST_BACKFILL_FAILED");
    var batch = response.data || [];
    if (!batch.length) { cursor = ""; break; }
    batch.forEach(function (item) {
      if (processed >= BATCH_CAP || known.indexOf(String(item.id)) > -1) return;
      newRows.push(postRow_(item));
      snapshots.push(snapRow_(item, today, Math.floor((now - new Date(item.timestamp)) / 86400000)));
      known.push(String(item.id));
      processed += 1;
      Utilities.sleep(120);
    });
    cursor = response.paging && response.paging.cursors ? response.paging.cursors.after || "" : "";
    if (!response.paging || !response.paging.next) { cursor = ""; break; }
  }
  if (newRows.length) postsSheet.getRange(postsSheet.getLastRow() + 1, 1, newRows.length, 6).setValues(newRows);
  if (snapshots.length) dailySheet.getRange(dailySheet.getLastRow() + 1, 1, snapshots.length, 13).setValues(snapshots);
  properties.setProperty("BACKFILL_CURSOR", cursor);
}

function collectDemographics_(spreadsheet) {
  return analyticsWithScriptLock_(function () {
    var sheet = spreadsheet.getSheetByName(SHEETS.demo);
    var today = fmt_(new Date());
    var stored = readSheet_(sheet).filter(function (row) {
      return String(row.snapshot_date || "").slice(0, 10) === today;
    });
    if (stored.length) {
      var storedDimensions = {};
      stored.forEach(function (row) { storedDimensions[String(row.dimension || "")] = true; });
      var storedComplete = DEMOGRAPHIC_DIMENSIONS.every(function (dimension) { return storedDimensions[dimension]; });
      if (!storedComplete) throw new Error("DEMOGRAPHICS_STORED_SNAPSHOT_INCOMPLETE");
      return stored.length;
    }

    var rows = [];
    DEMOGRAPHIC_DIMENSIONS.forEach(function (dimension) {
      var response = igGet_("/me/insights", {
        metric: "follower_demographics", period: "lifetime", metric_type: "total_value",
        breakdown: dimension, timeframe: "this_month"
      });
      if (response.error) throw new Error("DEMOGRAPHICS_COLLECTION_FAILED");
      var breakdowns = response.data && response.data[0] && response.data[0].total_value && response.data[0].total_value.breakdowns;
      var results = breakdowns && breakdowns[0] ? breakdowns[0].results || [] : [];
      if (!results.length) throw new Error("DEMOGRAPHICS_INCOMPLETE");
      results.forEach(function (result) {
        rows.push([today, dimension, String(result.dimension_values[0]), metricValue_(result.value)]);
      });
      Utilities.sleep(300);
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    return rows.length;
  });
}

function pullDemographics() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var today = fmt_(new Date());
  var outcome = analyticsRunStream_("demographics", today, function () {
    var count = collectDemographics_(spreadsheet);
    syncAnalyticsStream_("demographics");
    return { count: count };
  });
  if (!outcome.ok) throw new Error("ANALYTICS_STREAM_FAILURE: demographics");
  return outcome.result;
}

function collabImpact() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(SHEETS.collabs);
  if (!sheet || sheet.getLastRow() < 2) return;
  var byDate = {};
  readSheet_(spreadsheet.getSheetByName(SHEETS.account)).forEach(function (row) {
    byDate[String(row.date).slice(0, 10)] = row;
  });
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 14).getValues();
  var output = [];
  data.forEach(function (row) {
    if (!row[0]) { output.push(row.slice(4)); return; }
    var day = fmt_(row[0] instanceof Date ? row[0] : new Date(row[0]));
    var before = window_(byDate, day, -COLLAB_WIN, -1);
    var after = window_(byDate, day, 0, COLLAB_WIN - 1);
    if (!before.days || !after.days) { output.push(row.slice(4)); return; }
    var reachLift = before.reach ? (after.reach - before.reach) / before.reach * 100 : "";
    var nonFollowerLift = before.nf ? (after.nf - before.nf) / before.nf * 100 : "";
    output.push([before.follows, after.follows, after.follows - before.follows,
      before.reach, after.reach, reachLift === "" ? "" : Math.round(reachLift * 10) / 10,
      before.nf, after.nf, nonFollowerLift === "" ? "" : Math.round(nonFollowerLift * 10) / 10,
      new Date()]);
  });
  sheet.getRange(2, 5, output.length, 10).setValues(output);
  CacheService.getScriptCache().remove("portal");
}

function window_(byDate, anchor, from, to) {
  var result = { reach: 0, nf: 0, follows: 0, days: 0 };
  for (var offset = from; offset <= to; offset++) {
    var row = byDate[analyticsShiftDate_(anchor, offset)];
    if (!row) continue;
    if (row.reach !== "" && row.reach !== null && row.reach !== undefined) result.reach += Number(row.reach);
    if (row.reach_non_followers !== "" && row.reach_non_followers !== null && row.reach_non_followers !== undefined) result.nf += Number(row.reach_non_followers);
    if (row.follows !== "" && row.follows !== null && row.follows !== undefined) result.follows += Number(row.follows);
    if (row.unfollows !== "" && row.unfollows !== null && row.unfollows !== undefined) result.follows -= Number(row.unfollows);
    result.days += 1;
  }
  return result;
}

function mediaFields_() {
  return "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count";
}

function postRow_(item) {
  return [item.id, item.timestamp, item.media_type, item.media_product_type || "",
    item.permalink, String(item.caption || "").slice(0, 200)];
}

function metricValue_(value) {
  return typeof value === "number" && isFinite(value) ? value : "";
}

function snapRow_(item, today, age) {
  var pool = item.media_product_type === "REELS" ? M_REEL : M_POST;
  var insights = insights_("/" + item.id, pool, {});
  return [today, item.id, age, metricValue_(item.like_count), metricValue_(item.comments_count),
    metricValue_(insights.reach), metricValue_(insights.views), metricValue_(insights.saved),
    metricValue_(insights.shares), metricValue_(insights.total_interactions),
    metricValue_(insights.profile_visits), metricValue_(insights.follows),
    metricValue_(insights.ig_reels_avg_watch_time)];
}

function insights_(path, metrics, extra) {
  var pool = metrics.slice();
  var output = {};
  for (var attempt = 0; attempt < 8 && pool.length; attempt++) {
    var params = { metric: pool.join(",") };
    Object.keys(extra).forEach(function (key) { params[key] = extra[key]; });
    var response = igGet_(path + "/insights", params);
    if (!response.error) {
      (response.data || []).forEach(function (metric) {
        var value = metric.total_value && Object.prototype.hasOwnProperty.call(metric.total_value, "value")
          ? metric.total_value.value
          : metric.values && metric.values[0] && Object.prototype.hasOwnProperty.call(metric.values[0], "value")
            ? metric.values[0].value : null;
        output[metric.name] = metricValue_(value);
      });
      return output;
    }
    var message = String(response.error.message || "");
    var unsupported = pool.filter(function (metric) { return message.indexOf(metric) > -1; })[0];
    if (!unsupported) throw new Error("INSIGHTS_COLLECTION_FAILED");
    pool = pool.filter(function (metric) { return metric !== unsupported; });
  }
  return output;
}

function reachSplit_(bounds) {
  return parseFollowType_(igGet_("/me/insights", {
    metric: "reach", period: "day", metric_type: "total_value", breakdown: "follow_type",
    since: bounds.since, until: bounds.until
  }), "non", "non_followers", "followers");
}

function followsUnfollows_(bounds) {
  return parseFollowType_(igGet_("/me/insights", {
    metric: "follows_and_unfollows", period: "day", metric_type: "total_value", breakdown: "follow_type",
    since: bounds.since, until: bounds.until
  }), "un", "unfollows", "follows");
}

function parseFollowType_(response, needle, keyA, keyB) {
  var output = {};
  output[keyA] = "";
  output[keyB] = "";
  if (response.error || !response.data || !response.data[0]) return output;
  var breakdowns = response.data[0].total_value && response.data[0].total_value.breakdowns;
  if (!breakdowns || !breakdowns[0] || !breakdowns[0].results) return output;
  breakdowns[0].results.forEach(function (result) {
    var key = String(result.dimension_values[0]).toLowerCase();
    output[key.indexOf(needle) > -1 ? keyA : keyB] = metricValue_(result.value);
  });
  return output;
}

function igGet_(path, params) {
  params = params || {};
  params.access_token = prop_("IG_TOKEN");
  var query = Object.keys(params).map(function (key) {
    return key + "=" + encodeURIComponent(params[key]);
  }).join("&");
  var response = UrlFetchApp.fetch(API + "/" + VER + path + "?" + query, { muteHttpExceptions: true });
  try { return JSON.parse(response.getContentText()); }
  catch (error) { return { error: { message: "unparsable response" } }; }
}

function refreshToken() {
  var response = JSON.parse(UrlFetchApp.fetch(API + "/refresh_access_token?grant_type=ig_refresh_token&access_token=" + prop_("IG_TOKEN"), {
    muteHttpExceptions: true
  }).getContentText());
  if (!response.access_token) {
    logRun_("ERROR", "stream=token status=failed count=0 date=" + fmt_(new Date()));
    throw new Error("TOKEN_REFRESH_FAILED");
  }
  PropertiesService.getScriptProperties().setProperty("IG_TOKEN", response.access_token);
  logRun_("INFO", "stream=token status=accepted count=1 date=" + fmt_(new Date()));
}

function dateIndex_(sheet) {
  var index = {};
  if (sheet.getLastRow() < 2) return index;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (row, offset) {
    if (row[0]) index[fmt_(row[0] instanceof Date ? row[0] : new Date(row[0] + "T12:00:00Z"))] = offset + 2;
  });
  return index;
}

function colValues_(sheet, column) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, column, sheet.getLastRow() - 1, 1).getValues().map(function (row) { return row[0]; });
}
