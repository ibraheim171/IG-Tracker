"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ItemDrawer } from "@/components/item-drawer";
import type { IdeaTypeOption, PartnerOption, RoleName, TrackOption, WaitingItem } from "@/lib/ui-data";
import { formatHebronDateTime } from "@/lib/ui-data";

type Props = {
  items: WaitingItem[];
  tracks: TrackOption[];
  ideaTypes: IdeaTypeOption[];
  partners: PartnerOption[];
  currentUserId: string;
  roles: RoleName[];
};

function trackStyle(color: string | null) {
  return color ? ({ "--track-color": color } as CSSProperties & { "--track-color": string }) : undefined;
}

export function WaitingBoard({ items, tracks, ideaTypes, partners, currentUserId, roles }: Props) {
  const router = useRouter();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const groups = useMemo(() => {
    const grouped = new Map<string, WaitingItem[]>();
    for (const item of items) {
      const key = item.waiting_on ?? "غير محدد";
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return Array.from(grouped.entries());
  }, [items]);

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

      <ItemDrawer itemId={openItemId} onClose={() => setOpenItemId(null)} onChanged={() => router.refresh()} tracks={tracks} ideaTypes={ideaTypes} partners={partners} currentUserId={currentUserId} roles={roles} />
    </main>
  );
}
