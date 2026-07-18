"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CampaignState } from "@/shared/schemas";
import type { ChatEntry } from "@/shared/chat";
import { buildOpeningRecap, buildOpeningChoices, buildFallbackChoices } from "@/shared/recap";
import { TUTORIAL_GRADUATION_BEAT } from "@/shared/tutorial";
import { stripInlineMenu } from "@/shared/narration";
import type { ChoiceOption } from "@/shared/turnPlan";
import type { Job } from "@/shared/quests";
import type { PlayerLedger } from "@/shared/ledger";
import type { Fact } from "@/shared/facts";
import { combatActions, crewActionChips, type CombatState, type CombatAction } from "@/shared/combat";
import { usableConsumables } from "@/shared/items";
import { dispositionLabel, type NpcRelations, type SceneCard } from "@/shared/scene";
import { type RiskTier } from "@/shared/risk";
import { chipKind } from "./chipKinds";
import Sidebar from "./Sidebar";

/** Tailwind classes for a choice's RISK pill (odds axis — distinct from the
 *  ⚠ hazard/damage axis). safe=green, risky=accent, reckless=red. */
const RISK_PILL: Record<RiskTier, string> = {
  safe: "bg-good/15 text-good",
  risky: "bg-accent/15 text-accent",
  reckless: "bg-bad/15 text-bad",
};

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

