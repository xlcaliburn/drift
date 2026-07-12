import type { CampaignState } from "./schemas";
import { openingFor } from "@/content/openings";

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
  lines.push("WHERE THINGS STAND  (recap — free, no tokens spent)");

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
  if (opening && isFreshStart(state)) {
    return [...opening.firstMoves, "Look around and take stock"].slice(0, 4);
  }

  const active = state.threads.filter((t) => t.status === "active");
  const choices = active.slice(0, 3).map((t) => t.title);
  choices.push("Look around and take stock");
  return choices.slice(0, 4);
}
