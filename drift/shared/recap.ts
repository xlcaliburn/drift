import type { CampaignState } from "./schemas";

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
    lines.push(`${ship.name}: ${ship.hp}/${ship.maxHp} hull${critical} · ${credits}buyout ¢${ship.buyoutRemaining}.`);
  }

  if (active.length) {
    const bullets = active.slice(0, 6).map((t) => `• ${t.title}`);
    lines.push(["Open threads:", ...bullets].join("\n"));
  }

  lines.push("What does Vess do?");
  return lines.join("\n\n");
}

/**
 * Suggested opening actions, derived from active threads — free (no API call).
 * Shown as clickable choices before the first turn.
 */
export function buildOpeningChoices(state: CampaignState): string[] {
  const active = state.threads.filter((t) => t.status === "active");
  const choices = active.slice(0, 3).map((t) => t.title);
  choices.push("Look around and take stock");
  return choices.slice(0, 4);
}
