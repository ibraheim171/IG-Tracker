"use client";

import { useEffect, useRef, useState } from "react";

type Draft = { id: string; output: string; created_at: string; approved_at: string | null; approved_by: string | null; model: string | null };

export function MonthlyReportDraft({ reportId }: { reportId: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  async function prepare() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/monthly-report-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", signal: controller.signal, body: JSON.stringify({ reportId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "تعذر تجهيز المسودة.");
      if (!controller.signal.aborted) setDraft(body.draft);
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "تعذر تجهيز المسودة."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="card stack monthly-draft"><div><h2>مدخل المسودة</h2><p className="muted">لا يبدأ هذا الإجراء تلقائيًا ولا ينشر شيئًا؛ يسجل نسخة ثابتة من المقاطع والسياق البشري.</p></div><button className="button" type="button" disabled={busy} onClick={prepare}>{busy ? "جارٍ التجهيز…" : "جهّز مسودة التقرير"}</button>{error ? <p className="error">{error}</p> : null}{draft ? <div className="stack"><p className="notice">مسودة آلية — تحتاج اعتمادًا</p><p className="muted">أُنشئت في <span className="num">{draft.created_at}</span> · الاعتماد: غير معتمد · المصدر الآلي: غير مهيأ</p><pre className="monthly-draft-output" dir="rtl">{draft.output}</pre></div> : null}</section>;
}
