"use client";

import { useState } from "react";
import { ReportContextPicker } from "@/components/reports/report-context-picker";
import type { ValidReportContextBlock } from "@/lib/report-context";
import type { AdvancedReportContextInput } from "@/lib/advanced-report-context";

type Report = { id: string; title: string; month: string };

type Props = { block: ValidReportContextBlock; advanced?: never } | { block?: never; advanced: AdvancedReportContextInput };

export function AddToReportButton(props: Props) {
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function openPicker() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/monthly-reports", { cache: "no-store", credentials: "same-origin" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "تعذر تحميل التقارير.");
      setReports(body.reports); setOpen(true);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "تعذر تحميل التقارير."); }
    finally { setBusy(false); }
  }
  return <div className="add-to-report"><button className="button button-secondary" type="button" disabled={busy} onClick={openPicker}>{busy ? "جارٍ التحميل…" : "أضف للتقرير"}</button>{message ? <span className={message.startsWith("تم") ? "muted" : "error"}>{message}</span> : null}{open ? <ReportContextPicker reports={reports} {...props} onClose={() => setOpen(false)} onAdded={() => { setOpen(false); setMessage("تمت إضافة المقطع للتقرير."); }} /> : null}</div>;
}
