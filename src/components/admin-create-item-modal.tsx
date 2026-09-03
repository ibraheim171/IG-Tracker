"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AdminCreateItemPayload, AdminCreatedItem, AdminCreatedTrack, TeamMemberOption } from "@/lib/admin-create-item";
import type { BoardSlot } from "@/lib/ui-data";
import { formatHebronDateTime } from "@/lib/ui-data";
import { useReferenceData } from "@/components/reference-data-provider";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (item: AdminCreatedItem) => void;
  slots: BoardSlot[];
  teamMembers: TeamMemberOption[];
};

type FormState = {
  title: string;
  track_id: string;
  idea_type_id: string;
  caption: string;
  notes: string;
  writer_delivery_url: string;
  production_file_url: string;
  partner_ids: string[];
  new_partner_name: string;
  writer_id: string;
  producer_id: string;
  reviewer_id: string;
  slot_id: string;
};

type TrackState = {
  name: string;
  color_hex: string;
  sort_order: string;
};

const emptyForm: FormState = {
  title: "",
  track_id: "",
  idea_type_id: "",
  caption: "",
  notes: "",
  writer_delivery_url: "",
  production_file_url: "",
  partner_ids: [],
  new_partner_name: "",
  writer_id: "",
  producer_id: "",
  reviewer_id: "",
  slot_id: "",
};

const emptyTrack: TrackState = {
  name: "",
  color_hex: "#1E8F8B",
  sort_order: "",
};

function memberLabel(member: TeamMemberOption) {
  return `${member.display_name} — ${member.email}`;
}

function membersByRole(teamMembers: TeamMemberOption[], role: "writer" | "producer" | "reviewer") {
  return teamMembers
    .filter((member) => member.roles.includes(role))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ar"));
}

