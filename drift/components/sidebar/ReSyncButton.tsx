"use client";

import { useState } from "react";

/** Manual "re-sync" — runs the scene analyst on the CURRENT scene now, so a player
 *  who notices the world isn't lining up (a contact the game forgot, a stale read)
 *  can reconcile the memory without waiting for the scene to close. */
export function ReSyncButton({ campaignId, onSynced }: { campaignId: string; onSynced?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");

  async function run() {
    if (busy) return;
    setBusy(true);
    setState("idle");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      setState(res.ok ? "ok" : "err");
      if (res.ok) {
        onSynced?.();
        setTimeout(() => setState("idle"), 2500);
      }
    } catch {
      setState("err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={run}
      disabled={busy}
      title="Re-sync scene memory — re-read the current scene to pick up anyone/anything the game missed."
      className={
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] transition disabled:opacity-50 " +
        (state === "ok"
          ? "text-good"
          : state === "err"
            ? "text-bad"
            : "text-neutral-500 hover:text-accent")
      }
    >
      {busy ? "⟳ syncing…" : state === "ok" ? "✓ synced" : state === "err" ? "⚠ retry" : "⟳ re-sync"}
    </button>
  );
}
