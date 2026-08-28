"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { useReferenceData } from "@/components/reference-data-provider";
import { createClient } from "@/lib/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/database.types";
import type { DrawerPreview, IdeaTypeOption, ItemStatus, ParticipantPart, RoleName, TrackOption } from "@/lib/ui-data";
import { extractMessage, formatHebronDateTime, formatNumber, formatPercent, isAdminRole, isReviewerRole, parseRuleMessage, statusLabels } from "@/lib/ui-data";

type ItemRow = Tables<"items">;
type PerformanceRow = Tables<"v_item_performance">;

type ParticipantRecord = {
  user_id: string;
  part: ParticipantPart;
  profiles: { display_name: string } | { display_name: string }[] | null;
};

type PartnerRecord = {
  partner_id: number;
  partners: { name: string } | { name: string }[] | null;
};

type ApprovalRecord = Pick<Tables<"approvals">, "gate" | "result">;
type OpenSlot = Pick<Tables<"v_slot_board">, "slot_id" | "slot_at" | "state" | "n_items">;

type DrawerDetails = {
  item: ItemRow;
  participants: ParticipantRecord[];
  partners: PartnerRecord[];
  approvals: ApprovalRecord[];
  performance: PerformanceRow | null;
  openSlots: OpenSlot[];
};

type ItemDetailsResponse = { details: DrawerDetails } | { error: string };
type LoadState = "idle" | "loading" | "ready" | "error";

type EditableState = {
  title: string;
  track_id: string;
  idea_type_id: string;
  caption: string;
  notes: string;
  production_file_url: string;
  partnerIds: string[];
  newPartner: string;
};

type Props = {
  itemId: string | null;
  initialItem?: DrawerPreview | null;
  onClose: () => void;
  onChanged?: () => void;
  currentUserId: string;
  roles: RoleName[];
  largeCaption?: boolean;
};

const pipeline: { key: ItemStatus; label: string }[] = [
  { key: "idea", label: "كتابة الكابشن" },
  { key: "writing", label: "اعتماد المحتوى" },
  { key: "content_approved", label: "الإنتاج" },
  { key: "in_production", label: "اعتماد التصميم" },
  { key: "published", label: "النشر" },
];

const order: ItemStatus[] = ["idea", "writing", "content_approved", "in_production", "design_approved", "ready", "published"];
const detailTimeoutMs = 10000;

function profileName(value: ParticipantRecord["profiles"]) {
  if (Array.isArray(value)) return value[0]?.display_name ?? "—";
  return value?.display_name ?? "—";
}

function partnerName(value: PartnerRecord["partners"]) {
  if (Array.isArray(value)) return value[0]?.name ?? "—";
  return value?.name ?? "—";
}

function trackStyle(color: string | null | undefined) {
  return color ? ({ "--track-color": color } as CSSProperties & { "--track-color": string }) : undefined;
}

function canEdit(item: ItemRow | null) {
  return Boolean(item && !item.is_archived);
}

function buildEditable(item: ItemRow, partnerRows: PartnerRecord[]): EditableState {
  return {
    title: item.title,
    track_id: item.track_id?.toString() ?? "",
    idea_type_id: item.idea_type_id?.toString() ?? "",
    caption: item.caption ?? "",
    notes: item.notes ?? "",
    production_file_url: item.production_file_url ?? "",
    partnerIds: partnerRows.map((row) => row.partner_id.toString()),
    newPartner: "",
  };
}

function findTrack(tracks: TrackOption[], item: ItemRow | DrawerPreview | null) {
  return tracks.find((track) => track.id === item?.track_id) ?? null;
}

function findIdeaType(ideaTypes: IdeaTypeOption[], item: ItemRow | DrawerPreview | null) {
  return ideaTypes.find((ideaType) => ideaType.id === item?.idea_type_id) ?? null;
}

function hasAbortName(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error && (error as { name?: unknown }).name === "AbortError";
}

