import type { CampaignState } from "./schemas";

/** Job-reward tiers, low→high (mirrors economy.jobPayouts). */
export type PayoutTier = "T0" | "T1" | "T2" | "T3";
const ORDER: PayoutTier[] = ["T0", "T1", "T2", "T3"];

/**
 * How ADVANCED the player character is — the total skill levels they hold. A clean,
 * TRAP-FREE progress signal: it grows only by PLAYING (earning ticks), never by
 * wealth, so gating rewards on it can't strand a poor player. A freshly-created
 * character sits around 4-6.
 */
export function pcAdvancement(state: CampaignState): number {
  const pc = state.characters.find((c) => c.kind === "pc");
  return (pc?.skills ?? []).reduce((n, s) => n + Math.max(0, s.level ?? 0), 0);
}

/**
 * The highest payout tier a campaign has EARNED the right to see — a progression
 * ramp so a green, tendays-0 rookie can't be handed professional (T2) or major-score
 * (T3) money on day one just because the narrator called the job "big". Tracks
 * character advancement (levels earned through play) with campaign time (tendays) as
 * a second path, so either growing more capable OR playing longer unlocks bigger
 * jobs. Deliberately NOT wealth-based — that would be a poverty trap.
 *
 * Thresholds are intentionally simple/tunable:
 *   adv ≥ 14 or tendays ≥ 6  → T3 unlocked (established)
 *   adv ≥ 8  or tendays ≥ 2  → T2 unlocked (finding their feet)
 *   otherwise                → T1 ceiling (new — errands & standard jobs)
 */
export function payoutCeiling(state: CampaignState): PayoutTier {
  const adv = pcAdvancement(state);
  const days = state.campaign.tendaysElapsed ?? 0;
  if (adv >= 14 || days >= 6) return "T3";
  if (adv >= 8 || days >= 2) return "T2";
  return "T1";
}

/** Clamp a requested payout/offer tier DOWN to the campaign's earned ceiling (a
 *  tier at or below the ceiling passes through untouched; T0 errands always do). */
export function clampPayoutTier(requested: PayoutTier, ceiling: PayoutTier): PayoutTier {
  const ri = ORDER.indexOf(requested);
  const ci = ORDER.indexOf(ceiling);
  if (ri < 0) return requested; // unknown tier — leave to the engine to reject
  return ri > ci ? ceiling : requested;
}
