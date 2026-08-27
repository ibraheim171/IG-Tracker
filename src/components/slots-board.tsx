"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ItemDrawer } from "@/components/item-drawer";
import type { BoardItem, BoardSlot, IdeaTypeOption, PartnerOption, RoleName, TrackOption } from "@/lib/ui-data";
import { arabicDayName, formatHebronDateTime, relativeDayLabel } from "@/lib/ui-data";

type Props = {
  slots: BoardSlot[];
  items: BoardItem[];
  tracks: TrackOption[];
  ideaTypes: IdeaTypeOption[];
  partners: PartnerOption[];
  currentUserId: string;
  roles: RoleName[];
};

function trackStyle(color: string | null) {
  return color ? ({ "--track-color": color } as CSSProperties & { "--track-color": string }) : undefined;
}

export function SlotsBoard({ slots, items, tracks, ideaTypes, partners, currentUserId, roles }: Props) {
  const router = useRouter();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
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
    for (const item of items) {
      if (!item.slot_id) continue;
      map.set(item.slot_id, [...(map.get(item.slot_id) ?? []), item]);
    }
    return map;
  }, [items]);

  const dateKeys = Array.from(new Set(groups.map((group) => group.dateKey)));

  return (
    <main className="page wide-page stack">
      <header className="screen-head">
        <div>
          <p className="eyebrow">الجدول</p>
          <h1>خطة النشر</h1>
        </div>
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
      <ItemDrawer itemId={openItemId} onClose={() => setOpenItemId(null)} onChanged={() => router.refresh()} tracks={tracks} ideaTypes={ideaTypes} partners={partners} currentUserId={currentUserId} roles={roles} />
    </main>
  );
}
