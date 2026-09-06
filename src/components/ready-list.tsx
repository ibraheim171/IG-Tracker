"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ItemDrawer } from "@/components/item-drawer";
import type { TeamMemberOption } from "@/lib/admin-create-item";
import { fetchAdminTeamMembers } from "@/lib/admin-team-members";
import { restoreDialogFocus, trapDialogFocus } from "@/lib/dialog-focus";
import { isPublisherRole, safeHttpsHref } from "@/lib/item-permissions";
import { createSingleFlight, isInstagramPermalink } from "@/lib/operational-ui";
import { createClient } from "@/lib/supabase/client";
import type { DrawerPreview, ReadyItem, RoleName } from "@/lib/ui-data";
import { extractMessage, formatHebronDateTime, isAdminRole, parseRuleMessage } from "@/lib/ui-data";

type Props = {
  initialItems: ReadyItem[];
  currentUserId: string;
  roles: RoleName[];
  teamMembers?: TeamMemberOption[];
  teamMembersLoadError?: string | null;
  loadError?: string | null;
};

function trackStyle(color: string | null) {
  return color ? ({ "--track-color": color } as CSSProperties & { "--track-color": string }) : undefined;
}

function previewFromReady(item: ReadyItem): DrawerPreview {
  return {
    id: item.id,
    ref: item.ref,
    title: item.title,
    status: "ready",
    track_id: item.track_id,
    track_name: item.track_name,
    track_color: item.color_hex,
    idea_type: item.idea_type,
    slot_at: item.slot_at,
    caption: item.caption,
    production_file_url: item.production_file_url,
    partners: item.partners,
  };
}

