"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { ItemDrawer } from "@/components/item-drawer";
import { createClient } from "@/lib/supabase/client";
import type { IdeaTypeOption, PartnerOption, ReadyItem, RoleName, TrackOption } from "@/lib/ui-data";
import { extractMessage, formatHebronDateTime, isAdminRole, parseRuleMessage } from "@/lib/ui-data";

type Props = {
  initialItems: ReadyItem[];
  tracks: TrackOption[];
  ideaTypes: IdeaTypeOption[];
  partners: PartnerOption[];
  currentUserId: string;
  roles: RoleName[];
};

function trackStyle(color: string | null) {
  return color ? ({ "--track-color": color } as CSSProperties & { "--track-color": string }) : undefined;
}

export function ReadyList({ initialItems, tracks, ideaTypes, partners, currentUserId, roles }: Props) {
  const supabase = createClient();
  const [items, setItems] = useState(initialItems);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [publishItem, setPublishItem] = useState<ReadyItem | null>(null);
  const [permalink, setPermalink] = useState("");
  const [publishedAt, setPublishedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [message, setMessage] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isAdmin = isAdminRole(roles);
  const linkLooksValid = /^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[^/?#]+/.test(permalink.trim());

  async function publish(override: string | null = null) {
    if (!publishItem || !linkLooksValid) return;
    const at = new Date(publishedAt).toISOString();
    const { error } = await supabase.rpc("mark_published", {
      p_item: publishItem.id,
      p_permalink: permalink.trim(),
      p_at: at,
      p_override_reason: override ?? undefined,
    });
    if (error) {
      setBlocked(true);
      setMessage(parseRuleMessage(extractMessage(error)));
      return;
    }
    setItems((current) => current.filter((item) => item.id !== publishItem.id));
    setPublishItem(null);
    setPermalink("");
    setOverrideReason("");
    setBlocked(false);
    setMessage(null);
  }

  return (
    <main className="page wide-page stack">
      <header className="screen-head">
        <div>
          <p className="eyebrow">النشر</p>
          <h1>جاهز للنشر</h1>
        </div>
      </header>

      {items.length ? (
        <div className="ready-list">
          {items.map((item) => (
            <article className="ready-card" key={item.id} style={trackStyle(item.color_hex)}>
              <div className="ready-head">
                <span className="pill track-pill" style={trackStyle(item.color_hex)}>{item.track_name ?? "—"}</span>
                <h2>{item.title}</h2>
              </div>
              <p className="muted">{item.partners || "—"}</p>
              <p className="num">{formatHebronDateTime(item.slot_at)}</p>
              <div className="read-box">{item.caption || "—"}</div>
              <div className="actions-row">
                <button className="button button-secondary" type="button" onClick={() => navigator.clipboard.writeText(item.caption ?? "")}>نسخ الكابشن</button>
                {item.production_file_url ? <a className="button button-secondary" href={item.production_file_url} target="_blank" rel="noreferrer">فتح ملف الإنتاج</a> : null}
                <button className="button button-secondary" type="button" onClick={() => setOpenItemId(item.id)}>فتح البطاقة</button>
                <button className="button" type="button" onClick={() => { setPublishItem(item); setPublishedAt(new Date().toISOString().slice(0, 16)); }}>تم النشر</button>
              </div>
            </article>
          ))}
        </div>
      ) : <section className="card"><p>لا توجد مواد جاهزة للنشر.</p></section>}

      {publishItem ? (
        <div className="veil" onClick={() => setPublishItem(null)}>
          <form className="confirm-panel stack" onSubmit={(event) => { event.preventDefault(); startTransition(() => { void publish(); }); }} onClick={(event) => event.stopPropagation()}>
            <h2>تأكيد النشر</h2>
            {message ? <p className="notice">{message}</p> : null}
            <label className="field">رابط إنستغرام<input className="input" value={permalink} onChange={(event) => setPermalink(event.target.value)} placeholder="https://www.instagram.com/p/..." /></label>
            <label className="field">وقت النشر<input className="input" type="datetime-local" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} /></label>
            <button className="button" type="submit" disabled={!linkLooksValid || isPending}>حفظ النشر</button>
            {blocked && isAdmin ? (
              <div className="override-box">
                <label className="field">سبب التجاوز<input className="input" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label>
                <button className="button" type="button" disabled={!overrideReason.trim() || isPending} onClick={() => startTransition(() => { void publish(overrideReason.trim()); })}>تجاوز ونفّذ</button>
              </div>
            ) : null}
          </form>
        </div>
      ) : null}

      <ItemDrawer itemId={openItemId} onClose={() => setOpenItemId(null)} tracks={tracks} ideaTypes={ideaTypes} partners={partners} currentUserId={currentUserId} roles={roles} />
    </main>
  );
}
