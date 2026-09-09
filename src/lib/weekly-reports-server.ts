import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { Database, Tables, TablesInsert } from "@/lib/database.types";
import { requireActiveRouteProfile } from "@/lib/route-auth";
import {
  canManageWeeklyReports,
  canReadWeeklyReport,
  classifyWeeklyReportBackendError,
  isSameOriginAppRequest,
  weeklyReportError,
  weeklyReportsBucket,
} from "@/lib/weekly-reports";

export type WeeklyReport = Tables<"weekly_reports">;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !isHttpsUrl(url)) throw new Error("E_REPORT_CONFIG");
  return createSupabaseClient<Database>(
    url,
    key,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
  );
}

function isHttpsUrl(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export function responseWithRouteCookies(body: object, status: number, source: NextResponse) {
  const response = NextResponse.json(body, { status });
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

export function bytesWithRouteCookies(bytes: Uint8Array, headers: HeadersInit, source: NextResponse) {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const response = new NextResponse(body, { status: 200, headers });
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

export async function requireWeeklyReportAdmin(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  const sameOrigin = isSameOriginAppRequest({
    appOrigin: request.nextUrl.origin,
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    fetchSite: request.headers.get("sec-fetch-site"),
  });
  if (!sameOrigin) {
    return { ok: false as const, response: responseWithRouteCookies({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403, sessionResponse) };
  }
  const auth = await requireActiveRouteProfile(request, sessionResponse);
  if (!auth.ok) {
    return { ok: false as const, response: responseWithRouteCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, sessionResponse) };
  }
  if (!canManageWeeklyReports(auth.profile)) {
    return { ok: false as const, response: responseWithRouteCookies({ error: "غير مصرح لك بإدارة التقارير الأسبوعية.", code: "E_FORBIDDEN" }, 403, sessionResponse) };
  }
  return { ok: true as const, actorId: auth.user.id, sessionResponse };
}

export async function requireWeeklyReportReader(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  const sameOrigin = isSameOriginAppRequest({ appOrigin: request.nextUrl.origin, origin: request.headers.get("origin"), referer: request.headers.get("referer"), fetchSite: request.headers.get("sec-fetch-site") });
  if (!sameOrigin) {
    return { ok: false as const, response: responseWithRouteCookies({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403, sessionResponse) };
  }
  const auth = await requireActiveRouteProfile(request, sessionResponse);
  if (!auth.ok) {
    return { ok: false as const, response: responseWithRouteCookies({ error: auth.error.message, code: auth.error.code }, auth.error.status, sessionResponse) };
  }
  return { ok: true as const, profile: auth.profile, sessionResponse };
}

export function assertWeeklyReportReadable(profile: { active: boolean; roles: string[] }, report: WeeklyReport) {
  if (!canReadWeeklyReport(profile, report)) throw new Error("E_REPORT_NOT_FOUND");
}

export const weeklyReportStore = {
  async list(publishedOnly = false) {
    let query = serviceClient().from("weekly_reports").select("*").order("created_at", { ascending: false });
    if (publishedOnly) query = query.not("published_at", "is", null);
    const { data, error } = await query;
    if (error) throw new Error(classifyWeeklyReportBackendError(error, "E_REPORT_LIST"));
    return data ?? [];
  },
  async get(id: string) {
    const { data, error } = await serviceClient().from("weekly_reports").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(classifyWeeklyReportBackendError(error, "E_REPORT_READ"));
    return data;
  },
  async upload(path: string, bytes: Uint8Array) {
    const { error } = await serviceClient().storage.from(weeklyReportsBucket).upload(path, bytes, {
      contentType: "text/html",
      cacheControl: "0",
      upsert: false,
    });
    if (error) throw new Error("E_REPORT_UPLOAD");
  },
  async insert(row: TablesInsert<"weekly_reports">) {
    const { data, error } = await serviceClient().from("weekly_reports").insert(row).select("*").single();
    if (error || !data) throw new Error("E_REPORT_METADATA");
    return data;
  },
  async update(id: string, values: Partial<Pick<WeeklyReport, "title" | "period_start" | "period_end" | "published_at" | "published_by">>) {
    const { data, error } = await serviceClient().from("weekly_reports").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
    if (error || !data) throw new Error("E_REPORT_METADATA");
    return data;
  },
  async delete(id: string) {
    const report = await this.get(id);
    if (!report) throw new Error("E_REPORT_NOT_FOUND");
    const { error } = await serviceClient().from("weekly_reports").delete().eq("id", id);
    if (error) throw new Error("E_REPORT_DELETE");
    const { error: storageError } = await serviceClient().storage.from(weeklyReportsBucket).remove([report.storage_path]);
    if (storageError) throw new Error("E_REPORT_FILE_DELETE");
  },
  async remove(path: string) {
    await serviceClient().storage.from(weeklyReportsBucket).remove([path]);
  },
  async download(path: string) {
    const { data, error } = await serviceClient().storage.from(weeklyReportsBucket).download(path);
    if (error || !data) throw new Error("E_REPORT_FILE");
    return new Uint8Array(await data.arrayBuffer());
  },
};

export { weeklyReportError };
