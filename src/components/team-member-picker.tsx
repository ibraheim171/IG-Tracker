"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { RoleName } from "@/lib/ui-data";

export type TeamMemberOption = {
  id: string;
  display_name: string;
  roles: RoleName[];
  active: boolean;
};

const roleLabels: Record<RoleName, string> = {
  writer: "كاتب",
  reviewer: "مراجع",
  producer: "منتج",
  admin: "مدير",
};

function firstVisibleLetter(displayName: string) {
  return Array.from(displayName.trim()).find((letter) => letter.trim().length > 0) ?? "؟";
}

function roleText(roles: RoleName[]) {
  return roles.map((role) => roleLabels[role]).join("، ") || "عضو";
}

export function TeamMemberPicker({ members, selectedMemberId }: { members: TeamMemberOption[]; selectedMemberId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dialogId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const selectedMember = useMemo(() => members.find((member) => member.id === selectedMemberId) ?? null, [members, selectedMemberId]);

  useEffect(() => {
    if (!open) return;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => dialogRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [open]);

  function closePicker() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function chooseMember(member: TeamMemberOption) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("member", member.id);
    setOpen(false);
    router.push(`${pathname}?${nextParams.toString()}`);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <section className="team-picker card stack" aria-labelledby="team-picker-title">
      <div className="team-picker-head">
        <div>
          <p className="eyebrow">الفريق</p>
          <h2 id="team-picker-title">اختيار عضو</h2>
        </div>
        <span className="pill num">{members.length.toLocaleString("en-US")}</span>
      </div>

      <button
        type="button"
        className="member-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        ref={triggerRef}
        onClick={() => setOpen(true)}
      >
        {selectedMember ? (
          <>
            <span className="member-avatar" aria-hidden="true">{firstVisibleLetter(selectedMember.display_name)}</span>
            <span className="member-trigger-body">
              <strong>{selectedMember.display_name}</strong>
              <span>{roleText(selectedMember.roles)}</span>
            </span>
            {!selectedMember.active ? <span className="pill">معطل</span> : null}
          </>
        ) : (
          <span className="member-trigger-placeholder">اختر عضوًا من الفريق</span>
        )}
        <span className="account-trigger-chevron" aria-hidden="true">⌄</span>
      </button>

      {open ? (
        <div className="veil" onPointerDown={closePicker}>
          <section
            className="confirm-panel team-picker-dialog stack"
            id={dialogId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-title`}
            tabIndex={-1}
            ref={dialogRef}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="team-picker-dialog-head">
              <h2 id={`${dialogId}-title`}>اختيار عضو</h2>
              <button className="icon-button" type="button" aria-label="إغلاق" onClick={closePicker}>×</button>
            </header>
            <div className="member-option-list" role="listbox" aria-label="أعضاء الفريق">
              {members.map((member) => {
                const isSelected = member.id === selectedMemberId;
                return (
                  <button
                    className={`member-option${isSelected ? " is-selected" : ""}`}
                    key={member.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => chooseMember(member)}
                  >
                    <span className="member-avatar" aria-hidden="true">{firstVisibleLetter(member.display_name)}</span>
                    <span className="member-option-body">
                      <strong>{member.display_name}</strong>
                      <span>{roleText(member.roles)}</span>
                    </span>
                    {!member.active ? <span className="pill">معطل</span> : null}
                    {isSelected ? <span className="pill">مختار</span> : null}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
