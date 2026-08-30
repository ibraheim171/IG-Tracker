"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/database.types";
import type { ItemStatus, RoleName } from "@/lib/ui-data";
import { extractMessage, formatHebronDateTime, isAdminRole, parseRuleMessage } from "@/lib/ui-data";

type ItemRow = Tables<"items">;

export type AdminStageCurrentSlot = Pick<Tables<"publishing_slots">, "id" | "slot_at" | "state">;

type SlotDecision = "keep" | "clear";

type Props = {
  item: ItemRow;
  currentSlot: AdminStageCurrentSlot | null;
  roles: RoleName[];
  onChanged: () => void;
};

type AdminStageRpc = (
  fn: "admin_change_item_stage",
  args: {
    p_item: string;
    p_to: ItemStatus;
    p_reason: string;
    p_clear_slot: boolean;
  },
) => PromiseLike<{ data: ItemRow | null; error: { message?: string } | null }>;

const adminStageOptions: { value: Exclude<ItemStatus, "published">; label: string }[] = [
  { value: "idea", label: "كتابة الكابشن" },
  { value: "writing", label: "اعتماد المحتوى" },
  { value: "content_approved", label: "الإنتاج" },
  { value: "in_production", label: "اعتماد التصميم" },
  { value: "design_approved", label: "استيفاء شروط الجاهزية" },
  { value: "ready", label: "جاهز للنشر" },
  { value: "cancelled", label: "ملغاة" },
];

function stageLabel(status: ItemStatus) {
  if (status === "published") return "منشورة";
  return adminStageOptions.find((option) => option.value === status)?.label ?? status;
}

function isPastSlot(slot: AdminStageCurrentSlot | null) {
  return Boolean(slot?.slot_at && new Date(slot.slot_at).getTime() < Date.now());
}

export function AdminStageControl({ item, currentSlot, roles, onChanged }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const dialogRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [slotDecision, setSlotDecision] = useState<SlotDecision>("keep");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isAdmin = isAdminRole(roles);
  const trimmedReason = reason.trim();
  const availableStages = adminStageOptions.filter((option) => option.value !== item.status);
  const selectedLabel = target ? stageLabel(target as ItemStatus) : "";
  const hasSlot = Boolean(item.slot_id && currentSlot);
  const slotIsPast = isPastSlot(currentSlot);
  const canReview = Boolean(target && trimmedReason.length >= 5 && trimmedReason.length <= 500 && !isPending);

  useEffect(() => {
    if (!confirmOpen) return;

    const focusId = window.setTimeout(() => dialogRef.current?.focus(), 0);

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeConfirm();
      }
    }

    document.addEventListener("keydown", handleKeydown);
    return () => {
      window.clearTimeout(focusId);
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [confirmOpen]);

  function openConfirm() {
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
    setConfirmOpen(false);
    window.setTimeout(() => {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    }, 0);
  }

  async function submitChange() {
    if (!target || !canReview || isPending) return;
    const rpc = supabase.rpc as unknown as AdminStageRpc;
    const { error } = await rpc("admin_change_item_stage", {
      p_item: item.id,
      p_to: target as ItemStatus,
      p_reason: trimmedReason,
      p_clear_slot: hasSlot && slotDecision === "clear",
    });

    if (error) {
      setMessage(parseRuleMessage(extractMessage(error)));
      return;
    }

    setConfirmOpen(false);
    setTarget("");
    setReason("");
    setSlotDecision("keep");
    setMessage("تم تغيير المرحلة.");
    onChanged();
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
      {message ? <p className="notice" role="alert">{message}</p> : null}
      <p className="muted">المرحلة الحالية: {stageLabel(item.status)}</p>
      <label className="field">
        المرحلة الجديدة
        <select className="input" value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">اختر المرحلة</option>
          {availableStages.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
        </select>
      </label>
      <label className="field">
        سبب تغيير المرحلة
        <textarea
          className="input textarea"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="اكتب سببًا واضحًا سيبقى محفوظًا في سجل الانتقالات."
        />
      </label>
      <button className="button" type="button" disabled={!canReview} onClick={openConfirm}>مراجعة تغيير المرحلة</button>

      {confirmOpen ? (
        <div className="veil" onClick={(event) => { event.stopPropagation(); closeConfirm(); }}>
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
            {hasSlot ? (
              <fieldset className="admin-stage-slot stack">
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
              <button className="button" type="button" disabled={isPending} onClick={() => startTransition(() => { void submitChange(); })}>تأكيد التغيير</button>
              <button className="button button-secondary" type="button" disabled={isPending} onClick={closeConfirm}>إلغاء</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
