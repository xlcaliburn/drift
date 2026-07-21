"use client";

import { useEffect, useState } from "react";

interface SceneEntry {
  seq: number;
  title: string;
  summary: string;
}

/**
 * "Story so far" (HANDOFF_PLAYTEST_POLISH_1.md decision 10) — the deterministic
 * scene-summary list (free, loaded on open) plus an optional player-initiated
 * cheap-model retelling (a button click, never automatic). Styled like
 * PlayClient's own feedback modal.
 */
export function StorySoFarModal({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const [scenes, setScenes] = useState<SceneEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retelling, setRetelling] = useState<"idle" | "loading" | "error">("idle");
  const [retold, setRetold] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/summary?campaignId=${campaignId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setScenes(Array.isArray(d.scenes) ? d.scenes : []);
      })
      .catch(() => !cancelled && setError("Couldn't load your story."));
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  async function retell() {
    setRetelling("loading");
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      const data = await res.json();
      if (!res.ok || !data.text) {
        setRetelling("error");
        return;
      }
      setRetold(data.text);
      setRetelling("idle");
    } catch {
      setRetelling("error");
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80dvh] w-full max-w-lg flex-col rounded-xl border border-edge bg-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-neutral-100">Story so far</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-accent" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="scrollbar-thin mt-3 flex-1 overflow-y-auto">
          {retold ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-200">{retold}</p>
          ) : error ? (
            <p className="text-sm text-bad">⚠ {error}</p>
          ) : scenes === null ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : scenes.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing recorded yet — play a few scenes.</p>
          ) : (
            <div className="space-y-3">
              {scenes.map((s) => (
                <div key={s.seq}>
                  <div className="text-[13px] font-semibold text-neutral-200">{s.title}</div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-neutral-400">{s.summary}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {!retold && scenes && scenes.length > 0 && (
          <div className="mt-3 flex items-center justify-between border-t border-edge pt-3">
            <span className="text-xs text-neutral-500">
              {retelling === "error" && <span className="text-bad">⚠ couldn't retell it, try again</span>}
            </span>
            <button
              onClick={retell}
              disabled={retelling === "loading"}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-ink disabled:opacity-40"
            >
              {retelling === "loading" ? "Retelling…" : "Retell as a story"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
