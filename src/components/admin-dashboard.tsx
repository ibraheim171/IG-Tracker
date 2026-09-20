"use client";

import { useEffect, useState } from "react";
import { ItemDrawer } from "@/components/item-drawer";
import { AnalyticsHealth } from "@/components/analytics-health";
import { AdminPeoplePanel } from "@/components/admin-people-panel";
import type { TeamMemberOption } from "@/lib/admin-create-item";
import type { AdminDashboardSnapshot, AdminDecisionKind } from "@/lib/admin-dashboard";
import type { RoleName } from "@/lib/ui-data";
import { formatHebronDateTime } from "@/lib/ui-data";
import { workflowLabel } from "@/lib/workflow-ui";

type Props = {
  currentUserId: string;
  roles: RoleName[];
  teamMembers: TeamMemberOption[];
  teamMembersLoadError: string | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; snapshot: AdminDashboardSnapshot };

const decisionLabels: Record<AdminDecisionKind, string> = {
  content_approval: "تحتاج اعتماد المحتوى",
  design_approval: "تحتاج اعتماد التصميم",
  ready_without_slot: "جاهزة بلا موعد نشر",
  slot_without_ready_item: "موعد بلا مادة جاهزة",
  overdue_unpublished: "تجاوزت موعد النشر",
  published_without_instagram_link: "منشورة وتحتاج ربطًا",
};

export function AdminDashboard({ currentUserId, roles, teamMembers, teamMembersLoadError }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch("/api/admin/dashboard", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "تعذر تحميل لوحة الأدمن.");
        setState({ kind: "ready", snapshot: body.snapshot });
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر تحميل لوحة الأدمن." });
      });
    return () => controller.abort();
  }, [retry]);

  return <main className="page wide-page stack admin-dashboard">
    <header className="screen-head">
      <div><p className="eyebrow">قرارات وتشغيل</p><h1>لوحة الأدمن</h1></div>
      {state.kind === "ready" ? <p className="muted">آخر تحديث: <span className="num">{formatHebronDateTime(state.snapshot.generated_at)}</span></p> : null}
    </header>
    {teamMembersLoadError ? <p className="notice">{teamMembersLoadError}</p> : null}
    {state.kind === "loading" ? <section className="card"><p aria-live="polite">جارٍ تحميل لوحة الأدمن…</p></section> : null}
    {state.kind === "error" ? <section className="card stack" role="alert"><p className="error">{state.message}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></section> : null}
    {state.kind === "ready" ? <>
      <section className="admin-week-grid" aria-label="هذا الأسبوع">
        <SummaryCard label="المواد المنشورة" value={state.snapshot.week.published} href="/insights?section=posts" />
        <SummaryCard label="الفتحات المتاحة" value={state.snapshot.week.available_slots} href="/schedule" />
        <SummaryCard label="الجاهزة للنشر" value={state.snapshot.week.ready} href="/ready" />
        <SummaryCard label="فتحات بلا مادة جاهزة" value={state.snapshot.week.uncovered_slots} href="/schedule" />
      </section>
      <section className="card stack">
        <div><h2>قائمة القرارات</h2><p className="muted">مواد ومواعيد تحتاج إجراءً حاليًا، مرتبة بحسب الموعد ثم مدة الانتظار.</p></div>
        {state.snapshot.decisions.length === 0 ? <p className="muted">لا توجد قرارات معلقة حاليًا.</p> : <div className="admin-decision-list">{state.snapshot.decisions.map((decision) => (
          <article className="admin-decision-row" key={decision.key}>
            <div className="stack compact-stack">
              <span className="pill">{decisionLabels[decision.kind]}</span>
              <h3>{decision.ref === "—" ? decision.title : `${decision.ref} — ${decision.title}`}</h3>
              <p className="muted">
                {decision.status ? `المرحلة: ${workflowLabel(decision.status)}` : "موعد نشر"}
                {decision.assignees.length ? ` · المسؤول: ${decision.assignees.join("، ")}` : ""}
                {decision.due_at ? ` · الموعد: ${formatHebronDateTime(decision.due_at)}` : ""}
                {decision.waiting_days ? ` · الانتظار: ${decision.waiting_days.toLocaleString("en-US")} يوم` : ""}
              </p>
            </div>
            {decision.item_id ? <button className="button button-secondary" type="button" onClick={() => setOpenItemId(decision.item_id)}>فتح المادة</button> : <a className="button button-secondary" href="/schedule">فتح خطة النشر</a>}
          </article>
        ))}</div>}
      </section>
      <section className="admin-timing-grid">
        <article className="card stack"><div><h2>المخطط والفعلي</h2><p className="muted">المواد التي نُشرت بعد موعدها المخطط، مع فرق الأيام فقط.</p></div>{state.snapshot.publication_delays.length ? <div className="table-wrap"><table><thead><tr><th>المادة</th><th>المخطط</th><th>الفعلي</th><th>الفرق</th></tr></thead><tbody>{state.snapshot.publication_delays.map((row) => <tr key={row.item_id}><td><button className="link-button" type="button" onClick={() => setOpenItemId(row.item_id)}>{row.ref} — {row.title}</button></td><td className="num">{formatHebronDateTime(row.planned_at)}</td><td className="num">{formatHebronDateTime(row.actual_at)}</td><td className="num">{row.delay_days.toLocaleString("en-US", { maximumFractionDigits: 1 })} يوم</td></tr>)}</tbody></table></div> : <p className="muted">لا توجد حالات تأخر مسجلة.</p>}</article>
        <article className="card stack"><div><h2>مدة المراحل</h2><p className="muted">وسيط الأيام المسجلة داخل كل مرحلة وN عدد الفترات المقاسة؛ لا ينسب سبب التأخير لشخص.</p></div>{state.snapshot.stage_durations.length ? <ul className="stage-duration-list">{state.snapshot.stage_durations.map((row) => <li key={row.status}><span>{workflowLabel(row.status)}</span><span><b className="num">{row.median_days.toLocaleString("en-US", { maximumFractionDigits: 1 })} يوم</b> · <span className="num">N={row.n.toLocaleString("en-US")}</span></span></li>)}</ul> : <p className="muted">لا توجد انتقالات كافية للحساب.</p>}</article>
      </section>
      <AdminPeoplePanel />
      <AnalyticsHealth />
    </> : null}
    <ItemDrawer
      itemId={openItemId}
      onClose={() => setOpenItemId(null)}
      onChanged={() => setRetry((value) => value + 1)}
      currentUserId={currentUserId}
      roles={roles}
      teamMembers={teamMembers}
      teamMembersLoadError={teamMembersLoadError}
    />
  </main>;
}

function SummaryCard({ label, value, href }: { label: string; value: number; href: string }) {
  return <a className="card insight-card summary-card-link" href={href}><span>{label}</span><strong className="num">{value.toLocaleString("en-US")}</strong></a>;
}
