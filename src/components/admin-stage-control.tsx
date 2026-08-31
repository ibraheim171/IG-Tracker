"use client";

import { useEffect, useRef, useState } from "react";
import type { Tables } from "@/lib/database.types";
import type { ItemStatus, RoleName } from "@/lib/ui-data";
import { formatHebronDateTime, isAdminRole } from "@/lib/ui-data";

type ItemRow = Tables<"items">;

export type AdminStageCurrentSlot = Pick<Tables<"publishing_slots">, "id" | "slot_at" | "state">;

type SlotDecision = "keep" | "clear";

type Props = {
  item: ItemRow;
  currentSlot: AdminStageCurrentSlot | null;
  roles: RoleName[];
  onChanged: () => void;
};

type AdminStageRouteResponse = { item: ItemRow | null } | { error: string };
type ItemDetailsProbeResponse = { details?: { item?: Pick<ItemRow, "status"> | null }; error?: string };

const adminStageOptions: { value: Exclude<ItemStatus, "published">; label: string }[] = [
  { value: "idea", label: "الكتابة" },
  { value: "writing", label: "اعتماد المحتوى" },
  { value: "content_approved", label: "الإنتاج" },
  { value: "in_production", label: "اعتماد التصميم" },
  { value: "design_approved", label: "استيفاء شروط الجاهزية" },
  { value: "ready", label: "جاهز للنشر" },
  { value: "cancelled", label: "ملغاة" },
];

const routeFallbackError = "تعذر تغيير المرحلة. حاول مجددًا. رمز التشخيص: ADMIN_STAGE_SERVER";
const networkVerificationError = "تعذر تأكيد نتيجة تغيير المرحلة. أغلق البطاقة وأعد فتحها قبل المحاولة. رمز التشخيص: ADMIN_STAGE_NETWORK";

function stageLabel(status: ItemStatus) {
  if (status === "published") return "منشورة";
  return adminStageOptions.find((option) => option.value === status)?.label ?? status;
}

function isPastSlot(slot: AdminStageCurrentSlot | null) {
  return Boolean(slot?.slot_at && new Date(slot.slot_at).getTime() < Date.now());
}

async function readAdminStageResponse(response: Response) {
  try {
    return (await response.json()) as AdminStageRouteResponse;
  } catch {
    return null;
  }
}

function adminStageError(payload: AdminStageRouteResponse | null) {
  if (payload && "error" in payload && payload.error) return payload.error;
  return routeFallbackError;
}

