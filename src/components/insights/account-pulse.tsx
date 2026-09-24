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
  const partialRange = summary.reach.measured_days < summary.reach.expected_days || summary.views.measured_days < summary.views.expected_days || summary.followers.full_period_change === null;
  const warnings: ValidReportContextBlock["snapshot"]["warnings"] = partialRange ? ["partial_range"] : [];
  const completeDailySum = (value: AccountRangeMetric) => value.measured_days === value.expected_days ? value.daily_sum : null;
  const reportBlock: ValidReportContextBlock = { blockType: "account", title: "نبض الحساب", snapshot: {
    period: range,
    filters: {},
    metric: "account_overview",
    formula: reportMetricFormulas.account_overview,
    selection: [{ key: "instagram:aqsana2026", label: "حساب أقصانا" }],
    values: [
      { label: "عدد المتابعين في آخر يوم مقاس", value: summary.followers.last_observed, measured_n: summary.followers.measured_days },
      { label: "التغير بين حدّي الفترة", value: summary.followers.full_period_change, measured_n: summary.followers.measured_days },
      { label: "إجمالي الوصول للفترة المكتملة", value: completeDailySum(summary.reach), measured_n: summary.reach.measured_days },
      { label: "إجمالي المشاهدات للفترة المكتملة", value: completeDailySum(summary.views), measured_n: summary.views.measured_days },
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
      <MetricCard label="عدد المتابعين في آخر يوم مقاس" value={summary.followers.last_observed} coverage={followerCoverage} />
      <MetricCard label="التغير بين حدّي الفترة" value={summary.followers.full_period_change} coverage={followerCoverage} />
      <MetricCard label="مجموع الوصول اليومي المقاس" value={summary.reach.daily_sum} coverage={coverage(summary.reach)} />
      <MetricCard label="مجموع المشاهدات اليومية المقاسة" value={summary.views.daily_sum} coverage={coverage(summary.views)} />
    </section>

    {summary.followers.full_period_change === null && summary.followers.observed_change !== null ? <p className="soft-banner">لا يمكن حساب تغير الفترة كاملة لأن أحد حدّيها غير مقاس. التغير بين أول وآخر يومين مقاسين (<span className="num">{summary.followers.first_observed_date}</span> — <span className="num">{summary.followers.last_observed_date}</span>) هو <b className="num">{metric(summary.followers.observed_change)}</b>.</p> : null}

    <section className="card cadence-card">
      <div><p className="eyebrow">إيقاع النشر ضمن الفترة</p><h2><span className="num">{metric(publishing.published)}</span> منشورة مقابل <span className="num">{metric(publishing.slots)}</span> فتحة</h2></div>
      <p className="muted">رقمان تشغيليان فقط؛ لا يقدّمان تقييمًا لجودة الالتزام.</p>
    </section>

    <section className="card chart-card stack">
      <div><h2>المتابعون عبر الزمن</h2><p className="muted">خط المتابعين هو لقطة يومية، وليس مجموعًا. إلغاء المتابعة غير متاح من Meta ويظهر كبيان غير متاح، لا كصفر.</p></div>
      <MetricLineChart title="رصيد المتابعين اليومي" sourceTime={latestMeasured?.source_timestamp ?? null} series={[{ label: "المتابعون", points: daily.map((row) => ({ x: row.date, y: row.followers })) }]} />
    </section>

    <section className="card chart-card stack">
      <div><h2>التغير اليومي في المتابعين</h2><p className="muted">يُحسب فقط بين يومين متتاليين مقاسين. أي فجوة تبقى —. Meta لا يزوّدنا حاليًا بعدد إلغاءات المتابعة كقياس مستقل.</p></div>
      <MetricLineChart title="التغير اليومي في رصيد المتابعين" sourceTime={latestMeasured?.source_timestamp ?? null} series={[{ label: "التغير اليومي", points: followerChanges }]} />
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
