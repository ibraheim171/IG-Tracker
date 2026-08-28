"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

type BrowserClientOptions = {
  signal?: AbortSignal;
};

export function createClient(options?: BrowserClientOptions) {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    options?.signal ? {
      global: {
        fetch: (input, init) => fetch(input, { ...init, signal: options.signal }),
      },
    } : undefined,
  );
}
