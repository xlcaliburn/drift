import type Anthropic from "@anthropic-ai/sdk";
import type { CampaignState } from "./schemas";
import { openingFor } from "@/content/openings";
import { inTutorial, TUTORIAL_CHOICE_COUNT } from "./tutorial";

/** Stable id of the ship-ownership ("earn the title" / "earn a hull") thread. */
export const shipThreadId = (campaignId: string) => `th-ship-${campaignId}`;

/**
 * Does the player OWN their ship yet? The starting hull is a faction loaner; it
 * becomes theirs only when the ship-ownership thread is resolved (the narrator
 * does this once the title is earned). No thread at all → treat as owned (legacy
 * campaigns / hulls acquired in play). Callers should check `state.ship` first.
 */
export function shipIsOwned(state: CampaignState): boolean {
  const t = state.threads.find((t) => t.id === shipThreadId(state.campaign.id));
  return !t || t.status === "resolved";
}

/**
 * Is this a brand-new campaign that hasn't played a turn yet? Used to decide
 * whether to hand a newcomer concrete "here's what you can do" direction. The
 * starting quest thread (th-start-<id>) still being active on day 0 is a reliable
 * signal that no scene has resolved yet.
 */
function isFreshStart(state: CampaignState): boolean {
  return (
    state.campaign.tendaysElapsed === 0 &&
    state.threads.some((t) => t.id === `th-start-${state.campaign.id}` && t.status === "active")
  );
}

/**
 * Build the opening "where things stand" recap entirely from stored state.
 * This is static, derivable data — it must NEVER cost an API call. Shown as the
 * first line of the chat on load so the player has context for free.
 */
export function buildOpeningRecap(state: CampaignState): string {
  const loc = state.locations.find((l) => l.id === state.campaign.currentLocationId);
  const pc = state.characters.find((c) => c.kind === "pc");
  const ship = state.ship;
  const active = state.threads.filter((t) => t.status === "active");

  const lines: string[] = [];
  lines.push("WHERE THINGS STAND");

  if (state.campaign.situation) lines.push(state.campaign.situation);

  if (loc) {
    const desc = loc.description ? ` — ${loc.description.replace(/\.$/, "")}` : "";
    lines.push(`You're at ${loc.name}${desc}.`);
  }

  if (ship) {
    const critical = ship.hp / ship.maxHp < 0.34 ? " (critical)" : "";
    const credits = pc?.credits !== undefined ? `¢${pc.credits} on hand · ` : "";
    const ownership = shipIsOwned(state) ? "yours" : "on loan — not yet yours";
    lines.push(`${ship.name}: ${ship.hp}/${ship.maxHp} hull${critical} · ${credits}${ownership}.`);
  }

  if (active.length) {
    const bullets = active.slice(0, 6).map((t) => `• ${t.title}`);
    lines.push(["Open threads:", ...bullets].join("\n"));
  }

  // For a brand-new character, spell out concrete opening moves so the first
  // screen is a set of handholds, not a blank "what do you want to do?".
  const opening = openingFor(pc?.parentFactionId);
  if (opening && isFreshStart(state)) {
    const moves = opening.firstMoves.map((m) => `• ${m}`);
    lines.push([`Some ways to start (or do your own):`, ...moves].join("\n"));
  } else {
    lines.push(`What does ${pc?.name ?? "you"} do?`);
  }
  return lines.join("\n\n");
}

/**
 * Suggested opening actions — free (no API call), shown as clickable choices
 * before the first turn. For a fresh character these are the faction's concrete
 * first moves; otherwise they fall back to active-thread titles.
 */
export function buildOpeningChoices(state: CampaignState): string[] {
  const pc = state.characters.find((c) => c.kind === "pc");
  const opening = openingFor(pc?.parentFactionId);

  const base =
    opening && isFreshStart(state)
      ? [...opening.firstMoves, "Look around and take stock"]
      : (() => {
          const active = state.threads.filter((t) => t.status === "active");
          return [...active.slice(0, 3).map((t) => t.title), "Look around and take stock"];
        })();

  // Tutorial: the opening screen must honor the same binary-choice gating the
  // narrator's offer_choices does (which is clamped in engineBridge). Present a
  // single clear decision — the on-rails first move vs. a low-stakes look-around —
  // so a brand-new player never lands on a branching menu (e.g. "broker the deal").
  if (inTutorial(state)) {
    return [base[0], "Look around and take stock"].slice(0, TUTORIAL_CHOICE_COUNT);
  }
  return base.slice(0, 4);
}

/**
 * The in-world OPENING NARRATION — the cold-open the "DM" delivers before the
 * player's first action, derived from stored state (the campaign situation + the
 * starting quest framing). Pure and free. Distinct from buildOpeningRecap (which
 * is the meta "where things stand" panel); this reads as actual narration.
 */
export function buildOpeningNarration(state: CampaignState): string {
  const parts: string[] = [];
  if (state.campaign.situation) parts.push(state.campaign.situation);
  const start = state.threads.find(
    (t) => t.id === `th-start-${state.campaign.id}` && t.status === "active",
  );
  if (start?.body) parts.push(start.body);
  return parts.join("\n\n").trim();
}

/**
 * Seed the narrator's message history with the opening beat so the player's FIRST
 * action isn't sent to the model with empty history (which made the model re-offer
 * the just-accepted job). A lone assistant message would be stripped by
 * sanitizeHistory (history must start on a user turn), so we frame it as a
 * scene-start user directive + the assistant's opening narration.
 */
export function buildOpeningHistory(state: CampaignState): Anthropic.MessageParam[] {
  const opening = buildOpeningNarration(state);
  if (!opening) return [];
  return [
    { role: "user", content: "[The campaign opens — set the scene and pose the first decision.]" },
    { role: "assistant", content: opening },
  ];
}
