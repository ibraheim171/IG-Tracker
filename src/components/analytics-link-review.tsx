"use client";

import { useEffect, useRef, useState } from "react";

type Post = { media_id: string; published_at: string; media_type: string | null; product_type: string | null; permalink: string; caption: string | null };
type Candidate = { media_id: string; match: "exact_caption"; days_apart: number };
type Item = { id: string; ref: string; title: string; caption: string | null; published_at: string | null; ig_media_id: string | null; candidates: Candidate[] };
type LinkAudit = { item_id: string; media_id: string; linked_at: string; linked_by: string | null; reason: string; previous_legacy_media_id: string | null; source: string };
type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; posts: Post[]; items: Item[]; links: LinkAudit[]; unlinked_post_count: number };

export function AnalyticsLinkReview() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [postByItem, setPostByItem] = useState<Record<string, string>>({});
  const [reasonByItem, setReasonByItem] = useState<Record<string, string>>({});
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const linkingRef = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch("/api/admin/analytics-links", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر تحميل المنشورات غير المرتبطة.");
      setState({ kind: "ready", posts: body.posts, items: body.items, links: body.links, unlinked_post_count: body.unlinked_post_count });
    }).catch((caught) => { if (!controller.signal.aborted) setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر تحميل المنشورات غير المرتبطة." }); });
    return () => controller.abort();
  }, [retry]);

  function selectExactCandidate(item: Item, candidate: Candidate) {
    setPostByItem((current) => ({ ...current, [item.id]: candidate.media_id }));
    setReasonByItem((current) => current[item.id]?.trim().length ? current : {
      ...current,
      [item.id]: `تطابق نص الكابشن وفارق النشر ${candidate.days_apart} يوم`,
    });
  }

  async function link(item: Item) {
    const mediaId = postByItem[item.id];
    const reason = reasonByItem[item.id] ?? "";
    if (!mediaId || reason.trim().length < 4 || busyItem || linkingRef.current) return;
    linkingRef.current = true;
    setBusyItem(item.id);
    try {
      const response = await fetch("/api/admin/analytics-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: item.id, mediaId, reason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر حفظ الربط.");
      setRetry((value) => value + 1);
    } catch (caught) {
      setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر حفظ الربط." });
    } finally { linkingRef.current = false; setBusyItem(null); }
  }

  return <section className="card stack">
    <div><h2>مراجعة ربط المواد المنشورة</h2><p className="muted">هذه القائمة تعرض المواد المنشورة التي ينقصها ربط فقط. المنشورات المستوردة الأخرى ليست مهام عمل ما لم تُختَر هنا.</p></div>
    {state.kind === "loading" ? <p aria-live="polite">جارٍ تحميل مراجعة الروابط…</p> : null}
    {state.kind === "error" ? <div className="stack" role="alert"><p className="error">{state.message}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></div> : null}
    {state.kind === "ready" && state.items.length === 0 ? <p className="muted">لا توجد مواد منشورة تحتاج ربطًا.</p> : null}
    {state.kind === "ready" ? <p className="muted">منشورات مستوردة بلا رابط حاليًا: <span className="num">{state.unlinked_post_count}</span> — لا تُعرض كقائمة قرار إلا إذا ارتبطت بمادة أدناه.</p> : null}
    {state.kind === "ready" ? state.items.map((item) => {
      const selectedPost = state.posts.find((post) => post.media_id === postByItem[item.id]);
      return <article className="analytics-link-row" key={item.id}>
        <div><strong>{item.ref} — {item.title}</strong><p className="muted">تاريخ المادة: <span className="num">{item.published_at ?? "—"}</span></p>{item.caption ? <p>{item.caption}</p> : <p className="muted">لا يوجد كابشن كافٍ لإنشاء اقتراح تلقائي.</p>}</div>
        {item.candidates.length > 0 ? <div className="stack"><strong>اقتراح موثّق</strong>{item.candidates.map((candidate) => {
          const post = state.posts.find((entry) => entry.media_id === candidate.media_id);
          if (!post) return null;
          return <button className="button button-secondary" type="button" disabled={busyItem !== null} key={candidate.media_id} onClick={() => selectExactCandidate(item, candidate)}>اختيار المنشور المطابق نصيًا · فارق {candidate.days_apart} يوم</button>;
        })}</div> : null}
        <details><summary>اختيار منشور يدويًا</summary><label className="field">المنشور<select className="input" disabled={busyItem === item.id} value={postByItem[item.id] ?? ""} onChange={(event) => setPostByItem((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">اختر منشورًا مستوردًا</option>{state.posts.map((post) => <option value={post.media_id} key={post.media_id}>{post.published_at.slice(0, 10)} — {String(post.caption ?? "بدون كابشن").slice(0, 80)}</option>)}</select></label></details>
        {selectedPost ? <p className="muted">{mediaTypeLabel(selectedPost.media_type, selectedPost.product_type)} · <a href={selectedPost.permalink} target="_blank" rel="noreferrer">فتح المنشور</a></p> : null}
        <label className="field">سبب الربط<input className="input" disabled={busyItem === item.id} value={reasonByItem[item.id] ?? ""} onChange={(event) => setReasonByItem((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
        <button className="button" type="button" disabled={busyItem !== null || !postByItem[item.id] || (reasonByItem[item.id]?.trim().length ?? 0) < 4} onClick={() => link(item)}>{busyItem === item.id ? "جارٍ الحفظ…" : "حفظ الربط"}</button>
      </article>;
    }) : null}
    {state.kind === "ready" && state.links.length > 0 ? <details><summary>سجل الربط</summary><div className="table-wrap"><table><thead><tr><th>المادة</th><th>المنشور</th><th>الهوية القديمة</th><th>المصدر</th><th>السبب</th><th>وقت الربط</th></tr></thead><tbody>{state.links.map((link) => <tr key={`${link.item_id}-${link.media_id}`}><td className="num">{link.item_id}</td><td className="num">{link.media_id}</td><td className="num">{link.previous_legacy_media_id ?? "—"}</td><td>{link.source === "manual" ? "يدوي" : link.source === "exact_permalink" ? "تطابق تام" : "موجود سابقًا"}</td><td>{link.reason}</td><td className="num">{link.linked_at}</td></tr>)}</tbody></table></div></details> : null}
  </section>;
}

function mediaTypeLabel(mediaType: string | null, productType: string | null) {
  if (productType?.toUpperCase() === "REELS") return "ريلز";
  if (mediaType === "IMAGE") return "صورة";
  if (mediaType === "CAROUSEL_ALBUM") return "ألبوم";
  if (mediaType === "VIDEO") return "فيديو";
  return "نوع غير مقاس";
}
