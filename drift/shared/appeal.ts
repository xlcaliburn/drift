import { z } from "zod";

/**
 * APPEAL — the player's escalation to a stronger judge (Sonnet). When the routine
 * narrator and the engine desync (an NPC "gave" a stim that never landed, a payment
 * that didn't apply, damage that shouldn't have), the player types
 *   APPEAL: I should have a stim
 * and the engine sends the recent history + state + the request to Sonnet, which
 * rules on what SHOULD have happened and returns engine-legal adjustments the engine
 * applies. Auto-applied, but every appeal is logged for review.
 */

/** Matches a leading "APPEAL:" / "/appeal" (case-insensitive, optional colon). */
export const APPEAL_PREFIX = /^\s*(?:appeal|\/appeal)\b\s*:?\s*/i;

export function isAppeal(text: string): boolean {
  return APPEAL_PREFIX.test(text ?? "");
}

/** The complaint with the APPEAL marker stripped. */
export function stripAppeal(text: string): string {
  return (text ?? "").replace(APPEAL_PREFIX, "").trim();
}

/**
 * One engine-legal correction the judge can order. Deliberately a small, explicit
 * set — the engine still clamps every value (HP ≤ max, credits ≥ 0, disposition
 * ∈ [-3,3], sane deltas), so "broad" means "any of these", not "anything at all".
 */
export const AppealAdjustment = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("grantItem"), name: z.string().min(1), qty: z.number().int().min(1).max(5).optional() }),
  z.object({ kind: z.literal("removeItem"), name: z.string().min(1) }),
  z.object({ kind: z.literal("adjustHp"), delta: z.number().int(), reason: z.string().optional() }),
  z.object({ kind: z.literal("adjustCredits"), delta: z.number().int(), reason: z.string().optional() }),
  z.object({ kind: z.literal("adjustStims"), delta: z.number().int() }),
  z.object({ kind: z.literal("adjustDisposition"), npc: z.string().min(1), delta: z.number().int() }),
  z.object({ kind: z.literal("clearInjury"), name: z.string().min(1) }),
]);
export type AppealAdjustment = z.infer<typeof AppealAdjustment>;

/** The judge's structured verdict. */
export const AppealRuling = z.object({
  /** Did the appeal have merit? (false = denied, no adjustments applied.) */
  granted: z.boolean(),
  /** Short, player-facing explanation of the ruling (2-4 sentences). */
  ruling: z.string().min(1),
  /** Engine-legal corrections to apply (empty when denied). */
  adjustments: z.array(AppealAdjustment).max(8).default([]),
});
export type AppealRuling = z.infer<typeof AppealRuling>;
