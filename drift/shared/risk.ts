/**
 * Engine-owned RISK-TIER model for offered choices.
 *
 * PROBLEM this fixes: the model used to tag each option with a difficulty
 * (easy/normal/hard → a FIXED DC 10/13/16). It tagged several options the same,
 * so two "perception at DC 13" choices looked identical, and a fixed DC ignored
 * THIS character's odds (a maxed specialist auto-passed; a novice auto-failed).
 *
 * FIX: the model picks a RISK tier — how big a gamble the option is — and the
 * ENGINE derives the DC from the acting character's own modifier so the success
 * chance is PREBALANCED and consistent across characters. The model narrates the
 * stakes (bigger payoff / worse consequence); the engine owns the odds.
 *
 * ── The math (bounded accuracy: roll d20 + modifier vs DC) ───────────────────
 *   P(d20 + mod ≥ DC) = (21 − (DC − mod)) / 20   for DC−mod in [1..20]
 *   Let FACE = DC − mod (what you must roll on the raw die). Then:
 *     FACE  5 → (21−5)/20  = 16/20 = 80%   → "safe"
 *     FACE 10 → (21−10)/20 = 11/20 = 55%   → "risky"
 *     FACE 15 → (21−15)/20 =  6/20 = 30%   → "reckless"
 *   So DC = modifier + FACE, with FACE = 5 / 10 / 15. Because the DC tracks the
 *   modifier, the success chance stays ~80/55/30% for every character.
 */

export type RiskTier = "safe" | "risky" | "reckless";

export const RISK_TIERS: RiskTier[] = ["safe", "risky", "reckless"];

/** FACE value (what the raw d20 must show) that yields each tier's target odds. */
const RISK_FACE: Record<RiskTier, number> = { safe: 5, risky: 10, reckless: 15 };

/** Target success percent per tier, for display (P = (21 − FACE) / 20). */
const RISK_ODDS: Record<RiskTier, number> = { safe: 80, risky: 55, reckless: 30 };

/** CheckSpec's DC band is 5..30; we clamp tighter so no tier is a trivial
 *  auto-pass or a mathematically impossible ask regardless of the modifier. */
const DC_MIN = 6;
const DC_MAX = 28;

/**
 * DC for a risk tier given the acting character's modifier, so their success
 * chance lands near the tier's target (safe ≈ 80%, risky ≈ 55%, reckless ≈ 30%).
 * DC = modifier + FACE(5/10/15), clamped to [6, 28].
 */
export function dcForRisk(risk: RiskTier, modifier: number): number {
  const dc = modifier + RISK_FACE[risk];
  return Math.max(DC_MIN, Math.min(DC_MAX, dc));
}

/** Target success percent for a tier (80 / 55 / 30) — for UI display. */
export function riskOdds(risk: RiskTier): number {
  return RISK_ODDS[risk];
}

/** Back-compat: legacy difficulty tags map onto the risk tiers. */
export function difficultyToRisk(
  d?: "easy" | "normal" | "hard" | null,
): RiskTier | undefined {
  if (!d) return undefined;
  return d === "easy" ? "safe" : d === "normal" ? "risky" : "reckless";
}
