"use client";

import { useEffect, useRef, useState } from "react";

type Post = { media_id: string; published_at: string; media_type: string | null; product_type: string | null; permalink: string; caption: string | null };
type Item = { id: string; ref: string; title: string; published_at: string | null };
type LinkAudit = { item_id: string; media_id: string; linked_at: string; linked_by: string | null; reason: string; source: string };
type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; posts: Post[]; items: Item[]; links: LinkAudit[] };

export function AnalyticsLinkReview() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [itemByPost, setItemByPost] = useState<Record<string, string>>({});
  const [reasonByPost, setReasonByPost] = useState<Record<string, string>>({});
  const [busyPost, setBusyPost] = useState<string | null>(null);
  const linkingRef = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch("/api/admin/analytics-links", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر تحميل المنشورات غير المرتبطة.");
      setState({ kind: "ready", posts: body.posts, items: body.items, links: body.links });
    }).catch((caught) => { if (!controller.signal.aborted) setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر تحميل المنشورات غير المرتبطة." }); });
    return () => controller.abort();
  }, [retry]);

  async function link(post: Post) {
    const itemId = itemByPost[post.media_id];
    const reason = reasonByPost[post.media_id] ?? "";
    if (!itemId || reason.trim().length < 4 || busyPost || linkingRef.current) return;
    linkingRef.current = true;
    setBusyPost(post.media_id);
    try {
      const response = await fetch("/api/admin/analytics-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, mediaId: post.media_id, reason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذر حفظ الربط.");
      setRetry((value) => value + 1);
    } catch (caught) {
      setState({ kind: "error", message: caught instanceof Error ? caught.message : "تعذر حفظ الربط." });
    } finally { linkingRef.current = false; setBusyPost(null); }
  }

  return <section className="card stack">
    <div><h2>مراجعة المنشورات غير المرتبطة</h2><p className="muted">لا يجري الربط تلقائيًا إلا عند تطابق الرابط الدائم أو الرمز القصير تطابقًا تامًا. الربط اليدوي يحتاج سببًا للتدقيق.</p></div>
    {state.kind === "loading" ? <p aria-live="polite">جارٍ تحميل مراجعة الروابط…</p> : null}
    {state.kind === "error" ? <div className="stack" role="alert"><p className="error">{state.message}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</button></div> : null}
    {state.kind === "ready" && state.posts.length === 0 ? <p className="muted">لا توجد منشورات مستوردة بانتظار الربط.</p> : null}
    {state.kind === "ready" ? state.posts.map((post) => <article className="analytics-link-row" key={post.media_id}>
      <div><strong className="num">{post.media_id}</strong><p className="muted">{mediaTypeLabel(post.media_type, post.product_type)} · <span className="num">{post.published_at}</span></p>{post.caption ? <p>{post.caption}</p> : <p className="muted">لا يوجد مقتطف وصف متاح.</p>}</div>
      <label className="field">المادة<select className="input" disabled={busyPost === post.media_id} value={itemByPost[post.media_id] ?? ""} onChange={(event) => setItemByPost((current) => ({ ...current, [post.media_id]: event.target.value }))}><option value="">اختر مادة منشورة غير مرتبطة</option>{state.items.map((item) => <option value={item.id} key={item.id}>{item.ref} — {item.title}</option>)}</select></label>
      <label className="field">سبب الربط<input className="input" disabled={busyPost === post.media_id} value={reasonByPost[post.media_id] ?? ""} onChange={(event) => setReasonByPost((current) => ({ ...current, [post.media_id]: event.target.value }))} /></label>
      <button className="button" type="button" disabled={busyPost !== null || !itemByPost[post.media_id] || (reasonByPost[post.media_id]?.trim().length ?? 0) < 4} onClick={() => link(post)}>{busyPost === post.media_id ? "جارٍ الحفظ…" : "حفظ الربط"}</button>
    </article>) : null}
    {state.kind === "ready" && state.links.length > 0 ? <details><summary>سجل الربط</summary><div className="table-wrap"><table><thead><tr><th>المادة</th><th>المنشور</th><th>المصدر</th><th>السبب</th><th>وقت الربط</th></tr></thead><tbody>{state.links.map((link) => <tr key={`${link.item_id}-${link.media_id}`}><td className="num">{link.item_id}</td><td className="num">{link.media_id}</td><td>{link.source === "manual" ? "يدوي" : link.source === "exact_permalink" ? "تطابق تام" : "موجود سابقًا"}</td><td>{link.reason}</td><td className="num">{link.linked_at}</td></tr>)}</tbody></table></div></details> : null}
  </section>;
}

function mediaTypeLabel(mediaType: string | null, productType: string | null) {
  if (productType?.toUpperCase() === "REELS") return "ريلز";
  if (mediaType === "IMAGE") return "صورة";
  if (mediaType === "CAROUSEL_ALBUM") return "ألبوم";
  if (mediaType === "VIDEO") return "فيديو";
  return "نوع غير مقاس";
}
