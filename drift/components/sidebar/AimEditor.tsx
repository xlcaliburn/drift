"use client";

import { useState } from "react";
import { SheetSection } from "./ui";

/** The player's OWN aim for this character (campaign.directive) — an editable
 *  free-text goal fed to the narrator every turn so the world leans toward what
 *  THIS player enjoys (talk, trade, revenge…) instead of forcing a questline. */
export function AimEditor({ campaignId, initial, onSaved }: { campaignId: string; initial: string; onSaved?: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<"idle" | "ok" | "err">("idle");
  const dirty = text.trim() !== initial.trim();

  async function save() {
    if (busy) return;
    setBusy(true);
    setSaved("idle");
    try {
      const res = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, directive: text.trim() }),
      });
      setSaved(res.ok ? "ok" : "err");
      if (res.ok) onSaved?.();
    } catch {
      setSaved("err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetSection label="Your aim">
      <p className="mb-1.5 text-[12px] text-neutral-500">
        What do YOU want out of this character? The story leans into it — build relationships, chase a fortune, hunt someone
        down. Leave it blank to let the world set the pace.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={400}
        placeholder="e.g. get close to people and dig into who they really are"
        className="w-full resize-none rounded-lg border border-edge bg-ink px-3 py-2 text-[13px] outline-none focus:border-accent"
      />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[11px] text-neutral-600">
          {saved === "ok" && <span className="text-good">✓ saved — the narrator will lean into it</span>}
          {saved === "err" && <span className="text-bad">⚠ failed, try again</span>}
        </span>
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-md bg-accent px-3 py-1 text-[12px] font-semibold text-ink disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save aim"}
        </button>
      </div>
    </SheetSection>
  );
}
