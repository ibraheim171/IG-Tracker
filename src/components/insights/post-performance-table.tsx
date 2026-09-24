"use client";

import { useEffect, useState } from "react";
import { ItemDrawer } from "@/components/item-drawer";
import type { TeamMemberOption } from "@/lib/admin-create-item";
import type { InsightRange } from "@/lib/insights";
import type { RoleName } from "@/lib/ui-data";
import { MetricDefinitions } from "./metric-definitions";

type Option = { key: string; name: string };
type PostRow = {
  id: string | null; ref: string | null; title: string | null; published_at: string | null;
  track_name: string | null; idea_type: string | null; media_type: string | null; product_type: string | null;
  snapshot_date: string | null; age_days: number | null; reach: number | null; views: number | null;
  save_rate: number | null; share_rate: number | null; follow_rate: number | null; signal: number | null;
  missing_metrics: string[] | null; signal_partial: boolean | null; partners: string[];
};
type Payload = { rows: PostRow[]; total: number | null; page: number; page_size: number };
type Props = {
  range: InsightRange;
  currentUserId: string;
  roles: RoleName[];
  teamMembers: TeamMemberOption[];
  teamMembersLoadError: string | null;
};

function metric(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function typeLabel(row: PostRow) {
  return row.product_type === "REELS" ? "ريلز" : row.media_type === "CAROUSEL_ALBUM" ? "كاروسيل" : row.media_type === "VIDEO" ? "فيديو" : row.media_type === "IMAGE" ? "صورة" : "—";
}

export function PostPerformanceTable({ range, currentUserId, roles, teamMembers, teamMembersLoadError }: Props) {
  const [rows, setRows] = useState<PostRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("published_at");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [mediaType, setMediaType] = useState("");
  const [trackId, setTrackId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [tracks, setTracks] = useState<Option[]>([]);
  const [partners, setPartners] = useState<Option[]>([]);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/insights/compare?mode=options", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((body) => { setTracks(body.options.track); setPartners(body.options.partner); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => { setPage(1); }, [range.start, range.end]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ start: range.start, end: range.end, page: String(page), sort, direction });
    if (search) params.set("search", search);
    if (mediaType) params.set("media_type", mediaType);
    if (trackId) params.set("track_id", trackId);
    if (partnerId) params.set("partner_id", partnerId);
    setState("loading");
    fetch(`/api/insights/posts?${params}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "تعذر تحميل المنشورات.");
        const payload = body as Payload;
        const availablePages = payload.total === null ? null : Math.max(1, Math.ceil(payload.total / payload.page_size));
        if (availablePages !== null && page > availablePages) { setPage(availablePages); return; }
        setRows(payload.rows); setTotal(payload.total); setState("ready");
      })
      .catch((caught) => { if (!controller.signal.aborted) { setError(caught instanceof Error ? caught.message : "تعذر تحميل المنشورات."); setState("error"); } });
    return () => controller.abort();
  }, [direction, mediaType, page, partnerId, range.end, range.start, retry, search, sort, trackId]);

  function resetPage(action: () => void) { setPage(1); action(); }
  const pages = total === null ? null : Math.max(1, Math.ceil(total / 25));
  const reelsVisible = rows.some((row) => row.product_type === "REELS");
  return <div className="stack post-performance">
    <section className="card stack">
      <div><h2>كل المنشورات</h2><p className="muted">هذه هي الطبقة التفصيلية للأرقام. الفراغ «—» يعني أن القياس غير متاح، وليس صفرًا.</p></div>
      <form className="post-search" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchDraft.trim()); }}>
        <label className="field">بحث بالمرجع أو العنوان<input className="input" type="search" maxLength={80} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="مثال: AQ-104 أو القدس" /></label>
        <button className="button button-secondary" type="submit">بحث</button>
        {search ? <button className="button button-ghost" type="button" onClick={() => { setSearchDraft(""); setSearch(""); setPage(1); }}>مسح</button> : null}
      </form>
      <div className="post-filters">
        <label className="field">المسار<select className="input" value={trackId} onChange={(event) => resetPage(() => setTrackId(event.target.value))}><option value="">كل المسارات</option>{tracks.map((option) => <option value={option.key} key={option.key}>{option.name}</option>)}</select></label>
        <label className="field">الشريك<select className="input" value={partnerId} onChange={(event) => resetPage(() => setPartnerId(event.target.value))}><option value="">كل الشركاء</option>{partners.map((option) => <option value={option.key} key={option.key}>{option.name}</option>)}</select></label>
        <label className="field">النوع<select className="input" value={mediaType} onChange={(event) => resetPage(() => setMediaType(event.target.value))}><option value="">كل الأنواع</option><option value="IMAGE">صورة</option><option value="CAROUSEL_ALBUM">كاروسيل</option><option value="VIDEO">فيديو</option><option value="REELS">ريلز</option></select></label>
        <label className="field">الفرز<select className="input" value={sort} onChange={(event) => resetPage(() => setSort(event.target.value))}><option value="published_at">التاريخ</option><option value="reach">الوصول</option><option value="save_rate">الحفظ %</option><option value="share_rate">المشاركة %</option><option value="follow_rate">المتابعة %</option><option value="signal">قوة الإشارة</option></select></label>
        <label className="field">الاتجاه<select className="input" value={direction} onChange={(event) => resetPage(() => setDirection(event.target.value as "asc" | "desc"))}><option value="desc">تنازلي</option><option value="asc">تصاعدي</option></select></label>
      </div>
    </section>
    {reelsVisible ? <p className="notice">مقاييس ريلز ناقصة بنيويًا: قد لا تعيد Meta زيارات الملف أو المتابعة الجديدة، ولذلك قد تبقى النسب وقوة الإشارة غير متاحة.</p> : null}
    {state === "loading" ? <section className="card"><p aria-live="polite">جارٍ تحميل المنشورات…</p></section> : null}
    {state === "error" ? <section className="card stack" role="alert"><p className="error">{error}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></section> : null}
    {state === "ready" ? <section className="card stack">
      <p className="muted">النتائج: <b className="num">{total === null ? "—" : total.toLocaleString("en-US")}</b></p>
      {!rows.length ? <p className="muted">لا توجد منشورات مطابقة لهذه المرشحات.</p> : <>
        <div className="table-wrap post-table-desktop"><table className="post-performance-table"><thead><tr><th>المادة</th><th>المسار</th><th>الشريك</th><th>نوع الفكرة</th><th>النوع</th><th>التاريخ</th><th>الوصول</th><th>المشاهدات</th><th>حفظ %</th><th>مشاركة %</th><th>متابعة %</th><th>الإشارة</th><th>القياس</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id ?? `${row.ref}-${row.published_at}`}><td><strong>{row.ref ?? "—"}</strong><br />{row.title ?? "—"}</td><td>{row.track_name ?? "—"}</td><td>{row.partners.length ? row.partners.join("، ") : "—"}</td><td>{row.idea_type ?? "—"}</td><td>{typeLabel(row)}</td><td className="num">{row.published_at?.slice(0, 10) ?? "—"}</td><td className="num">{metric(row.reach)}</td><td className="num">{metric(row.views)}</td><td className="num">{metric(row.save_rate)}</td><td className="num">{metric(row.share_rate)}</td><td className="num">{metric(row.follow_rate)}</td><td className="num">{metric(row.signal)}</td><td>{row.signal_partial || row.missing_metrics?.length ? <span className="metric-flag">قياس ناقص</span> : <span>مكتمل</span>}<br /><small className="num">D{row.age_days ?? "—"}</small></td><td>{row.id ? <button className="button button-secondary" type="button" onClick={() => setOpenItemId(row.id)}>عرض التفاصيل</button> : null}</td></tr>)}</tbody></table></div>
        <div className="post-card-list">{rows.map((row) => <article className="post-performance-card" key={row.id ?? `${row.ref}-${row.published_at}`}><div><strong>{row.ref ?? "—"} — {row.title ?? "—"}</strong><span className="muted num">{row.published_at?.slice(0, 10) ?? "—"}</span></div><p>{row.track_name ?? "—"} · {row.idea_type ?? "نوع فكرة غير متاح"} · {typeLabel(row)} · {row.partners.join("، ") || "بلا شريك"}</p><dl><div><dt>الوصول</dt><dd className="num">{metric(row.reach)}</dd></div><div><dt>المشاهدات</dt><dd className="num">{metric(row.views)}</dd></div><div><dt>الحفظ %</dt><dd className="num">{metric(row.save_rate)}</dd></div><div><dt>المشاركة %</dt><dd className="num">{metric(row.share_rate)}</dd></div><div><dt>المتابعة %</dt><dd className="num">{metric(row.follow_rate)}</dd></div><div><dt>الإشارة</dt><dd className="num">{metric(row.signal)}</dd></div></dl>{row.signal_partial || row.missing_metrics?.length ? <span className="metric-flag">قياس ناقص</span> : null}{row.id ? <button className="button button-secondary" type="button" onClick={() => setOpenItemId(row.id)}>عرض التفاصيل</button> : null}</article>)}</div>
      </>}
      <div className="pagination"><button className="button button-secondary" type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</button><span>صفحة <b className="num">{page.toLocaleString("en-US")}</b>{pages ? <> من <b className="num">{pages.toLocaleString("en-US")}</b></> : null}</span><button className="button button-secondary" type="button" disabled={pages ? page >= pages : rows.length < 25} onClick={() => setPage((value) => value + 1)}>التالي</button></div>
    </section> : null}
    <MetricDefinitions />
    <ItemDrawer itemId={openItemId} onClose={() => setOpenItemId(null)} onChanged={() => setRetry((value) => value + 1)} currentUserId={currentUserId} roles={roles} teamMembers={teamMembers} teamMembersLoadError={teamMembersLoadError} />
  </div>;
}