export default function PlayClient({
  campaignId,
  roster = [],
}: {
  campaignId: string;
  /** The player's own characters (from the server) — powers the Switch menu. */
  roster?: { id: string; name: string; status: string }[];
}) {
  const [state, setState] = useState<CampaignState | null>(null);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [choices, setChoices] = useState<ChoiceOption[]>([]);
  const [combat, setCombat] = useState<CombatState | null>(null);
  // Staged squad orders (HANDOFF_COMBAT_V2_1 Task C) — memberId → chosen action,
  // sent alongside the PC's own combat chip; cleared once a round is submitted.
  const [crewOrders, setCrewOrders] = useState<Record<string, CombatAction>>({});
  const [npcRelations, setNpcRelations] = useState<NpcRelations>({});
  const [sceneCard, setSceneCard] = useState<SceneCard | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [playerLedger, setPlayerLedger] = useState<PlayerLedger>({});
  const [facts, setFacts] = useState<Fact[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Terminal state — the PC has died; the story is over and input is locked.
  const [dead, setDead] = useState(false);
  // A turn that failed retryably (narrator glitch): nothing was saved server-side;
  // this holds the exact action so one click resumes where the player left off.
  const [failedAction, setFailedAction] = useState<{ action?: ChoiceOption; text: string } | null>(null);
  const lastSentRef = useRef<{ action?: ChoiceOption; text: string } | null>(null);
  // Live narration while a turn streams in. null = not streaming; "" = streaming
  // but no text yet (waiting on first token). Committed to `chat` on done.
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [choicesCollapsed, setChoicesCollapsed] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showSheet, setShowSheet] = useState(false); // mobile sidebar drawer
  // Mobile scene strip: the persistent Here & now bar under the header (tap to expand).
  const [sceneStripOpen, setSceneStripOpen] = useState(false);
  // Composer stays compact (1 row) until the player actually engages with it.
  const [inputFocused, setInputFocused] = useState(false);
  // Header Switch-characters dropdown (multi-character roster).
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackState, setFeedbackState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  // The player's own submitted reports + status, shown inside the feedback modal.
  const [myFeedback, setMyFeedback] = useState<{ id: string; title: string; summary: string; status: string }[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // On a phone the choice chips eat half the screen — start them tucked behind
  // the tab; the player's toggle is respected from then on. Set post-mount (not
  // in the initializer) so server and client first-render match.
  useEffect(() => {
    if (window.innerWidth < 640) setChoicesCollapsed(true);
  }, []);

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
        if (d.npcRelations) setNpcRelations(d.npcRelations);
        if (d.sceneCard) setSceneCard(d.sceneCard);
        if (d.jobs) setJobs(d.jobs);
        if (d.playerLedger) setPlayerLedger(d.playerLedger);
        if (d.facts) setFacts(d.facts);

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
              ? combatActions(
                  d.combat,
                  combatPc ? usableConsumables(combatPc, d.combat.scale) : [],
                  burstReady,
                  (combatPc?.gear ?? []).filter((g: { damage?: string }) => g.damage).map((g: { name: string }) => g.name),
                )
              : [],
          );
        } else if (d.lastChoices?.length) {
          // Restore the chips the player last saw so a refresh doesn't blank them.
          setChoices(normalizeChoices(d.lastChoices));
        } else {
          // No persisted chips (fresh start, or a campaign last played before this
          // feature). Never leave the bar empty: opening moves if brand-new, else
          // next moves derived from live state.
          setChoices(
            normalizeChoices(restored.length ? buildFallbackChoices(d.state) : buildOpeningChoices(d.state)),
          );
        }
        // A refresh after death stays terminal: no choices, input locked.
        const loadedPc = d.state.characters.find((c: { kind: string }) => c.kind === "pc");
        if (loadedPc?.injuries?.some((i: { name: string }) => i.name === "Dead")) {
          setDead(true);
          setChoices([]);
        }
      });
  }, [campaignId]);

  // Auto-follow new content only while pinned to the bottom — don't yank the
  // player down while they've scrolled up to re-read.
  useEffect(() => {
    if (atBottom) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, choices, streamingText, atBottom]);

  // Load the player's own reports whenever the feedback modal opens (and after a
  // successful submit) so they can track each one's status.
  useEffect(() => {
    if (!showFeedback) return;
    fetch("/api/feedback?mine=1")
      .then((r) => r.json())
      .then((d) => setMyFeedback(Array.isArray(d.requests) ? d.requests : []))
      .catch(() => {});
  }, [showFeedback, feedbackState]);

  /** Pull the latest campaign state/relations/scene from the server — used when
   *  opening "More details" so the sheet never shows stale data (a background
   *  enrichment, or a turn taken in another tab, may have advanced things). Only
   *  touches the sheet-backing state; leaves the chat/choices/combat as-is. */
  async function refreshState() {
    try {
      const r = await fetch(`/api/state?campaignId=${campaignId}`);
      const d = await r.json();
      if (!d.state) return;
      setState(d.state);
      if (d.npcRelations) setNpcRelations(d.npcRelations);
      if (d.sceneCard) setSceneCard(d.sceneCard);
      if (d.jobs) setJobs(d.jobs);
      if (d.playerLedger) setPlayerLedger(d.playerLedger);
      if (d.facts) setFacts(d.facts);
    } catch {
      /* keep the current view on a transient failure */
    }
  }

  async function send(action?: ChoiceOption, opts?: { retryText?: string }) {
    const text = (opts?.retryText ?? action?.label ?? input).trim();
    if (!text || busy || dead) return;
    lastSentRef.current = { action, text };
    setFailedAction(null);
    setInput("");
    setChoices([]);
    // A retry resumes the SAME action — the player line is already in the chat.
    if (!opts?.retryText) setChat((c) => [...c, { role: "player", text }]);
    setBusy(true);
    setStreamingText("");
    let streamed = "";
    try {
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The WHOLE clicked choice rides along to the engine — every chip field
        // (check, combatAction, useItemId, repairHull, patronRest, swap*, and any
        // future kind) forwards without this file changing. fromChoice marks a
        // CLICKED option (vs. typed text): a clicked choice's check is already
        // decided (shown on the chip), so the engine won't add a surprise roll —
        // the badge is the contract.
        body: JSON.stringify({
          ...action,
          campaignId,
          playerText: text,
          fromChoice: !!action,
          // Staged squad orders (HANDOFF_COMBAT_V2_1 Task C) ride along with the
          // PC's own combat chip; an un-ordered member keeps auto-acting.
          ...(combat?.active && Object.keys(crewOrders).length
            ? { combatActions: Object.entries(crewOrders).map(([memberId, order]) => ({ memberId, action: order })) }
            : {}),
        }),
      });
      // Orders are per-round — clear the staging once this round is in flight;
      // the next round's chips (if any) start fresh.
      if (combat?.active) setCrewOrders({});

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
            retryable?: boolean;
            narration?: string;
            state?: CampaignState;
            choices?: unknown;
            combat?: CombatState | null;
            sceneEnded?: boolean;
            dead?: boolean;
            npcRelations?: NpcRelations;
            sceneCard?: SceneCard | null;
            jobs?: Job[];
            playerLedger?: PlayerLedger;
            facts?: Fact[];
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
            if (evt.npcRelations) setNpcRelations(evt.npcRelations);
            if (evt.sceneCard) setSceneCard(evt.sceneCard);
            if (evt.jobs) setJobs(evt.jobs);
            if (evt.playerLedger) setPlayerLedger(evt.playerLedger);
            if (evt.facts) setFacts(evt.facts);
            if (evt.dead) {
              // The character has died — end the story: lock input, drop choices,
              // and show a final beat instead of the scene-end line.
              setDead(true);
              setChoices([]);
              const pcName = evt.state?.characters.find((c) => c.kind === "pc")?.name ?? "You";
              setChat((c) => [...c, { role: "system", text: `☠ ${pcName} is dead. This character's story has ended.` }]);
            } else {
              setChoices(normalizeChoices(evt.choices));
            }
            // One-time "training wheels are off" beat when the tutorial just ended.
            if (evt.tutorialGraduated) {
              setChat((c) => [...c, { role: "system", text: TUTORIAL_GRADUATION_BEAT }]);
            }
            finished = true;
          } else if (evt.type === "error") {
            setChat((c) => [...c, { role: "system", text: `⚠ ${evt.error ?? "narration failed"}` }]);
            // Retryable glitch: nothing was saved server-side — offer to resume
            // the exact same action once the issue clears.
            if (evt.retryable && lastSentRef.current) setFailedAction(lastSentRef.current);
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

  // "This is wrong" on a remembered fact — prefills the existing feedback modal
  // rather than mutating state directly (correction is triage input, not a write;
  // the engine still owns the ledger).
  function flagFact(text: string) {
    setFeedbackText(`Memory correction: "${text}" is wrong — `);
    setFeedbackState("idle");
    setShowFeedback(true);
  }

  const headerPc = state?.characters.find((c) => c.kind === "pc");
  const headerClock =
    state?.clocks.find((c) => c.id === "clk-faultline") ??
    state?.clocks.find((c) => c.status === "active");

  // Squad-order chip groups (HANDOFF_COMBAT_V2_1 Task C) — one per standing
  // crew/ally member, personal-scale fights only (crewActionChips returns []
  // for ship scale; crew orders there are out of scope this slice).
  const standingCrew =
    combat?.active && state
      ? state.characters.filter(
          (c) => c.kind === "party" && c.hp > 0 && !(c.injuries ?? []).some((i) => i.name === "Dead"),
        )
      : [];
  const crewChipGroups =
    combat?.active && standingCrew.length
      ? crewActionChips(
          combat,
          standingCrew.map((c) => ({ id: c.id, name: c.name })),
          Object.fromEntries(standingCrew.map((c) => [c.id, usableConsumables(c, combat.scale)])),
        )
      : [];

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex items-center gap-2 border-b border-edge px-3 py-2.5 sm:px-5 sm:py-3">
        {/* Logo shows on ≥sm; on mobile it's replaced by live game status. */}
        <span className="hidden shrink-0 text-lg font-bold text-accent sm:inline">DRIFT</span>

        {/* Mobile-only status bar: HP first, then character name, then clock if it fits. */}
        {state && headerPc && (
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs sm:hidden">
            <span
              className={
                "shrink-0 font-bold " +
                (headerPc.hp / headerPc.maxHp < 0.34 ? "text-bad" : "text-accent")
              }
            >
              HP {headerPc.hp}/{headerPc.maxHp}
            </span>
            <span className="min-w-0 truncate font-semibold text-neutral-200">{headerPc.name}</span>
            {headerClock && (
              <span className="shrink-0 text-neutral-500" title={headerClock.name}>
                · ⏱ {headerClock.current}/{headerClock.max}
              </span>
            )}
          </div>
        )}

        {/* Campaign name + location — desktop only (mobile shows live status instead). */}
        <span className="hidden min-w-0 flex-1 truncate text-center text-xs text-neutral-400 sm:block sm:text-sm">
          {state?.campaign.name}
          {state?.campaign.currentLocationId &&
            ` · ${state?.locations.find((l) => l.id === state.campaign.currentLocationId)?.name ?? ""}`}
        </span>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {!hasApiKey && <span className="hidden text-sm text-bad sm:inline">narration disabled</span>}
          {/* Switch characters — the player's roster (each character is its own
              campaign). Shown whenever the server passed a roster. */}
          {roster.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowSwitcher((v) => !v)}
                className="rounded-md border border-edge px-2.5 py-1.5 text-xs text-neutral-300 transition hover:border-accent hover:text-accent"
                title="Switch characters"
              >
                ⇄<span className="hidden sm:inline"> Switch</span>
              </button>
              {showSwitcher && (
                <>
                  {/* Click-away backdrop. */}
                  <div className="fixed inset-0 z-40" onClick={() => setShowSwitcher(false)} />
                  <div className="absolute right-0 z-50 mt-1.5 w-56 rounded-lg border border-edge bg-panel p-1.5 shadow-xl">
                    <div className="px-2 pb-1 pt-0.5 text-[10px] uppercase tracking-wide text-neutral-600">
                      Your characters
                    </div>
                    {roster.map((c) =>
                      c.id === campaignId ? (
                        <div key={c.id} className="rounded-md bg-ink/60 px-2 py-1.5 text-[13px] text-accent">
                          {c.name} <span className="text-[10px] text-neutral-500">· playing now</span>
                        </div>
                      ) : (
                        <Link
                          key={c.id}
                          href={`/play/${c.id}`}
                          className="block rounded-md px-2 py-1.5 text-[13px] text-neutral-200 transition hover:bg-ink/60 hover:text-accent"
                          onClick={() => setShowSwitcher(false)}
                        >
                          {c.name}
                          {c.status === "deceased" && <span className="ml-1.5 text-[10px] text-bad">☠</span>}
                        </Link>
                      ),
                    )}
                    <div className="mt-1 border-t border-edge pt-1">
                      <Link
                        href="/"
                        className="block rounded-md px-2 py-1.5 text-[12px] text-neutral-400 transition hover:bg-ink/60 hover:text-neutral-200"
                        onClick={() => setShowSwitcher(false)}
                      >
                        All characters…
                      </Link>
                      <Link
                        href="/create"
                        className="block rounded-md px-2 py-1.5 text-[12px] text-accent/90 transition hover:bg-ink/60 hover:text-accent"
                        onClick={() => setShowSwitcher(false)}
                      >
                        + New character
                      </Link>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
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

      {/* Mobile-only scene strip — the Here & now, persistent under the header.
          One truncated line (place · situation · danger count); tap to expand the
          full card: situation, active dangers, and who's present with standing.
          The sidebar drawer still holds the deep view; this keeps the essentials
          on screen while playing. */}
      {state && (
        <div className="border-b border-edge bg-panel/40 md:hidden">
          {(() => {
            const loc = state.locations.find((l) => l.id === state.campaign.currentLocationId);
            const place = sceneCard?.place ?? loc?.name ?? "Unknown";
            const dangers = sceneCard?.dangers ?? [];
            const present = (sceneCard?.presentNpcIds ?? [])
              .map((id) => state.npcs.find((n) => n.id === id))
              .filter((n): n is NonNullable<typeof n> => !!n);
            return (
              <>
                <button
                  onClick={() => setSceneStripOpen((v) => !v)}
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left"
                  aria-expanded={sceneStripOpen}
                >
                  <span className="shrink-0 text-[11px]" aria-hidden>
                    📍
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-neutral-300">
                    <span className="font-medium text-neutral-200">{place}</span>
                    {sceneCard?.situation && !sceneStripOpen && (
                      <span className="text-neutral-500"> — {sceneCard.situation}</span>
                    )}
                  </span>
                  {dangers.length > 0 && (
                    <span className="shrink-0 text-[11px] font-medium text-bad">⚠{dangers.length}</span>
                  )}
                  {present.length > 0 && !sceneStripOpen && (
                    <span className="shrink-0 text-[11px] text-neutral-500">👤{present.length}</span>
                  )}
                  <span className="shrink-0 text-[9px] text-neutral-600" aria-hidden>
                    {sceneStripOpen ? "▲" : "▼"}
                  </span>
                </button>
                {sceneStripOpen && (
                  <div className="space-y-1.5 px-3 pb-2.5">
                    {sceneCard?.place && loc?.name && !sceneCard.place.includes(loc.name) && (
                      <div className="text-[11px] text-neutral-600">near {loc.name}</div>
                    )}
                    {sceneCard?.situation && (
                      <p className="text-[12px] italic leading-snug text-neutral-300">{sceneCard.situation}</p>
                    )}
                    {dangers.length > 0 && (
                      <div className="rounded border border-bad/40 bg-bad/5 px-2 py-1">
                        {dangers.map((d, i) => (
                          <div key={i} className="text-[12px] font-medium text-bad">
                            ⚠ {d}
                          </div>
                        ))}
                      </div>
                    )}
                    {present.length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {present.map((npc) => {
                          const rel = npcRelations[npc.id];
                          const tone =
                            rel && rel.disposition > 0
                              ? "text-good"
                              : rel && rel.disposition < 0
                                ? "text-bad"
                                : "text-neutral-500";
                          return (
                            <span key={npc.id} className="text-[12px] text-neutral-200">
                              {npc.name}
                              {rel && <span className={tone}> ({dispositionLabel(rel.disposition)})</span>}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Feature-request modal — z-[60], above the Sidebar/DetailsModal (z-50), so
          flagging a remembered fact from inside the details modal surfaces this
          on top instead of being hidden behind it. */}
      {showFeedback && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 p-4" onClick={() => setShowFeedback(false)}>
          <div className="w-full max-w-md rounded-xl border border-edge bg-panel p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-neutral-100">
              {feedbackText.startsWith("Memory correction:") ? "Flag a memory" : "Request a feature"}
            </h3>
            <p className="mt-1 text-sm text-neutral-400">
              {feedbackText.startsWith("Memory correction:")
                ? "Say why it's wrong — this goes to the review queue, not a live edit."
                : "Broken, unbalanced, or missing something? Describe it in your own words — it gets tidied up automatically for review."}
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

            {/* Your previous reports + where they stand. */}
            {myFeedback.length > 0 && (
              <div className="mt-4 border-t border-edge pt-3">
                <div className="mb-1.5 text-[11px] uppercase tracking-wide text-neutral-500">Your reports</div>
                <div className="scrollbar-thin max-h-44 space-y-1.5 overflow-y-auto">
                  {myFeedback.map((r) => (
                    <div key={r.id} className="flex items-baseline justify-between gap-2" title={r.summary}>
                      <span className="min-w-0 truncate text-[13px] text-neutral-300">{r.title}</span>
                      <span
                        className={
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide " +
                          (r.status === "done"
                            ? "bg-good/15 text-good"
                            : r.status === "approved"
                              ? "bg-accent/15 text-accent"
                              : r.status === "declined"
                                ? "bg-bad/15 text-bad"
                                : "bg-edge text-neutral-400")
                        }
                      >
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
              <div className="flex items-center gap-2 text-sm italic text-neutral-500">
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-700 border-t-accent"
                  aria-hidden
                />
                the world turns…
              </div>
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

          <div className="mx-auto w-full max-w-3xl border-t border-edge px-3 py-2.5 sm:px-5 sm:py-4">
            {/* Squad orders (HANDOFF_COMBAT_V2_1 Task C) — order every standing
                crew/ally member before acting yourself. Tap a chip to STAGE that
                member's order (highlighted); tap again to clear it back to
                auto-act. Submitting any of your own chips below sends the
                staged set along; an un-ordered member keeps auto-acting. */}
            {crewChipGroups.length > 0 && !busy && (
              <div className="mb-2 space-y-1.5 rounded-lg border border-edge bg-panel/60 px-3 py-2">
                {crewChipGroups.map((g) => (
                  <div key={g.memberId} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-20 shrink-0 truncate text-xs font-medium text-neutral-400">{g.memberName}</span>
                    {g.chips.map((chip, ci) => {
                      const staged = crewOrders[g.memberId];
                      const selected =
                        !!staged &&
                        staged.type === chip.combatAction.type &&
                        (staged.enemyId ?? staged.itemId) === (chip.combatAction.enemyId ?? chip.combatAction.itemId);
                      return (
                        <button
                          key={ci}
                          onClick={() =>
                            setCrewOrders((prev) => {
                              const next = { ...prev };
                              if (selected) delete next[g.memberId];
                              else next[g.memberId] = chip.combatAction;
                              return next;
                            })
                          }
                          className={
                            "rounded-full border px-2.5 py-1 text-[12px] transition " +
                            (selected
                              ? "border-accent bg-accent/15 text-accent"
                              : "border-edge bg-panel text-neutral-300 hover:border-accent hover:text-accent")
                          }
                        >
                          {chip.label}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {/* Suggested actions — click to act, or type your own below. The
                toggle is a compact icon tab on mobile (⚡ + count) so the row
                costs almost nothing when tucked away; full label on desktop. */}
            {choices.length > 0 && !busy && (
              <div className={choicesCollapsed ? "mb-1.5 sm:mb-3" : "mb-3"}>
                <button
                  onClick={() => setChoicesCollapsed((v) => !v)}
                  className="mb-1.5 inline-flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-neutral-400 transition hover:border-accent hover:text-accent sm:mb-2 sm:gap-1.5 sm:px-2.5"
                  aria-expanded={!choicesCollapsed}
                  aria-label={`Suggested actions (${choices.length})`}
                >
                  <span className="text-[10px]">{choicesCollapsed ? "▸" : "▾"}</span>
                  <span aria-hidden>⚡</span>
                  <span className="hidden sm:inline">Suggested actions</span>
                  <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                    {choices.length}
                  </span>
                </button>
                {!choicesCollapsed && (
                  <div className="flex flex-wrap gap-2">
                    {choices.map((c, i) => {
                      // Engine-owned chips (deterministic use/repair/rest/swap…) get
                      // their icon/tooltip/styling from the registry — a new chip
                      // kind is one chipKinds.ts entry, zero edits here.
                      const kind = chipKind(c);
                      return (
                      <button
                        key={i}
                        onClick={() => send(c)}
                        disabled={!hasApiKey}
                        className={
                          "flex items-center gap-2 rounded-full border px-4 py-2 text-left text-[15px] transition hover:border-accent hover:text-accent disabled:opacity-40 " +
                          (kind
                            ? "border-good/40 bg-good/5 text-neutral-200"
                            : "border-edge bg-panel text-neutral-200")
                        }
                        title={
                          c.check
                            ? `Skill check: ${c.check.skill ?? c.verb} vs DC ${c.check.dc}` +
                              (c.check.hazardLevel
                                ? ` · danger ${"⚠".repeat(c.check.hazardLevel)} — up to ${c.check.hazardLevel * 2} damage on failure`
                                : "")
                            : kind?.tip
                        }
                      >
                        <span>{kind ? `${kind.icon} ` : ""}{c.label}</span>
                        {c.check && (
                          <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium capitalize text-accent">
                            🎲 {c.check.skill ?? c.verb}
                          </span>
                        )}
                        {c.check?.risk && c.check.risk !== "safe" && (
                          <span
                            className={
                              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize " +
                              RISK_PILL[c.check.risk]
                            }
                          >
                            {c.check.risk}
                          </span>
                        )}
                        {c.check?.hazardLevel ? (
                          <span
                            className="shrink-0 rounded-full bg-bad/15 px-1.5 py-0.5 text-[11px] font-medium text-bad"
                            title={`Danger level ${c.check.hazardLevel} — up to ${c.check.hazardLevel * 2} damage on failure`}
                          >
                            {"⚠".repeat(Math.min(5, c.check.hazardLevel))}
                          </span>
                        ) : null}
                      </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {failedAction && !busy && !dead && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-bad/50 bg-bad/5 px-4 py-2.5">
                <span className="min-w-0 truncate text-sm text-neutral-300">
                  ⚠ Turn failed — nothing was lost. Your action: <span className="italic">“{failedAction.text}”</span>
                </span>
                <button
                  onClick={() => send(failedAction.action, { retryText: failedAction.text })}
                  className="shrink-0 rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-ink transition hover:opacity-90"
                >
                  ↻ Retry
                </button>
              </div>
            )}
            {dead ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-bad/50 bg-bad/5 px-4 py-4 text-center">
                <p className="text-[15px] text-bad">
                  ☠ {state?.characters.find((c) => c.kind === "pc")?.name ?? "This character"} has died — their story
                  ends here.
                </p>
                <a
                  href="/create"
                  className="rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-ink transition hover:opacity-90"
                >
                  Create a new character →
                </a>
              </div>
            ) : (
              <div className="flex gap-2">
                {/* Compact until engaged: one row idle, two while focused or
                    holding text — reclaims vertical space for the story. */}
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={inputFocused || input.trim() ? 2 : 1}
                  placeholder={choices.length ? "…or write your own action" : `What does ${state?.characters.find((c) => c.kind === "pc")?.name ?? "you"} do?`}
                  className="flex-1 resize-none rounded-lg border border-edge bg-ink px-4 py-2.5 text-[16px] outline-none transition-all focus:border-accent sm:py-3"
                />
                <button
                  onClick={() => send()}
                  disabled={busy || !hasApiKey}
                  className="rounded-lg bg-accent px-4 text-base font-semibold text-ink disabled:opacity-40 sm:px-6"
                >
                  Act
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Sidebar — right rail on desktop, slide-over drawer on mobile */}
        {state && (
          <Sidebar
            state={state}
            combat={combat}
            npcRelations={npcRelations}
            sceneCard={sceneCard}
            jobs={jobs}
            playerLedger={playerLedger}
            facts={facts}
            onFlagFact={flagFact}
            onJobAction={busy ? undefined : (c) => send(c)}
            onRefresh={refreshState}
            mobileOpen={showSheet}
            onClose={() => setShowSheet(false)}
          />
        )}
      </div>
    </div>
  );
}
