import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

/** RNG that always returns the band minimum (rng.int(min, max) → min). */
const minRng: RNG = { int: (min: number) => min };
/** RNG that always returns the band maximum. */
const maxRng: RNG = { int: (_min: number, max: number) => max };

function stateWithPc(credits = 120): CampaignState {
  return {
    campaign: { id: "camp-p", currentLocationId: "loc-x", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Test", hp: 8, maxHp: 8, ac: 12, stims: 0,
        fragile: false, credits,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const pcCredits = (rt: TurnRuntime) => rt.state.characters[0].credits;

describe("award_payout — engine-clamped income", () => {
  it("rolls inside the tier band (T1 = 150-250)", () => {
    const lo = new TurnRuntime(stateWithPc(), minRng);
    expect((lo.execute("award_payout", { tier: "T1" }) as { amount: number }).amount).toBe(150);
    expect(pcCredits(lo)).toBe(270);

    const hi = new TurnRuntime(stateWithPc(), maxRng);
    expect((hi.execute("award_payout", { tier: "T1" }) as { amount: number }).amount).toBe(250);
  });

  it("negotiation success shades to the upper half; failure to the lower", () => {
    // T1 mid = 200. mood high + min-RNG → floor is the midpoint.
    const high = new TurnRuntime(stateWithPc(), minRng);
    expect((high.execute("award_payout", { tier: "T1", mood: "high" }) as { amount: number }).amount).toBe(200);
    // mood low + max-RNG → ceiling is the midpoint.
    const low = new TurnRuntime(stateWithPc(), maxRng);
    expect((low.execute("award_payout", { tier: "T1", mood: "low" }) as { amount: number }).amount).toBe(200);
  });

  it("rejects unknown tiers", () => {
    const rt = new TurnRuntime(stateWithPc(), minRng);
    expect(rt.execute("award_payout", { tier: "T9" })).toHaveProperty("error");
    expect(pcCredits(rt)).toBe(120);
  });
});

describe("adjust_resource credits clamp", () => {
  it("clamps model credit grants to the flavor cap (50)", () => {
    const rt = new TurnRuntime(stateWithPc(), minRng);
    rt.execute("adjust_resource", { targetId: "pc-1", field: "credits", delta: 5000 });
    expect(pcCredits(rt)).toBe(170); // 120 + 50, not 5120
  });

  it("clamps a single debit to the per-turn cap (500)", () => {
    const rt = new TurnRuntime(stateWithPc(1000), minRng);
    rt.execute("adjust_resource", { targetId: "pc-1", field: "credits", delta: -9999 });
    expect(pcCredits(rt)).toBe(500); // 1000 - 500
  });

  it("passes small legitimate deltas through untouched", () => {
    const rt = new TurnRuntime(stateWithPc(), minRng);
    rt.execute("adjust_resource", { targetId: "pc-1", field: "credits", delta: -30 });
    expect(pcCredits(rt)).toBe(90);
  });
});
