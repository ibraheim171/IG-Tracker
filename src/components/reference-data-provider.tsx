"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { IdeaTypeOption, PartnerOption, TrackOption } from "@/lib/ui-data";

export type ReferenceData = {
  tracks: TrackOption[];
  ideaTypes: IdeaTypeOption[];
  partners: PartnerOption[];
};

const ReferenceDataContext = createContext<ReferenceData | null>(null);

export function ReferenceDataProvider({ data, children }: { data: ReferenceData; children: ReactNode }) {
  return <ReferenceDataContext.Provider value={data}>{children}</ReferenceDataContext.Provider>;
}

export function useReferenceData() {
  const data = useContext(ReferenceDataContext);
  if (!data) throw new Error("ReferenceDataProvider is missing");
  return data;
}
