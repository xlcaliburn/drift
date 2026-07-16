import type { CampaignState, Campaign } from "./schemas";
import type { NpcRelations } from "./scene";
import { ambitions } from "@/content/creation";

/**
 * BACKSTORY.md Phase 1 — the "backstory pressure" backstop. Context (an NPC tie, an
 * ambition, a moral code) is fed to the narrator every turn already, but nothing
 * ever forces the model to actually USE it — a live campaign ran 100+ turns with a
 * freshly-retconned love interest sitting in context, never once surfaced. This is
 * the engine-owned fix: like a tenday tick (crew wages, market rotation), track
 * tendays since a backstory beat last landed, and once it crosses a threshold, hand
 * the narrator an explicit, concrete directive instead of hoping it notices.
 *
 * Pure + deterministic (no RNG needed — this SELECTS the most significant anchor,
 * it doesn't roll for one), so it's fully unit-testable and safe to call every turn.
 */

/** How many tendays of silence before a backstory beat is forced. */
export const BACKSTORY_PRESSURE_TENDAYS = 4;

/** Is a backstory beat due? Undefined `lastBackstoryBeatTenday` means "never yet" —
 *  pressure is measured from campaign start (tenday 0), not exempted. */
export function backstoryPressureDue(campaign: Campaign): boolean {
  const since = (campaign.tendaysElapsed ?? 0) - (campaign.lastBackstoryBeatTenday ?? 0);
  return since >= BACKSTORY_PRESSURE_TENDAYS;
}

export type BackstoryBeat =
  | { kind: "npc"; npcId: string; npcName: string; note: string }
  | { kind: "ambition"; label: string; description: string }
  | { kind: "moralCode"; text: string };

/** Ids that never anchor a backstory beat — the patron already runs its own
 *  presence/safety-net system (STARTER.md); nudging it here would be redundant. */
function isPatronId(id: string): boolean {
  return id.startsWith("npc-patron-");
}

/**
 * Pick the single most significant backstory anchor available RIGHT NOW —
 * preferring a concrete personal NPC tie over the always-present fallbacks
 * (ambition, then moral code), so the pool is never empty for a real character.
 * Excludes NPCs already IN the scene (no point nudging toward someone already
 * there) and the patron (own system). Deterministic: highest disposition wins,
 * ties broken by id so two calls on the same state always agree.
 */
export function selectBackstoryBeat(
  state: CampaignState,
  npcRelations: NpcRelations,
  presentNpcIds: string[] = [],
): BackstoryBeat | null {
  const present = new Set(presentNpcIds);
  const candidates = Object.entries(npcRelations)
    .filter(([id, rel]) => !!rel.relationship && !present.has(id) && !isPatronId(id))
    .map(([id, rel]) => ({ id, rel, npc: state.npcs.find((n) => n.id === id) }))
    .filter((x): x is { id: string; rel: NpcRelations[string]; npc: NonNullable<(typeof x)["npc"]> } => !!x.npc)
    .sort((a, b) => b.rel.disposition - a.rel.disposition || a.id.localeCompare(b.id));

  if (candidates.length) {
    const top = candidates[0];
    return {
      kind: "npc",
      npcId: top.id,
      npcName: top.npc.name,
      note: top.rel.lastNote ?? top.rel.relationship!,
    };
  }

  const pc = state.characters.find((c) => c.kind === "pc");
  const ambition = pc?.ambition ? ambitions.find((a) => a.id === pc.ambition) : undefined;
  if (ambition) return { kind: "ambition", label: ambition.label, description: ambition.description };

  if (pc?.moralCode) return { kind: "moralCode", text: pc.moralCode };

  return null;
}
