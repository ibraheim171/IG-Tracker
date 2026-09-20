"use client";

import { useEffect, useState } from "react";
import type { ComparisonMetric, ComparisonResult } from "@/lib/analytics-comparison";
import { workflowLabel } from "@/lib/workflow-ui";

type Person = {
  id: string;
  display_name: string;
  roles: string[];
  stage_counts: Array<{ part: string; status: string; count: number }>;
  participation_totals: Array<{ part: string; count: number }>;
  metrics: Array<{ metric: ComparisonMetric; row: ComparisonResult }>;
};
type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; people: Person[]; period: { start: string; end: string } | null };
const partLabels: Record<string, string> = { writer: "الكتابة", producer: "الإنتاج", reviewer: "المراجعة" };
const metricLabels: Partial<Record<ComparisonMetric, string>> = { save_rate: "وسيط الحفظ %", share_rate: "وسيط المشاركة %", follow_rate: "وسيط المتابعة %", signal: "وسيط قوة الإشارة" };

function metric(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function AdminPeoplePanel() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch("/api/admin/people-analytics", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "تعذر تحميل لوحة الأشخاص.");
        setState({ kind: "ready", people: body.people, period: body.period });
      })
      .catch((caught) => { if (!controller.signal.aborted) setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر تحميل لوحة الأشخاص." }); });
    return () => controller.abort();
  }, [retry]);

  if (state.kind === "loading") return <section className="card"><p aria-live="polite">جارٍ تحميل لوحة الأشخاص…</p></section>;
  if (state.kind === "error") return <section className="card stack" role="alert"><p className="error">{state.message}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></section>;
  const hasPartialReels = state.people.some((person) => person.metrics.some(({ row }) => row.has_partial_reels));
  return <section className="card stack admin-people-panel">
    <div><h2>لوحة الأشخاص</h2><p className="muted">حقائق إدارية خاصة بالأدمن: المشاركات التاريخية، والمواد النشطة، ووسيط المقاييس حسب نوع المشاركة خلال آخر 12 شهرًا. لا تنسب هذه الأرقام السببية لشخص بعينه.</p>{state.period ? <p className="muted num">{state.period.start} — {state.period.end}</p> : null}</div>
    {hasPartialReels ? <p className="notice">بيانات ريلز ناقصة بنيويًا في المتابعة وزيارات الملف؛ لذلك قد يكون وسيط قوة الإشارة أو حجم العينة المقاسة ناقصًا.</p> : null}
    {!state.people.length ? <p className="muted">لا يوجد أعضاء نشطون.</p> : <div className="people-grid">{state.people.map((person) => <article className="people-card" key={person.id}>
      <h3>{person.display_name}</h3>
      <div className="people-facts"><h4>إجمالي المشاركات التاريخية حسب الدور</h4>{!person.participation_totals.length ? <p className="muted">لا توجد مشاركات مسجلة.</p> : <ul>{person.participation_totals.map((row) => <li key={row.part}><span>{partLabels[row.part] ?? row.part}</span><b className="num">{row.count.toLocaleString("en-US")}</b></li>)}</ul>}</div>
      <div className="people-facts"><h4>المواد النشطة حسب المرحلة والدور</h4>{!person.stage_counts.length ? <p className="muted">لا توجد مواد نشطة.</p> : <ul>{person.stage_counts.map((row) => <li key={`${row.part}-${row.status}`}><span>{partLabels[row.part] ?? row.part} · {workflowLabel(row.status as Parameters<typeof workflowLabel>[0])}</span><b className="num">{row.count.toLocaleString("en-US")}</b></li>)}</ul>}</div>
      <div className="people-facts"><h4>وسيط المقاييس حسب نوع المشاركة</h4>{!person.metrics.length ? <p className="muted">لا توجد قياسات متاحة.</p> : <ul>{person.metrics.map(({ metric: metricKey, row }) => <li key={`${metricKey}-${row.participant_part ?? "all"}`}><span>{metricLabels[metricKey] ?? metricKey} · {partLabels[row.participant_part ?? ""] ?? row.participant_part ?? "المشاركة"}{row.is_thin ? " · عيّنة صغيرة" : ""}</span><span><b className="num">{metric(row.median_value)}</b> · <span className="num">N={row.measured_n.toLocaleString("en-US")}</span></span></li>)}</ul>}</div>
    </article>)}</div>}
  </section>;
}
