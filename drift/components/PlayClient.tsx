"use client";

import { useEffect, useRef, useState } from "react";
import type { CampaignState } from "@/shared/schemas";
import type { ChatEntry } from "@/shared/chat";
import { buildOpeningRecap, buildOpeningChoices } from "@/shared/recap";
import Sidebar from "./Sidebar";

export default function PlayClient({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<CampaignState | null>(null);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [choices, setChoices] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Live narration while a turn streams in. null = not streaming; "" = streaming
  // but no text yet (waiting on first token). Committed to `chat` on done.
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showSheet, setShowSheet] = useState(false); // mobile sidebar drawer
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackState, setFeedbackState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/state?campaignId=${campaignId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.state) {
          setChat([
            {
              role: "system",
              text: `⚠ ${d.error ?? "Campaign not found."} Head back to the home page and create a character to begin.`,
            },
          ]);
          return;
        }
        setState(d.state);
        setHasApiKey(d.hasApiKey);

        // The opening recap + starter choices are derived from stored state — free.
        const recap: ChatEntry = { role: "recap", text: buildOpeningRecap(d.state) };
        const restored: ChatEntry[] = d.transcript?.length ? d.transcript : [];
        const notice: ChatEntry[] =
          !d.hasApiKey && !restored.length
            ? [
                {
                  role: "system",
                  text: "No ANTHROPIC_API_KEY set — the sheet is live but narration is disabled. Add the key to .env.local and restart to play.",
                },
              ]
            : [];
        setChat([recap, ...restored, ...notice]);
        if (!restored.length) setChoices(buildOpeningChoices(d.state));
      });
  }, [campaignId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, choices, streamingText]);

  async function send(actionText?: string) {
    const text = (actionText ?? input).trim();
    if (!text || busy) return;
    setInput("");
    setChoices([]);
    setChat((c) => [...c, { role: "player", text }]);
    setBusy(true);
    setStreamingText("");
    let streamed = "";
    try {
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, playerText: text }),
      });

      // Gating errors (budget/auth/not-found) come back as plain JSON, not a stream.
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setChat((c) => [...c, { role: "system", text: `⚠ ${data.error ?? "request failed"}` }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? ""; // keep the trailing partial frame
        for (const frame of frames) {
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          let evt: {
            type: string;
            text?: string;
            error?: string;
            narration?: string;
            state?: CampaignState;
            choices?: string[];
            sceneEnded?: boolean;
          };
          try {
            evt = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.type === "token") {
            streamed += evt.text ?? "";
            setStreamingText(streamed);
          } else if (evt.type === "done") {
            setChat((c) => [...c, { role: "dm", text: evt.narration || streamed || "…" }]);
            if (evt.state) setState(evt.state);
            setChoices(Array.isArray(evt.choices) ? evt.choices : []);
            if (evt.sceneEnded) {
              setChat((c) => [...c, { role: "system", text: "— scene ended · checklist applied —" }]);
            }
            finished = true;
          } else if (evt.type === "error") {
            setChat((c) => [...c, { role: "system", text: `⚠ ${evt.error ?? "narration failed"}` }]);
            finished = true;
          }
        }
      }
      // Stream closed without a done/error frame (e.g. dropped connection).
      if (!finished && streamed) {
        setChat((c) => [...c, { role: "dm", text: streamed }]);
      }
    } catch {
      setChat((c) => [...c, { role: "system", text: "⚠ request failed" }]);
    } finally {
      setStreamingText(null);
      setBusy(false);
    }
  }

  async function submitFeedback() {
    const text = feedbackText.trim();
    if (!text || feedbackState === "sending") return;
    setFeedbackState("sending");
    try {
      const pc = state?.characters.find((c) => c.kind === "pc");
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, campaignId, authorName: pc?.name ?? "anonymous" }),
      });
      const data = await res.json();
      if (data.error) {
        setFeedbackState("error");
      } else {
        setFeedbackState("sent");
        setFeedbackText("");
        setTimeout(() => {
          setShowFeedback(false);
          setFeedbackState("idle");
        }, 1500);
      }
    } catch {
      setFeedbackState("error");
    }
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex items-center gap-2 border-b border-edge px-3 py-2.5 sm:px-5 sm:py-3">
        <span className="shrink-0 text-lg font-bold text-accent">DRIFT</span>
        <span className="min-w-0 flex-1 truncate text-center text-xs text-neutral-400 sm:text-sm">
          {state?.campaign.name}
          {state?.campaign.currentLocationId &&
            ` · ${state?.locations.find((l) => l.id === state.campaign.currentLocationId)?.name ?? ""}`}
        </span>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {!hasApiKey && <span className="hidden text-sm text-bad sm:inline">narration disabled</span>}
          <button
            onClick={() => setShowFeedback(true)}
            className="rounded-md border border-edge px-2.5 py-1.5 text-xs text-neutral-400 transition hover:border-accent hover:text-accent"
          >
            💡<span className="hidden sm:inline"> Request</span>
          </button>
          {/* Mobile-only: open the character sheet/ship/map/clocks drawer. */}
          {state && (
            <button
              onClick={() => setShowSheet(true)}
              className="rounded-md border border-edge px-2.5 py-1.5 text-xs text-neutral-300 transition hover:border-accent hover:text-accent md:hidden"
            >
              ☰<span className="sr-only"> Character sheet</span>
            </button>
          )}
        </div>
      </header>

      {/* Feature-request modal */}
      {showFeedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" onClick={() => setShowFeedback(false)}>
          <div className="w-full max-w-md rounded-xl border border-edge bg-panel p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-neutral-100">Request a feature</h3>
            <p className="mt-1 text-sm text-neutral-400">
              Broken, unbalanced, or missing something? Describe it in your own words — it gets tidied up automatically for review.
            </p>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              rows={4}
              placeholder="e.g. let me rename my ship / the dock fees feel too punishing early on"
              className="mt-3 w-full resize-none rounded-lg border border-edge bg-ink px-3 py-2 text-[15px] outline-none focus:border-accent"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-neutral-500">
                {feedbackState === "sent" && "✓ Submitted — thanks!"}
                {feedbackState === "error" && <span className="text-bad">⚠ failed, try again</span>}
              </span>
              <div className="flex gap-2">
                <button onClick={() => setShowFeedback(false)} className="px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-300">
                  Cancel
                </button>
                <button
                  onClick={submitFeedback}
                  disabled={!feedbackText.trim() || feedbackState === "sending"}
                  className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-ink disabled:opacity-40"
                >
                  {feedbackState === "sending" ? "Sending…" : "Submit"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Chat pane */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="scrollbar-thin mx-auto w-full max-w-3xl flex-1 space-y-5 overflow-y-auto px-5 py-6">
            {chat.map((e, i) =>
              e.role === "recap" ? (
                <div
                  key={i}
                  className="whitespace-pre-wrap rounded-lg border border-edge bg-panel/60 px-4 py-3 text-[15px] leading-relaxed text-neutral-300"
                >
                  {e.text}
                </div>
              ) : (
                <div key={i} className={e.role === "player" ? "text-right" : ""}>
                  <div
                    className={
                      "inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 " +
                      (e.role === "player"
                        ? "bg-edge text-[16px] text-neutral-50"
                        : e.role === "dm"
                          ? "bg-panel text-[17px] leading-relaxed text-neutral-100"
                          : "text-sm italic text-neutral-500")
                    }
                  >
                    {e.text}
                  </div>
                </div>
              ),
            )}
            {/* Live narration as it streams in. */}
            {streamingText !== null && streamingText.length > 0 && (
              <div>
                <div className="inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl bg-panel px-4 py-3 text-[17px] leading-relaxed text-neutral-100">
                  {streamingText}
                  <span className="ml-0.5 inline-block animate-pulse text-accent">▍</span>
                </div>
              </div>
            )}
            {/* Waiting on the first token. */}
            {busy && (streamingText === null || streamingText.length === 0) && (
              <div className="text-sm italic text-neutral-500">the world turns…</div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="mx-auto w-full max-w-3xl border-t border-edge px-5 py-4">
            {/* Suggested actions — click to act, or type your own below. */}
            {choices.length > 0 && !busy && (
              <div className="mb-3 flex flex-wrap gap-2">
                {choices.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => send(c)}
                    disabled={!hasApiKey}
                    className="rounded-full border border-edge bg-panel px-4 py-2 text-left text-[15px] text-neutral-200 transition hover:border-accent hover:text-accent disabled:opacity-40"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                placeholder={choices.length ? "…or write your own action" : `What does ${state?.characters.find((c) => c.kind === "pc")?.name ?? "you"} do?`}
                className="flex-1 resize-none rounded-lg border border-edge bg-ink px-4 py-3 text-[16px] outline-none focus:border-accent"
              />
              <button
                onClick={() => send()}
                disabled={busy || !hasApiKey}
                className="rounded-lg bg-accent px-6 text-base font-semibold text-ink disabled:opacity-40"
              >
                Act
              </button>
            </div>
          </div>
        </section>

        {/* Sidebar — right rail on desktop, slide-over drawer on mobile */}
        {state && <Sidebar state={state} mobileOpen={showSheet} onClose={() => setShowSheet(false)} />}
      </div>
    </div>
  );
}
