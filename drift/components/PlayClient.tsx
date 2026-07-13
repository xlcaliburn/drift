"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CampaignState } from "@/shared/schemas";
import type { ChatEntry } from "@/shared/chat";
import { buildOpeningRecap, buildOpeningChoices } from "@/shared/recap";
import { TUTORIAL_GRADUATION_BEAT } from "@/shared/tutorial";
import { stripInlineMenu } from "@/shared/narration";
import type { ChoiceOption } from "@/shared/turnPlan";
import { combatActions, type CombatState } from "@/shared/combat";
import { usableConsumables } from "@/shared/items";
import Sidebar from "./Sidebar";

/** Choices may arrive as plain strings (opening/fallback) or objects with an
 *  attached engine check (structured turns) — normalize to objects. */
function normalizeChoices(list: unknown): ChoiceOption[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => (typeof c === "string" ? { label: c } : (c as ChoiceOption)))
    .filter((c) => c && typeof c.label === "string" && c.label.length > 0);
}

/** On load, show only the tail of the transcript — from the Nth-most-recent
 *  player message onward — so you rejoin in recent context, not the whole log. */
function lastExchanges(transcript: ChatEntry[], n: number): ChatEntry[] {
  const playerIdxs: number[] = [];
  transcript.forEach((e, i) => {
    if (e.role === "player") playerIdxs.push(i);
  });
  if (playerIdxs.length <= n) return transcript;
  return transcript.slice(playerIdxs[playerIdxs.length - n]);
}

export default function PlayClient({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<CampaignState | null>(null);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [choices, setChoices] = useState<ChoiceOption[]>([]);
  const [combat, setCombat] = useState<CombatState | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Live narration while a turn streams in. null = not streaming; "" = streaming
  // but no text yet (waiting on first token). Committed to `chat` on done.
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [choicesCollapsed, setChoicesCollapsed] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
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
        setIsAdmin(Boolean(d.isAdmin));

        // The opening recap + starter choices are derived from stored state — free.
        const recap: ChatEntry = { role: "recap", text: buildOpeningRecap(d.state) };
        // Show only the last 5 exchanges on load — recent context, not the whole log.
        const restored: ChatEntry[] = d.transcript?.length ? lastExchanges(d.transcript, 5) : [];
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
        // In a live fight, rebuild the engine's combat chips; otherwise opening choices.
        if (d.combat?.active) {
          setCombat(d.combat);
          const combatPc = d.state.characters.find((c: { kind: string }) => c.kind === "pc");
          const burstReady = !!d.state.ship?.burstDriveReady;
          setChoices(
            d.combat.enemies
              ? combatActions(d.combat, combatPc ? usableConsumables(combatPc, d.combat.scale) : [], burstReady)
              : [],
          );
        } else if (!restored.length) {
          setChoices(normalizeChoices(buildOpeningChoices(d.state)));
        }
      });
  }, [campaignId]);

  // Auto-follow new content only while pinned to the bottom — don't yank the
  // player down while they've scrolled up to re-read.
  useEffect(() => {
    if (atBottom) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, choices, streamingText, atBottom]);

  async function send(action?: ChoiceOption) {
    const text = (action?.label ?? input).trim();
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
        // A choice's attached check / combat action rides along to the engine.
        body: JSON.stringify({
          campaignId,
          playerText: text,
          check: action?.check,
          combatAction: action?.combatAction,
        }),
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
            lines?: string[];
            error?: string;
            narration?: string;
            state?: CampaignState;
            choices?: unknown;
            combat?: CombatState | null;
            sceneEnded?: boolean;
            tutorialGraduated?: boolean;
          };
          try {
            evt = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.type === "token") {
            streamed += evt.text ?? "";
            setStreamingText(streamed);
          } else if (evt.type === "engine") {
            // Engine output (dice, ticks, damage, payment) — pre-prefixed by the
            // server, shown the moment it happens, before/while narration streams.
            const lines = Array.isArray(evt.lines) ? evt.lines : [];
            setChat((c) => [...c, ...lines.map((l) => ({ role: "system" as const, text: l }))]);
          } else if (evt.type === "done") {
            setChat((c) => [...c, { role: "dm", text: evt.narration || stripInlineMenu(streamed) || "…" }]);
            if (evt.state) setState(evt.state);
            setCombat(evt.combat ?? null);
            setChoices(normalizeChoices(evt.choices));
            if (evt.sceneEnded) {
              setChat((c) => [...c, { role: "system", text: "— scene ended · checklist applied —" }]);
            }
            // One-time "training wheels are off" beat when the tutorial just ended.
            if (evt.tutorialGraduated) {
              setChat((c) => [...c, { role: "system", text: TUTORIAL_GRADUATION_BEAT }]);
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
        setChat((c) => [...c, { role: "dm", text: stripInlineMenu(streamed) }]);
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
          {isAdmin && (
            <Link
              href="/admin"
              className="rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20"
            >
              Admin
            </Link>
          )}
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
        <section className="relative flex min-w-0 flex-1 flex-col">
          <div
            className="scrollbar-thin mx-auto w-full max-w-3xl flex-1 space-y-5 overflow-y-auto px-5 py-6"
            onScroll={(e) => {
              const el = e.currentTarget;
              setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
            }}
          >
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
                  {stripInlineMenu(streamingText)}
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

          {/* Jump to the latest — shown only when scrolled up from the bottom. */}
          {!atBottom && (
            <button
              onClick={() => {
                chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
                setAtBottom(true);
              }}
              className="absolute bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-full border border-edge bg-panel/90 px-3 py-1.5 text-xs text-neutral-200 shadow-lg backdrop-blur transition hover:border-accent hover:text-accent"
              aria-label="Scroll to latest"
            >
              ↓ Latest
            </button>
          )}

          <div className="mx-auto w-full max-w-3xl border-t border-edge px-5 py-4">
            {/* Suggested actions — click to act, or type your own below. The tab
                collapses this row so the narration above is easier to read on a
                small screen. */}
            {choices.length > 0 && !busy && (
              <div className="mb-3">
                <button
                  onClick={() => setChoicesCollapsed((v) => !v)}
                  className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-1 text-xs text-neutral-400 transition hover:border-accent hover:text-accent"
                  aria-expanded={!choicesCollapsed}
                >
                  <span className="text-[10px]">{choicesCollapsed ? "▸" : "▾"}</span>
                  Suggested actions
                  <span className="text-neutral-600">({choices.length})</span>
                </button>
                {!choicesCollapsed && (
                  <div className="flex flex-wrap gap-2">
                    {choices.map((c, i) => (
                      <button
                        key={i}
                        onClick={() => send(c)}
                        disabled={!hasApiKey}
                        className="rounded-full border border-edge bg-panel px-4 py-2 text-left text-[15px] text-neutral-200 transition hover:border-accent hover:text-accent disabled:opacity-40"
                        title={c.check ? `Skill check: ${c.check.skill} vs DC ${c.check.dc}` : undefined}
                      >
                        {c.label}
                        {c.check && <span className="ml-1.5 text-xs text-accent/80">🎲 {c.check.skill}</span>}
                      </button>
                    ))}
                  </div>
                )}
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
        {state && <Sidebar state={state} combat={combat} mobileOpen={showSheet} onClose={() => setShowSheet(false)} />}
      </div>
    </div>
  );
}
