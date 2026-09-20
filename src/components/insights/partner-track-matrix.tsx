"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { hasReelsStructuralLimit, type ComparisonMetric, type ComparisonResult } from "@/lib/analytics-comparison";
import type { InsightRange } from "@/lib/insights";
import { buildPartnerTrackMatrix, type MatrixPartner, type MatrixTrack } from "@/lib/partner-track-matrix";
import { MetricDefinitions } from "./metric-definitions";
import { AddToReportButton } from "./add-to-report-button";
import { reportMetricFormulas, type ValidReportContextBlock } from "@/lib/report-context";

type HistoryRow = {
  id: string; ref: string | null; title: string | null; published_at: string | null; track_name: string | null;
  media_type: string | null; product_type: string | null; reach: number | null; save_rate: number | null;
  share_rate: number | null; follow_rate: number | null; signal: number | null; missing_metrics: string[] | null; signal_partial: boolean | null;
};
type Payload = { partners: MatrixPartner[]; tracks: MatrixTrack[]; rows: ComparisonResult[]; history: HistoryRow[]; source_time: string | null };
type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; payload: Payload };

const metrics: Array<{ value: ComparisonMetric; label: string }> = [
  { value: "signal", label: "وسيط قوة الإشارة" },
  { value: "reach_d7", label: "وسيط الوصول D7" },
  { value: "save_rate", label: "وسيط معدل الحفظ %" },
  { value: "share_rate", label: "وسيط معدل المشاركة %" },
  { value: "follow_rate", label: "وسيط معدل المتابعة %" },
  { value: "item_count", label: "عدد المواد" },
];

