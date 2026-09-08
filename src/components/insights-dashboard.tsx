"use client";

import { useEffect, useState } from "react";
import type { InsightRange, InsightsSnapshot, PostCheckpoint } from "@/lib/insights";
import { workflowLabel } from "@/lib/workflow-ui";
import { AnalyticsLinkReview } from "@/components/analytics-link-review";

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
  const [mediaType, setMediaType] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch(`/api/insights?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}&media_type=${encodeURIComponent(mediaType)}`, {
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
  }, [range, retry, mediaType]);

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
        <label className="field">نوع الوسائط<select className="input" value={mediaType} onChange={(event) => setMediaType(event.target.value)}><option value="">كل الأنواع</option><option value="IMAGE">صورة</option><option value="CAROUSEL_ALBUM">ألبوم</option><option value="VIDEO">فيديو</option><option value="REELS">ريلز</option></select></label>
        <button className="button" type="submit" disabled={state.kind === "loading"}>تطبيق النطاق</button>
      </form>

      {state.kind === "loading" ? <section className="card" aria-live="polite"><p>جارٍ تحميل الإحصائيات…</p></section> : null}
      {state.kind === "error" ? <section className="card stack" role="alert"><p className="error">{state.message}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></section> : null}
      {state.kind === "ready" ? <><InsightsContent snapshot={state.snapshot} /><AnalyticsLinkReview /></> : null}
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
        {snapshot.upcoming_slots.map((slot) => <tr key={slot.slot_id}><td className="num">{dateTime(slot.slot_at)}</td><td>{slotStateLabel(slot.state)}</td><td className="num">{number(slot.n_items)}</td><td className="num">{number(slot.n_ready)}</td></tr>)}
      </tbody></table></div>}
    </section>

    <section className="card stack">
      <div><h2>أداء المواد المنشورة</h2><p className="muted">القيم أدناه من أحدث لقطة فعلية، ونقاط D1 وD7 وD30 لا تظهر إلا إن وُجد قياس مطابق تمامًا.</p></div>
      {!snapshot.performance?.length ? <p className="muted">لا توجد قياسات مواد ضمن النطاق المحدد.</p> : <div className="table-wrap"><table className="analytics-detail-table"><thead><tr><th>المادة</th><th>العمر</th><th>الوصول</th><th>المشاهدات</th><th>الإعجابات</th><th>التعليقات</th><th>الحفظ</th><th>المشاركات</th><th>المتابعات</th><th>زيارات الملف</th><th>التفاعلات</th><th>متوسط المشاهدة بالمللي ثانية</th><th>الحفظ %</th><th>المشاركة %</th><th>المتابعة %</th><th>زيارة الملف %</th><th>التفاعل %</th><th>الإشارة</th><th>D1</th><th>D7</th><th>D30</th></tr></thead><tbody>{snapshot.performance.map((row) => <tr key={row.id}><td><strong>{row.ref}</strong><br />{row.title}{row.signal_partial ? <><br /><span className="muted">قياس ناقص</span></> : null}<br /><span className="muted">آخر مصدر: <span className="num">{row.source_timestamp ?? "—"}</span></span></td><td className="num">{row.age_days === null ? "—" : `D${row.age_days}`}</td><td className="num">{metric(row.reach)}</td><td className="num">{metric(row.views)}</td><td className="num">{metric(row.likes)}</td><td className="num">{metric(row.comments)}</td><td className="num">{metric(row.saved)}</td><td className="num">{metric(row.shares)}</td><td className="num">{metric(row.follows)}</td><td className="num">{metric(row.profile_visits)}</td><td className="num">{metric(row.interactions)}</td><td className="num">{metric(row.avg_watch_ms)}</td><td className="num">{metric(row.save_rate)}</td><td className="num">{metric(row.share_rate)}</td><td className="num">{metric(row.follow_rate)}</td><td className="num">{metric(row.visit_rate)}</td><td className="num">{metric(row.engagement_rate)}</td><td className="num">{metric(row.signal)}</td>{["D1", "D7", "D30"].map((checkpoint) => <td key={checkpoint}>{checkpointSummary(row.checkpoints[checkpoint])}</td>)}</tr>)}</tbody></table></div>}
    </section>

    <section className="card stack">
      <div><h2>المقارنات بالوسيط</h2><p className="muted">حجم العيّنة ظاهر دائمًا. مصفوفة الشريك × المسار لا تعرض وسيطًا قبل اكتمال 5 مواد.</p></div>
      {!snapshot.aggregates?.length ? <p className="muted">لا توجد عيّنة كافية للمقارنة في هذا النطاق.</p> : <div className="table-wrap"><table><thead><tr><th>التجميع</th><th>القيمة</th><th>حجم العيّنة</th><th>وسيط الوصول</th><th>وسيط الحفظ %</th><th>وسيط المشاركة %</th><th>وسيط الإشارة</th></tr></thead><tbody>{snapshot.aggregates.map((row) => <tr key={`${row.dimension}-${row.key}`}><td>{aggregateLabel(row.dimension)}</td><td>{row.name}</td><td className="num">{number(row.n)}</td><td className="num">{metric(row.median_reach)}</td><td className="num">{metric(row.median_save_rate)}</td><td className="num">{metric(row.median_share_rate)}</td><td className="num">{metric(row.median_signal)}</td></tr>)}</tbody></table></div>}
      {snapshot.partner_track_matrix?.map((row) => <div className="status-count-grid" key={row.key}><div><span>{row.name}</span><strong className="num">N={number(row.n)} · {row.sample_sufficient ? metric(row.median_signal) : "عيّنة غير كافية"}</strong></div></div>)}
    </section>

    <section className="card stack">
      <h2>نمو الحساب والديموغرافيا</h2>
      {!snapshot.account_daily?.length ? <p className="muted">لا توجد قياسات حساب ضمن النطاق.</p> : <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>المتابعون</th><th>الوصول</th><th>المشاهدات</th><th>متابعات</th><th>إلغاء متابعة</th><th>اكتمال القياس</th></tr></thead><tbody>{snapshot.account_daily.map((row) => <tr key={row.date}><td className="num">{row.date}</td><td className="num">{metric(row.followers)}</td><td className="num">{metric(row.reach)}</td><td className="num">{metric(row.views)}</td><td className="num">{metric(row.follows)}</td><td className="num">{metric(row.unfollows)}</td><td>{row.missing_metrics.length ? <span className="muted">قياس ناقص</span> : "مكتمل"}</td></tr>)}</tbody></table></div>}
      {!snapshot.demographics?.length ? <p className="muted">لا توجد لقطة ديموغرافية ضمن النطاق.</p> : <div className="table-wrap"><table><thead><tr><th>تاريخ اللقطة</th><th>البعد</th><th>الفئة</th><th>القيمة</th></tr></thead><tbody>{snapshot.demographics.map((row) => <tr key={`${row.snapshot_date}-${row.dimension}-${row.key}`}><td className="num">{row.snapshot_date}</td><td>{row.dimension}</td><td>{row.key}</td><td className="num">{row.value === null ? <span className="muted">قياس ناقص</span> : metric(row.value)}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="card stack">
      <div><h2>سياق التعاون قبل/بعد</h2><p className="muted">هذه المقارنة سياق زمني فقط، ولا تثبت علاقة سببية.</p></div>
      {!snapshot.collabs?.length ? <p className="muted">لا توجد نوافذ تعاون مستوردة ضمن النطاق.</p> : snapshot.collabs.map((row) => <div className="status-count-grid" key={`${row.collaboration_date}-${row.partner}`}><div><span>{row.partner} · <span className="num">{row.collaboration_date}</span></span><strong className="num">{metric(row.reach_lift_pct)}</strong></div></div>)}
    </section>
    <section className="card stack"><h2>سجل مزامنة القياسات</h2>{!snapshot.sync_runs?.length ? <p className="muted">لا توجد عمليات مزامنة مسجلة.</p> : <div className="table-wrap"><table><thead><tr><th>وقت المصدر</th><th>وقت الاستلام</th><th>الحالة</th><th>المقبول</th><th>المرفوض</th></tr></thead><tbody>{snapshot.sync_runs.map((row) => <tr key={row.id}><td className="num">{row.source_timestamp}</td><td className="num">{row.received_at}</td><td>{syncStatusLabel(row.status)}</td><td className="num">{number(row.accepted_count)}</td><td className="num">{number(row.rejected_count)}</td></tr>)}</tbody></table></div>}</section>
  </>;
}

function aggregateLabel(value: string) {
  return value === "month" ? "الشهر" : value === "track" ? "المسار" : value === "idea_type" ? "نوع الفكرة" : value === "partner" ? "الشريك" : "الشريك × المسار";
}

function checkpointSummary(point: PostCheckpoint | null | undefined) {
  if (!point) return <span className="muted">غير مقاس</span>;
  return <span className="checkpoint-summary"><span>الوصول: <b className="num">{metric(point.reach)}</b></span><span>الحفظ: <b className="num">{metric(point.saved)}</b></span><span>المشاركة: <b className="num">{metric(point.shares)}</b></span><span>الإشارة: <b className="num">{metric(point.signal)}</b></span></span>;
}

function slotStateLabel(value: string | null) {
  return value === "open" ? "مفتوح" : value === "locked" ? "مقفل" : value === "cancelled" ? "ملغى" : "—";
}

function syncStatusLabel(value: string) {
  return value === "accepted" ? "مقبولة" : value === "processing" ? "قيد المعالجة" : "غير معروفة";
}
