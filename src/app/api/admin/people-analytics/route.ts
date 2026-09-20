import { NextRequest, NextResponse } from "next/server";
import { requireAnalyticsAdmin } from "@/lib/analytics-auth";
import type { ComparisonResult } from "@/lib/analytics-comparison";
import type { ComparisonMetric } from "@/lib/analytics-comparison";

function withCookies(body: object, status: number, source: NextResponse) {
  const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

function isSameOriginRead(request: NextRequest) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  try {
    if (origin) return new URL(origin).origin === request.nextUrl.origin;
    if (referer) return new URL(referer).origin === request.nextUrl.origin;
  } catch { return false; }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

export async function GET(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  if (!isSameOriginRead(request)) return withCookies({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403, sessionResponse);
  const auth = await requireAnalyticsAdmin(request, sessionResponse);
  if (!auth.ok) return withCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, sessionResponse);

  const [profilesResult, assignmentsResult] = await Promise.all([
    auth.supabase.from("profiles").select("id,display_name,roles").eq("active", true).order("display_name"),
    auth.supabase.from("item_participants").select("user_id,part,items!inner(id,status,is_archived)").eq("items.is_archived", false),
  ]);
  if (profilesResult.error || assignmentsResult.error) return withCookies({ error: "تعذر تحميل لوحة الأشخاص.", code: "E_PEOPLE_LOAD" }, 503, sessionResponse);
  const profiles = profilesResult.data ?? [];
  if (!profiles.length) return withCookies({ people: [], period: null }, 200, sessionResponse);

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 365);
  const range = { start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10) };
  const metricKeys: ComparisonMetric[] = ["save_rate", "share_rate", "follow_rate", "signal"];
  const profileChunks = chunks(profiles.map((profile) => profile.id), 20);
  const metricResults = await Promise.all(metricKeys.flatMap((metric) => profileChunks.map(async (keys) => ({
    metric,
    result: await auth.supabase.rpc("admin_analytics_comparison", {
      p_start: range.start,
      p_end: range.end,
      p_dimension: "person",
      p_metric: metric,
      p_keys: keys,
      p_media_type: null,
    }),
  }))));
  if (metricResults.some(({ result }) => result.error)) return withCookies({ error: "تعذر حساب قياسات الأشخاص.", code: "E_PEOPLE_METRICS" }, 503, sessionResponse);
  const metrics = metricResults.flatMap(({ metric, result }) => ((result.data ?? []) as ComparisonResult[]).map((row) => ({ metric, row })));

  const activeStatuses = new Set(["idea", "writing", "content_approved", "in_production", "design_approved", "ready"]);
  const people = profiles.map((profile) => {
    const allAssignments = (assignmentsResult.data ?? []).flatMap((row) => {
      const item = Array.isArray(row.items) ? row.items[0] : row.items;
      return row.user_id === profile.id && item ? [{ part: row.part, status: item.status }] : [];
    });
    const assignments = allAssignments.filter((row) => activeStatuses.has(row.status));
    const stageCounts = Object.entries(assignments.reduce<Record<string, number>>((counts, row) => {
      const key = `${row.part}:${row.status}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {})).map(([key, count]) => {
      const [part, status] = key.split(":");
      return { part, status, count };
    });
    const participationTotals = Object.entries(allAssignments.reduce<Record<string, number>>((counts, row) => {
      counts[row.part] = (counts[row.part] ?? 0) + 1;
      return counts;
    }, {})).map(([part, count]) => ({ part, count }));
    return { id: profile.id, display_name: profile.display_name, roles: profile.roles, stage_counts: stageCounts, participation_totals: participationTotals, metrics: metrics.filter(({ row }) => row.dimension_key === profile.id) };
  });
  return withCookies({ people, period: range }, 200, sessionResponse);
}
