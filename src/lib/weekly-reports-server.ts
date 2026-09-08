import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { Database, Tables, TablesInsert } from "@/lib/database.types";
import { requireActiveRouteProfile } from "@/lib/route-auth";
import {
  canManageWeeklyReports,
  isSameOriginAppRequest,
  weeklyReportsBucket,
} from "@/lib/weekly-reports";

export type WeeklyReport = Tables<"weekly_reports">;

function serviceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
  );
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

export const weeklyReportStore = {
  async list() {
    const { data, error } = await serviceClient().from("weekly_reports").select("*").order("created_at", { ascending: false });
    if (error) throw new Error("E_REPORT_LIST");
    return data ?? [];
  },
  async get(id: string) {
    const { data, error } = await serviceClient().from("weekly_reports").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error("E_REPORT_READ");
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
  async remove(path: string) {
    await serviceClient().storage.from(weeklyReportsBucket).remove([path]);
  },
  async download(path: string) {
    const { data, error } = await serviceClient().storage.from(weeklyReportsBucket).download(path);
    if (error || !data) throw new Error("E_REPORT_FILE");
    return new Uint8Array(await data.arrayBuffer());
  },
};

export function weeklyReportError(caught: unknown) {
  const code = caught instanceof Error ? caught.message : "E_REPORT";
  if (code === "E_FILE_TOO_LARGE") return { status: 413, code, message: "يتجاوز الملف الحد الأقصى المسموح وهو 2 MiB." };
  if (code === "E_EMPTY_FILE") return { status: 400, code, message: "ملف التقرير فارغ." };
  if (code === "E_UTF8") return { status: 400, code, message: "يجب أن يكون ملف HTML بترميز UTF-8 صالح." };
  if (code === "E_REPORT_NOT_FOUND") return { status: 404, code, message: "التقرير غير موجود." };
  return { status: 500, code: "E_REPORT", message: "تعذر تنفيذ طلب التقرير الآن." };
}
