"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { IdeaTypeOption, PartnerOption, TrackOption } from "@/lib/ui-data";

export type ReferenceData = {
  tracks: TrackOption[];
  ideaTypes: IdeaTypeOption[];
  partners: PartnerOption[];
};

type ReferenceDataResponse = ReferenceData | { error: string };

type ReferenceDataContextValue = ReferenceData & {
  isLoading: boolean;
  error: string | null;
  refreshReferenceData: () => Promise<void>;
};

const emptyReferenceData: ReferenceData = {
  tracks: [],
  ideaTypes: [],
  partners: [],
};

const ReferenceDataContext = createContext<ReferenceDataContextValue | null>(null);

function readError(error: unknown) {
  return error instanceof Error ? error.message : "تعذر تحميل البيانات المرجعية.";
}

export function ReferenceDataProvider({ children }: { children: ReactNode }) {
  const requestSequence = useRef(0);
  const [data, setData] = useState<ReferenceData>(emptyReferenceData);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshReferenceData = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/reference-data", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = (await response.json()) as ReferenceDataResponse;

      if (sequence !== requestSequence.current) return;
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : `HTTP_${response.status}`);
      }

      setData(payload);
    } catch (caughtError) {
      if (sequence !== requestSequence.current) return;
      setError(readError(caughtError));
    } finally {
      if (sequence === requestSequence.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshReferenceData();
    return () => {
      requestSequence.current += 1;
    };
  }, [refreshReferenceData]);

  const value = useMemo<ReferenceDataContextValue>(() => ({
    ...data,
    isLoading,
    error,
    refreshReferenceData,
  }), [data, error, isLoading, refreshReferenceData]);

  return <ReferenceDataContext.Provider value={value}>{children}</ReferenceDataContext.Provider>;
}

export function useReferenceData() {
  const data = useContext(ReferenceDataContext);
  if (!data) throw new Error("ReferenceDataProvider is missing");
  return data;
}
