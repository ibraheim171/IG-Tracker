"use client";

import { useEffect, useState } from "react";
import { DataCoverage } from "./data-coverage";
import { MetricLineChart } from "./metric-line-chart";
import type { AccountFlowDailyInsight, AccountFlowSummary, AccountRangeMetric, AccountStockObservation, InsightRange } from "@/lib/insights";
import { reportMetricFormulas, type ValidReportContextBlock } from "@/lib/report-context";
import { AddToReportButton } from "./add-to-report-button";
import type { AccountStockChange } from "@/lib/account-pulse";
import { MetricDefinitions } from "./metric-definitions";

type AccountPayload = {
  range: InsightRange;
  daily: AccountFlowDailyInsight[];
  summary: AccountFlowSummary;
  stock: AccountStockObservation[];
  stock_changes: AccountStockChange[];
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

  const { daily, summary, stock, stock_changes: stockChanges, publishing } = state.payload;
  const latestMeasured = [...daily].reverse().find((row) => !row.missing_metrics.includes("day"));
  const latestStock = stock.at(-1) ?? null;
  const latestFollowers = [...stock].reverse().find((row) => row.followers_count !== null) ?? null;
  const latestMedia = [...stock].reverse().find((row) => row.media_count !== null) ?? null;
  const latestFollowerChange = [...stockChanges].reverse().find((row) => row.follower_change !== null) ?? null;
  const latestMediaChange = [...stockChanges].reverse().find((row) => row.media_count_change !== null) ?? null;
  const followerMeasured = stock.filter((row) => row.followers_count !== null).length;
  const mediaMeasured = stock.filter((row) => row.media_count !== null).length;
  const partialRange = summary.reach.measured_days < summary.reach.expected_days || summary.views.measured_days < summary.views.expected_days;
  const warnings: ValidReportContextBlock["snapshot"]["warnings"] = [
    ...(partialRange ? ["partial_range" as const] : []),
    ...(!stock.length || stock.some((row) => row.missing_metrics.length) ? ["incomplete_measurement" as const] : []),
  ];
  const completeDailySum = (value: AccountRangeMetric) => value.measured_days === value.expected_days ? value.daily_sum : null;
  const reportBlock: ValidReportContextBlock = { blockType: "account", title: "نبض الحساب", snapshot: {
    period: range,
    filters: {},
    metric: "account_overview",
    formula: reportMetricFormulas.account_overview,
    selection: [{ key: "instagram:aqsana2026", label: "حساب أقصانا" }],
    values: [
      { label: "المتابعون في آخر رصد", value: latestFollowers?.followers_count ?? null, measured_n: followerMeasured },
      { label: "عدد المواد في آخر رصد", value: latestMedia?.media_count ?? null, measured_n: mediaMeasured },
      { label: "التغير بين الرصدين للمتابعين", value: latestFollowerChange?.follower_change ?? null, measured_n: latestFollowerChange ? 2 : 0 },
      { label: "التغير بين الرصدين للمواد", value: latestMediaChange?.media_count_change ?? null, measured_n: latestMediaChange ? 2 : 0 },
      { label: "إجمالي الوصول للفترة المكتملة", value: completeDailySum(summary.reach), measured_n: summary.reach.measured_days },
      { label: "إجمالي المشاهدات للفترة المكتملة", value: completeDailySum(summary.views), measured_n: summary.views.measured_days },
      { label: "المواد المنشورة", value: publishing.published, measured_n: publishing.published === null ? 0 : 1 },
      { label: "فتحات النشر", value: publishing.slots, measured_n: publishing.slots === null ? 0 : 1 },
    ],
    series: [
      { key: "reach", label: "الوصول", points: daily.map((row) => ({ date: row.date, value: row.reach })) },
      { key: "reach_non_followers", label: "وصول غير المتابعين", points: daily.map((row) => ({ date: row.date, value: row.reach_non_followers })) },
    ],
    completeness: { measured_n: Math.min(summary.reach.measured_days, summary.views.measured_days), expected_n: summary.reach.expected_days },
    warnings,
    source_time: latestStock?.source_timestamp ?? latestMeasured?.source_timestamp ?? null,
    stock_observations: stock.map((row) => ({
      observation_key: row.observation_key,
      observed_at: row.observed_at,
      followers_count: row.followers_count,
      media_count: row.media_count,
      missing_metrics: row.missing_metrics,
      source_time: row.source_timestamp,
    })),
  } };
  return <div className="stack account-pulse">
    <div className="insight-section-actions"><AddToReportButton block={reportBlock} /></div>
    <section className="insight-card-grid account-pulse-grid" aria-label="ملخص نبض الحساب">
      <MetricCard label="المتابعون في آخر رصد" value={latestFollowers?.followers_count ?? null} coverage={{ measured: followerMeasured, expected: stock.length }} />
      <MetricCard label="عدد المواد في آخر رصد" value={latestMedia?.media_count ?? null} coverage={{ measured: mediaMeasured, expected: stock.length }} />
      <MetricCard label="التغير بين الرصدين للمتابعين" value={latestFollowerChange?.follower_change ?? null} coverage={{ measured: latestFollowerChange ? 2 : Math.min(followerMeasured, 2), expected: 2 }} />
      <MetricCard label="التغير بين الرصدين للمواد" value={latestMediaChange?.media_count_change ?? null} coverage={{ measured: latestMediaChange ? 2 : Math.min(mediaMeasured, 2), expected: 2 }} />
      <MetricCard label="مجموع الوصول اليومي المقاس" value={summary.reach.daily_sum} coverage={coverage(summary.reach)} />
      <MetricCard label="مجموع المشاهدات اليومية المقاسة" value={summary.views.daily_sum} coverage={coverage(summary.views)} />
    </section>

    <div className="muted">
      <p>وقت الرصد لأحدث قيمة متابعين: <span className="num">{latestFollowers?.observed_at ?? "—"}</span>.</p>
      <p>وقت الرصد لأحدث عدد مواد: <span className="num">{latestMedia?.observed_at ?? "—"}</span>.</p>
      <p>التغير بين الرصدين لا يمثل تغيرًا يوميًا ولا يُستكمل عبر الفجوات.</p>
    </div>

    <section className="card cadence-card">
      <div><p className="eyebrow">إيقاع النشر ضمن الفترة</p><h2><span className="num">{metric(publishing.published)}</span> منشورة مقابل <span className="num">{metric(publishing.slots)}</span> فتحة</h2></div>
      <p className="muted">رقمان تشغيليان فقط؛ لا يقدّمان تقييمًا لجودة الالتزام.</p>
    </section>

    <section className="card chart-card stack">
      <div><h2>رصيد الحساب</h2><p className="muted">كل نقطة رصد مستقل بوقت حقيقي. لا تُنسب إلى يوم تاريخي ولا تُستكمل بين الرصدات.</p></div>
      <MetricLineChart title="رصد المتابعين" sourceTime={latestStock?.source_timestamp ?? null} series={[{ label: "المتابعون", points: stock.map((row) => ({ x: row.observed_at, y: row.followers_count })) }, { label: "عدد المواد", points: stock.map((row) => ({ x: row.observed_at, y: row.media_count })) }]} />
    </section>

    <section className="card chart-card stack">
      <div><h2>التغير بين الرصدين</h2><p className="muted">يُحسب فقط بين رصدين يحملان القياس نفسه. أي فجوة تبقى —. Meta لا يزوّدنا حاليًا بعدد إلغاءات المتابعة كقياس مستقل.</p></div>
      <MetricLineChart title="التغير بين رصدات الحساب" sourceTime={latestStock?.source_timestamp ?? null} series={[{ label: "تغير المتابعين", points: stockChanges.map((row) => ({ x: row.observed_at, y: row.follower_change })) }, { label: "تغير عدد المواد", points: stockChanges.map((row) => ({ x: row.observed_at, y: row.media_count_change })) }]} />
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
