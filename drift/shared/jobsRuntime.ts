import type { CampaignState, FactionRep } from "./schemas";
import type { EngineEvent } from "@/engine/events";
import type { RNG } from "@/engine/rng";
import { type NpcRelations, DISPOSITION_MAX } from "./scene";
import {
  advanceJobs,
  turnSignals,
  rollJobCredits,
  refreshBoard,
  consumeJobCargo,
  type Job,
} from "./quests";

/**
 * DRIFT jobs runtime — the thin, PURE bridge between a resolved turn and the job
 * board (QUESTS.md). It runs the engine-owned completion tracker over the turn's
 * real signals, PAYS OUT completed jobs (credits from the tier band + faction rep),
 * tops the board back up, and folds accept/abandon clicks in — all as deterministic
 * TypeScript so the invariant holds (engine does the math; the narrator only
 * narrates). Kept out of engineBridge/runtime* so it never collides with the
 * engine-split refactor, and stays fully unit-testable.
 */

const BOARD_SIZE = 4;

export interface JobsTurnResult {
  jobs: Job[];
  /** Mutated state (credits + faction rep for any job that paid out this turn). */
  state: CampaignState;
  /** 🎯 display lines for the transcript (progress + payout). */
  lines: string[];
  /** resource EngineEvents (credits/rep) so the dice log mirrors the payout. */
  events: EngineEvent[];
  /** Relations after any personal-job arc resolution (RELATIONSHIPS.md) — the giver's
   *  standing is bumped and their arc marked resolved. Unchanged if no personal job
   *  paid out this turn. */
  npcRelations: NpcRelations;
}

/** Bump a campaign's standing with a faction, creating the row if it's the first
 *  time. Clamped to the schema's -5..5 band. Exported so shared/storylineRuntime.ts
 *  (HANDOFF_STORY_1 Task C) pays chapter rewards through the SAME rep-clamp rule
 *  as job rewards — one definition, never two. */
export function applyRep(rep: FactionRep[], campaignId: string, factionId: string, delta: number): FactionRep[] {
  const clamp = (n: number) => Math.max(-5, Math.min(5, n));
  const existing = rep.find((r) => r.factionId === factionId && r.campaignId === campaignId);
  if (existing) {
    return rep.map((r) =>
      r === existing ? { ...r, rep: clamp(r.rep + delta) } : r,
    );
  }
  return [...rep, { campaignId, factionId, rep: clamp(delta) }];
}

/**
 * Post-turn: advance active jobs from this turn's signals, pay out completions,
 * and refresh the offered board. `combatResolvedAlive` is true when a fight ended
 * this turn with the PC still standing (satisfies eliminate/survive objectives).
 */
export function resolveJobsTurn(input: {
  state: CampaignState;
  jobs: Job[];
  events: EngineEvent[];
  combatResolvedAlive: boolean;
  rng: RNG;
  npcRelations?: NpcRelations;
  /** NPCs present in the CURRENT scene — feeds the `report` objective kind
   *  (QUESTS.md 1b). Defaults to none for callers that don't track presence. */
  presentNpcIds?: string[];
}): JobsTurnResult {
  const { events, combatResolvedAlive, rng } = input;
  let state = input.state;
  let npcRelations = input.npcRelations ?? {};
  const tenday = state.campaign.tendaysElapsed ?? 0;
  const signals = turnSignals(state.campaign.currentLocationId, events, combatResolvedAlive, input.presentNpcIds);

  const progress = advanceJobs(input.jobs, signals);
  const lines = [...progress.lines];
  const payEvents: EngineEvent[] = [];
  const pc = state.characters.find((c) => c.kind === "pc");

  for (const { job } of progress.completed) {
    if (!pc) break;
    // Delivery jobs: the freight LEAVES the player's hands the moment the engine
    // detects completion — one crate, one fate (QUESTS.md 1b; the Wren audit's
    // sold-AND-delivered-AND-still-carried core).
    const handedOver = consumeJobCargo(state, job.id);
    if (handedOver.removedName) {
      state = handedOver.state;
      lines.push(`📦 Cargo handed over: ${handedOver.removedName}.`);
    }
    const credits = rollJobCredits(job.reward.tier, rng);
    state = {
      ...state,
      characters: state.characters.map((c) =>
        c.id === pc.id ? { ...c, credits: (c.credits ?? 0) + credits } : c,
      ),
    };
    payEvents.push({
      type: "resource",
      breakdown: `Payment: +¢${credits} (${job.reward.tier} — ${job.title})`,
      field: "credits",
      delta: credits,
    });
    lines.push(`🎯 Reward paid: +¢${credits}`);
    // Faction standing, when the job carried a rep reward.
    if (job.reward.repFactionId && job.reward.repDelta) {
      state = {
        ...state,
        factionRep: applyRep(state.factionRep, state.campaign.id, job.reward.repFactionId, job.reward.repDelta),
      };
      payEvents.push({
        type: "resource",
        breakdown: `Standing: ${job.reward.repFactionId} ${job.reward.repDelta >= 0 ? "+" : ""}${job.reward.repDelta}`,
        field: "rep",
        delta: job.reward.repDelta,
      });
    }
    // A PERSONAL job (giver is an NPC, not the board) resolves that NPC's arc
    // (RELATIONSHIPS.md): their want paid off in this campaign, so their standing
    // deepens and the arc closes. Campaign-side only — the shared NPC is untouched.
    if (job.giver !== "board") {
      const rel = npcRelations[job.giver];
      if (rel && rel.arcStage !== "resolved") {
        const npcName = state.npcs.find((n) => n.id === job.giver)?.name ?? "them";
        npcRelations = {
          ...npcRelations,
          [job.giver]: {
            ...rel,
            arcStage: "resolved",
            arcNote: `You came through on what they needed most — ${job.blurb}`.slice(0, 160),
            disposition: Math.min(DISPOSITION_MAX, rel.disposition + 1),
          },
        };
        lines.push(`❤ ${npcName} won't forget this — your bond deepened.`);
      }
    }
  }

  // Keep the offered board topped up (drops expired offers too). Active/complete
  // jobs pass through untouched.
  const jobs = refreshBoard(state, progress.jobs, rng, tenday, BOARD_SIZE);

  return { jobs, state, lines, events: payEvents, npcRelations };
}

// NOTE: an `applyJobClick(state, jobs, click, rng): Job[]` helper used to live
// here — REMOVED as dead code (the turn route applies accept/abandon clicks
// directly, because acceptance now mutates STATE too: cargo grant + cast
// materialization — a Job[]-only contract can't express that). Don't revive it;
// route.ts is the accept path.
