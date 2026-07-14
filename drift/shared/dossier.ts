import type { CampaignState, Character, WorldEvent } from "@/shared/schemas";
import type { CapabilityTier, Deed, Dossier } from "@/shared/multiplayer";

/**
 * Pure dossier deriver — builds a PC's PUBLIC profile so OTHER players' games
 * can cameo them as an NPC. Public projection only: no secrets, no full sheet.
 *
 * INVARIANT: pure/deterministic. No DB, no fetch, no Date.now — the persistence
 * layer stamps `updatedAt`. Given the same inputs it always returns the same
 * value, so it is trivially unit-testable.
 */

/** Skills that speak to how dangerous someone is in a fight. */
const COMBAT_SKILLS = ["smallArms", "melee", "gunnery"] as const;
/** Attributes (stored as modifiers) that matter in a fight. */
const COMBAT_ATTRS = ["might", "reflex", "perception"] as const;

function skillLevel(pc: Character, name: string): number {
  return pc.skills.find((s) => s.name === name)?.level ?? 0;
}

/**
 * Deterministic capability tier from combat-relevant skill LEVELS (0–10 each)
 * plus the best combat attribute modifier.
 *
 *   combatScore = 2 * topCombatSkill + secondCombatSkill   (reward a specialist,
 *                 credit some breadth)
 *   attrBonus   = max(0, best of {might, reflex, perception} modifier)
 *   score       = combatScore + attrBonus
 *
 * Thresholds (a specialist maxing one skill at lvl 10 with a +4 attribute scores
 * ~24 → elite; a rookie with lvl 0 combat and flat attributes scores 0 → green):
 *   green      score <=  5   — untrained / non-combatant
 *   capable    score  6–11   — can handle themselves
 *   dangerous  score 12–19   — a real threat
 *   elite      score >= 20   — top of the food chain
 *
 * e.g. Vess (smallArms1/melee0/gunnery2, reflex +4): 2*2+1 + 4 = 9 → capable.
 */
export function deriveCapabilityTier(pc: Character): CapabilityTier {
  const combatLevels = COMBAT_SKILLS.map((s) => skillLevel(pc, s)).sort((a, b) => b - a);
  const combatScore = 2 * (combatLevels[0] ?? 0) + (combatLevels[1] ?? 0);
  const attrBonus = Math.max(0, ...COMBAT_ATTRS.map((a) => pc.attributes[a]));
  const score = combatScore + attrBonus;

  if (score <= 5) return "green";
  if (score <= 11) return "capable";
  if (score <= 19) return "dangerous";
  return "elite";
}

/** Death check — mirrors the engine's `TurnRuntime.isDead` (a "Dead" injury).
 *  Inlined rather than imported: the deriver must not depend on `drift/llm`. */
function isDead(pc: Character): boolean {
  return (pc.injuries ?? []).some((i) => i.name === "Dead");
}

/** First sentence of a blurb, trimmed — keeps assembled voice notes to one line. */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const stop = trimmed.search(/[.;]\s/);
  return (stop === -1 ? trimmed : trimmed.slice(0, stop)).trim();
}

/**
 * One-line identity/voice cue for GMs playing this PC as an NPC. Prefers the
 * character's authored `voiceNotes` (written for exactly this), else assembles a
 * cue from background + alignment + ambition. Deterministic; capped short.
 */
function buildVoiceNotes(pc: Character): string | undefined {
  if (pc.voiceNotes && pc.voiceNotes.trim()) {
    return firstSentence(pc.voiceNotes).slice(0, 160) || undefined;
  }
  const parts: string[] = [];
  if (pc.background && pc.background.trim()) parts.push(firstSentence(pc.background));
  if (pc.alignment) parts.push(pc.alignment);
  if (pc.ambition && pc.ambition.trim()) parts.push(firstSentence(pc.ambition));
  if (parts.length === 0) return undefined;
  return parts.join("; ").slice(0, 160);
}

/** Map world events → public deeds, most recent first, capped. */
function buildDeeds(worldEvents: WorldEvent[], cap = 5): Deed[] {
  return [...worldEvents]
    // Most recent first; undated events sort last but keep their relative order.
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, cap)
    .map((e) => ({
      id: e.id,
      headline: e.headline,
      factionIds: e.factionIds ?? [],
      notoriety: "known" as const,
      at: e.createdAt,
    }));
}

/**
 * Build the public dossier for a campaign's PC. `worldEvents` is expected to be
 * pre-filtered by the caller (e.g. to this campaign's canon events); this
 * function just maps and caps them.
 */
export function buildDossier(state: CampaignState, worldEvents: WorldEvent[]): Dossier {
  const pc = state.characters.find((c) => c.kind === "pc");
  if (!pc) {
    throw new Error(`buildDossier: campaign ${state.campaign.id} has no PC character`);
  }

  const factionId = pc.ownFactionId ?? pc.parentFactionId;
  // Standing label from the PC's own faction rep, when present — else undefined.
  const standing = factionId
    ? state.factionRep.find((r) => r.factionId === factionId)?.standing
    : undefined;

  return {
    characterId: pc.id,
    campaignId: state.campaign.id,
    universeId: state.universe.id,
    name: pc.name,
    factionId,
    role: undefined,
    reputation: undefined,
    capabilityTier: deriveCapabilityTier(pc),
    standing,
    locationId: state.campaign.currentLocationId,
    alive: !isDead(pc),
    deeds: buildDeeds(worldEvents),
    voiceNotes: buildVoiceNotes(pc),
    updatedAt: undefined,
  };
}