export function AdminStageControl({ item, currentSlot, roles, onChanged }: Props) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const stageDialogRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const stageReturnFocusRef = useRef<HTMLElement | null>(null);
  const actionInFlightRef = useRef(false);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [slotDecision, setSlotDecision] = useState<SlotDecision>("keep");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stagePickerOpen, setStagePickerOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const isAdmin = isAdminRole(roles);
  const trimmedReason = reason.trim();
  const selectedLabel = target ? stageLabel(target as ItemStatus) : "";
  const slotLoadFailed = Boolean(item.slot_id && !currentSlot);
  const hasSlot = Boolean(item.slot_id && currentSlot);
  const slotIsPast = isPastSlot(currentSlot);
  const canReview = Boolean(target && trimmedReason.length >= 5 && trimmedReason.length <= 500 && !actionBusy && !slotLoadFailed);

  useEffect(() => {
    if (!confirmOpen) return;

    const focusId = window.setTimeout(() => dialogRef.current?.focus(), 0);

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!actionInFlightRef.current) closeConfirm();
      }
    }

    document.addEventListener("keydown", handleKeydown);
    return () => {
      window.clearTimeout(focusId);
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [confirmOpen]);

  useEffect(() => {
    if (!stagePickerOpen) return;

    const focusId = window.setTimeout(() => stageDialogRef.current?.focus(), 0);

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeStagePicker();
      }
    }

    document.addEventListener("keydown", handleKeydown);
    return () => {
      window.clearTimeout(focusId);
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [stagePickerOpen]);

  function openStagePicker() {
    if (actionBusy || slotLoadFailed) return;
    stageReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStagePickerOpen(true);
  }

  function closeStagePicker() {
    setStagePickerOpen(false);
    window.setTimeout(() => {
      stageReturnFocusRef.current?.focus();
      stageReturnFocusRef.current = null;
    }, 0);
  }

  function chooseStage(value: Exclude<ItemStatus, "published">) {
    if (value === item.status) return;
    setTarget(value);
    setStagePickerOpen(false);
    window.setTimeout(() => {
      stageReturnFocusRef.current?.focus();
      stageReturnFocusRef.current = null;
    }, 0);
  }

  function openConfirm() {
    if (slotLoadFailed) {
      setMessage("تعذر تحميل موعد النشر المرتبط. أعد المحاولة قبل تغيير المرحلة.");
      return;
    }
    if (!canReview) {
      setMessage("اختر المرحلة الجديدة واكتب سببًا واضحًا من 5 إلى 500 حرف.");
      return;
    }
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMessage(null);
    setSlotDecision("keep");
    setConfirmOpen(true);
  }

  function closeConfirm() {
    if (actionInFlightRef.current) return;
    setConfirmOpen(false);
    window.setTimeout(() => {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    }, 0);
  }

  function finishSuccessfulChange() {
    setConfirmOpen(false);
    setTarget("");
    setReason("");
    setSlotDecision("keep");
    setMessage("تم تغيير المرحلة.");
    try {
      onChanged();
    } catch {
      setMessage("تم تغيير المرحلة. أعد فتح البطاقة لتحديث العرض.");
    }
  }

  async function verifyStageAfterInterruptedResponse(expectedTarget: ItemStatus) {
    try {
      const response = await fetch(`/api/item-details?itemId=${encodeURIComponent(item.id)}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) return false;

      const payload = (await response.json()) as ItemDetailsProbeResponse;
      return payload.details?.item?.status === expectedTarget;
    } catch {
      return false;
    }
  }

  async function submitChange() {
    if (!target || !canReview || actionInFlightRef.current) return;
    const requestedTarget = target as ItemStatus;
    actionInFlightRef.current = true;
    setActionBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/change-item-stage", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          itemId: item.id,
          target: requestedTarget,
          reason: trimmedReason,
          clearSlot: hasSlot && slotDecision === "clear",
        }),
      });
      const payload = await readAdminStageResponse(response);

      if (!response.ok || (payload && "error" in payload)) {
        setMessage(adminStageError(payload));
        return;
      }

      finishSuccessfulChange();
    } catch {
      const verified = await verifyStageAfterInterruptedResponse(requestedTarget);
      if (verified) {
        finishSuccessfulChange();
        return;
      }

      setMessage(networkVerificationError);
    } finally {
      actionInFlightRef.current = false;
      setActionBusy(false);
    }
  }

  if (!isAdmin) return null;
  if (item.is_archived) return null;

  if (item.status === "published") {
    return (
      <section className="drawer-section stack">
        <h3>إدارة المرحلة</h3>
        <p className="muted">هذه المادة منشورة وتُعامل كسجل تاريخي. لا تُعاد لمرحلة سابقة من هنا.</p>
      </section>
    );
  }

  return (
    <section className="drawer-section admin-stage stack">
      <h3>إدارة المرحلة</h3>
      {message && !confirmOpen ? <p className="notice" role="alert">{message}</p> : null}
      {slotLoadFailed ? <p className="notice" role="alert">تعذر تحميل موعد النشر المرتبط. أعد المحاولة قبل تغيير المرحلة.</p> : null}
      <p className="muted">المرحلة الحالية: {stageLabel(item.status)}</p>
      <div className="field">
        <span>المرحلة الجديدة</span>
        <button
          aria-expanded={stagePickerOpen}
          aria-haspopup="dialog"
          className="input"
          disabled={actionBusy || slotLoadFailed}
          onClick={openStagePicker}
          type="button"
        >
          {selectedLabel || "اختر المرحلة"}
        </button>
      </div>
      <label className="field">
        سبب تغيير المرحلة
        <textarea
          className="input textarea"
          value={reason}
          disabled={actionBusy || slotLoadFailed}
          onChange={(event) => setReason(event.target.value)}
          placeholder="اكتب سببًا واضحًا سيبقى محفوظًا في سجل الانتقالات."
        />
      </label>
      <button className="button" type="button" disabled={!canReview} onClick={openConfirm}>مراجعة تغيير المرحلة</button>

      {stagePickerOpen ? (
        <div className="veil" onClick={(event) => { event.stopPropagation(); closeStagePicker(); }}>
          <section
            aria-labelledby="admin-stage-picker-title"
            aria-modal="true"
            className="confirm-panel stack"
            onClick={(event) => event.stopPropagation()}
            ref={stageDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="admin-stage-picker-title">اختيار المرحلة الجديدة</h2>
            <p className="muted">المرحلة الحالية: {stageLabel(item.status)}</p>
            <div className="read-box stack">
              {adminStageOptions.filter((stage) => stage.value !== "cancelled").map((stage) => {
                const isCurrent = stage.value === item.status;
                const isSelected = stage.value === target;
                return (
                  <button
                    aria-disabled={isCurrent}
                    aria-pressed={isSelected}
                    className={`radio-row ${isSelected ? "step is-current" : ""}`}
                    disabled={isCurrent}
                    key={stage.value}
                    onClick={() => chooseStage(stage.value)}
                    type="button"
                  >
                    <span>{stage.label}</span>
                    {isCurrent ? <span className="pill">الحالية</span> : null}
                    {isSelected ? <span className="pill">مختارة</span> : null}
                  </button>
                );
              })}
              <div className="override-box">
                <p className="eyebrow">إجراء مختلف</p>
                {adminStageOptions.filter((stage) => stage.value === "cancelled").map((stage) => {
                  const isCurrent = stage.value === item.status;
                  const isSelected = stage.value === target;
                  return (
                    <button
                      aria-disabled={isCurrent}
                      aria-pressed={isSelected}
                      className="radio-row button-secondary"
                      disabled={isCurrent}
                      key={stage.value}
                      onClick={() => chooseStage(stage.value)}
                      type="button"
                    >
                      <span>{stage.label}</span>
                      {isCurrent ? <span className="pill">الحالية</span> : null}
                      {isSelected ? <span className="pill">مختارة</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <button className="button button-secondary" type="button" onClick={closeStagePicker}>إلغاء</button>
          </section>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="veil" onClick={(event) => { event.stopPropagation(); if (!actionInFlightRef.current) closeConfirm(); }}>
          <section
            aria-labelledby="admin-stage-confirm-title"
            aria-modal="true"
            className="confirm-panel stack"
            onClick={(event) => event.stopPropagation()}
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="admin-stage-confirm-title">تأكيد تغيير المرحلة</h2>
            <p><span className="num ref-pill">{item.ref}</span></p>
            <p className="stage-change-line">{stageLabel(item.status)} ← {selectedLabel}</p>
            <div className="read-box">{trimmedReason}</div>
            {message ? <p className="notice" role="alert">{message}</p> : null}
            {hasSlot ? (
              <fieldset className="admin-stage-slot stack" disabled={actionBusy}>
                <legend>موعد النشر</legend>
                <p className="num">{formatHebronDateTime(currentSlot?.slot_at)}</p>
                {slotIsPast ? <p className="notice">هذا الموعد مضى. لا يتم إلغاؤه تلقائيًا؛ القرار للأدمن.</p> : null}
                <label className="radio-row">
                  <input type="radio" name="slotDecision" value="keep" checked={slotDecision === "keep"} onChange={() => setSlotDecision("keep")} />
                  <span>الاحتفاظ بموعد النشر</span>
                </label>
                <label className="radio-row">
                  <input type="radio" name="slotDecision" value="clear" checked={slotDecision === "clear"} onChange={() => setSlotDecision("clear")} />
                  <span>إلغاء موعد النشر وإعادته للمواعيد المتاحة</span>
                </label>
              </fieldset>
            ) : null}
            <div className="actions-row">
              <button className="button" type="button" disabled={actionBusy} onClick={() => { void submitChange(); }}>{actionBusy ? "جارٍ التنفيذ..." : "تأكيد التغيير"}</button>
              <button className="button button-secondary" type="button" disabled={actionBusy} onClick={closeConfirm}>إلغاء</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
