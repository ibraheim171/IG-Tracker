import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

export async function POST(request: NextRequest) {
  let body: LoginBody;
  try {
    body = await request.json() as LoginBody;
  } catch {
    return NextResponse.json({ ok: false, code: "E_LOGIN_INPUT" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ ok: false, code: "E_LOGIN_INPUT" }, { status: 400 });
  }

  const cookieCarrier = new NextResponse(null);
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => cookies.forEach(({ name, value, options }) => cookieCarrier.cookies.set(name, value, options)),
      },
    },
  );

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return withCookies(
        cookieCarrier,
        NextResponse.json(
          { ok: false, code: error.code || "AUTH_ERROR", error: error.message },
          { status: typeof error.status === "number" ? error.status : 401 },
        ),
      );
    }

    return withCookies(cookieCarrier, NextResponse.json({ ok: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return withCookies(cookieCarrier, NextResponse.json({ ok: false, code: "E_AUTH_REQUEST", error: message }, { status: 502 }));
  }
}

function withCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach(({ name, value, ...options }) => target.cookies.set(name, value, options));
  return target;
}
