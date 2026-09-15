"use client";

import { useEffect, useRef, useState } from "react";
import { currentWeekRange } from "@/lib/insights";
import { weeklyReportMaxBytes } from "@/lib/weekly-reports";

type Report = {
  id: string; title: string; period_start: string; period_end: string; original_filename: string;
  content_sha256: string; byte_size: number; created_at: string; published_at: string | null;
};
type ListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; reports: Report[] };

function latinDate(value: string) {
  return new Intl.DateTimeFormat("ar-PS", { dateStyle: "medium", timeZone: "Asia/Hebron", numberingSystem: "latn" }).format(new Date(value));
}

export function WeeklyReportsManager() {
  const defaultRange = currentWeekRange();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const mutationRef = useRef(false);
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [title, setTitle] = useState("");
  const [periodStart, setPeriodStart] = useState(defaultRange.start);
  const [periodEnd, setPeriodEnd] = useState(defaultRange.end);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Report | null>(null);
  const [editing, setEditing] = useState<Report | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch("/api/admin/weekly-reports", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "تعذر تحميل التقارير.");
        setState({ kind: "ready", reports: body.reports });
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر تحميل التقارير." });
      });
    return () => controller.abort();
  }, [retry]);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (uploadingRef.current || !file) return;
    setMessage(null);
    if (file.size > weeklyReportMaxBytes) {
      setMessage("يتجاوز الملف الحد الأقصى المسموح وهو 2 MiB.");
      return;
    }
    uploadingRef.current = true;
    setBusy(true);
    try {
      const query = new URLSearchParams({ title, period_start: periodStart, period_end: periodEnd, filename: file.name });
      const response = await fetch(`/api/admin/weekly-reports?${query}`, { method: "POST", headers: { "Content-Type": "text/html; charset=utf-8" }, body: file });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر رفع التقرير.");
      setRetry((value) => value + 1);
      setTitle("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setMessage("تم رفع التقرير بنجاح.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "تعذر رفع التقرير.");
    } finally {
      uploadingRef.current = false;
      setBusy(false);
    }
  }

  async function mutateReport(report: Report, action: "publish" | "unpublish" | "delete") {
    if (busy || mutationRef.current) return;
    if (action === "delete" && !window.confirm(`حذف التقرير «${report.title}» نهائيًا؟`)) return;
    mutationRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/weekly-reports/${report.id}`, {
        method: action === "delete" ? "DELETE" : "PATCH",
        headers: action === "delete" ? undefined : { "Content-Type": "application/json" },
        body: action === "delete" ? undefined : JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر تحديث التقرير.");
      if (selected?.id === report.id && (action === "delete" || action === "unpublish")) setSelected(null);
      setRetry((value) => value + 1);
      setMessage(action === "publish" ? "تم نشر التقرير للفريق." : action === "unpublish" ? "أعيد التقرير إلى المسودات." : "تم حذف التقرير.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "تعذر تحديث التقرير.");
    } finally {
      mutationRef.current = false;
      setBusy(false);
    }
  }

  function beginEdit(report: Report) {
    setEditing(report);
    setEditTitle(report.title);
    setEditStart(report.period_start);
    setEditEnd(report.period_end);
  }

  async function saveMetadata(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || busy || mutationRef.current) return;
    mutationRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/weekly-reports/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: editTitle, period_start: editStart, period_end: editEnd }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر حفظ بيانات التقرير.");
      setEditing(null);
      setRetry((value) => value + 1);
      setMessage("تم تحديث بيانات التقرير.");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "تعذر حفظ بيانات التقرير."); }
    finally { mutationRef.current = false; setBusy(false); }
  }

  return <main className="page wide-page stack">
    <header className="screen-head"><div><p className="eyebrow">للمدير فقط</p><h1>التقارير الأسبوعية</h1></div></header>
    <form className="card report-upload-form" onSubmit={upload}>
      <label className="field report-title-field">عنوان التقرير<input className="input" required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} /></label>
      <label className="field">بداية الفترة<input className="input num" type="date" required value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} disabled={busy} /></label>
      <label className="field">نهاية الفترة<input className="input num" type="date" required value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} disabled={busy} /></label>
      <label className="field report-file-field">ملف HTML<input ref={fileRef} className="input file-input" type="file" accept=".html,.htm,text/html" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={busy} /><span className="muted">ملف واحد بصيغة HTML أو HTM، بحد أقصى 2 MiB.</span></label>
      <button className="button" type="submit" disabled={busy || !file}>{busy ? "جارٍ الرفع…" : "رفع التقرير"}</button>
      {message ? <p className={message.startsWith("تم ") ? "notice" : "error"} role="status">{message}</p> : null}
    </form>

    <section className="card stack">
      <h2>التقارير المحفوظة</h2>
      {state.kind === "loading" ? <p aria-live="polite">جارٍ تحميل التقارير…</p> : null}
      {state.kind === "error" ? <div className="stack" role="alert"><p className="error">{state.message}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></div> : null}
      {state.kind === "ready" && state.reports.length === 0 ? <p className="muted">لا توجد تقارير أسبوعية محفوظة بعد.</p> : null}
      {state.kind === "ready" && state.reports.length > 0 ? <div className="report-list">{state.reports.map((report) => <article className="report-row" key={report.id}>
        <div><h3>{report.title}</h3><p className="muted"><span className="num">{report.period_start}</span> – <span className="num">{report.period_end}</span></p><p className="muted">أُضيف في <span className="num">{latinDate(report.created_at)}</span> · <span className="num">{report.byte_size.toLocaleString("en-US")}</span> بايت · {report.published_at ? "منشور للفريق" : "مسودة للمدير"}</p></div>
        <div className="actions-row"><button className="button button-secondary" type="button" disabled={busy} onClick={() => setSelected(report)}>فتح داخل الموقع</button><a className="button report-download" href={`/api/admin/weekly-reports/${report.id}/download`}>تنزيل الملف الأصلي</a><button className="button button-secondary" type="button" disabled={busy} onClick={() => beginEdit(report)}>تعديل البيانات</button><button className="button" type="button" disabled={busy} onClick={() => mutateReport(report, report.published_at ? "unpublish" : "publish")}>{report.published_at ? "إلغاء النشر" : "نشر للفريق"}</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => mutateReport(report, "delete")}>حذف</button></div>
        {editing?.id === report.id ? <form className="report-edit-grid" onSubmit={saveMetadata}><label className="field">العنوان<input className="input" required maxLength={160} disabled={busy} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label><label className="field">بداية الفترة<input className="input num" type="date" required disabled={busy} value={editStart} onChange={(event) => setEditStart(event.target.value)} /></label><label className="field">نهاية الفترة<input className="input num" type="date" required disabled={busy} value={editEnd} onChange={(event) => setEditEnd(event.target.value)} /></label><div className="actions-row"><button className="button" type="submit" disabled={busy}>حفظ البيانات</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>إلغاء</button></div></form> : null}
      </article>)}</div> : null}
    </section>

    {selected ? <section className="card stack report-preview-section">
      <div className="users-toolbar"><div><h2>{selected.title}</h2><p className="muted">معاينة آمنة داخل الموقع</p></div><button className="button button-secondary" type="button" onClick={() => setSelected(null)}>إغلاق المعاينة</button></div>
      <iframe className="report-preview" sandbox="" title={`معاينة التقرير: ${selected.title}`} src={`/api/admin/weekly-reports/${selected.id}/preview`} />
    </section> : null}
  </main>;
}
