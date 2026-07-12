"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

/** The one sign-in button. Kicks off the Google OAuth round-trip. */
export default function GoogleSignIn() {
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    const supabase = createBrowserSupabase();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setBusy(false); // success navigates away; only reset on failure
  }

  return (
    <button
      onClick={signIn}
      disabled={busy}
      className="w-full rounded-lg bg-accent px-6 py-3 font-semibold text-ink transition hover:bg-accent/90 disabled:opacity-60"
    >
      {busy ? "Redirecting…" : "Sign in with Google"}
    </button>
  );
}