function optionalString(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function AdminCreateItemModal({ open, onClose, onCreated, slots, teamMembers }: Props) {
  const { tracks, ideaTypes, partners, refreshReferenceData } = useReferenceData();
  const panelRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [trackForm, setTrackForm] = useState<TrackState>(emptyTrack);
  const [showTrackForm, setShowTrackForm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [savingTrack, setSavingTrack] = useState(false);

  const writers = useMemo(() => membersByRole(teamMembers, "writer"), [teamMembers]);
  const producers = useMemo(() => membersByRole(teamMembers, "producer"), [teamMembers]);
  const reviewers = useMemo(() => membersByRole(teamMembers, "reviewer"), [teamMembers]);
  const availableSlots = useMemo(() => {
    const now = Date.now();
    return slots.filter((slot) => slot.slot_id && slot.slot_at && new Date(slot.slot_at).getTime() >= now);
  }, [slots]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusId = window.setTimeout(() => panelRef.current?.focus(), 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusId);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function patchForm(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function patchTrack(patch: Partial<TrackState>) {
    setTrackForm((current) => ({ ...current, ...patch }));
  }

  function handleClose() {
    if (savingItem || savingTrack) return;
    onClose();
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }

  function resetForm() {
    setForm(emptyForm);
    setTrackForm(emptyTrack);
    setShowTrackForm(false);
    setMessage(null);
  }

  async function createTrack() {
    if (savingTrack || !trackForm.name.trim()) return;
    setSavingTrack(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name: trackForm.name,
          color_hex: trackForm.color_hex,
          sort_order: trackForm.sort_order ? Number(trackForm.sort_order) : null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { track?: AdminCreatedTrack; error?: string };
      if (!response.ok || !payload.track) {
        setMessage(payload.error ?? "تعذر إنشاء المسار. رمز التشخيص: TRACK_CREATE_UI.");
        return;
      }

      await refreshReferenceData();
      patchForm({ track_id: payload.track.id.toString() });
      setTrackForm(emptyTrack);
      setShowTrackForm(false);
      setMessage("تمت إضافة المسار واختياره.");
    } finally {
      setSavingTrack(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingItem) return;
    setSavingItem(true);
    setMessage(null);
    try {
      const payload: AdminCreateItemPayload = {
        title: form.title,
        track_id: form.track_id ? Number(form.track_id) : null,
        idea_type_id: form.idea_type_id ? Number(form.idea_type_id) : null,
        caption: optionalString(form.caption),
        notes: optionalString(form.notes),
        writer_delivery_url: optionalString(form.writer_delivery_url),
        production_file_url: optionalString(form.production_file_url),
        partner_ids: form.partner_ids.map(Number),
        new_partner_name: optionalString(form.new_partner_name),
        writer_id: form.writer_id,
        producer_id: optionalString(form.producer_id),
        reviewer_id: optionalString(form.reviewer_id),
        slot_id: optionalString(form.slot_id),
      };
      const response = await fetch("/api/admin/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as { item?: AdminCreatedItem; error?: string };
      if (!response.ok || !result.item) {
        setMessage(result.error ?? "تعذر إنشاء المادة. رمز التشخيص: ITEM_CREATE_UI.");
        return;
      }

      resetForm();
      onCreated(result.item);
      onClose();
      window.setTimeout(() => returnFocusRef.current?.focus(), 0);
    } finally {
      setSavingItem(false);
    }
  }

  if (!open) return null;

  const canSubmit = Boolean(form.title.trim() && form.writer_id && !savingItem);

  return (
    <div className="veil" onClick={handleClose}>
      <section
        aria-labelledby="admin-create-item-title"
        aria-modal="true"
        className="confirm-panel create-item-panel stack"
        onClick={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="screen-head">
          <div>
            <p className="eyebrow">الأدمن</p>
            <h2 id="admin-create-item-title">إضافة مادة</h2>
          </div>
          <button className="icon-button" type="button" onClick={handleClose} aria-label="إغلاق">×</button>
        </header>

        {message ? <p className="notice" role="status">{message}</p> : null}

        <form className="stack" onSubmit={submit}>
          <label className="field">العنوان<input className="input" required value={form.title} onChange={(event) => patchForm({ title: event.target.value })} /></label>
          <div className="form-grid">
            <label className="field">المسار<select className="input" value={form.track_id} onChange={(event) => patchForm({ track_id: event.target.value })}><option value="">—</option>{tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
            <div className="field">
              <span>مسار جديد</span>
              <button className="button button-secondary" type="button" onClick={() => setShowTrackForm((current) => !current)}>إضافة مسار جديد</button>
            </div>
          </div>

          {showTrackForm ? (
            <fieldset className="drawer-partners stack">
              <legend>إضافة مسار جديد</legend>
              <div className="form-grid">
                <label className="field">اسم المسار<input className="input" value={trackForm.name} onChange={(event) => patchTrack({ name: event.target.value })} /></label>
                <label className="field">لون المسار<input className="input" type="color" value={trackForm.color_hex} onChange={(event) => patchTrack({ color_hex: event.target.value })} /></label>
              </div>
              <label className="field">ترتيب العرض<input className="input" inputMode="numeric" value={trackForm.sort_order} onChange={(event) => patchTrack({ sort_order: event.target.value.replace(/\D/g, "") })} /></label>
              <button className="button button-secondary" type="button" disabled={!trackForm.name.trim() || savingTrack} onClick={createTrack}>حفظ المسار</button>
            </fieldset>
          ) : null}

          <label className="field">نوع الفكرة<select className="input" value={form.idea_type_id} onChange={(event) => patchForm({ idea_type_id: event.target.value })}><option value="">—</option>{ideaTypes.map((ideaType) => <option key={ideaType.id} value={ideaType.id}>{ideaType.name}</option>)}</select></label>
          <label className="field">الكابشن<textarea className="input textarea" value={form.caption} onChange={(event) => patchForm({ caption: event.target.value })} /></label>
          <label className="field">الملاحظات<textarea className="input textarea" value={form.notes} onChange={(event) => patchForm({ notes: event.target.value })} /></label>
          <div className="form-grid">
            <label className="field">رابط تسليم الكاتب<input className="input" inputMode="url" value={form.writer_delivery_url} onChange={(event) => patchForm({ writer_delivery_url: event.target.value })} placeholder="https://..." /></label>
            <label className="field">رابط ملف الإنتاج<input className="input" inputMode="url" value={form.production_file_url} onChange={(event) => patchForm({ production_file_url: event.target.value })} placeholder="https://..." /></label>
          </div>

          <div className="form-grid">
            <label className="field">الكاتب المسؤول<select className="input" required value={form.writer_id} onChange={(event) => patchForm({ writer_id: event.target.value })}><option value="">اختر الكاتب</option>{writers.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label>
            <label className="field">المنتج المسؤول<select className="input" value={form.producer_id} onChange={(event) => patchForm({ producer_id: event.target.value })}><option value="">—</option>{producers.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label>
          </div>
          <label className="field">المراجع المسؤول<select className="input" value={form.reviewer_id} onChange={(event) => patchForm({ reviewer_id: event.target.value })}><option value="">—</option>{reviewers.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label>

          <fieldset className="drawer-partners">
            <legend>الشركاء</legend>
            <div className="drawer-partner-checks">
              {partners.map((partner) => (
                <label className="drawer-partner-option" key={partner.id}>
                  <input
                    type="checkbox"
                    checked={form.partner_ids.includes(partner.id.toString())}
                    onChange={(event) => patchForm({ partner_ids: event.target.checked ? [...form.partner_ids, partner.id.toString()] : form.partner_ids.filter((id) => id !== partner.id.toString()) })}
                  />
                  <span>{partner.name}</span>
                </label>
              ))}
            </div>
            <div className="drawer-new-partner stack">
              <label className="field">شريك جديد<input className="input" value={form.new_partner_name} onChange={(event) => patchForm({ new_partner_name: event.target.value })} /></label>
            </div>
          </fieldset>

          <label className="field">موعد النشر<select className="input" value={form.slot_id} onChange={(event) => patchForm({ slot_id: event.target.value })}><option value="">—</option>{availableSlots.map((slot) => <option key={slot.slot_id} value={slot.slot_id}>{formatHebronDateTime(slot.slot_at)} · {(slot.n_items ?? 0).toLocaleString("en-US")}</option>)}</select></label>

          <div className="actions-row">
            <button className="button" type="submit" disabled={!canSubmit}>إنشاء المادة</button>
            <button className="button button-secondary" type="button" disabled={savingItem || savingTrack} onClick={handleClose}>إلغاء</button>
          </div>
        </form>
      </section>
    </div>
  );
}
