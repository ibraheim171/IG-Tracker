"use client";

import { useEffect, useState } from "react";
import { DataCoverage } from "./data-coverage";
import { MetricLineChart } from "./metric-line-chart";
import type { AccountDailyInsight, AccountRangeMetric, AccountRangeSummary, InsightRange } from "@/lib/insights";
import { reportMetricFormulas, type ValidReportContextBlock } from "@/lib/report-context";
import { AddToReportButton } from "./add-to-report-button";
import { followerDailyChanges } from "@/lib/account-pulse";
import { MetricDefinitions } from "./metric-definitions";

type AccountPayload = {
  range: InsightRange;
  daily: AccountDailyInsight[];
  summary: AccountRangeSummary;
  publishing: { published: number | null; slots: number | null };
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; payload: AccountPayload };

function metric(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function MetricCard({ label, value, coverage }: { label: string; value: number | null; coverage: { measured: number; expected: number } }) {
  return <article className="card insight-card account-metric-card"><span>{label}</span><strong className="num">{metric(value)}</strong><DataCoverage measured={coverage.measured} expected={coverage.expected} /></article>;
}

function coverage(summary: AccountRangeMetric) {
  return { measured: summary.measured_days, expected: summary.expected_days };
}

export function AccountPulse({ range }: { range: InsightRange }) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch(`/api/insights/account?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر تحميل نبض الحساب.");
      setState({ kind: "ready", payload: body });
    }).catch((caught) => {
      if (!controller.signal.aborted) setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر تحميل نبض الحساب." });
    });
    return () => controller.abort();
  }, [range, retry]);

  if (state.kind === "loading") return <section className="card"><p aria-live="polite">جارٍ تحميل نبض الحساب…</p></section>;
  if (state.kind === "error") return <section className="card stack" role="alert"><p className="error">{state.message}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></section>;

  const { daily, summary, publishing } = state.payload;
  const latestMeasured = [...daily].reverse().find((row) => !row.missing_metrics.includes("day"));
  const followerChanges = followerDailyChanges(daily);
  const followerCoverage = { measured: summary.followers.measured_days, expected: summary.followers.expected_days };
  const warnings: ValidReportContextBlock["snapshot"]["warnings"] = [summary.reach.total === null || summary.views.total === null ? "partial_range" : null].filter((value): value is "partial_range" => value !== null);
  const reportBlock: ValidReportContextBlock = { blockType: "account", title: "نبض الحساب", snapshot: {
    period: range,
    filters: {},
    metric: "account_overview",
    formula: reportMetricFormulas.account_overview,
    selection: [{ key: "instagram:aqsana2026", label: "حساب أقصانا" }],
    values: [
      { label: "عدد المتابعين في آخر قياس", value: summary.followers.end, measured_n: summary.followers.measured_days },
      { label: "التغير في عدد المتابعين", value: summary.followers.change, measured_n: summary.followers.measured_days },
      { label: "الوصول", value: summary.reach.total, measured_n: summary.reach.measured_days },
      { label: "المشاهدات", value: summary.views.total, measured_n: summary.views.measured_days },
      { label: "المواد المنشورة", value: publishing.published, measured_n: publishing.published === null ? 0 : 1 },
      { label: "فتحات النشر", value: publishing.slots, measured_n: publishing.slots === null ? 0 : 1 },
    ],
    series: [
      { key: "followers", label: "المتابعون", points: daily.map((row) => ({ date: row.date, value: row.followers })) },
      { key: "follower_change", label: "التغير اليومي", points: followerChanges.map((row) => ({ date: row.x, value: row.y })) },
      { key: "reach", label: "الوصول", points: daily.map((row) => ({ date: row.date, value: row.reach })) },
      { key: "reach_non_followers", label: "وصول غير المتابعين", points: daily.map((row) => ({ date: row.date, value: row.reach_non_followers })) },
    ],
    completeness: { measured_n: Math.min(summary.followers.measured_days, summary.reach.measured_days, summary.views.measured_days), expected_n: summary.reach.expected_days },
    warnings,
    source_time: latestMeasured?.source_timestamp ?? null,
  } };
  return <div className="stack account-pulse">
    <div className="insight-section-actions"><AddToReportButton block={reportBlock} /></div>
    <section className="insight-card-grid account-pulse-grid" aria-label="ملخص نبض الحساب">
      <MetricCard label="عدد المتابعين في آخر قياس" value={summary.followers.end} coverage={followerCoverage} />
      <MetricCard label="التغير في عدد المتابعين" value={summary.followers.change} coverage={followerCoverage} />
      <MetricCard label="الوصول" value={summary.reach.total} coverage={coverage(summary.reach)} />
      <MetricCard label="المشاهدات" value={summary.views.total} coverage={coverage(summary.views)} />
    </section>

    <section className="card cadence-card">
      <div><p className="eyebrow">إيقاع النشر ضمن الفترة</p><h2><span className="num">{metric(publishing.published)}</span> منشورة مقابل <span className="num">{metric(publishing.slots)}</span> فتحة</h2></div>
      <p className="muted">رقمان تشغيليان فقط؛ لا يقدّمان تقييمًا لجودة الالتزام.</p>
    </section>

    <section className="card chart-card stack">
      <div><h2>المتابعون عبر الزمن</h2><p className="muted">خط المتابعين هو لقطة يومية، وليس مجموعًا. إلغاء المتابعة غير متاح من Meta ويظهر كبيان غير متاح، لا كصفر.</p></div>
      <MetricLineChart title="منحنى المتابعين عبر الزمن" sourceTime={latestMeasured?.source_timestamp ?? null} series={[{ label: "المتابعون", points: daily.map((row) => ({ x: row.date, y: row.followers })) }, { label: "التغير اليومي", points: followerChanges }]} />
    </section>

    <section className="card chart-card stack">
      <div><h2>الوصول عبر الزمن</h2><p className="muted">وصول غير المتابعين سلسلة مستقلة كما تعيدها Meta؛ لا تُجمع مع الوصول ولا تُقسم عليه.</p></div>
      <MetricLineChart title="منحنى الوصول ووصول غير المتابعين" sourceTime={latestMeasured?.source_timestamp ?? null} series={[
        { label: "الوصول", points: daily.map((row) => ({ x: row.date, y: row.reach })) },
        { label: "وصول غير المتابعين", points: daily.map((row) => ({ x: row.date, y: row.reach_non_followers })) },
      ]} />
    </section>
    <MetricDefinitions />
  </div>;
}
