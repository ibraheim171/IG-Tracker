import { NextResponse, type NextRequest } from "next/server";
import { requireActiveRouteProfile } from "@/lib/route-auth";
import type { IdeaTypeOption, PartnerOption, TrackOption } from "@/lib/ui-data";

type ReferenceData = {
  tracks: TrackOption[];
  ideaTypes: IdeaTypeOption[];
  partners: PartnerOption[];
};

export const dynamic = "force-dynamic";
export const preferredRegion = "hnd1";

function jsonWithCookies(source: NextResponse, body: ReferenceData | { error: string; code?: string }, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  for (const cookie of source.cookies.getAll()) {
    const { name, value, ...options } = cookie;
    response.cookies.set(name, value, options);
  }
  return response;
}

export async function GET(request: NextRequest) {
  const cookieResponse = NextResponse.next();
  const auth = await requireActiveRouteProfile(request, cookieResponse);
  if (!auth.ok) return jsonWithCookies(cookieResponse, { error: auth.error.message, code: auth.error.code }, { status: auth.error.status });
  const { supabase } = auth;

  const [tracksResult, ideaTypesResult, partnersResult] = await Promise.all([
    supabase.from("tracks").select("id, name, color_hex").order("sort_order", { ascending: true }),
    supabase.from("idea_types").select("id, name").eq("active", true).order("id", { ascending: true }),
    supabase.from("partners").select("id, name").eq("active", true).order("name", { ascending: true }),
  ]);

  if (tracksResult.error || ideaTypesResult.error || partnersResult.error) {
    return jsonWithCookies(cookieResponse, { error: "تعذر تحميل البيانات المرجعية." }, { status: 500 });
  }

  return jsonWithCookies(cookieResponse, {
    tracks: tracksResult.data ?? [],
    ideaTypes: ideaTypesResult.data ?? [],
    partners: partnersResult.data ?? [],
  });
}
