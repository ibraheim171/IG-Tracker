"use client";

import { useEffect, useRef, useState } from "react";
import { displaySnapshotValue, type ValidReportContextBlock } from "@/lib/report-context";
import { restoreDialogFocus, trapDialogFocus } from "@/lib/dialog-focus";
import type { AdvancedReportContextInput } from "@/lib/advanced-report-context";
import { advancedReportDisplayRows, validateStoredAdvancedReportContextSnapshot } from "@/lib/advanced-report-context";

type Report = { id: string; title: string; month: string };

type PickerProps = { reports: Report[]; onClose: () => void; onAdded: () => void } & ({ block: ValidReportContextBlock; advanced?: never } | { block?: never; advanced: AdvancedReportContextInput });

export function ReportContextPicker({ reports, block, advanced, onClose, onAdded }: PickerProps) {
  const [reportId, setReportId] = useState(reports[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      trapDialogFocus(event, dialogRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", onKeyDown); restoreDialogFocus(opener); };
  }, []);
  async function add() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/reports/context-blocks", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(advanced ? { reportId, advanced } : { reportId, block }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر إضافة المقطع.");
      onAdded();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "تعذر إضافة المقطع."); }
    finally { setBusy(false); }
  }
  return <div className="veil" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="confirm-panel stack" role="dialog" aria-modal="true" aria-labelledby="report-picker-title" tabIndex={-1}>
    <div className="users-toolbar"><h2 id="report-picker-title">أضف للتقرير</h2><button ref={closeButtonRef} className="button button-secondary" type="button" onClick={onClose}>إغلاق</button></div>
    {!reports.length ? <p className="notice">أنشئ مساحة تقرير شهري أولًا من صفحة «التقرير الشهري».</p> : <label className="field">التقرير<select className="input" value={reportId} onChange={(event) => setReportId(event.target.value)}>{reports.map((report) => <option value={report.id} key={report.id}>{report.title} — {report.month.slice(0, 7)}</option>)}</select></label>}
    {advanced ? <div className="report-block-preview"><h3>معاينة المقطع</h3><p>{advanced.title}</p><p className="muted">D{advanced.request.checkpoint} · <span className="num">{advanced.request.cohorts[0].range.start} — {advanced.request.cohorts[0].range.end}</span> مقابل <span className="num">{advanced.request.cohorts[1].range.start} — {advanced.request.cohorts[1].range.end}</span></p><p className="muted">سيعيد الخادم حساب المقارنة ويتحقق من بصمتها قبل حفظ اللقطة.</p></div> : block ? <div className="report-block-preview"><h3>معاينة المقطع</h3><p>{block.title}</p><p className="muted">{block.snapshot.period ? <span className="num">{block.snapshot.period.start} — {block.snapshot.period.end}</span> : "أحدث لقطة متاحة"}</p><div className="table-wrap"><table><thead><tr><th>القيمة</th><th>الرقم</th><th>العينة</th></tr></thead><tbody>{block.snapshot.values.map((row) => <tr key={row.label}><td>{row.label}</td><td className="num">{displaySnapshotValue(row.value)}</td><td className="num">N={row.measured_n.toLocaleString("en-US")}</td></tr>)}</tbody></table></div></div> : null}
    {error ? <p className="error">{error}</p> : null}
    <button className="button" type="button" disabled={!reportId || busy} onClick={add}>{busy ? "جارٍ الإضافة…" : "تأكيد إضافة المقطع"}</button>
  </section></div>;
}

type StoredBlock = { id: string; report_id: string; block_type: string; title: string; input_snapshot: unknown; formula_version: string; position: number; created_at: string };

function storedRows(snapshot: unknown) {
  if (validateStoredAdvancedReportContextSnapshot(snapshot)) return advancedReportDisplayRows(snapshot).flatMap((row) => [{ label: `${row.label} — A`, value: row.cohortA, measured_n: row.aMeasuredN }, { label: `${row.label} — B`, value: row.cohortB, measured_n: row.bMeasuredN }]);
  const validation = snapshot && typeof snapshot === "object" && "values" in snapshot ? (snapshot as ValidReportContextBlock["snapshot"]) : null;
  return validation?.values ?? [];
}

export function ReportContextList({ reportId }: { reportId: string }) {
  const [blocks, setBlocks] = useState<StoredBlock[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setState("loading"); setMessage("");
    fetch(`/api/reports/context-blocks?report_id=${encodeURIComponent(reportId)}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "تعذر تحميل المقاطع."); setBlocks(body.blocks); setState("ready"); })
      .catch((caught) => { if (!controller.signal.aborted) { setMessage(caught instanceof Error ? caught.message : "تعذر تحميل المقاطع."); setState("error"); } });
    return () => controller.abort();
  }, [reportId, retry]);
  async function reorder(index: number, direction: -1 | 1) {
    const target = index + direction; if (target < 0 || target >= blocks.length) return;
    const next = [...blocks]; [next[index], next[target]] = [next[target], next[index]];
    const response = await fetch("/api/reports/context-blocks", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ reportId, order: next.map((block) => block.id) }) });
    const body = await response.json(); if (!response.ok) { setMessage(body.error || "تعذر ترتيب المقاطع."); return; }
    setBlocks(body.blocks); setMessage("");
  }
  async function remove(blockId: string) {
    const params = new URLSearchParams({ report_id: reportId, block_id: blockId });
    const response = await fetch(`/api/reports/context-blocks?${params}`, { method: "DELETE", credentials: "same-origin" });
    const body = await response.json(); if (!response.ok) { setMessage(body.error || "تعذر حذف المقطع."); return; }
    setBlocks((current) => current.filter((block) => block.id !== blockId)); setPendingDeleteId(null); setMessage("");
  }
  return <section className="card stack"><div><h2>مقاطع التقرير</h2><p className="muted">الترتيب هنا هو ترتيب السياق الذي سيُجهز للمسودة.</p></div>{state === "loading" ? <p aria-live="polite">جارٍ تحميل المقاطع…</p> : null}{state === "error" ? <p className="error">{message}</p> : null}{state === "error" ? <button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button> : null}{state === "ready" && !blocks.length ? <p className="muted">لم تُضف مقاطع بعد. افتح أي رسم أو مقارنة في الإحصائيات واضغط «أضف للتقرير».</p> : null}{state === "ready" ? <div className="report-context-list">{blocks.map((block, index) => <article key={block.id}><div><strong>{block.title}</strong><span className="muted">{block.block_type} · <span className="num">{block.formula_version}</span></span></div><details><summary>عرض الأرقام المحفوظة</summary><ul>{storedRows(block.input_snapshot).map((value) => <li key={value.label}><span>{value.label}</span><b className="num">{displaySnapshotValue(value.value)} · N={value.measured_n.toLocaleString("en-US")}</b></li>)}</ul></details><div className="actions-row"><button className="button button-secondary" type="button" disabled={index === 0} onClick={() => reorder(index, -1)}>للأعلى</button><button className="button button-secondary" type="button" disabled={index === blocks.length - 1} onClick={() => reorder(index, 1)}>للأسفل</button>{pendingDeleteId === block.id ? <><button className="button button-danger" type="button" onClick={() => remove(block.id)}>تأكيد الحذف</button><button className="button button-secondary" type="button" onClick={() => setPendingDeleteId(null)}>إلغاء</button></> : <button className="button button-secondary" type="button" onClick={() => setPendingDeleteId(block.id)}>حذف المقطع</button>}</div></article>)}</div> : null}{message && state === "ready" ? <p className="error">{message}</p> : null}</section>;
}
