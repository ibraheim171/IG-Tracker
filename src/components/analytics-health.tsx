"use client";

import { useEffect, useState } from "react";
import { AnalyticsLinkReview } from "@/components/analytics-link-review";
import { formatHebronDateTime } from "@/lib/ui-data";
import { summarizeAnalyticsFreshness, summarizeSyncHealth, type AnalyticsFreshnessStatus, type AnalyticsStreamDates } from "@/lib/analytics-health-state";

type SyncRun = {
  id: string;
  source_timestamp: string;
  received_at: string;
  status: string;
  received_count: number;
  inserted_count: number;
  updated_count: number;
  already_present_identical_count: number;
  rejected_count: number;
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; runs: SyncRun[]; streams: AnalyticsStreamDates };

const freshnessLabels: Record<AnalyticsFreshnessStatus, string> = {
  fresh: "حديثة",
  stale: "متأخرة",
  never_collected: "لم تُجمع",
  not_due: "غير مستحقة بعد",
};

export function AnalyticsHealth() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/analytics-health", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "تعذر تحميل صحة البيانات.");
        setState({ kind: "ready", runs: body.runs, streams: body.streams });
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر تحميل صحة البيانات." });
      });
    return () => controller.abort();
  }, [retry]);

  const health = state.kind === "ready" ? summarizeSyncHealth(state.runs, new Date().toISOString()) : null;
  const freshness = state.kind === "ready" ? summarizeAnalyticsFreshness(state.streams, new Date().toISOString()) : null;
  const latest = health?.latest ?? null;
  const latestAccepted = health?.latestAccepted ?? null;
  return <section className="stack analytics-health" aria-labelledby="analytics-health-title">
    <section className="card stack">
      <div><h2 id="analytics-health-title">سلامة البيانات والربط</h2><p className="muted">حالة مزامنة Instagram ومهام الربط الفعلية.</p></div>
      {state.kind === "loading" ? <p aria-live="polite">جارٍ تحميل سجل المزامنة…</p> : null}
      {state.kind === "error" ? <div className="stack" role="alert"><p className="error">{state.message}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></div> : null}
      {state.kind === "ready" && !latest ? <p className="muted">لا توجد عمليات مزامنة مسجلة.</p> : null}
      {health?.latestFailed ? <p className="notice">آخر محاولة مزامنة لم تُقبل. تبقى أدناه آخر قراءة ناجحة بدل استبدالها بصفر.</p> : null}
      {freshness ? <div className="admin-sync-summary">
        {([
          ["المنشورات", freshness.posts],
          ["مقاييس الحساب اليومية", freshness.account],
          ["الجمهور", freshness.audience],
        ] as const).map(([label, stream]) => <div key={label}>
          <span className="muted">{label}</span>
          <strong>{freshnessLabels[stream.status]}</strong>
          <span className="num muted">{stream.latestDate ?? "—"}</span>
        </div>)}
      </div> : null}
      {freshness ? <p className="muted">رصيد المتابعين وعدد المواد غير متاحين ضمن هذا القياس، ولا تُنسب قراءة حالية إلى يوم تاريخي.</p> : null}
      {latestAccepted ? <div className="admin-sync-summary"><div><span className="muted">آخر طلب مزامنة مقبول</span><strong className="num">{formatHebronDateTime(latestAccepted.source_timestamp)}</strong></div><div><span className="muted">وقت الاستلام</span><strong className="num">{formatHebronDateTime(latestAccepted.received_at)}</strong></div></div> : latest ? <p className="muted">لا توجد مزامنة ناجحة مسجلة بعد.</p> : null}
      {state.kind === "ready" && state.runs.length ? <details><summary>سجل المزامنة</summary><div className="table-wrap"><table><thead><tr><th>وقت المصدر</th><th>الحالة</th><th>المستلم</th><th>الجديد</th><th>المحدّث</th><th>الموجود</th><th>المرفوض</th></tr></thead><tbody>{state.runs.map((run) => <tr key={run.id}><td className="num">{formatHebronDateTime(run.source_timestamp)}</td><td>{run.status === "accepted" ? "مقبولة" : "قيد المعالجة"}</td><td className="num">{run.received_count.toLocaleString("en-US")}</td><td className="num">{run.inserted_count.toLocaleString("en-US")}</td><td className="num">{run.updated_count.toLocaleString("en-US")}</td><td className="num">{run.already_present_identical_count.toLocaleString("en-US")}</td><td className="num">{run.rejected_count.toLocaleString("en-US")}</td></tr>)}</tbody></table></div></details> : null}
    </section>
    <AnalyticsLinkReview />
  </section>;
}
