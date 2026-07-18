import type { CampaignState, Character } from "./schemas";
import type { EngineEvent } from "@/engine/events";
import { type NpcRelations, appendRelationLog, TRUST_THRESHOLD } from "./scene";
import type { Fact } from "./facts";
import type { PackStoryline } from "@/content/pack/types";
import type { TurnSignals } from "./quests";
import { applyRep } from "./jobsRuntime";
import { catalogItem, slotsUsed, maxSlotsFor } from "./items";
import {
  evaluateTriggers,
  advanceStoryline,
  markBeatDelivered,
  type StorylineState,
  type NextBeat,
} from "./storyline";

/**
 * The thin, PURE bridge between a resolved turn and the storyline (mirrors
 * shared/jobsRuntime.ts over shared/quests.ts): runs the engine-owned trigger
 * check + objective advance over the turn's real signals, PAYS OUT completed
 * chapters (credits + faction rep + an optional signature item/crew unlock,
 * same rep-clamp as job rewards), and marks the beat this turn actually
 * delivered (trap 4 — only ever called with a beat computed BEFORE the turn
 * ran, and only from a caller that reached a successful turn).
 */

/** Best armor bonus in a gear list — duplicated from llm/runtimeEconomy.ts's
 *  bestArmor rather than imported: shared/ must never depend on llm/ (same
 *  reasoning as shared/storyline.ts's duplicated npcIsGone). */
function bestArmorBonus(gear: Character["gear"]): number {
  return Math.max(0, ...gear.map((g) => g.acBonus ?? (g.itemId ? (catalogItem(g.itemId)?.acBonus ?? 0) : 0)));
}

/** Grant a signature item reward (HANDOFF_STORY_2.md Task D) — the SAME
 *  full-pack-safe rule the loot/shop flow uses (llm/runtimeEconomy.ts's gear
 *  gain path): a stack grows freely; a genuinely new piece that would push
 *  the character over capacity is PARKED instead of silently lost (trap 5).
 *  Pure — the caller applies `pendingPickup` onto sceneCard itself. */
function grantSignatureItem(
  character: Character,
  itemId: string,
  chapterTitle: string,
): { character: Character; line: string; pendingPickup?: { name: string; itemId?: string } } {
  const cat = catalogItem(itemId);
  if (!cat) return { character, line: "" }; // validatePack guarantees this resolves; defensive no-op only
  const existing = character.gear.find((g) => g.itemId === cat.id);
  const gear = existing
    ? character.gear.map((g) => (g === existing ? { ...g, qty: (g.qty ?? 1) + 1 } : g))
    : [
        ...character.gear,
        {
          name: cat.name,
          itemId: cat.id,
          qty: 1,
          detail: `a reward from "${chapterTitle}"`,
          ...(cat.damage ? { damage: cat.damage } : {}),
          ...(cat.acBonus ? { acBonus: cat.acBonus } : {}),
        },
      ];
  if (!existing && slotsUsed({ ...character, gear }) > maxSlotsFor(character)) {
    return {
      character,
      line: `📖 Reward pending — ${cat.name} won't fit; drop something to take it.`,
      pendingPickup: { name: cat.name, itemId: cat.id },
    };
  }
  const ac = cat.acBonus ? 10 + (character.attributes?.reflex ?? 0) + bestArmorBonus(gear) : character.ac;
  return { character: { ...character, gear, ac }, line: `📖 Reward: ${cat.name}` };
}

export interface StorylineTurnResult {
  storyline: StorylineState;
  /** Mutated state (credits + faction rep + a signature item for any chapter
   *  that paid out). */
  state: CampaignState;
  /** Relations after any crewUnlock reward. Unchanged if none paid out. */
  npcRelations: NpcRelations;
  /** Set when a signature item reward didn't fit the pack — the caller must
   *  park this on sceneCard.pendingPickup so the existing swap chips can
   *  offer it (trap 5; kept out of this function's inputs/outputs otherwise
   *  so the storyline bridge stays decoupled from scene-memory machinery). */
  pendingPickup?: { name: string; itemId?: string };
  /** 📖 display lines for the transcript (chapter open/advance/complete/payout). */
  lines: string[];
  /** resource EngineEvents (credits/rep) so the dice log mirrors the payout. */
  events: EngineEvent[];
}

