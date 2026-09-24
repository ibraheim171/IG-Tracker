"use client";

import { useEffect, useMemo, useState } from "react";
import { hasReelsStructuralLimit, type ComparisonDimension, type ComparisonMetric, type ComparisonResult } from "@/lib/analytics-comparison";
import type { InsightRange } from "@/lib/insights";
import { ComparisonChart } from "./comparison-chart";
import { MetricDefinitions } from "./metric-definitions";
import { AddToReportButton } from "./add-to-report-button";
import { reportMetricFormulas, type ValidReportContextBlock } from "@/lib/report-context";
import { MetricLineChart } from "./metric-line-chart";
import { AdvancedComparison } from "./advanced-comparison";
import type { TeamMemberOption } from "@/lib/admin-create-item";
import type { RoleName } from "@/lib/ui-data";

type Option = { key: string; name: string };
type Options = Record<ComparisonDimension, Option[]>;
type TimelineEntry = { month: string; rows: ComparisonResult[] };
type LoadState = { kind: "idle" | "loading" } | { kind: "error"; message: string } | { kind: "ready"; rows: ComparisonResult[]; timeline: TimelineEntry[]; sourceTime: string | null };

const dimensions: Array<{ value: ComparisonDimension; label: string }> = [
  { value: "track", label: "المسار" },
  { value: "partner", label: "الشريك" },
  { value: "idea_type", label: "نوع الفكرة" },
  { value: "media_type", label: "نوع المحتوى" },
  { value: "person", label: "الشخص" },
];
const metrics: Array<{ value: ComparisonMetric; label: string }> = [
  { value: "reach_d7", label: "وسيط الوصول D7" },
  { value: "reach_d1", label: "وسيط الوصول D1" },
  { value: "reach_d30", label: "وسيط الوصول D30" },
  { value: "save_rate", label: "وسيط معدل الحفظ %" },
  { value: "share_rate", label: "وسيط معدل المشاركة %" },
  { value: "follow_rate", label: "وسيط معدل المتابعة %" },
  { value: "signal", label: "وسيط قوة الإشارة" },
  { value: "item_count", label: "عدد المواد" },
];

