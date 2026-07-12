"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client — used only to kick off OAuth (GoogleSignIn). */
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
