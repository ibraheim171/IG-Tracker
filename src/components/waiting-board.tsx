"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ItemDrawer } from "@/components/item-drawer";
import { useReferenceData } from "@/components/reference-data-provider";
import type { RoleName, WaitingItem } from "@/lib/ui-data";
import { formatHebronDateTime } from "@/lib/ui-data";

type Props = {
  items: WaitingItem[];
  currentUserId: string;
  roles: RoleName[];
};

function trackStyle(color: string | null) {
  return color ? ({ "--track-color": color } as CSSProperties & { "--track-color": string }) : undefined;
}

export function WaitingBoard({ items, currentUserId, roles }: Props) {
  const { tracks } = useReferenceData();
  const router = useRouter();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const enrichedItems = useMemo(() => items.map((item) => {
    const track = tracks.find((candidate) => candidate.id === item.track_id);
    return {
      ...item,
      track_name: item.track_name ?? track?.name ?? null,
      track_color: item.track_color ?? track?.color_hex ?? null,
      idea_type: null,
    };
  }), [items, tracks]);
  const openItem = useMemo(() => enrichedItems.find((item) => item.id === openItemId) ?? null, [enrichedItems, openItemId]);
  const groups = useMemo(() => {
    const grouped = new Map<string, WaitingItem[]>();
    for (const item of enrichedItems) {
      const key = item.waiting_on ?? "غير محدد";
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return Array.from(grouped.entries());
  }, [enrichedItems]);

  return (
    <main className="page wide-page stack">
      <header className="screen-head">
        <div>
          <p className="eyebrow">المتابعة</p>
          <h1>بانتظار</h1>
        </div>
      </header>

      {groups.length ? groups.map(([waitingOn, groupItems]) => (
        <section className="date-group" key={waitingOn}>
          <header className="date-head">
            <h2>{waitingOn}</h2>
            <span className="pill num">{groupItems.length.toLocaleString("en-US")}</span>
          </header>
          <div className="item-row-list">
            {groupItems.map((item) => (
              <button className="item-row" key={item.id} type="button" style={trackStyle(item.track_color)} onClick={() => setOpenItemId(item.id)}>
                <span className="num subtle-ref">{item.ref}</span>
                <span className="item-title">{item.title}</span>
                <span className="pill">{item.track_name ?? "—"}</span>
                {item.slot_at ? <span className="num muted">{formatHebronDateTime(item.slot_at)}</span> : null}
              </button>
            ))}
          </div>
        </section>
      )) : <section className="card"><p>لا توجد مواد بانتظار إجراء.</p></section>}

      <ItemDrawer itemId={openItemId} initialItem={openItem} onClose={() => setOpenItemId(null)} onChanged={() => router.refresh()} currentUserId={currentUserId} roles={roles} />
    </main>
  );
}
