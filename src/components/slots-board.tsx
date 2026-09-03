"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { AdminCreateItemModal } from "@/components/admin-create-item-modal";
import { ItemDrawer } from "@/components/item-drawer";
import { useReferenceData } from "@/components/reference-data-provider";
import type { TeamMemberOption } from "@/lib/admin-create-item";
import type { BoardItem, BoardSlot, RoleName } from "@/lib/ui-data";
import { arabicDayName, formatHebronDateTime, isAdminRole, relativeDayLabel } from "@/lib/ui-data";

type Props = {
  slots: BoardSlot[];
  items: BoardItem[];
  currentUserId: string;
  roles: RoleName[];
  teamMembers: TeamMemberOption[];
};

function trackStyle(color: string | null) {
  return color ? ({ "--track-color": color } as CSSProperties & { "--track-color": string }) : undefined;
}

export function SlotsBoard({ slots, items, currentUserId, roles, teamMembers }: Props) {
  const { tracks, ideaTypes } = useReferenceData();
  const router = useRouter();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const isAdmin = isAdminRole(roles);
  const enrichedItems = useMemo(() => items.map((item) => {
    const track = tracks.find((candidate) => candidate.id === item.track_id);
    const ideaType = ideaTypes.find((candidate) => candidate.id === item.idea_type_id);
    return {
      ...item,
      track_name: item.track_name ?? track?.name ?? null,
      track_color: item.track_color ?? track?.color_hex ?? null,
      idea_type: item.idea_type ?? ideaType?.name ?? null,
    };
  }), [ideaTypes, items, tracks]);
  const openItem = useMemo(() => enrichedItems.find((item) => item.id === openItemId) ?? null, [enrichedItems, openItemId]);
  const groups = useMemo(() => {
    return slots.reduce<{ dateKey: string; slot: BoardSlot }[]>((acc, slot) => {
      if (!slot.slot_at) return acc;
      const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(slot.slot_at));
      acc.push({ dateKey: key, slot });
      return acc;
    }, []);
  }, [slots]);

  const bySlot = useMemo(() => {
    const map = new Map<string, BoardItem[]>();
    for (const item of enrichedItems) {
      if (!item.slot_id) continue;
      map.set(item.slot_id, [...(map.get(item.slot_id) ?? []), item]);
    }
    return map;
  }, [enrichedItems]);

  const dateKeys = Array.from(new Set(groups.map((group) => group.dateKey)));

  return (
    <main className="page wide-page stack">
      <header className="screen-head">
        <div>
          <p className="eyebrow">الجدول</p>
          <h1>خطة النشر</h1>
        </div>
        {isAdmin ? <button className="button" type="button" onClick={() => setCreateOpen(true)}>إضافة مادة</button> : null}
      </header>
      <div className="slot-days">
        {dateKeys.map((dateKey) => {
          const firstSlot = groups.find((group) => group.dateKey === dateKey)?.slot;
          if (!firstSlot?.slot_at) return null;
          return (
            <section className="date-group" key={dateKey}>
              <header className="date-head">
                <h2>{arabicDayName(firstSlot.slot_at)}</h2>
                <span className="num">{dateKey}</span>
                <span className="pill">{relativeDayLabel(firstSlot.slot_at)}</span>
              </header>
              <div className="slot-list">
                {groups.filter((group) => group.dateKey === dateKey).map(({ slot }) => {
                  const slotItems = bySlot.get(slot.slot_id) ?? [];
                  const isEmpty = slotItems.length === 0;
                  const allPublished = slotItems.length > 0 && slotItems.every((item) => item.status === "published");
                  return (
                    <article className={`slot-card ${isEmpty ? "slot-empty" : ""}`} key={slot.slot_id}>
                      <div className="slot-topline">
                        <span className="num">{formatHebronDateTime(slot.slot_at)}</span>
                        {isEmpty ? <span className="pill empty-pill">موعد متاح</span> : allPublished ? <span className="pill">جاهزة</span> : <span className="pill num">{slotItems.length.toLocaleString("en-US")} مواد</span>}
                      </div>
                      {isEmpty ? <p className="muted">لا توجد مواد مرتبطة بهذا الموعد.</p> : (
                        <div className="item-row-list">
                          {slotItems.map((item) => (
                            <button className="item-row" type="button" key={item.id} style={trackStyle(item.track_color)} onClick={() => setOpenItemId(item.id)}>
                              <span className="item-title">{item.title}</span>
                              <span className="muted">{item.idea_type ?? "—"}</span>
                              {item.waiting_on ? <span className="pill">{item.waiting_on}</span> : null}
                            </button>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <AdminCreateItemModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(createdItem) => {
          setOpenItemId(createdItem.id);
          router.refresh();
        }}
        slots={slots}
        teamMembers={teamMembers}
      />
      <ItemDrawer itemId={openItemId} initialItem={openItem} onClose={() => setOpenItemId(null)} onChanged={() => router.refresh()} currentUserId={currentUserId} roles={roles} teamMembers={teamMembers} />
    </main>
  );
}