export function QuickComparisonBuilder({ range }: { range: InsightRange }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [dimension, setDimension] = useState<ComparisonDimension>("track");
  const [metric, setMetric] = useState<ComparisonMetric>("reach_d7");
  const [mediaType, setMediaType] = useState("");
  const [order, setOrder] = useState<"selection" | "desc" | "asc">("selection");
  const [view, setView] = useState<"bars" | "timeline">("bars");
  const [keys, setKeys] = useState<string[]>([]);
  const [state, setState] = useState<LoadState>({ kind: "idle" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/insights/compare?mode=options", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "تعذر تحميل عناصر المقارنة.");
        setOptions(body.options);
        setKeys((body.options.track as Option[]).slice(0, 2).map((option) => option.key));
      })
      .catch((caught) => { if (!controller.signal.aborted) setOptionsError(caught instanceof Error ? caught.message : "تعذر تحميل عناصر المقارنة."); });
    return () => controller.abort();
  }, []);

  const available = useMemo(() => options?.[dimension] ?? [], [options, dimension]);
  const query = useMemo(() => {
    if (keys.length < 2) return null;
    const params = new URLSearchParams({ dimension, metric, keys: keys.join(","), start: range.start, end: range.end });
    if (mediaType) params.set("media_type", mediaType);
    if (view === "timeline") params.set("view", "timeline");
    return params.toString();
  }, [dimension, keys, mediaType, metric, range, view]);

  useEffect(() => {
    if (!query) { setState({ kind: "idle" }); return; }
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch(`/api/insights/compare?${query}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "تعذر بناء المقارنة.");
        setState({ kind: "ready", rows: body.rows, timeline: body.timeline ?? [], sourceTime: body.source_time ?? null });
      })
      .catch((caught) => { if (!controller.signal.aborted) setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر بناء المقارنة." }); });
    return () => controller.abort();
  }, [query]);

  function changeDimension(next: ComparisonDimension) {
    setDimension(next);
    setKeys((options?.[next] ?? []).slice(0, 2).map((option) => option.key));
  }

  function toggleKey(key: string) {
    setKeys((current) => current.includes(key) ? current.filter((value) => value !== key) : current.length < 20 ? [...current, key] : current);
  }

  const metricLabel = metrics.find((entry) => entry.value === metric)?.label ?? metric;
  const reelsWarning = state.kind === "ready" && hasReelsStructuralLimit(metric, state.rows);
  const displayedRows = useMemo(() => {
    if (state.kind !== "ready") return [];
    const rows = [...state.rows];
    if (order === "selection") return rows.sort((left, right) => keys.indexOf(left.dimension_key) - keys.indexOf(right.dimension_key));
    return rows.sort((left, right) => {
      if (left.median_value === null) return 1;
      if (right.median_value === null) return -1;
      return order === "asc" ? left.median_value - right.median_value : right.median_value - left.median_value;
    });
  }, [keys, order, state]);
  const timelineSeries = useMemo(() => {
    if (state.kind !== "ready" || !state.timeline.length) return [];
    const identities = new Map<string, string>();
    for (const entry of state.timeline) for (const row of entry.rows) {
      const identity = `${row.dimension_key}:${row.participant_part ?? "all"}`;
      identities.set(identity, `${row.dimension_name}${row.participant_part ? ` — ${row.participant_part}` : ""}`);
    }
    return [...identities].map(([identity, label]) => ({
      label,
      points: state.timeline.map((entry) => {
        const row = entry.rows.find((candidate) => `${candidate.dimension_key}:${candidate.participant_part ?? "all"}` === identity);
        return { x: `${entry.month}-01`, y: row?.median_value ?? null };
      }),
    }));
  }, [state]);
  const reportBlock: ValidReportContextBlock | null = state.kind === "ready" && state.rows.length ? { blockType: "comparison", title: metricLabel, snapshot: {
    period: range,
    filters: { dimension, metric, media_type: mediaType || null, keys: keys.join(",") },
    metric,
    formula: reportMetricFormulas[metric],
    selection: keys.map((key) => ({ key: `${dimension}:${key}`, label: available.find((option) => option.key === key)?.name ?? key })),
    values: displayedRows.map((row) => ({ label: `${row.dimension_name}${row.participant_part ? ` — ${row.participant_part}` : ""}`, value: row.median_value, measured_n: row.measured_n, total_n: row.total_n })),
    series: timelineSeries.map((series, index) => ({ key: `comparison:${index + 1}`, label: series.label, points: series.points.map((point) => ({ date: point.x, value: point.y })) })),
    completeness: { measured_n: state.rows.reduce((sum, row) => sum + row.measured_n, 0), expected_n: state.rows.reduce((sum, row) => sum + row.total_n, 0) },
    warnings: [...(state.rows.some((row) => row.is_thin) ? ["small_sample" as const] : []), ...(reelsWarning ? ["reels_structural_limits" as const] : [])],
    source_time: state.sourceTime,
  } } : null;
  return <div className="stack comparison-builder">
    <section className="card stack">
      <div><h2>بناء مقارنة</h2><p className="muted">اختر محورًا ومقياسًا وعنصرين أو أكثر. تتحدث الأرقام تلقائيًا، مع إظهار حجم العينة دائمًا.</p></div>
      <div className="comparison-controls">
        <label className="field">المحور<select className="input" value={dimension} onChange={(event) => changeDimension(event.target.value as ComparisonDimension)}>{dimensions.map((entry) => <option value={entry.value} key={entry.value}>{entry.label}</option>)}</select></label>
        <label className="field">المقياس<select className="input" value={metric} onChange={(event) => setMetric(event.target.value as ComparisonMetric)}>{metrics.map((entry) => <option value={entry.value} key={entry.value}>{entry.label}</option>)}</select></label>
        <label className="field">نوع المحتوى<select className="input" value={mediaType} onChange={(event) => setMediaType(event.target.value)}><option value="">كل الأنواع</option><option value="IMAGE">صورة</option><option value="CAROUSEL_ALBUM">كاروسيل</option><option value="VIDEO">فيديو</option><option value="REELS">ريلز</option></select></label>
        <label className="field">ترتيب العرض<select className="input" value={order} onChange={(event) => setOrder(event.target.value as "selection" | "desc" | "asc")}><option value="selection">حسب الاختيار</option><option value="desc">القيمة تنازليًا</option><option value="asc">القيمة تصاعديًا</option></select></label>
        <label className="field">الرسم<select className="input" value={view} onChange={(event) => setView(event.target.value as "bars" | "timeline")}><option value="bars">أعمدة للفترة</option><option value="timeline">خط زمني شهري</option></select></label>
      </div>
      {optionsError ? <p className="error">{optionsError}</p> : null}
      {!options && !optionsError ? <p aria-live="polite">جارٍ تحميل العناصر…</p> : null}
      {options ? <fieldset><legend>العناصر — اختر من 2 إلى 20</legend><div className="comparison-options">{available.map((option) => <label className="comparison-option" key={option.key}><input type="checkbox" checked={keys.includes(option.key)} onChange={() => toggleKey(option.key)} /><span>{option.name}</span></label>)}</div></fieldset> : null}
    </section>

    {keys.length < 2 ? <p className="soft-banner">اختر عنصرين على الأقل لعرض المقارنة.</p> : null}
    {reelsWarning ? <p className="notice">بيانات ريلز ناقصة بنيويًا في المتابعة وزيارات الملف؛ لذلك قد يظهر المقياس «—» أو بعينة مقاسة أصغر.</p> : null}
    {state.kind === "loading" ? <section className="card"><p aria-live="polite">جارٍ حساب المقارنة…</p></section> : null}
    {state.kind === "error" ? <section className="card"><p className="error">{state.message}</p></section> : null}
    {state.kind === "ready" ? <section className="card stack"><div className="insight-result-head"><div><h2>{metricLabel}</h2><p className="muted">الفترة: <span className="num">{range.start}</span> — <span className="num">{range.end}</span></p></div>{reportBlock ? <AddToReportButton block={reportBlock} /> : null}</div>{view === "timeline" ? <><MetricLineChart title={`خط زمني شهري — ${metricLabel}`} sourceTime={state.sourceTime} series={timelineSeries} /><p className="muted">كل نقطة تمثل وسيط الشهر الظاهر. تفاصيل حجم العينة للفترة كاملة أدناه.</p></> : null}<ComparisonChart rows={displayedRows} metricLabel={metricLabel} /></section> : null}
    <MetricDefinitions />
  </div>;
}

export function ComparisonBuilder({ range, currentUserId, roles, teamMembers, teamMembersLoadError }: { range: InsightRange; currentUserId: string; roles: RoleName[]; teamMembers: TeamMemberOption[]; teamMembersLoadError: string | null }) {
  const [mode, setMode] = useState<"advanced" | "quick">("advanced");
  return <div className="stack"><div className="comparison-mode-switch" role="group" aria-label="نوع المقارنة"><button className={`button ${mode === "advanced" ? "" : "button-secondary"}`} type="button" onClick={() => setMode("advanced")}>المقارنة المتقدمة</button><button className={`button ${mode === "quick" ? "" : "button-secondary"}`} type="button" onClick={() => setMode("quick")}>المقارنة السريعة</button></div>{mode === "advanced" ? <AdvancedComparison range={range} currentUserId={currentUserId} roles={roles} teamMembers={teamMembers} teamMembersLoadError={teamMembersLoadError} /> : <QuickComparisonBuilder range={range} />}</div>;
}
