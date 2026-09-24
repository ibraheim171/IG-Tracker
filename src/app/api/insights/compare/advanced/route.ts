import { NextRequest, NextResponse } from "next/server";
import { requireAnalyticsAdmin } from "@/lib/analytics-auth";
import { handleAdvancedComparisonRequest } from "@/lib/advanced-comparison-handler";
import type { Json } from "@/lib/database.types";
function withCookies(body: unknown,status: number,source: NextResponse) { const response=NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}}); source.cookies.getAll().forEach(({name,value,...options})=>response.cookies.set(name,value,options)); return response; }
export async function POST(request: NextRequest) {
  const sessionResponse=NextResponse.next(); const body=await request.json().catch(()=>null);
  const result=await handleAdvancedComparisonRequest({ expectedOrigin:request.nextUrl.origin,origin:request.headers.get("origin"),referer:request.headers.get("referer"),secFetchSite:request.headers.get("sec-fetch-site"),body,
    authorize:async()=>{ const auth=await requireAnalyticsAdmin(request,sessionResponse); if(!auth.ok) return {ok:false as const,status:auth.error.status,body:{error:auth.error.message,code:auth.error.code}};
      return {ok:true as const,client:{rpc:(name:"admin_advanced_analytics_comparison",args:{p_request:unknown})=>auth.supabase.rpc(name,{p_request:args.p_request as Json})}}; }
  });
  return withCookies(result.body,result.status,sessionResponse);
}
