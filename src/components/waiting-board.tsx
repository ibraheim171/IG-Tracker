"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ItemDrawer } from "@/components/item-drawer";
import { useReferenceData } from "@/components/reference-data-provider";
import type { TeamMemberOption } from "@/lib/admin-create-item";
import { fetchAdminTeamMembers } from "@/lib/admin-team-members";
import type { RoleName, WaitingItem } from "@/lib/ui-data";
import { formatHebronDateTime, isAdminRole } from "@/lib/ui-data";

type Props = {
  items: WaitingItem[];
  currentUserId: string;
  roles: RoleName[];
  loadError?: string | null;
  teamMembers?: TeamMemberOption[];
  teamMembersLoadError?: string | null;
};

function trackStyle(color: string | null) {
  return color ? ({ "--track-color": color } as CSSProperties & { "--track-color": string }) : undefined;
}

export function WaitingBoard({ items, currentUserId, roles, loadError = null, teamMembers: initialTeamMembers = [], teamMembersLoadError: initialTeamMembersLoadError = null }: Props) {
  const { tracks } = useReferenceData();
  const router = useRouter();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState(initialTeamMembers);
  const [teamMembersError, setTeamMembersError] = useState(initialTeamMembersLoadError);
  const [retryingTeamMembers, setRetryingTeamMembers] = useState(false);
  const isAdmin = isAdminRole(roles);
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

  useEffect(() => {
    setTeamMembers(initialTeamMembers);
    setTeamMembersError(initialTeamMembersLoadError);
  }, [initialTeamMembers, initialTeamMembersLoadError]);

  async function retryTeamMembers() {
    if (!isAdmin || retryingTeamMembers) return;
    setRetryingTeamMembers(true);
    const result = await fetchAdminTeamMembers();
    setTeamMembers(result.teamMembers);
    setTeamMembersError(result.error);
    setRetryingTeamMembers(false);
  }

  return (
    <main className="page wide-page stack">
      <header className="screen-head">
        <div>
          <p className="eyebrow">المتابعة</p>
          <h1>بانتظار</h1>
        </div>
      </header>

      {isAdmin && teamMembersError ? (
        <section className="card stack" role="alert">
          <p>{teamMembersError}</p>
          <button className="button button-secondary" type="button" disabled={retryingTeamMembers} onClick={() => { void retryTeamMembers(); }}>
            {retryingTeamMembers ? "جارٍ تحميل أعضاء الفريق..." : "إعادة تحميل أعضاء الفريق"}
          </button>
        </section>
      ) : null}

      {loadError ? (
        <section className="card stack" role="alert">
          <p>{loadError}</p>
          <button className="button button-secondary" type="button" onClick={() => router.refresh()}>إعادة المحاولة</button>
        </section>
      ) : groups.length ? groups.map(([waitingOn, groupItems]) => (
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

      <ItemDrawer itemId={openItemId} initialItem={openItem} onClose={() => setOpenItemId(null)} onChanged={() => router.refresh()} currentUserId={currentUserId} roles={roles} teamMembers={teamMembers} teamMembersLoadError={teamMembersError} onRetryTeamMembers={retryTeamMembers} retryingTeamMembers={retryingTeamMembers} />
    </main>
  );
}
