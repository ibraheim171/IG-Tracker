"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ItemDrawer } from "@/components/item-drawer";
import type { IdeaTypeOption, MyMaterial, PartnerOption, RoleName, TrackOption } from "@/lib/ui-data";
import { formatHebronDateTime, statusLabels } from "@/lib/ui-data";

type Props = {
  materials: MyMaterial[];
  tracks: TrackOption[];
  ideaTypes: IdeaTypeOption[];
  partners: PartnerOption[];
  currentUserId: string;
  roles: RoleName[];
};

function trackStyle(color: string | null) {
  return color ? ({ "--track-color": color } as CSSProperties & { "--track-color": string }) : undefined;
}

export function MyMaterials({ materials, tracks, ideaTypes, partners, currentUserId, roles }: Props) {
  const router = useRouter();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const current = materials.filter((material) => material.part === "writer" && material.item.status === "idea");
  const previous = materials.filter((material) => !(material.part === "writer" && material.item.status === "idea"));

  return (
    <main className="page wide-page stack">
      <header className="screen-head">
        <div>
          <p className="eyebrow">شخصي</p>
          <h1>موادي</h1>
        </div>
      </header>

      <section className="date-group">
        <header className="date-head">
          <h2>لم تُسلَّم بعد</h2>
          <span className="pill num">{current.length.toLocaleString("en-US")}</span>
        </header>
        {current.length ? <div className="item-row-list">{current.map((material) => (
          <button className="item-row title-forward" key={material.item_id} type="button" style={trackStyle(material.item.track_color)} onClick={() => setOpenItemId(material.item_id)}>
            <span className="item-title">{material.item.title}</span>
            <span className="pill">{material.item.track_name ?? "—"}</span>
            <span className="muted">{material.item.idea_type ?? "—"}</span>
          </button>
        ))}</div> : <p className="muted">لا توجد مواد قيد الكتابة.</p>}
      </section>

      <section className="date-group">
        <header className="date-head">
          <h2>مواد سابقة</h2>
          <span className="pill num">{previous.length.toLocaleString("en-US")}</span>
        </header>
        {previous.length ? <div className="item-row-list">{previous.map((material) => (
          <button className="item-row title-forward" key={`${material.item_id}-${material.part}`} type="button" style={trackStyle(material.item.track_color)} onClick={() => setOpenItemId(material.item_id)}>
            <span className="item-title">{material.item.title}</span>
            <span className="pill">{statusLabels[material.item.status]}</span>
            {material.item.slot_at ? <span className="num muted">{formatHebronDateTime(material.item.slot_at)}</span> : null}
          </button>
        ))}</div> : <p className="muted">لا توجد مواد سابقة.</p>}
      </section>

      <ItemDrawer itemId={openItemId} onClose={() => setOpenItemId(null)} onChanged={() => router.refresh()} tracks={tracks} ideaTypes={ideaTypes} partners={partners} currentUserId={currentUserId} roles={roles} largeCaption />
    </main>
  );
}
