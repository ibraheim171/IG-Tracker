"use client";

import { useEffect, useState } from "react";
import { ReportContextList } from "./report-context-picker";
import { MonthlyReportDraft } from "./monthly-report-draft";

export type MonthlyReport = { id: string; month: string; title: string; context_note: string | null; body_md: string | null; created_at: string; updated_at: string };
type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; reports: MonthlyReport[] };

export function MonthlyReportWorkspace() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [title, setTitle] = useState("");
  const [contextNote, setContextNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch("/api/admin/monthly-reports", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "تعذر تحميل التقارير."); setState({ kind: "ready", reports: body.reports }); })
      .catch((caught) => { if (!controller.signal.aborted) setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر تحميل التقارير." }); });
    return () => controller.abort();
  }, [retry]);

  function selectReport(report: MonthlyReport) { setSelectedId(report.id); setMonth(report.month.slice(0, 7)); setTitle(report.title); setContextNote(report.context_note ?? ""); setMessage(""); }
  function newReport() { setSelectedId(null); setTitle(""); setContextNote(""); setMessage(""); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/monthly-reports", { method: selectedId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ reportId: selectedId, month: `${month}-01`, title, contextNote }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "تعذر حفظ التقرير.");
      setSelectedId(body.report.id); setMessage("تم حفظ مساحة التقرير."); setRetry((value) => value + 1);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "تعذر حفظ التقرير."); }
    finally { setBusy(false); }
  }

  const selected = state.kind === "ready" ? state.reports.find((report) => report.id === selectedId) ?? null : null;
  return <main className="page wide-page stack monthly-report-workspace">
    <header className="screen-head"><div><p className="eyebrow">سياق ومراجعة</p><h1>التقرير الشهري</h1><p className="muted">تجمع هنا المقاطع الرقمية التي تختارها من الإحصائيات قبل إعداد المسودة.</p></div><button className="button button-secondary" type="button" onClick={newReport}>تقرير جديد</button></header>
    {state.kind === "loading" ? <section className="card"><p aria-live="polite">جارٍ تحميل التقارير…</p></section> : null}
    {state.kind === "error" ? <section className="card stack" role="alert"><p className="error">{state.message}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></section> : null}
    {state.kind === "ready" ? <div className="monthly-report-layout"><aside className="card stack"><h2>التقارير</h2>{!state.reports.length ? <p className="muted">لا توجد تقارير شهرية بعد.</p> : <div className="monthly-report-list">{state.reports.map((report) => <button className={selectedId === report.id ? "is-active" : ""} type="button" onClick={() => selectReport(report)} key={report.id}><strong>{report.title}</strong><span className="num">{report.month.slice(0, 7)}</span></button>)}</div>}</aside>
      <section className="stack"><form className="card stack" onSubmit={save}><h2>{selectedId ? "بيانات التقرير" : "إنشاء تقرير"}</h2><label className="field">الشهر<input className="input num" type="month" required value={month} onChange={(event) => setMonth(event.target.value)} /></label><label className="field">العنوان<input className="input" required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field">السياق البشري<textarea className="input textarea" maxLength={4000} value={contextNote} onChange={(event) => setContextNote(event.target.value)} /></label><button className="button" type="submit" disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ مساحة التقرير"}</button>{message ? <p className={message.startsWith("تم") ? "notice" : "error"}>{message}</p> : null}</form>
      {selected ? <><ReportContextList reportId={selected.id} /><MonthlyReportDraft key={selected.id} reportId={selected.id} /></> : null}</section></div> : null}
  </main>;
}
