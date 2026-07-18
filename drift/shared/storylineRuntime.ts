import type { CampaignState } from "./schemas";
import type { EngineEvent } from "@/engine/events";
import type { NpcRelations } from "./scene";
import type { Fact } from "./facts";
import type { PackStoryline } from "@/content/pack/types";
import type { TurnSignals } from "./quests";
import { applyRep } from "./jobsRuntime";
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
 * chapters (credits + faction rep, same rep-clamp as job rewards), and marks
 * the beat this turn actually delivered (trap 4 — only ever called with a
 * beat computed BEFORE the turn ran, and only from a caller that reached a
 * successful turn).
 */

export interface StorylineTurnResult {
  storyline: StorylineState;
  /** Mutated state (credits + faction rep for any chapter that paid out). */
  state: CampaignState;
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
  const { content, state, npcRelations, facts, signals } = input;
  const tenday = state.campaign.tendaysElapsed ?? 0;
  const lines: string[] = [];
  const events: EngineEvent[] = [];

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
  }

  if (input.deliveredBeat) {
    storyline = markBeatDelivered(storyline, input.deliveredBeat, tenday);
  }

  return { storyline, state: nextState, lines, events };
}
