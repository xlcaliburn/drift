import { describe, it, expect } from "vitest";
import { dcForRisk, riskOdds, difficultyToRisk, RISK_TIERS, type RiskTier } from "./risk";

/** Success chance for d20 + mod ≥ dc (bounded accuracy). */
function pSuccess(dc: number, mod: number): number {
  const face = dc - mod; // what the raw die must show
  if (face <= 1) return 1; // any roll clears it
  if (face > 20) return 0; // impossible
  return (21 - face) / 20;
}

describe("dcForRisk — DC tracks the modifier so odds stay prebalanced", () => {
  it("hits the target FACE (5/10/15) at a modest modifier", () => {
    // mod +3 → safe DC 8 (face 5), risky DC 13 (face 10), reckless DC 18 (face 15)
    expect(dcForRisk("safe", 3)).toBe(8);
    expect(dcForRisk("risky", 3)).toBe(13);
    expect(dcForRisk("reckless", 3)).toBe(18);
  });

  it("keeps the target success chance stable across different modifiers", () => {
    // mods where the [6,28] clamp doesn't bite (safe needs mod≥1, reckless mod≤13)
    for (const mod of [2, 5, 8, 10]) {
      // clamp doesn't bite in this mod range, so odds land exactly on target
      expect(pSuccess(dcForRisk("safe", mod), mod)).toBeCloseTo(0.8, 5);
      expect(pSuccess(dcForRisk("risky", mod), mod)).toBeCloseTo(0.55, 5);
      expect(pSuccess(dcForRisk("reckless", mod), mod)).toBeCloseTo(0.3, 5);
    }
  });

  it("orders the tiers: safe DC < risky DC < reckless DC for a fixed modifier", () => {
    for (const mod of [-2, 0, 4, 9]) {
      expect(dcForRisk("safe", mod)).toBeLessThan(dcForRisk("risky", mod));
      expect(dcForRisk("risky", mod)).toBeLessThan(dcForRisk("reckless", mod));
    }
  });

  it("clamps to [6, 28] at extreme modifiers", () => {
    // Very low mod: safe would fall below 6 → clamped up to 6.
    expect(dcForRisk("safe", -5)).toBe(6); // -5 + 5 = 0 → 6
    // Very high mod: reckless would exceed 28 → clamped down to 28.
    expect(dcForRisk("reckless", 20)).toBe(28); // 20 + 15 = 35 → 28
    // Every result stays within the band regardless of input.
    for (const mod of [-50, -10, 0, 10, 50]) {
      for (const r of RISK_TIERS) {
        const dc = dcForRisk(r, mod);
        expect(dc).toBeGreaterThanOrEqual(6);
        expect(dc).toBeLessThanOrEqual(28);
      }
    }
  });
});

describe("riskOdds — display percentages", () => {
  it("returns 80 / 55 / 30", () => {
    expect(riskOdds("safe")).toBe(80);
    expect(riskOdds("risky")).toBe(55);
    expect(riskOdds("reckless")).toBe(30);
  });
});

describe("difficultyToRisk — legacy mapping", () => {
  it("maps easy→safe, normal→risky, hard→reckless", () => {
    expect(difficultyToRisk("easy")).toBe<RiskTier>("safe");
    expect(difficultyToRisk("normal")).toBe<RiskTier>("risky");
    expect(difficultyToRisk("hard")).toBe<RiskTier>("reckless");
  });

  it("returns undefined for null/undefined", () => {
    expect(difficultyToRisk()).toBeUndefined();
    expect(difficultyToRisk(null)).toBeUndefined();
  });
});
