"use client";

import { useEffect, useState } from "react";

type Report = { id: string; title: string; period_start: string; period_end: string; original_filename: string; byte_size: number; created_at: string; published_at: string | null };
type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; reports: Report[] };

export function WeeklyReportsLibrary() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Report | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch("/api/reports", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "تعذر تحميل التقارير المنشورة.");
        setState({ kind: "ready", reports: body.reports });
      })
      .catch((caught) => { if (!controller.signal.aborted) setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر تحميل التقارير المنشورة." }); });
    return () => controller.abort();
  }, [retry]);
  return <main className="page wide-page stack">
    <header className="screen-head"><div><p className="eyebrow">تقارير معتمدة</p><h1>التقارير الأسبوعية</h1></div></header>
    {state.kind === "loading" ? <section className="card" aria-live="polite">جارٍ تحميل التقارير المنشورة…</section> : null}
    {state.kind === "error" ? <section className="card stack" role="alert"><p className="error">{state.message}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></section> : null}
    {state.kind === "ready" && state.reports.length === 0 ? <section className="card"><p className="muted">لا توجد تقارير منشورة بعد.</p></section> : null}
    {state.kind === "ready" && state.reports.length > 0 ? <section className="card report-list">{state.reports.map((report) => <article className="report-row" key={report.id}>
      <div><h2>{report.title}</h2><p className="muted"><span className="num">{report.period_start}</span> – <span className="num">{report.period_end}</span></p></div>
      <div className="actions-row"><button className="button button-secondary" type="button" onClick={() => setSelected(report)}>فتح داخل الموقع</button><a className="button report-download" href={`/api/reports/${report.id}/download`}>تنزيل الملف الأصلي</a></div>
    </article>)}</section> : null}
    {selected ? <section className="card stack report-preview-section"><div className="users-toolbar"><h2>{selected.title}</h2><button className="button button-secondary" type="button" onClick={() => setSelected(null)}>إغلاق المعاينة</button></div><iframe className="report-preview" sandbox="" title={`معاينة التقرير: ${selected.title}`} src={`/api/reports/${selected.id}/preview`} /></section> : null}
  </main>;
}
