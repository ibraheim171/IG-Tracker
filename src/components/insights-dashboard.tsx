"use client";

import { useEffect, useState } from "react";
import type { InsightRange, InsightsSnapshot } from "@/lib/insights";
import { workflowLabel } from "@/lib/workflow-ui";

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; snapshot: InsightsSnapshot };

function number(value: number) {
  return value.toLocaleString("en-US");
}

function metric(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ar-PS", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Hebron", numberingSystem: "latn",
  }).format(new Date(value));
}

export function InsightsDashboard({ initialRange }: { initialRange: InsightRange }) {
  const [draft, setDraft] = useState(initialRange);
  const [range, setRange] = useState(initialRange);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch(`/api/insights?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`, {
      cache: "no-store", signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "تعذر تحميل الإحصائيات.");
        setState({ kind: "ready", snapshot: body.snapshot });
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر تحميل الإحصائيات." });
      });
    return () => controller.abort();
  }, [range, retry]);

  function applyRange(event: React.FormEvent) {
    event.preventDefault();
    setRange(draft);
  }

  return (
    <main className="page wide-page stack">
      <header className="screen-head">
        <div><p className="eyebrow">متابعة تشغيلية</p><h1>الإحصائيات</h1></div>
      </header>

      <form className="card range-filter" onSubmit={applyRange}>
        <label className="field">من<input className="input num" type="date" required value={draft.start} onChange={(event) => setDraft((current) => ({ ...current, start: event.target.value }))} /></label>
        <label className="field">إلى<input className="input num" type="date" required value={draft.end} onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value }))} /></label>
        <button className="button" type="submit" disabled={state.kind === "loading"}>تطبيق النطاق</button>
      </form>

      {state.kind === "loading" ? <section className="card" aria-live="polite"><p>جارٍ تحميل الإحصائيات…</p></section> : null}
      {state.kind === "error" ? <section className="card stack" role="alert"><p className="error">{state.message}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></section> : null}
      {state.kind === "ready" ? <InsightsContent snapshot={state.snapshot} /> : null}
    </main>
  );
}

function InsightsContent({ snapshot }: { snapshot: InsightsSnapshot }) {
  const hasAnyData = snapshot.total_active > 0
    || snapshot.published_in_period > 0
    || snapshot.overdue > 0
    || snapshot.blocked > 0
    || snapshot.upcoming_slots.length > 0
    || snapshot.partners.length > 0;
  const cards = [
    ["إجمالي المواد النشطة", snapshot.total_active],
    ["نُشرت خلال الفترة", snapshot.published_in_period],
    ["جاهزة للنشر", snapshot.ready],
    ["تجاوزت موعد النشر", snapshot.overdue],
    ["بانتظار إجراء", snapshot.blocked],
    ["مواد منشورة مرتبطة بشركاء", snapshot.partner_linked_materials],
    ["شركاء نشطون في الفترة", snapshot.active_partners],
  ] as const;
  return <>
    {!hasAnyData ? <p className="soft-banner">لا توجد بيانات تشغيلية ضمن النطاق المحدد.</p> : null}
    <section className="insight-card-grid" aria-label="المؤشرات التشغيلية">
      {cards.map(([label, value]) => <article className="card insight-card" key={label}><span>{label}</span><strong className="num">{number(value)}</strong></article>)}
    </section>

    <section className="card stack">
      <h2>المواد حسب مرحلة العمل</h2>
      <div className="status-count-grid">
        {snapshot.by_status.map((row) => <div key={row.status}><span>{workflowLabel(row.status)}</span><strong className="num">{number(row.count)}</strong></div>)}
      </div>
    </section>

    <section className="card stack">
      <h2>مواعيد النشر القادمة ضمن النطاق</h2>
      {snapshot.upcoming_slots.length === 0 ? <p className="muted">لا توجد مواعيد نشر قادمة ضمن النطاق المحدد.</p> : <div className="table-wrap"><table><thead><tr><th>موعد النشر</th><th>الحالة</th><th>المواد</th><th>الجاهزة</th></tr></thead><tbody>
        {snapshot.upcoming_slots.map((slot) => <tr key={slot.slot_id}><td className="num">{dateTime(slot.slot_at)}</td><td>{slot.state ?? "—"}</td><td className="num">{number(slot.n_items)}</td><td className="num">{number(slot.n_ready)}</td></tr>)}
      </tbody></table></div>}
    </section>

    <section className="card stack">
      <div><h2>أداء الشركاء</h2><p className="muted">النشاط المنشور محسوب للفترة المحددة، وحجم العيّنة ومؤشرات الأداء من السجل الحقيقي حسب المسار.</p></div>
      {snapshot.partners.length === 0 ? <p className="muted">لا توجد بيانات شراكات متاحة.</p> : <div className="table-wrap"><table className="partner-table"><thead><tr><th>الشريك</th><th>المسار</th><th>حجم العيّنة</th><th>منشور خلال الفترة</th><th>وسيط الوصول</th><th>وسيط الإشارة</th></tr></thead><tbody>
        {snapshot.partners.map((row) => <tr key={`${row.partner_id}-${row.track_id}`}><td>{row.partner_name}</td><td>{row.track_name}</td><td className="num">{number(row.n)}</td><td className="num">{number(row.published_in_period)}</td><td>{row.n === 0 ? <span className="muted">لا توجد بيانات أداء</span> : !row.sample_sufficient ? <span className="muted">عيّنة صغيرة</span> : <span className="num">{metric(row.median_reach)}</span>}</td><td>{row.n === 0 ? <span className="muted">لا توجد بيانات أداء</span> : !row.sample_sufficient ? <span className="muted">عيّنة صغيرة</span> : <span className="num">{metric(row.median_signal)}</span>}</td></tr>)}
      </tbody></table></div>}
    </section>
  </>;
}
