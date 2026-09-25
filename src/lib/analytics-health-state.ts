export type SyncHealthRow = { id: string; status: string; source_timestamp: string; received_at: string };

export type AnalyticsStreamDates = {
  posts: string | null;
  account: string | null;
  audience: string | null;
};

export type AnalyticsFreshnessStatus = "fresh" | "stale" | "never_collected" | "not_due";

type StreamFreshness = {
  status: AnalyticsFreshnessStatus;
  latestDate: string | null;
  expectedDate: string;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function hebronDate(instant: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hebron",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dailyFreshness(latestDate: string | null, expectedDate: string): StreamFreshness {
  const measured = latestDate && datePattern.test(latestDate) ? latestDate : null;
  return {
    status: measured === null ? "never_collected" : measured >= expectedDate ? "fresh" : "stale",
    latestDate: measured,
    expectedDate,
  };
}

function weeklyFreshness(latestDate: string | null, today: string): StreamFreshness {
  const measured = latestDate && datePattern.test(latestDate) ? latestDate : null;
  if (measured === null) return { status: "never_collected", latestDate: null, expectedDate: today };
  const nextExpected = shiftDate(measured, 7);
  const status = measured >= today ? "fresh" : today < nextExpected ? "not_due" : "stale";
  return { status, latestDate: measured, expectedDate: nextExpected };
}

export function summarizeAnalyticsFreshness(latest: AnalyticsStreamDates, now: string) {
  const today = hebronDate(now);
  return {
    posts: dailyFreshness(latest.posts, today),
    account: dailyFreshness(latest.account, shiftDate(today, -2)),
    audience: weeklyFreshness(latest.audience, today),
  };
}

export function summarizeSyncHealth<T extends SyncHealthRow>(runs: T[], now: string, staleHours = 36) {
  const latest = runs[0] ?? null;
  const latestAccepted = runs.find((run) => run.status === "accepted") ?? null;
  const stale = latestAccepted
    ? Date.parse(now) - Date.parse(latestAccepted.source_timestamp) > staleHours * 3_600_000
    : true;
  return { latest, latestAccepted, latestFailed: Boolean(latest && latest.status !== "accepted"), stale };
}
