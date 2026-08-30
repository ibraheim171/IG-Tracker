import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ReferenceData } from "@/components/reference-data-provider";
import type { IdeaTypeOption, PartnerOption, TrackOption } from "@/lib/ui-data";

export const getReferenceData = cache(async (): Promise<ReferenceData> => {
  const supabase = await createClient();
  const [{ data: tracks }, { data: ideaTypes }, { data: partners }] = await Promise.all([
    supabase.from("tracks").select("id, name, color_hex").order("sort_order", { ascending: true }),
    supabase.from("idea_types").select("id, name").eq("active", true).order("id", { ascending: true }),
    supabase.from("partners").select("id, name").eq("active", true).order("name", { ascending: true }),
  ]);
  return {
    tracks: (tracks ?? []) as TrackOption[],
    ideaTypes: (ideaTypes ?? []) as IdeaTypeOption[],
    partners: (partners ?? []) as PartnerOption[],
  };
});
