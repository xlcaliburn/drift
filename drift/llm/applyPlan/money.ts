import { payoutCeiling, clampPayoutTier, type PayoutTier } from "@/shared/payoutRamp";
import type { PlanHandler } from "./types";

/**
 * Payouts and offers — the engine-owned money moves. A negotiation success THIS
 * turn shades the figure to the upper half of the band (a failure to the lower);
 * a green rookie's tier is clamped DOWN to what the campaign's advancement earned,
 * so the narrator calling a job "big" can't hand out major-score money.
 */
export const money: PlanHandler = (plan, { runtime, pc, emit, toolCalls, lastRoll, preState }) => {
  const negotiationMood: "high" | "low" | undefined =
    lastRoll?.skill === "negotiation" ? (lastRoll.outcome === "success" ? "high" : "low") : undefined;
  const rewardCeiling = payoutCeiling(preState);

  if (plan.payout && pc) {
    toolCalls.push("award_payout");
    const tier = clampPayoutTier(plan.payout.tier as PayoutTier, rewardCeiling);
    const res = runtime.execute("award_payout", {
      tier,
      reason: plan.payout.reason,
      mood: negotiationMood,
    }) as { amount?: number; tier?: string; error?: string };
    if (res.amount) emit([`💰 Payment: +¢${res.amount} (${tier})`]);
  }
  // OFFERS: bids/quotes the model presented (a job's pay, a rival buyer's counter).
  // The model names a TIER; the engine rolls the bounded figure and shows it as a
  // system line — the real number the player sees, never a re-call to the model.
  if (plan.offers?.length) {
    const offerLines: string[] = [];
    for (const offer of plan.offers.slice(0, 3)) {
      const amount = runtime.quoteOffer(clampPayoutTier(offer.tier as PayoutTier, rewardCeiling), negotiationMood);
      if (amount != null) offerLines.push(`💰 ${offer.from?.trim() || "Offer"}: ~¢${amount}`);
    }
    if (offerLines.length) {
      toolCalls.push("quote_offer");
      emit(offerLines);
    }
  }
};
