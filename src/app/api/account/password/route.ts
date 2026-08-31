import { NextRequest, NextResponse } from "next/server";
import { adminClient, isSameOriginMutation, validatePassword } from "@/lib/admin-users-server";
import { createRouteClient } from "@/lib/supabase/route";

function responseWithCookies(body: object, status: number, source: NextResponse) {
  const response = NextResponse.json(body, { status });
  source.cookies.getAll().forEach(({ name, value, ...options }) => response.cookies.set(name, value, options));
  return response;
}

export async function POST(request: NextRequest) {
  const sessionResponse = NextResponse.next();
  if (!isSameOriginMutation(request)) return responseWithCookies({ error: "رُفض الطلب لأن مصدره غير مطابق للتطبيق.", code: "E_ORIGIN" }, 403, sessionResponse);
  const body: unknown = await request.json();
  if (!isPasswordBody(body) || !validatePassword(body.password)) {
    return responseWithCookies({ error: "كلمة المرور غير قوية بما يكفي.", code: "E_WEAK_PASSWORD" }, 400, sessionResponse);
  }

  const supabase = createRouteClient(request, sessionResponse);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return responseWithCookies({ error: "انتهت الجلسة. سجّل الدخول مرة أخرى.", code: "E_SESSION" }, 401, sessionResponse);

  const { error: updateError } = await supabase.auth.updateUser({ password: body.password });
  if (updateError) return responseWithCookies({ error: "تعذر تغيير كلمة المرور.", code: "E_AUTH_PASSWORD" }, 400, sessionResponse);

  const { error: profileError } = await adminClient().from("profiles").update({ must_change_password: false }).eq("id", user.id);
  if (profileError) return responseWithCookies({ error: "تم تغيير كلمة المرور، لكن تعذر تأكيدها. حاول مجدداً.", code: "E_PROFILE_PASSWORD_FLAG" }, 400, sessionResponse);

  return responseWithCookies({ ok: true }, 200, sessionResponse);
}

type PasswordBody = { password: string };
function isPasswordBody(value: unknown): value is PasswordBody {
  return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).password === "string";
}