export function ReadyList({ initialItems, currentUserId, roles, teamMembers: initialTeamMembers = [], teamMembersLoadError: initialTeamMembersLoadError = null, loadError = null }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const publishFlight = useRef(createSingleFlight());
  const publishDialogRef = useRef<HTMLFormElement | null>(null);
  const publishReturnFocusRef = useRef<HTMLElement | null>(null);
  const readyHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [items, setItems] = useState(initialItems);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [publishItem, setPublishItem] = useState<ReadyItem | null>(null);
  const [permalink, setPermalink] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [teamMembers, setTeamMembers] = useState(initialTeamMembers);
  const [teamMembersError, setTeamMembersError] = useState(initialTeamMembersLoadError);
  const [retryingTeamMembers, setRetryingTeamMembers] = useState(false);
  const isAdmin = isAdminRole(roles);
  const canPublish = isPublisherRole(roles);
  const linkLooksValid = isInstagramPermalink(permalink);
  const openItem = useMemo(() => {
    const item = items.find((candidate) => candidate.id === openItemId);
    return item ? previewFromReady(item) : null;
  }, [items, openItemId]);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  useEffect(() => {
    setTeamMembers(initialTeamMembers);
    setTeamMembersError(initialTeamMembersLoadError);
  }, [initialTeamMembers, initialTeamMembersLoadError]);

  useEffect(() => {
    if (!publishItem) return;

    publishDialogRef.current?.focus();
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Tab") trapDialogFocus(event, publishDialogRef.current);
      if (event.key === "Escape" && !isPublishing) {
        event.preventDefault();
        closePublishDialog();
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [isPublishing, publishItem]);

  function closePublishDialog() {
    if (isPublishing) return;
    setPublishItem(null);
    window.setTimeout(() => {
      restoreDialogFocus(publishReturnFocusRef.current, readyHeadingRef.current);
      publishReturnFocusRef.current = null;
    }, 0);
  }

  function openPublishDialog(item: ReadyItem, trigger: HTMLElement) {
    publishReturnFocusRef.current = trigger;
    setPublishItem(item);
  }

  async function retryTeamMembers() {
    if (retryingTeamMembers) return;
    setRetryingTeamMembers(true);
    const result = await fetchAdminTeamMembers();
    setTeamMembers(result.teamMembers);
    setTeamMembersError(result.error);
    setRetryingTeamMembers(false);
  }

  async function publish(override: string | null = null) {
    if (!publishItem || !linkLooksValid) return;
    await publishFlight.current(async () => {
      let didPublish = false;
      setIsPublishing(true);
      try {
        const { error } = await supabase.rpc("mark_published", {
          p_item: publishItem.id,
          p_permalink: permalink.trim(),
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
        didPublish = true;
        router.refresh();
      } catch (error) {
        setBlocked(true);
        setMessage(parseRuleMessage(extractMessage(error)));
      } finally {
        setIsPublishing(false);
        if (didPublish) {
          window.setTimeout(() => {
            restoreDialogFocus(publishReturnFocusRef.current, readyHeadingRef.current);
            publishReturnFocusRef.current = null;
          }, 0);
        }
      }
    });
  }

  return (
    <main className="page wide-page stack">
      <header className="screen-head">
        <div>
          <p className="eyebrow">النشر</p>
          <h1 ref={readyHeadingRef} tabIndex={-1}>جاهز للنشر</h1>
        </div>
      </header>

      {isAdmin && teamMembersError ? (
        <section className="card stack" role="alert">
          <p>{teamMembersError}</p>
          <button className="button button-secondary" type="button" disabled={retryingTeamMembers} onClick={() => { void retryTeamMembers(); }}>
            {retryingTeamMembers ? "جارٍ تحميل أعضاء الفريق..." : "إعادة تحميل أعضاء الفريق"}
          </button>
        </section>
      ) : null}

      {loadError ? (
        <section className="card stack" role="alert">
          <p>{loadError}</p>
          <button className="button button-secondary" type="button" onClick={() => router.refresh()}>إعادة المحاولة</button>
        </section>
      ) : items.length ? (
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
                {item.production_file_url && safeHttpsHref(item.production_file_url) ? <a className="button button-secondary" href={safeHttpsHref(item.production_file_url) ?? undefined} target="_blank" rel="noopener noreferrer">فتح ملف الإنتاج</a> : null}
                {item.production_file_url && safeHttpsHref(item.production_file_url) ? <button className="button button-secondary" type="button" onClick={() => navigator.clipboard.writeText(safeHttpsHref(item.production_file_url) ?? "")}>نسخ رابط الإنتاج</button> : null}
                {item.production_file_url && !safeHttpsHref(item.production_file_url) ? <span>رابط غير صالح</span> : null}
                <button className="button button-secondary" type="button" onClick={() => setOpenItemId(item.id)}>فتح البطاقة</button>
                {canPublish ? <button className="button" type="button" onClick={(event) => openPublishDialog(item, event.currentTarget)}>تم النشر</button> : null}
              </div>
            </article>
          ))}
        </div>
      ) : <section className="card"><p>لا توجد مواد جاهزة للنشر.</p></section>}

      {canPublish && publishItem ? (
        <div className="veil" onClick={closePublishDialog}>
          <form aria-labelledby="ready-publish-title" aria-modal="true" className="confirm-panel stack" onSubmit={(event) => { event.preventDefault(); void publish(); }} onClick={(event) => event.stopPropagation()} ref={publishDialogRef} role="dialog" tabIndex={-1}>
            <h2 id="ready-publish-title">تأكيد النشر</h2>
            {message ? <p className="notice" role="alert">{message}</p> : null}
            <label className="field">رابط إنستغرام<input className="input" disabled={isPublishing} inputMode="url" value={permalink} onChange={(event) => setPermalink(event.target.value)} placeholder="https://www.instagram.com/p/..." /></label>
            <button className="button" type="submit" disabled={!linkLooksValid || isPublishing}>{isPublishing ? "جارٍ حفظ النشر..." : "حفظ النشر"}</button>
            {blocked && isAdmin ? (
              <div className="override-box">
                <label className="field">سبب التجاوز<input className="input" disabled={isPublishing} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label>
                <button className="button" type="button" disabled={!overrideReason.trim() || isPublishing} onClick={() => { void publish(overrideReason.trim()); }}>{isPublishing ? "جارٍ حفظ النشر..." : "تجاوز ونفّذ"}</button>
              </div>
            ) : null}
            <button className="button button-secondary" type="button" disabled={isPublishing} onClick={closePublishDialog}>إلغاء</button>
          </form>
        </div>
      ) : null}

      <ItemDrawer itemId={openItemId} initialItem={openItem} onClose={() => setOpenItemId(null)} onChanged={() => router.refresh()} currentUserId={currentUserId} roles={roles} teamMembers={teamMembers} teamMembersLoadError={teamMembersError} onRetryTeamMembers={retryTeamMembers} retryingTeamMembers={retryingTeamMembers} />
    </main>
  );
}
