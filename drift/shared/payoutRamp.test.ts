import { describe, it, expect } from "vitest";
import type { CampaignState } from "./schemas";
import { payoutCeiling, clampPayoutTier, pcAdvancement } from "./payoutRamp";

function state(levels: number[], tendays = 0): CampaignState {
  return {
    campaign: { id: "c", tendaysElapsed: tendays },
    characters: [
      { id: "pc", kind: "pc", skills: levels.map((level, i) => ({ name: `s${i}`, level, ticks: 0 })) },
    ],
  } as unknown as CampaignState;
}

describe("payoutRamp — progression-gated reward ceiling (trap-free)", () => {
  it("sums the PC's skill levels as the advancement signal", () => {
    expect(pcAdvancement(state([2, 1, 1, 1, 0]))).toBe(5);
  });

  it("caps a fresh, tendays-0 rookie at T1 (the reported Agnes case)", () => {
    expect(payoutCeiling(state([2, 1, 1, 1, 0, 0, 0]))).toBe("T1"); // adv 5, days 0
    expect(clampPayoutTier("T2", payoutCeiling(state([2, 1, 1, 1, 0])))).toBe("T1");
    expect(clampPayoutTier("T3", payoutCeiling(state([2, 1, 1, 1, 0])))).toBe("T1");
  });

  it("unlocks T2 once the character finds their feet (advancement OR time)", () => {
    expect(payoutCeiling(state([3, 2, 2, 1]))).toBe("T2"); // adv 8
    expect(payoutCeiling(state([2, 1, 1], 2))).toBe("T2"); // tendays 2
  });

  it("unlocks T3 only for an established character", () => {
    expect(payoutCeiling(state([4, 4, 3, 3]))).toBe("T3"); // adv 14
    expect(payoutCeiling(state([2, 1], 6))).toBe("T3"); // tendays 6
  });

  it("never raises a modest tier and always lets T0 errands through", () => {
    expect(clampPayoutTier("T0", "T3")).toBe("T0");
    expect(clampPayoutTier("T1", "T3")).toBe("T1"); // ceiling is a cap, not a floor
  });
});
