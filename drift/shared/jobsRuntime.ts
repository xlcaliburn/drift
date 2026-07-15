import type { CampaignState, FactionRep } from "./schemas";
import type { EngineEvent } from "@/engine/events";
import type { RNG } from "@/engine/rng";
import {
  advanceJobs,
  turnSignals,
  rollJobCredits,
  refreshBoard,
  acceptJob,
  abandonJob,
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
}

/** Bump a campaign's standing with a faction, creating the row if it's the first
 *  time. Clamped to the schema's -5..5 band. */
function applyRep(rep: FactionRep[], campaignId: string, factionId: string, delta: number): FactionRep[] {
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
}): JobsTurnResult {
  const { events, combatResolvedAlive, rng } = input;
  let state = input.state;
  const tenday = state.campaign.tendaysElapsed ?? 0;
  const signals = turnSignals(state.campaign.currentLocationId, events, combatResolvedAlive);

  const progress = advanceJobs(input.jobs, signals);
  const lines = [...progress.lines];
  const payEvents: EngineEvent[] = [];
  const pc = state.characters.find((c) => c.kind === "pc");

  for (const { job } of progress.completed) {
    if (!pc) break;
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
  }

  // Keep the offered board topped up (drops expired offers too). Active/complete
  // jobs pass through untouched.
  const jobs = refreshBoard(state, progress.jobs, rng, tenday, BOARD_SIZE);

  return { jobs, state, lines, events: payEvents };
}

/** Apply an accept/abandon click, then top the board up so a freshly-accepted job
 *  leaves an empty slot that refills. Returns the new board. */
export function applyJobClick(
  state: CampaignState,
  jobs: Job[],
  click: { acceptJobId?: string; abandonJobId?: string },
  rng: RNG,
): Job[] {
  let next = jobs;
  if (click.acceptJobId) next = acceptJob(next, click.acceptJobId);
  if (click.abandonJobId) next = abandonJob(next, click.abandonJobId);
  const tenday = state.campaign.tendaysElapsed ?? 0;
  return refreshBoard(state, next, rng, tenday, BOARD_SIZE);
}
