import { parseAdvancedComparisonRequest } from "./advanced-comparison.ts";
type ErrorBody = { error: string; code: string };
type RpcResult = { data: unknown; error: { message?: string } | null };
type RpcClient = { rpc(name: "admin_advanced_analytics_comparison", args: { p_request: unknown }): PromiseLike<RpcResult> };
type Authorization = { ok: true; client: RpcClient } | { ok: false; status: number; body: ErrorBody };
export type AdvancedComparisonHandlerInput = { expectedOrigin: string; origin: string | null; referer: string | null; secFetchSite: string | null; body: unknown; now?: Date; authorize: () => Promise<Authorization> };
function sameOrigin(input: Pick<AdvancedComparisonHandlerInput,"expectedOrigin"|"origin"|"referer"|"secFetchSite">) {
  try { if (input.origin) return new URL(input.origin).origin === input.expectedOrigin; if (input.referer) return new URL(input.referer).origin === input.expectedOrigin; } catch { return false; }
  return input.secFetchSite === "same-origin";
}
export async function handleAdvancedComparisonRequest(input: AdvancedComparisonHandlerInput): Promise<{ status: number; body: unknown }> {
  if (!sameOrigin(input)) return { status: 403, body: { error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" } };
  const access = await input.authorize(); if (!access.ok) return { status: access.status, body: access.body };
  const parsed = parseAdvancedComparisonRequest(input.body,input.now); if (!parsed.ok) return { status: 400, body: { error: parsed.message, code: parsed.code } };
  try {
    const result = await access.client.rpc("admin_advanced_analytics_comparison",{ p_request: parsed.value });
    if (result.error || result.data === null) return { status: 503, body: { error: "تعذر حساب المقارنة المتقدمة.", code: "E_ADVANCED_COMPARISON" } };
    return { status: 200, body: result.data };
  } catch { return { status: 503, body: { error: "تعذر حساب المقارنة المتقدمة.", code: "E_ADVANCED_COMPARISON" } }; }
}