export function ItemDrawer({ itemId, initialItem, onClose, onChanged, currentUserId, roles, largeCaption }: Props) {
  const { tracks, ideaTypes, partners } = useReferenceData();
  const supabase = useMemo(() => createClient(), []);
  const loadSequence = useRef(0);
  const hasUserEditedFields = useRef(false);
  const [details, setDetails] = useState<DrawerDetails | null>(null);
  const [editable, setEditable] = useState<EditableState | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [failedAdvance, setFailedAdvance] = useState<ItemStatus | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [isPending, startTransition] = useTransition();

  const preview = initialItem?.id === itemId ? initialItem : null;
  const item = details?.item ?? null;
  const displayItem = item ?? preview;
  const currentTrack = findTrack(tracks, displayItem);
  const currentIdeaType = findIdeaType(ideaTypes, displayItem);
  const trackName = currentTrack?.name ?? preview?.track_name ?? null;
  const trackColor = currentTrack?.color_hex ?? preview?.track_color ?? null;
  const ideaTypeName = currentIdeaType?.name ?? preview?.idea_type ?? null;
  const isAdmin = isAdminRole(roles);
  const isReviewer = isReviewerRole(roles);
  const participantParts = details?.participants.filter((row) => row.user_id === currentUserId).map((row) => row.part) ?? [];
  const isParticipant = participantParts.length > 0;
  const isWriter = participantParts.includes("writer");
  const isProducer = participantParts.includes("producer");
  const hasProducer = details?.participants.some((row) => row.part === "producer") ?? false;
  const hasApprovalHistory = details?.approvals.some((approval) => approval.result === "approve") ?? false;
  const captionText = item?.caption ?? preview?.caption ?? null;
  const productionFileUrl = item?.production_file_url ?? preview?.production_file_url ?? null;

  useEffect(() => {
    const sequence = ++loadSequence.current;
    const controller = new AbortController();
    let didTimeout = false;

    async function load() {
      if (!itemId) {
        hasUserEditedFields.current = false;
        setDetails(null);
        setEditable(null);
        setLoadState("idle");
        setLoadError(null);
        setMessage(null);
        return;
      }

      hasUserEditedFields.current = false;
      setMessage(null);
      setLoadError(null);
      setLoadState("loading");
      setDetails(null);
      setEditable(null);
      setFailedAdvance(null);
      setOverrideReason("");
      setRejectNote("");

      const timeoutId = window.setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, detailTimeoutMs);

      try {
        const response = await fetch(`/api/item-details?itemId=${encodeURIComponent(itemId)}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const payload = (await response.json()) as ItemDetailsResponse;

        if (controller.signal.aborted || sequence !== loadSequence.current) return;

        if (!response.ok || "error" in payload) {
          throw new Error("error" in payload ? payload.error : `HTTP_${response.status}`);
        }

        hasUserEditedFields.current = false;
        setDetails(payload.details);
        setEditable(buildEditable(payload.details.item, payload.details.partners));
        setLoadState("ready");
      } catch (error) {
        if (sequence !== loadSequence.current) return;
        if (controller.signal.aborted && !didTimeout) return;

        setLoadState("error");
        setLoadError(didTimeout ? "تعذر تحميل تفاصيل البطاقة خلال الوقت المتوقع. حاول مجددًا." : extractMessage(error));
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void load();

    return () => {
      controller.abort();
    };
  }, [itemId, retryNonce]);

  useEffect(() => {
    if (!item || !editable || item.is_archived || !hasUserEditedFields.current) return;
    const handle = window.setTimeout(() => {
      void saveFields(false);
    }, 1800);
    return () => window.clearTimeout(handle);
  }, [editable?.title, editable?.track_id, editable?.idea_type_id, editable?.caption, editable?.notes, editable?.production_file_url]);

  function updateEditable(patch: Partial<EditableState>) {
    hasUserEditedFields.current = true;
    setEditable((current) => current ? { ...current, ...patch } : current);
  }

  async function reloadAndNotify() {
    if (!itemId) return;
    const { data } = await supabase.from("items").select("*").eq("id", itemId).single();
    if (data) {
      hasUserEditedFields.current = false;
      setDetails((current) => current ? { ...current, item: data } : current);
      setEditable((current) => current ? buildEditable(data, details?.partners ?? []) : current);
    }
    onChanged?.();
  }

  async function saveFields(showMessage = true) {
    if (!item || !editable || item.is_archived) return;
    const payload: TablesUpdate<"items"> = {
      title: editable.title,
      track_id: editable.track_id ? Number(editable.track_id) : null,
      idea_type_id: editable.idea_type_id ? Number(editable.idea_type_id) : null,
      caption: editable.caption.trim() ? editable.caption : null,
      notes: editable.notes.trim() ? editable.notes : null,
      production_file_url: editable.production_file_url.trim() ? editable.production_file_url : null,
    };
    const { error } = await supabase.from("items").update(payload).eq("id", item.id);
    if (error) {
      setMessage(parseRuleMessage(extractMessage(error)));
      return;
    }
    hasUserEditedFields.current = false;
    if (showMessage) setMessage("تم حفظ التعديلات.");
    onChanged?.();
  }

  async function savePartners() {
    if (!item || !editable || item.is_archived) return;
    let selectedIds = editable.partnerIds.map(Number);
    const typed = editable.newPartner.trim();
    if (typed) {
      const existing = partners.find((partner) => partner.name === typed);
      if (existing) {
        selectedIds = [...selectedIds, existing.id];
      } else if (window.confirm("لا يوجد شريك بهذا الاسم، أضِفه؟")) {
        const { data, error } = await supabase.from("partners").insert({ name: typed, aliases: [typed] }).select("id, name").single();
        if (error) {
          setMessage(extractMessage(error));
          return;
        }
        selectedIds = [...selectedIds, data.id];
      }
    }

    const uniqueIds = Array.from(new Set(selectedIds));
    const { error: deleteError } = await supabase.from("item_partners").delete().eq("item_id", item.id);
    if (deleteError) {
      setMessage(extractMessage(deleteError));
      return;
    }

    if (uniqueIds.length > 0) {
      const rows: TablesInsert<"item_partners">[] = uniqueIds.map((partner_id) => ({ item_id: item.id, partner_id }));
      const { error: insertError } = await supabase.from("item_partners").insert(rows);
      if (insertError) {
        setMessage(extractMessage(insertError));
        return;
      }
    }

    setMessage("تم حفظ الشركاء.");
    onChanged?.();
  }

  function runAction(action: () => Promise<void>) {
    startTransition(() => {
      void action();
    });
  }

  async function advance(toStatus: ItemStatus, override: string | null = null) {
    if (!item) return;
    const { error } = await supabase.rpc("advance_item", {
      p_item: item.id,
      p_to: toStatus,
      p_note: undefined,
      p_override_reason: override ?? undefined,
    });
    if (error) {
      setMessage(parseRuleMessage(extractMessage(error)));
      setFailedAdvance(toStatus);
      return;
    }
    setFailedAdvance(null);
    setOverrideReason("");
    setMessage("تم تنفيذ الانتقال.");
    await reloadAndNotify();
  }

  async function reject(gate: "content" | "design") {
    if (!item || !rejectNote.trim()) return;
    const { error } = await supabase.rpc("reject_item", {
      p_item: item.id,
      p_gate: gate,
      p_note: rejectNote.trim(),
    });
    if (error) {
      setMessage(parseRuleMessage(extractMessage(error)));
      return;
    }
    setRejectNote("");
    setMessage("تمت الإعادة بالملاحظة.");
    await reloadAndNotify();
  }

  async function assignSlot(slotId: string) {
    if (!item) return;
    const { error } = await supabase.rpc("assign_slot", { p_item: item.id, p_slot: slotId });
    if (error) {
      setMessage(parseRuleMessage(extractMessage(error)));
      return;
    }
    setMessage("تم ربط موعد النشر.");
    await reloadAndNotify();
  }

  if (!itemId) return null;

  const drawerDetails = details;
  const performanceData = drawerDetails?.performance ?? null;
  const showDetailsLoading = loadState === "loading";
  const retryButton = loadState === "error" ? <button className="button button-secondary" type="button" onClick={() => setRetryNonce((current) => current + 1)}>إعادة المحاولة</button> : null;

  return (
    <div className="veil" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()} aria-label="بطاقة المادة">
        <button className="icon-button drawer-close" type="button" onClick={onClose} aria-label="إغلاق">×</button>
        {!displayItem ? (
          <div className="drawer-stack">
            {showDetailsLoading ? <p>جارٍ التحميل...</p> : null}
            {loadError ? <div className="notice stack" role="alert"><p>{loadError}</p>{retryButton}</div> : null}
          </div>
        ) : (
          <div className="drawer-stack">
            <header className="drawer-head">
              <span className="num ref-pill">{displayItem.ref}</span>
              <h2>{displayItem.title}</h2>
              <div className="pill-row">
                {trackName ? <span className="pill track-pill" style={trackStyle(trackColor)}>{trackName}</span> : null}
                {ideaTypeName ? <span className="pill">{ideaTypeName}</span> : null}
                {item?.is_archived ? <span className="pill">مؤرشفة</span> : null}
              </div>
            </header>

            {message ? <p className="notice">{message}</p> : null}
            {showDetailsLoading ? <p className="muted">جارٍ تحميل التفاصيل والإجراءات...</p> : null}
            {loadError ? <div className="notice stack" role="alert"><p>{loadError}</p>{retryButton}</div> : null}

            {drawerDetails ? (
              <section className="meta-grid">
                <div><span className="meta-label">الشركاء</span><div className="pill-row">{drawerDetails.partners.length ? drawerDetails.partners.map((row) => <span className="pill" key={row.partner_id}>{partnerName(row.partners)}</span>) : <span>—</span>}</div></div>
                <div><span className="meta-label">الفريق</span><div className="pill-row">{drawerDetails.participants.length ? drawerDetails.participants.map((row) => <span className="pill" key={`${row.user_id}-${row.part}`}>{profileName(row.profiles)} · {row.part === "writer" ? "كاتب" : row.part === "producer" ? "منتج" : "مراجع"}</span>) : <span>—</span>}</div></div>
              </section>
            ) : null}

            <section className="steps">
              {pipeline.map((step) => {
                const currentIndex = order.indexOf(displayItem.status);
                const stepIndex = order.indexOf(step.key);
                const isDone = displayItem.status === "published" || currentIndex > stepIndex;
                const isCurrent = displayItem.status !== "published" && (displayItem.status === step.key || (step.key === "published" && (displayItem.status === "ready" || displayItem.status === "design_approved")));
                return <span className={`step ${isDone ? "is-done" : ""} ${isCurrent ? "is-current" : ""}`} key={step.key}>{isDone ? "✓ " : ""}{step.label}</span>;
              })}
            </section>

            {item && editable && canEdit(item) ? (
              <section className="drawer-section stack">
                <h3>الحقول</h3>
                <label className="field">العنوان<input className="input" value={editable.title} onChange={(event) => updateEditable({ title: event.target.value })} /></label>
                <div className="form-grid">
                  <label className="field">المسار<select className="input" value={editable.track_id} onChange={(event) => updateEditable({ track_id: event.target.value })}><option value="">—</option>{tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
                  <label className="field">نوع الفكرة<select className="input" value={editable.idea_type_id} onChange={(event) => updateEditable({ idea_type_id: event.target.value })}><option value="">—</option>{ideaTypes.map((ideaType) => <option key={ideaType.id} value={ideaType.id}>{ideaType.name}</option>)}</select></label>
                </div>
                {hasApprovalHistory ? <p className="soft-banner">هذا النص معتمَد — تعديله لا يُلغي الاعتماد تلقائياً. أبلغ المراجع إن كان التغيير جوهرياً.</p> : null}
                <label className="field">الكابشن<textarea className={`input textarea ${largeCaption ? "textarea-large" : ""}`} value={editable.caption} onChange={(event) => updateEditable({ caption: event.target.value })} /></label>
                <label className="field">الملاحظات<textarea className="input textarea" value={editable.notes} onChange={(event) => updateEditable({ notes: event.target.value })} /></label>
                <label className="field">رابط ملف الإنتاج<input className="input" value={editable.production_file_url} onChange={(event) => updateEditable({ production_file_url: event.target.value })} /></label>
                <button className="button" type="button" onClick={() => runAction(() => saveFields(true))}>حفظ التعديلات</button>
                <fieldset>
                  <legend>الشركاء</legend>
                  <div className="checks">
                    {partners.map((partner) => <label key={partner.id}><input type="checkbox" checked={editable.partnerIds.includes(partner.id.toString())} onChange={(event) => updateEditable({ partnerIds: event.target.checked ? [...editable.partnerIds, partner.id.toString()] : editable.partnerIds.filter((id) => id !== partner.id.toString()) })} /> {partner.name}</label>)}
                  </div>
                  <label className="field">شريك جديد<input className="input" value={editable.newPartner} onChange={(event) => updateEditable({ newPartner: event.target.value })} /></label>
                  <button className="button button-secondary" type="button" onClick={() => runAction(savePartners)}>حفظ الشركاء</button>
                </fieldset>
              </section>
            ) : null}

            <section className="drawer-section stack">
              <h3>الكابشن</h3>
              <div className="read-box">{captionText || "—"}</div>
              <button className="button button-secondary" type="button" onClick={() => navigator.clipboard.writeText(captionText ?? "")}>نسخ الكابشن</button>
              {item?.notes ? <p>{item.notes}</p> : null}
              <div className="actions-row">
                {productionFileUrl ? <a className="button button-secondary" href={productionFileUrl} target="_blank" rel="noreferrer">فتح ملف الإنتاج</a> : null}
                {item?.ig_permalink ? <a className="button button-secondary" href={item.ig_permalink} target="_blank" rel="noreferrer">فتح المنشور</a> : null}
              </div>
            </section>

            {item?.status === "published" && performanceData ? (
              <section className="drawer-section stack">
                <h3>الأداء</h3>
                {performanceData.signal_partial ? <p className="soft-banner">قياس ناقص</p> : null}
                <div className="metric-grid">
                  <span>الوصول <b className="num">{formatNumber(performanceData.reach)}</b></span>
                  <span>الحفظ <b className="num">{formatPercent(performanceData.save_rate)}</b></span>
                  <span>المشاركة <b className="num">{formatPercent(performanceData.share_rate)}</b></span>
                  <span>المتابعة <b className="num">{formatPercent(performanceData.follow_rate)}</b></span>
                </div>
              </section>
            ) : null}

            {item && editable && !item.is_archived ? (
              <section className="drawer-section stack">
                <h3>الإجراءات</h3>
                {item.status === "idea" && isWriter ? <button className="button" type="button" disabled={isPending} onClick={() => window.confirm("متأكد أنك جاهز للتسليم؟") && runAction(() => advance("writing"))}>تسليم</button> : null}
                {item.status === "writing" && isReviewer ? (
                  <>
                    <button className="button" type="button" disabled={isPending} onClick={() => runAction(() => advance("content_approved"))}>اعتماد</button>
                    <label className="field">ملاحظة الإعادة<textarea className="input textarea" placeholder="هذه الملاحظة هي ما سيراه الكاتب." value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} /></label>
                    <button className="button button-secondary" type="button" disabled={!rejectNote.trim() || isPending} onClick={() => runAction(() => reject("content"))}>إعادة بملاحظة</button>
                  </>
                ) : item.status === "writing" ? <p className="muted">بانتظار مراجع.</p> : null}
                {item.status === "content_approved" && (isParticipant || isAdmin) ? hasProducer ? <button className="button" type="button" disabled={isPending} onClick={() => runAction(() => advance("in_production"))}>ابدأ الإنتاج</button> : <p className="muted">بانتظار تعيين منتج.</p> : null}
                {item.status === "in_production" && isReviewer ? (
                  <>
                    <button className="button" type="button" disabled={isPending} onClick={() => runAction(() => advance("design_approved"))}>اعتماد التصميم</button>
                    <label className="field">ملاحظة الإعادة<textarea className="input textarea" placeholder="هذه الملاحظة هي ما سيراه المنتج." value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} /></label>
                    <button className="button button-secondary" type="button" disabled={!rejectNote.trim() || isPending} onClick={() => runAction(() => reject("design"))}>إعادة بملاحظة</button>
                  </>
                ) : item.status === "in_production" ? <p className="muted">{isProducer ? "بانتظار مراجع." : "بانتظار الإنتاج والمراجعة."}</p> : null}
                {item.status === "design_approved" && (isParticipant || isAdmin) ? <button className="button" type="button" disabled={isPending} onClick={() => runAction(() => advance("ready"))}>انتقل إلى جاهز للنشر</button> : null}
                {item.status === "ready" ? <p className="muted">تظهر هذه المادة في شاشة جاهز للنشر.</p> : null}
                {!item.slot_id && item.status !== "published" ? (
                  <label className="field">موعد النشر<select className="input" defaultValue="" onChange={(event) => event.target.value && runAction(() => assignSlot(event.target.value))}><option value="">اختر موعدًا</option>{drawerDetails?.openSlots.map((slot) => <option key={slot.slot_id ?? ""} value={slot.slot_id ?? ""}>{formatHebronDateTime(slot.slot_at)} · {(slot.n_items ?? 0).toLocaleString("en-US")}</option>)}</select></label>
                ) : null}
                {isAdmin && failedAdvance ? (
                  <div className="override-box">
                    <label className="field">سبب التجاوز<input className="input" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label>
                    <button className="button" type="button" disabled={!overrideReason.trim() || isPending} onClick={() => runAction(() => advance(failedAdvance, overrideReason.trim()))}>تجاوز ونفّذ</button>
                  </div>
                ) : null}
              </section>
            ) : null}

            <p className="muted">الحالة الحالية: {statusLabels[displayItem.status]}</p>
          </div>
        )}
      </aside>
    </div>
  );
}
