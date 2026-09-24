"use client";

import { useEffect, useState } from "react";
import type { AudienceSnapshot, AudienceValue } from "@/lib/account-pulse";
import { reportMetricFormulas, type ValidReportContextBlock } from "@/lib/report-context";
import { AddToReportButton } from "./add-to-report-button";
import { MetricDefinitions } from "./metric-definitions";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; snapshot: AudienceSnapshot };

function countryLabel(code: string) {
  try { return new Intl.DisplayNames(["ar"], { type: "region" }).of(code.toUpperCase()) ?? code; }
  catch { return code; }
}

function genderLabel(value: string) {
  const key = value.trim().toLowerCase();
  return key === "f" || key === "female" ? "نساء" : key === "m" || key === "male" ? "رجال" : key === "u" || key === "unknown" ? "غير محدد" : value;
}

function AudienceList({ rows, label, formatLabel = (value) => value }: { rows: AudienceValue[]; label: string; formatLabel?: (value: string) => string }) {
  const maximum = Math.max(...rows.flatMap((row) => row.value === null ? [] : [row.value]), 1);
  if (!rows.length) return <p className="muted">لا توجد بيانات متاحة لهذا البعد في أحدث لقطة.</p>;
  return <ol className="audience-list" aria-label={label}>{rows.map((row) => (
    <li key={row.key}>
      <div className="audience-row-label"><span>{formatLabel(row.key)}</span><strong className="num">{row.value === null ? "—" : row.value.toLocaleString("en-US")}</strong></div>
      {row.value === null ? <span className="audience-missing muted">قياس غير متاح</span> : <span className="audience-bar" aria-hidden="true"><i style={{ inlineSize: `${(row.value / maximum) * 100}%` }} /></span>}
    </li>
  ))}</ol>;
}

export function AudienceSnapshotView() {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch("/api/insights/audience", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "تعذر تحميل بيانات الجمهور.");
        setState({ kind: "ready", snapshot: body.snapshot });
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر تحميل بيانات الجمهور." });
      });
    return () => controller.abort();
  }, [retry]);

  if (state.kind === "loading") return <section className="card"><p aria-live="polite">جارٍ تحميل أحدث لقطة للجمهور…</p></section>;
  if (state.kind === "error") return <section className="card stack" role="alert"><p className="error">{state.message}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></section>;

  const snapshot = state.snapshot;
  const reportBlock: ValidReportContextBlock | null = snapshot.snapshot_date ? { blockType: "audience", title: "أحدث لقطة للجمهور", snapshot: {
    period: null,
    filters: { snapshot_date: snapshot.snapshot_date },
    metric: "audience_snapshot",
    formula: reportMetricFormulas.audience_snapshot,
    selection: [{ key: `snapshot:${snapshot.snapshot_date}`, label: `لقطة ${snapshot.snapshot_date}` }],
    values: [
      ...snapshot.countries.map((row) => ({ label: `دولة: ${countryLabel(row.key)}`, value: row.value, measured_n: row.value === null ? 0 : 1 })),
      ...snapshot.cities.map((row) => ({ label: `مدينة: ${row.key}`, value: row.value, measured_n: row.value === null ? 0 : 1 })),
      ...snapshot.ages.map((row) => ({ label: `عمر: ${row.key}`, value: row.value, measured_n: row.value === null ? 0 : 1 })),
      ...snapshot.genders.map((row) => ({ label: `جنس: ${genderLabel(row.key)}`, value: row.value, measured_n: row.value === null ? 0 : 1 })),
    ],
    series: [],
    completeness: null,
    warnings: ["meta_demographics_snapshot"],
    source_time: snapshot.source_time,
  } } : null;
  return <div className="stack audience-snapshot">
    <section className="soft-banner audience-warning">
      <strong>قيد مصدر البيانات</strong>
      <span>هذه لقطة تراكمية من Meta وليست قياسًا يوميًا دقيقًا. قد لا تُرجع Meta هذه البيانات إطلاقًا إذا كان عدد المتابعين أقل من 100 متابع.</span>
      <span>تاريخ أحدث لقطة: <b className="num">{snapshot.snapshot_date ?? "—"}</b></span>
    </section>
    {reportBlock ? <div className="insight-section-actions"><AddToReportButton block={reportBlock} /></div> : null}
    {!snapshot.snapshot_date ? <section className="card"><p className="muted">لا توجد لقطة جمهور متاحة حاليًا.</p></section> : <>
      <section className="audience-grid">
        <article className="card stack"><h2>أعلى 10 دول</h2><AudienceList rows={snapshot.countries} label="أعلى عشر دول" formatLabel={countryLabel} /></article>
        <article className="card stack"><h2>أعلى 10 مدن</h2><AudienceList rows={snapshot.cities} label="أعلى عشر مدن" /></article>
      </section>
      <section className="audience-grid audience-grid-secondary">
        <article className="card stack"><h2>الفئات العمرية</h2><AudienceList rows={snapshot.ages} label="الفئات العمرية" /></article>
        <article className="card stack"><h2>الجنس</h2><AudienceList rows={snapshot.genders} label="الجنس" formatLabel={genderLabel} /></article>
      </section>
    </>}
    <MetricDefinitions />
  </div>;
}
