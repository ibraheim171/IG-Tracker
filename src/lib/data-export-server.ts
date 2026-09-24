import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buildAiExport, type AiExport, type DataExportInput } from "@/lib/data-export";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("E_EXPORT_CONFIG");
  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function readTable<T extends keyof Database["public"]["Tables"]>(table: T, columns = "*"): Promise<Record<string, unknown>[]> {
  const { data, error } = await serviceClient().from(table).select(columns);
  if (error) throw new Error(`E_EXPORT_QUERY:${String(table)}`);
  return (data ?? []) as unknown as Record<string, unknown>[];
}

export async function readAiExport(generatedAt?: string): Promise<AiExport> {
  const [items, publishingSlots, itemParticipants, itemPartners, transitions, profiles, partners, tracks, igPosts, igItemLinks, igPostDaily, igAccountDaily, igDemographics, igCollabs, workTrackerSourceRows] = await Promise.all([
    readTable("items"),
    readTable("publishing_slots"),
    readTable("item_participants"),
    readTable("item_partners"),
    readTable("transitions"),
    readTable("profiles", "id,display_name,roles"),
    readTable("partners"),
    readTable("tracks"),
    readTable("ig_posts"),
    readTable("ig_item_links"),
    readTable("ig_post_daily"),
    readTable("ig_account_daily"),
    readTable("ig_demographics"),
    readTable("ig_collabs"),
    readTable("work_tracker_source_rows"),
  ]);

  const input: DataExportInput = {
    items,
    publishingSlots,
    itemParticipants,
    itemPartners,
    transitions,
    profiles,
    partners,
    tracks,
    igPosts,
    igItemLinks,
    igPostDaily,
    igAccountDaily,
    igDemographics,
    igCollabs,
    workTrackerSourceRows,
  };
  return buildAiExport(input, generatedAt);
}