export function resolveStorylineTurn(input: {
  content: PackStoryline;
  storyline: StorylineState;
  state: CampaignState;
  npcRelations: NpcRelations;
  facts: Fact[];
  signals: TurnSignals;
  /** The beat that was fed to the narrator as THIS turn's context, if any —
   *  computed before the turn ran via shared/storyline.ts's nextBeat. Passing
   *  undefined marks nothing (no active chapter, or nothing left to deliver). */
  deliveredBeat?: NextBeat;
}): StorylineTurnResult {
  const { content, state, facts, signals } = input;
  const tenday = state.campaign.tendaysElapsed ?? 0;
  const lines: string[] = [];
  const events: EngineEvent[] = [];
  let npcRelations = input.npcRelations;
  let pendingPickup: { name: string; itemId?: string } | undefined;

  const triggerRes = evaluateTriggers(content, input.storyline, state, npcRelations, facts);
  lines.push(...triggerRes.lines);

  const advanceRes = advanceStoryline(content, triggerRes.storyline, signals);
  lines.push(...advanceRes.lines);

  let nextState = state;
  let storyline = advanceRes.storyline;

  for (const { chapter } of advanceRes.completed) {
    const credits = chapter.reward.credits;
    if (credits > 0) {
      const pc = nextState.characters.find((c) => c.kind === "pc");
      if (pc) {
        nextState = {
          ...nextState,
          characters: nextState.characters.map((c) => (c.id === pc.id ? { ...c, credits: (c.credits ?? 0) + credits } : c)),
        };
        events.push({
          type: "resource",
          breakdown: `Payment: +¢${credits} (${chapter.title})`,
          field: "credits",
          delta: credits,
        });
        lines.push(`📖 Reward paid: +¢${credits}`);
      }
    }
    if (chapter.reward.factionRep) {
      const { factionId, delta } = chapter.reward.factionRep;
      nextState = { ...nextState, factionRep: applyRep(nextState.factionRep, nextState.campaign.id, factionId, delta) };
      events.push({
        type: "resource",
        breakdown: `Standing: ${factionId} ${delta >= 0 ? "+" : ""}${delta}`,
        field: "rep",
        delta,
      });
    }
    // Signature item (HANDOFF_STORY_2.md Task D) — full-pack-safe (trap 5).
    if (chapter.reward.itemId) {
      const pc = nextState.characters.find((c) => c.kind === "pc");
      if (pc) {
        const granted = grantSignatureItem(pc, chapter.reward.itemId, chapter.title);
        nextState = {
          ...nextState,
          characters: nextState.characters.map((c) => (c.id === pc.id ? granted.character : c)),
        };
        if (granted.line) lines.push(granted.line);
        if (granted.pendingPickup) pendingPickup = granted.pendingPickup;
      }
    }
    // Crew unlock — raises the NPC to recruit-eligibility (disposition to at
    // least TRUST_THRESHOLD, never lowered); recruitOffer still gates on
    // berth/presence as normal. A relation log line records why.
    if (chapter.reward.crewUnlock) {
      const npcId = chapter.reward.crewUnlock;
      const rel = { ...(npcRelations[npcId] ?? { disposition: 0 }) };
      if (rel.disposition < TRUST_THRESHOLD) rel.disposition = TRUST_THRESHOLD;
      appendRelationLog(rel, `Earned your trust through "${chapter.title}".`);
      npcRelations = { ...npcRelations, [npcId]: rel };
      const npcName = nextState.npcs.find((n) => n.id === npcId)?.name ?? "They";
      lines.push(`📖 ${npcName} would sign on with you now.`);
    }
  }

  if (input.deliveredBeat) {
    storyline = markBeatDelivered(storyline, input.deliveredBeat, tenday);
  }

  return { storyline, state: nextState, npcRelations, ...(pendingPickup ? { pendingPickup } : {}), lines, events };
}
