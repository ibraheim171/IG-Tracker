"use client";

import { useState } from "react";
import { currentMonthRange, previousMonthRange } from "@/lib/account-pulse";
import { insightRangePreset, type InsightRange } from "@/lib/insights";
import type { InsightSection } from "@/lib/analytics-table";
import { AccountPulse } from "./account-pulse";
import { AudienceSnapshotView } from "./audience-snapshot";
import { ComparisonBuilder } from "./comparison-builder";
import { PartnerTrackMatrix } from "./partner-track-matrix";
import { PostPerformanceTable } from "./post-performance-table";
import type { TeamMemberOption } from "@/lib/admin-create-item";
import type { RoleName } from "@/lib/ui-data";

type Section = InsightSection;

const sections: Array<{ key: Section; label: string }> = [
  { key: "pulse", label: "نبض الحساب" },
  { key: "compare", label: "المقارنة" },
  { key: "matrix", label: "الشركاء × المسارات" },
  { key: "posts", label: "كل المنشورات" },
  { key: "audience", label: "الجمهور" },
];

type Props = { initialSection: Section; initialRange: InsightRange; currentUserId: string; roles: RoleName[]; teamMembers: TeamMemberOption[]; teamMembersLoadError: string | null };

export function InsightsShell({ initialSection, initialRange, currentUserId, roles, teamMembers, teamMembersLoadError }: Props) {
  const [section, setSection] = useState<Section>(initialSection);
  const [draft, setDraft] = useState(initialRange);
  const [range, setRange] = useState(initialRange);

  function applyRange(event: React.FormEvent) {
    event.preventDefault();
    setRange(draft);
  }

  function setPreset(next: InsightRange) {
    setDraft(next);
    setRange(next);
  }

  return <main className="page wide-page stack insights-page">
    <header className="screen-head"><div><p className="eyebrow">أرقام وقياسات</p><h1>الإحصائيات</h1><p className="muted">الاستنتاجات والتوصيات تبقى ضمن التقرير المعتمد؛ هذه الشاشة تعرض البيانات ومعادلاتها فقط.</p></div></header>

    <nav className="insights-tabs" aria-label="أقسام الإحصائيات">
      {sections.map((entry) => <button className={section === entry.key ? "is-active" : ""} type="button" aria-current={section === entry.key ? "page" : undefined} onClick={() => setSection(entry.key)} key={entry.key}>{entry.label}</button>)}
    </nav>

    {section !== "audience" ? <>
      <div className="range-presets" aria-label="نطاقات سريعة">
        <button className="button button-secondary" type="button" onClick={() => setPreset(currentMonthRange())}>هذا الشهر</button>
        <button className="button button-secondary" type="button" onClick={() => setPreset(previousMonthRange())}>الشهر الماضي</button>
        <button className="button button-secondary" type="button" onClick={() => setPreset(insightRangePreset("three_months"))}>3 أشهر</button>
      </div>
      <form className="card range-filter compact-range-filter" onSubmit={applyRange}>
        <label className="field">من<input className="input num" type="date" required value={draft.start} onChange={(event) => setDraft((current) => ({ ...current, start: event.target.value }))} /></label>
        <label className="field">إلى<input className="input num" type="date" required value={draft.end} onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value }))} /></label>
        <button className="button" type="submit">تطبيق النطاق</button>
      </form>
    </> : null}

    {section === "pulse" ? <AccountPulse range={range} /> : null}
    {section === "compare" ? <ComparisonBuilder range={range} currentUserId={currentUserId} roles={roles} teamMembers={teamMembers} teamMembersLoadError={teamMembersLoadError} /> : null}
    {section === "matrix" ? <PartnerTrackMatrix range={range} /> : null}
    {section === "posts" ? <PostPerformanceTable range={range} currentUserId={currentUserId} roles={roles} teamMembers={teamMembers} teamMembersLoadError={teamMembersLoadError} /> : null}
    {section === "audience" ? <AudienceSnapshotView /> : null}
  </main>;
}
