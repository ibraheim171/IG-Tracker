import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const codeSource = readFileSync("apps-script/Code.gs", "utf8");
const syncSource = readFileSync("apps-script/AnalyticsSync.gs", "utf8");

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function formatDate(date: Date, timeZone: string, pattern: string) {
  const parts = zonedParts(date, timeZone);
  if (pattern === "yyyy-MM-dd") return `${parts.year}-${parts.month}-${parts.day}`;
  if (pattern === "Z") {
    const representedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const offsetMinutes = Math.round((representedAsUtc - date.getTime()) / 60_000);
    const sign = offsetMinutes < 0 ? "-" : "+";
    const absolute = Math.abs(offsetMinutes);
    return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}${String(absolute % 60).padStart(2, "0")}`;
  }
  throw new Error(`Unsupported test pattern: ${pattern}`);
}

function loadAppsScript() {
  const properties = new Map<string, string>();
  const logs: string[] = [];
  const context = vm.createContext({
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Error,
    isFinite,
    parseInt,
    encodeURIComponent,
    Utilities: {
      formatDate,
      sleep() {},
      Charset: { UTF_8: "UTF_8" },
      DigestAlgorithm: { SHA_256: "SHA_256" },
      computeDigest() { return [0]; },
      computeHmacSha256Signature() { return [0]; },
    },
    Session: { getScriptTimeZone() { throw new Error("Session timezone must not be used"); } },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key: string) { return properties.get(key) ?? null; },
          setProperty(key: string, value: string) { properties.set(key, value); },
        };
      },
    },
    CacheService: { getScriptCache() { return { remove() {} }; } },
    LockService: {
      getScriptLock() {
        return { waitLock() {}, releaseLock() {} };
      },
    },
    SpreadsheetApp: { getActiveSpreadsheet() { return { getSheetByName() { return null; } }; } },
    logRun_(_level: string, message: string) { logs.push(message); },
  });
  vm.runInContext(codeSource, context, { filename: "Code.gs" });
  vm.runInContext(syncSource, context, { filename: "AnalyticsSync.gs" });
  return { context: context as Record<string, any>, properties, logs };
}

function accountRow(date: string) {
  return {
    date,
    followers: null,
    media_count: null,
    reach: 1,
    views: null,
    reach_followers: null,
    reach_non_followers: null,
    follows: null,
    unfollows: null,
    missing_metrics: ["followers", "media_count", "views", "reach_followers", "reach_non_followers", "follows", "unfollows"],
  };
}

function isoDateFrom(base: string, offset: number) {
  const date = new Date(`${base}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function memorySheet(headers: string[], initialRows: unknown[][] = []) {
  const rows = initialRows.map((row) => [...row]);
  return {
    rows,
    getLastRow() { return rows.length + 1; },
    getDataRange() {
      return { getValues() { return [[...headers], ...rows.map((row) => [...row])]; } };
    },
    getRange(startRow: number, startColumn: number, rowCount: number, columnCount: number) {
      return {
        getValues() {
          return Array.from({ length: rowCount }, (_, rowOffset) =>
            Array.from({ length: columnCount }, (_, columnOffset) =>
              rows[startRow - 2 + rowOffset]?.[startColumn - 1 + columnOffset] ?? ""));
        },
        setValues(values: unknown[][]) {
          values.forEach((valueRow, rowOffset) => {
            const target = startRow - 2 + rowOffset;
            rows[target] = rows[target] ?? [];
            valueRow.forEach((value, columnOffset) => {
              rows[target][startColumn - 1 + columnOffset] = value;
            });
          });
        },
      };
    },
  };
}

function assertHebronMidnight(epochSeconds: number, expectedDate: string) {
  const parts = zonedParts(new Date(epochSeconds * 1000), "Asia/Hebron");
  assert.equal(`${parts.year}-${parts.month}-${parts.day}`, expectedDate);
  assert.equal(`${parts.hour}:${parts.minute}:${parts.second}`, "00:00:00");
}

test("account collection closes the Hebron calendar two days before now", () => {
  const { context } = loadAppsScript();
  assert.equal(context.ACCOUNT_FINALIZATION_LAG_DAYS, 2);
  assert.equal(context.analyticsClosedAccountDate_(new Date("2026-09-24T21:30:00Z")), "2026-09-23");
  assert.equal(context.fmt_(new Date("2026-09-24T21:30:00Z")), "2026-09-25");
});

test("account day bounds are Hebron midnights in both 2026 DST offset regimes", () => {
  const { context } = loadAppsScript();
  const winter = context.analyticsAccountDayBounds_("2026-01-15");
  const summer = context.analyticsAccountDayBounds_("2026-07-15");

  assertHebronMidnight(winter.since, "2026-01-15");
  assertHebronMidnight(winter.until, "2026-01-16");
  assertHebronMidnight(summer.since, "2026-07-15");
  assertHebronMidnight(summer.until, "2026-07-16");
  assert.notEqual(formatDate(new Date(winter.since * 1000), "Asia/Hebron", "Z"),
    formatDate(new Date(summer.since * 1000), "Asia/Hebron", "Z"));
});

test("the versioned Code source retains the Portal web entry point", () => {
  const { context } = loadAppsScript();
  const calls: string[] = [];
  context.HtmlService = {
    createHtmlOutputFromFile(name: string) {
      calls.push(name);
      return {
        setTitle() { return this; },
        addMetaTag() { return this; },
      };
    },
  };
  context.doGet();
  assert.deepEqual(calls, ["Dashboard"]);
});

test("account selection requires a configured watermark and excludes old or unfinalized days", () => {
  const { context } = loadAppsScript();
  assert.throws(() => context.analyticsRequireAccountWatermark_(), /ANALYTICS_ACCOUNT_SENT_THROUGH/);
  const rows = ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"].map(accountRow);
  assert.deepEqual(
    Array.from(context.analyticsSelectAccountRows_(rows, "2026-09-20", "2026-09-23"), (row: { date: string }) => row.date),
    ["2026-09-21", "2026-09-22", "2026-09-23"],
  );
});

test("account collection uses explicit day bounds and never overwrites an existing row", () => {
  const { context } = loadAppsScript();
  let apiCalls = 0;
  let appendCalls = 0;
  context.dateIndex_ = () => ({ "2026-09-21": 2 });
  context.igGet_ = () => { apiCalls += 1; throw new Error("must not fetch an existing immutable day"); };
  const existing = context.pullAccountDay_({ getSheetByName() { return {}; } }, "2026-09-21");
  assert.equal(existing.status, "already_present");
  assert.equal(apiCalls, 0);

  const insightParams: Array<Record<string, unknown>> = [];
  context.dateIndex_ = () => ({});
  context.igGet_ = (_path: string, params: Record<string, unknown>) => {
    insightParams.push(params);
    if (params.metric === "reach" && params.breakdown === undefined) return { data: [{ name: "reach", values: [{ value: 7 }] }] };
    if (params.metric === "views") return { data: [{ name: "views", total_value: { value: 9 } }] };
    return { data: [] };
  };
  const sheet = { appendRow(row: unknown[]) { appendCalls += 1; assert.deepEqual(Array.from(row), ["2026-09-21", "", "", 7, 9, "", "", "", ""]); } };
  const inserted = context.pullAccountDay_({ getSheetByName() { return sheet; } }, "2026-09-21");
  assert.equal(inserted.status, "inserted");
  assert.equal(appendCalls, 1);
  assert.ok(insightParams.length >= 4);
  assert.ok(insightParams.every((params) => Number.isInteger(params.since) && Number.isInteger(params.until) && Number(params.until) > Number(params.since)));
});

test("post collection retry reuses the stored same-day snapshot without recollecting", () => {
  const { context } = loadAppsScript();
  const posts = memorySheet(
    ["post_id", "published_at", "media_type", "product_type", "permalink", "caption"],
    [["post-1", "2026-09-20T18:00:00Z", "VIDEO", "REELS", "https://www.instagram.com/reel/abc/", "caption"]],
  );
  const daily = memorySheet(
    ["snapshot_date", "post_id", "age_days", "likes", "comments", "reach", "views", "saved", "shares", "interactions", "profile_visits", "follows", "avg_watch_ms"],
  );
  const spreadsheet = {
    getSheetByName(name: string) { return name === "posts" ? posts : daily; },
  };
  context.igGet_ = () => ({ data: [{ id: "post-1", timestamp: "2026-09-20T18:00:00Z" }] });
  let snapshotCalls = 0;
  let reach = 10;
  context.snapRow_ = () => {
    snapshotCalls += 1;
    return ["2026-09-25", "post-1", 5, 1, 1, reach, 20, 1, 1, 2, "", "", ""];
  };

  context.pullPosts_(spreadsheet, "2026-09-25");
  reach = 99;
  context.pullPosts_(spreadsheet, "2026-09-25");

  assert.equal(snapshotCalls, 1);
  assert.equal(daily.rows.length, 1);
  assert.equal(daily.rows[0][5], 10);
});

test("complete same-day demographics are synchronized without recollection", () => {
  const { context } = loadAppsScript();
  const demographics = memorySheet(
    ["snapshot_date", "dimension", "key", "value"],
    [
      ["2026-09-25", "country", "PS", 100],
      ["2026-09-25", "city", "Jerusalem", 80],
      ["2026-09-25", "age", "25-34", 70],
      ["2026-09-25", "gender", "F", 60],
    ],
  );
  const spreadsheet = { getSheetByName() { return demographics; } };
  context.fmt_ = () => "2026-09-25";
  context.SpreadsheetApp = { getActiveSpreadsheet() { return spreadsheet; } };
  context.logRun_ = () => {};
  context.igGet_ = () => { throw new Error("must not recollect an immutable same-day snapshot"); };
  const synced: string[] = [];
  context.syncAnalyticsStream_ = (stream: string) => { synced.push(stream); return { received: 4 }; };

  const result = context.pullDemographics();

  assert.deepEqual(synced, ["demographics"]);
  assert.equal(result.count, 4);
  assert.equal(demographics.rows.length, 4);
});

test("demographic collection refuses partial same-day data and writes no partial snapshot", () => {
  const { context } = loadAppsScript();
  const demographics = memorySheet(["snapshot_date", "dimension", "key", "value"]);
  const spreadsheet = { getSheetByName() { return demographics; } };
  context.fmt_ = () => "2026-09-25";
  context.igGet_ = (_path: string, params: { breakdown: string }) => {
    const results = params.breakdown === "age"
      ? []
      : [{ dimension_values: [params.breakdown + "-value"], value: 1 }];
    return { data: [{ total_value: { breakdowns: [{ results }] } }] };
  };

  assert.throws(() => context.collectDemographics_(spreadsheet), /DEMOGRAPHICS_INCOMPLETE/);
  assert.equal(demographics.rows.length, 0);
});

test("an incomplete stored demographic date is never extended into a second snapshot", () => {
  const { context } = loadAppsScript();
  const demographics = memorySheet(
    ["snapshot_date", "dimension", "key", "value"],
    [["2026-09-25", "country", "PS", 100]],
  );
  const spreadsheet = { getSheetByName() { return demographics; } };
  context.fmt_ = () => "2026-09-25";
  context.igGet_ = () => { throw new Error("must not recollect over a partial stored date"); };

  assert.throws(() => context.collectDemographics_(spreadsheet), /DEMOGRAPHICS_STORED_SNAPSHOT_INCOMPLETE/);
  assert.equal(demographics.rows.length, 1);
});

test("account watermark advances after each accepted chunk and not past a failed chunk", () => {
  const { context, properties } = loadAppsScript();
  properties.set("ANALYTICS_ACCOUNT_SENT_THROUGH", "2020-01-01");
  const rows = Array.from({ length: 501 }, (_, index) => accountRow(isoDateFrom("2020-01-01", index + 1)));
  const sizes: number[] = [];
  context.analyticsSendBatch_ = (batch: { account_daily: unknown[] }) => {
    sizes.push(batch.account_daily.length);
    if (sizes.length === 2) throw new Error("second chunk rejected");
    return { ok: true, rejected_count: 0 };
  };

  assert.throws(() => context.analyticsSyncAccountRows_(rows), /second chunk rejected/);
  assert.deepEqual(sizes, [500, 1]);
  assert.equal(properties.get("ANALYTICS_ACCOUNT_SENT_THROUGH"), rows[499].date);
});

test("daily streams remain isolated and report failure only after the other streams run", () => {
  const { context } = loadAppsScript();
  const calls: string[] = [];
  context.pullPosts_ = () => { calls.push("posts_collect"); };
  context.syncAnalyticsStream_ = (stream: string) => { calls.push(stream); return { received: 1 }; };
  context.syncAccountAnalytics_ = () => { calls.push("account"); throw new Error("account rejected"); };
  context.CacheService = { getScriptCache() { return { remove() {} }; } };

  assert.throws(() => context.dailyPull(), /ANALYTICS_STREAM_FAILURE/);
  assert.deepEqual(calls, ["posts_collect", "posts", "account", "collabs"]);
});

test("weekly demographics collection synchronizes its own stream", () => {
  const { context } = loadAppsScript();
  const calls: string[] = [];
  context.collectDemographics_ = () => { calls.push("collect"); return 12; };
  context.syncAnalyticsStream_ = (stream: string) => { calls.push(stream); return { received: 12 }; };

  const result = context.pullDemographics();
  assert.deepEqual(calls, ["collect", "demographics"]);
  assert.equal(result.count, 12);
});

test("every analytics chunk stays at or below 500 rows", () => {
  const { context } = loadAppsScript();
  const chunks = context.analyticsChunk_(Array.from({ length: 1001 }, (_, index) => index), context.ANALYTICS_MAX_ROWS);
  assert.deepEqual(Array.from(chunks, (chunk: unknown[]) => chunk.length), [500, 500, 1]);
});
