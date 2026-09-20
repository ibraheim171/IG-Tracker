import type { AccountDailyInsight, DemographicInsight, InsightRange } from "./insights.ts";

export type ChartPoint<X extends string | number = string | number> = { x: X; y: number | null };
export type MeasuredChartPoint<X extends string | number = string | number> = { x: X; y: number };
export type AudienceValue = { key: string; value: number | null };
export type AudienceSnapshot = {
  snapshot_date: string | null;
  source_time: string | null;
  countries: AudienceValue[];
  cities: AudienceValue[];
  ages: AudienceValue[];
  genders: AudienceValue[];
};

function dateInAccountTimeZone(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hebron",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function currentMonthRange(now = new Date()): InsightRange {
  const end = dateInAccountTimeZone(now);
  return { start: `${end.slice(0, 7)}-01`, end };
}

export function previousMonthRange(now = new Date()): InsightRange {
  const current = dateInAccountTimeZone(now);
  const firstCurrentMonth = new Date(`${current.slice(0, 7)}-01T00:00:00Z`);
  const lastPreviousMonth = new Date(firstCurrentMonth);
  lastPreviousMonth.setUTCDate(0);
  const end = lastPreviousMonth.toISOString().slice(0, 10);
  return { start: `${end.slice(0, 7)}-01`, end };
}

export function lineSegments<X extends string | number>(points: ChartPoint<X>[]): MeasuredChartPoint<X>[][] {
  const segments: MeasuredChartPoint<X>[][] = [];
  let current: MeasuredChartPoint<X>[] = [];
  for (const point of points) {
    if (point.y === null) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push({ x: point.x, y: point.y });
  }
  if (current.length) segments.push(current);
  return segments;
}

export function followerDailyChanges(rows: Array<Pick<AccountDailyInsight, "date" | "followers">>): ChartPoint<string>[] {
  return rows.map((row, index) => ({
    x: row.date,
    y: index > 0 && row.followers !== null && rows[index - 1].followers !== null
      ? row.followers - (rows[index - 1].followers as number)
      : null,
  }));
}

export function completeAccountDailyRange(range: InsightRange, rows: AccountDailyInsight[]): AccountDailyInsight[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const cursor = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  const complete: AccountDailyInsight[] = [];
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    complete.push(byDate.get(date) ?? {
      date,
      followers: null,
      media_count: null,
      reach: null,
      views: null,
      reach_followers: null,
      reach_non_followers: null,
      follows: null,
      unfollows: null,
      missing_metrics: ["day"],
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return complete;
}

function ranked(rows: DemographicInsight[], dimension: string, limit?: number): AudienceValue[] {
  const values = rows
    .filter((row) => row.dimension.trim().toLowerCase() === dimension)
    .map(({ key, value }) => ({ key, value }))
    .sort((left, right) => {
      if (left.value === null && right.value !== null) return 1;
      if (left.value !== null && right.value === null) return -1;
      return (right.value ?? 0) - (left.value ?? 0) || left.key.localeCompare(right.key, "ar");
    });
  return limit ? values.slice(0, limit) : values;
}

export function latestAudienceSnapshot(rows: DemographicInsight[]): AudienceSnapshot {
  const snapshotDate = rows.reduce<string | null>((latest, row) => !latest || row.snapshot_date > latest ? row.snapshot_date : latest, null);
  if (!snapshotDate) return { snapshot_date: null, source_time: null, countries: [], cities: [], ages: [], genders: [] };
  const latest = rows.filter((row) => row.snapshot_date === snapshotDate);
  return {
    snapshot_date: snapshotDate,
    source_time: latest.find((row) => row.source_timestamp)?.source_timestamp ?? null,
    countries: ranked(latest, "country", 10),
    cities: ranked(latest, "city", 10),
    ages: ranked(latest, "age"),
    genders: ranked(latest, "gender"),
  };
}