function metric(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function PartnerTrackMatrix({ range }: { range: InsightRange }) {
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<ComparisonMetric>("signal");
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ start: range.start, end: range.end, metric: selectedMetric });
    if (selectedPartner) params.set("partner_id", selectedPartner);
    setState({ kind: "loading" });
    fetch(`/api/insights/partner-track?${params}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "تعذر تحميل المصفوفة.");
        setState({ kind: "ready", payload: body });
        if (!selectedPartner && body.partners[0]?.partner_id) setSelectedPartner(body.partners[0].partner_id);
      })
      .catch((caught) => { if (!controller.signal.aborted) setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر تحميل المصفوفة." }); });
    return () => controller.abort();
  }, [range, retry, selectedMetric, selectedPartner]);

  const matrix = useMemo(() => state.kind === "ready" ? buildPartnerTrackMatrix(state.payload.partners, state.payload.tracks, state.payload.rows) : null, [state]);
  const metricLabel = metrics.find((entry) => entry.value === selectedMetric)?.label ?? selectedMetric;
  if (state.kind === "loading") return <section className="card"><p aria-live="polite">جارٍ تحميل مصفوفة الشركاء والمسارات…</p></section>;
  if (state.kind === "error") return <section className="card stack" role="alert"><p className="error">{state.message}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></section>;
  if (!matrix || !matrix.partners.length || !matrix.tracks.length) return <section className="card"><p className="muted">لا توجد مواد مرتبطة بشركاء ومسارات ضمن هذه الفترة.</p></section>;
  const reelsWarning = hasReelsStructuralLimit(selectedMetric, state.payload.rows);
  const reportBlock: ValidReportContextBlock = { blockType: "partner_track", title: `الشركاء × المسارات — ${metricLabel}`, snapshot: {
    period: range,
    filters: { metric: selectedMetric },
    metric: selectedMetric,
    formula: reportMetricFormulas[selectedMetric],
    selection: state.payload.rows.map((row) => ({ key: `partner_track:${row.dimension_key}`, label: row.dimension_name })),
    values: state.payload.rows.map((row) => ({ label: row.dimension_name, value: row.median_value, measured_n: row.measured_n, total_n: row.total_n })),
    series: [],
    completeness: { measured_n: state.payload.rows.reduce((sum, row) => sum + row.measured_n, 0), expected_n: state.payload.rows.reduce((sum, row) => sum + row.total_n, 0) },
    warnings: [...(state.payload.rows.some((row) => row.is_thin) ? ["small_sample" as const] : []), ...(state.payload.rows.some((row) => row.has_partial_reels) ? ["reels_structural_limits" as const] : [])],
    source_time: state.payload.source_time,
  } };

  return <div className="stack partner-track-view">
    <section className="card stack">
      <div className="matrix-head"><div><h2>الشركاء × المسارات</h2><p className="muted">اللون يرمز إلى مقدار {metricLabel} فقط. الخانة الفارغة تعني عدم وجود قياس، وليست صفرًا.</p></div><label className="field">المقياس<select className="input" value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value as ComparisonMetric)}>{metrics.map((entry) => <option value={entry.value} key={entry.value}>{entry.label}</option>)}</select></label></div>
      {reelsWarning ? <p className="notice">بيانات ريلز ناقصة بنيويًا في المتابعة وزيارات الملف؛ لذلك قد يكون وسيط قوة الإشارة أو حجم العينة المقاسة ناقصًا.</p> : null}
      <div className="insight-section-actions"><AddToReportButton block={reportBlock} /></div>
      <div className="table-wrap"><table className="partner-track-table"><thead><tr><th>الشريك</th>{matrix.tracks.map((track) => <th key={track.track_id}>{track.name}</th>)}</tr></thead><tbody>
        {matrix.partners.map((partner) => <tr key={partner.partner_id}><th><button className={selectedPartner === partner.partner_id ? "matrix-partner is-active" : "matrix-partner"} type="button" onClick={() => setSelectedPartner(partner.partner_id)}>{partner.name}</button></th>{matrix.tracks.map((track) => {
          const cell = matrix.cells.get(`${partner.partner_id}:${track.track_id}`)!;
          const intensity = cell.value === null ? 0 : Math.abs(cell.value) / matrix.maximum;
          return <td className={`matrix-cell${cell.value === null ? " is-empty" : ""}${cell.is_thin ? " is-thin" : ""}`} style={{ "--matrix-intensity": intensity } as CSSProperties} key={track.track_id}><strong className="num">{metric(cell.value)}</strong><small className="num">N={cell.measured_n.toLocaleString("en-US")}</small>{cell.is_thin ? <small>عيّنة صغيرة</small> : null}</td>;
        })}</tr>)}
      </tbody></table></div>
    </section>

    <section className="card stack">
      <div><h2>سجل التعاون</h2><p className="muted">القياسات مرتبة زمنيًا للشريك المحدد، وتظهر كما وردت دون استنتاج اتجاه.</p></div>
      {!state.payload.history.length ? <p className="muted">لا توجد قياسات منشورات لهذا الشريك ضمن الفترة.</p> : <div className="collaboration-history">{state.payload.history.map((row) => <article key={row.id}><div><strong>{row.ref ? `${row.ref} — ` : ""}{row.title ?? "مادة بلا عنوان"}</strong><span className="muted num">{row.published_at?.slice(0, 10) ?? "—"}</span></div><dl><div><dt>المسار</dt><dd>{row.track_name ?? "—"}</dd></div><div><dt>الوصول</dt><dd className="num">{metric(row.reach)}</dd></div><div><dt>الحفظ %</dt><dd className="num">{metric(row.save_rate)}</dd></div><div><dt>المشاركة %</dt><dd className="num">{metric(row.share_rate)}</dd></div><div><dt>المتابعة %</dt><dd className="num">{metric(row.follow_rate)}</dd></div><div><dt>الإشارة</dt><dd className="num">{metric(row.signal)}</dd></div></dl>{row.signal_partial ? <span className="metric-flag">قياس ناقص</span> : null}</article>)}</div>}
    </section>
    <MetricDefinitions />
  </div>;
}
